"""
Department ticketing API.

  dept_router (/department)               — department login + their scoped workspace
  pa_router   (/dashboard/api/tickets)    — PA-only NEW actions (route, forward-external)

Department endpoints require the dept_session cookie (require_department); PA
endpoints require the staff cookie (require_auth). Existing ticket close/reopen
in dashboard.py are reused for the PA side.
"""
import asyncio
import mimetypes
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, Form, File, UploadFile, Request, Body
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from src.core.config import settings

from src.core.database import get_db
from src.core.dash_auth import require_auth
from src.core.dept_auth import require_department, create_dept_session_cookie, clear_dept_session_cookie
from src.core.rate_limit import limiter
from src.models.department_account import DepartmentAccount, verify_password
from src.models.school_department import SchoolDepartment, department_label, SCHOOL_DEPARTMENT_DISPLAY
from src.services import department_service
from src.services.storage_service import save_file

dept_router = APIRouter(prefix="/department", tags=["Department"])
pa_router = APIRouter(prefix="/dashboard/api/tickets", tags=["Ticketing (PA)"])

_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
_MAX_BYTES = 15 * 1024 * 1024


# ── Reference (both panels use this to populate the department dropdown) ───────
@dept_router.get("/api/departments")
async def list_departments():
    return JSONResponse([{"key": d.value, "label": department_label(d.value)} for d in SchoolDepartment])


# ── Authenticated file serving for department users ────────────────────────────
# Mirrors dashboard.py's /dashboard/api/files/... endpoint but gates on the
# dept_session cookie instead of dash_session. Every attachment URL surfaced
# in the dept workspace (both petition media and resolution proofs) is
# rewritten in department_service.get_detail from /api/files/... to
# /department/api/files/... so it hits this route.
#
# We use storage_service.get_file_bytes rather than reading files directly so
# BOTH storage backends (local disk in dev, MinIO in prod) are transparent,
# and so the read path always matches the write path (avoiding CWD-vs-package
# root drift that would otherwise 404 anything just uploaded).


@dept_router.get("/api/files/{file_path:path}")
async def dept_serve_upload(
    file_path: str,
    department: str = Depends(require_department),
):
    """Serve an uploaded file scoped by the dept session cookie."""
    from src.services.storage_service import get_file_bytes

    filename = PurePosixPath(file_path).name or "file"
    mime, _ = mimetypes.guess_type(filename)

    # storage_service.get_file_url strips the leading `uploads/` when
    # generating the URL, so the incoming file_path is bucket-relative. On
    # local-disk mode get_file_bytes reads via Path(storage_path) — that's
    # CWD-relative, so we prepend `uploads/` back on. In MinIO mode
    # get_file_bytes already strips the prefix again, so this is safe either
    # way.
    key = file_path if file_path.startswith("uploads/") else f"uploads/{file_path}"
    data = get_file_bytes(key)
    if data is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return Response(
        content=data,
        media_type=mime or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ── Department auth ────────────────────────────────────────────────────────────
@dept_router.post("/api/login")
@limiter.limit("5/minute")
async def dept_login(request: Request, username: str = Form(...), password: str = Form(...),
                     db: AsyncSession = Depends(get_db)):
    acct = (await db.execute(
        select(DepartmentAccount).where(DepartmentAccount.username == username.strip())
    )).scalar_one_or_none()
    if acct is None or not verify_password(password, acct.password_hash):
        return JSONResponse({"error": "Invalid username or password."}, status_code=401)
    resp = JSONResponse({"ok": True, "department": acct.department, "label": department_label(acct.department)})
    create_dept_session_cookie(resp, acct.department)
    return resp


@dept_router.post("/api/logout")
async def dept_logout():
    resp = JSONResponse({"ok": True})
    clear_dept_session_cookie(resp)
    return resp


@dept_router.get("/api/session")
async def dept_session(department: str = Depends(require_department)):
    return JSONResponse({"department": department, "label": department_label(department)})


# ── Department workspace (scoped to the logged-in department) ──────────────────
@dept_router.get("/api/tickets")
async def dept_tickets(status: str = "", department: str = Depends(require_department),
                       db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.list_for_department(db, department, status or None))


@dept_router.get("/api/counts")
async def dept_counts(department: str = Depends(require_department), db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.department_counts(db, department))


@dept_router.get("/api/tickets/{ticket_id}")
async def dept_ticket_detail(ticket_id: int, department: str = Depends(require_department),
                             db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.get_detail(db, ticket_id, department))


@dept_router.post("/api/tickets/{ticket_id}/accept")
async def dept_accept(ticket_id: int, department: str = Depends(require_department),
                      db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.dept_accept(db, ticket_id, department))


@dept_router.post("/api/tickets/{ticket_id}/forward")
async def dept_forward(ticket_id: int, to_department: str = Form(...), reason: str = Form(...),
                       department: str = Depends(require_department), db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.dept_forward(db, ticket_id, department, to_department, reason))


@dept_router.post("/api/tickets/{ticket_id}/progress")
async def dept_progress(ticket_id: int, note: str = Form(...), progress_pct: Optional[int] = Form(None),
                        department: str = Depends(require_department), db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.dept_progress(db, ticket_id, department, note, progress_pct))


@dept_router.post("/api/tickets/{ticket_id}/resolve")
async def dept_resolve(ticket_id: int, remarks: str = Form(...),
                       files: List[UploadFile] = File(...),
                       department: str = Depends(require_department), db: AsyncSession = Depends(get_db)):
    metas = []
    for f in files:
        if not f.filename:
            continue
        mime = f.content_type or "application/octet-stream"
        if mime not in _ALLOWED_MIMES:
            return JSONResponse({"error": f"Unsupported file type '{mime}'."}, status_code=400)
        raw = await f.read()
        if len(raw) > _MAX_BYTES:
            return JSONResponse({"error": f"'{f.filename}' exceeds 15 MB."}, status_code=400)
        rel = f"ticket_attachments/{ticket_id}/{f.filename}"
        url = await asyncio.to_thread(save_file, raw, rel, mime)
        metas.append({"storage_url": url, "mime_type": mime,
                      "file_size_bytes": len(raw), "original_filename": f.filename})
    return JSONResponse(await department_service.dept_resolve(db, ticket_id, department, remarks, metas))


# ── PA (monitoring) — NEW actions only ────────────────────────────────────────
@pa_router.post("/{ticket_id}/route")
async def pa_route(ticket_id: int, payload: dict = Body(...),
                   user: str = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.route_to_department(
        db, ticket_id, payload.get("department", ""), actor=user, note=payload.get("note")))


@pa_router.post("/{ticket_id}/forward-external")
async def pa_forward_external(ticket_id: int, payload: dict = Body(...),
                              user: str = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    return JSONResponse(await department_service.forward_external(
        db, ticket_id, payload.get("ministry", ""), payload.get("reason", ""), actor=user))
