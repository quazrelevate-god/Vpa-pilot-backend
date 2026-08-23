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

from fastapi import APIRouter, Depends, Form, File, UploadFile, Request, Body, HTTPException
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from src.core.config import settings

from src.core.database import get_db
from src.core.dash_auth import require_auth
from src.core.dept_auth import require_department, create_dept_session_cookie, clear_dept_session_cookie
from src.core.rate_limit import limiter
from src.core.rbac import require_role
from src.models.department_account import DepartmentAccount, verify_password, needs_rehash, hash_password
from src.models.login_models import ROLE_PA, ROLE_SUPER_ADMIN
from src.models.school_department import SchoolDepartment, department_label, SCHOOL_DEPARTMENT_DISPLAY
from src.models.registry_models import DepartmentRegistry
from src.services import department_service
from src.services.storage_service import save_file

dept_router = APIRouter(prefix="/department", tags=["Department"])
# PA-only ticket actions (route into a department, forward out to a ministry)
# are terminal state transitions — gate the whole router to super_admin + PA
# so no auditor / dept_officer / petition_reviewer can trigger them.
pa_router = APIRouter(
    prefix="/dashboard/api/tickets",
    tags=["Ticketing (PA)"],
    dependencies=[Depends(require_role(ROLE_SUPER_ADMIN, ROLE_PA))],
)

_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
_MAX_BYTES = 15 * 1024 * 1024


# ── Reference (dept-workspace "forward to another dept" dropdown) ────────────
# DB-backed for parity with the PA-portal /api/v1/departments endpoint. Using
# the SchoolDepartment enum here silently returned the ORIGINAL 10 hardcoded
# departments, so a dept officer trying to forward to a Settings-added dept
# either didn't see it in the picker (this endpoint) OR the write side rejected
# it as "Unknown" (department_service._valid_department pre-fix).
@dept_router.get("/api/departments")
async def list_departments(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(DepartmentRegistry)
        .where(DepartmentRegistry.is_active.is_(True))
        .order_by(DepartmentRegistry.is_builtin.desc(), DepartmentRegistry.display_en)
    )).scalars().all()
    return JSONResponse([
        {"key": r.key, "label": r.display_en, "label_ta": r.display_ta}
        for r in rows
    ])


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


async def _dept_authorize_file(
    file_path: str,
    department: str,
    db: AsyncSession,
) -> None:
    """Row-level authorization for the /department/api/files/* endpoint.

    Before: any authenticated dept account could fetch ANY storage key it
    could name — a full IDOR to appointment PII scans, other departments'
    resolution proofs, ai_uploads bulk scans, proposal + association PDFs.
    The route delegated straight to serve_stored_file with no ownership
    check at all.

    Now: mirrors dashboard._authorize_file_access but scopes strictly to the
    caller's own department key. Dept users only ever legitimately need:
      - attachments/…      on an Appointment whose Ticket is routed to
                           their dept
      - ticket_attachments/… on a Ticket routed to their dept
      - ai_uploads/…       on an AiUpload approved into a Ticket routed
                           to their dept (the citizen's original PDF /
                           image / audio — AiUpload.storage_url doesn't
                           get relocated on approve, so the drawer's
                           preview URL still points at the ai_uploads/
                           key even after routing to a department)
    Every other namespace (proposals/, associations/) 403s — dept
    accounts don't have a UI surface for them and never should.
    """
    from sqlalchemy import func
    from src.models.appointment_models import AppointmentAttachment
    from src.models.ticket_models import Ticket, TicketAttachment
    from src.models.ai_upload_models import AiUpload

    _deny = HTTPException(status_code=403, detail="Not authorized to access this file.")

    if file_path.startswith("attachments/"):
        appt_id = (await db.execute(
            select(AppointmentAttachment.appointment_id)
            .where(AppointmentAttachment.storage_url == file_path)
            .limit(1)
        )).scalar_one_or_none()
        if appt_id is None:
            raise _deny
        allowed = await db.scalar(
            select(func.count(Ticket.id))
            .where(Ticket.appointment_id == appt_id)
            .where(Ticket.department == department)
        )
        if not allowed:
            raise _deny
        return

    if file_path.startswith("ticket_attachments/"):
        ticket_id = (await db.execute(
            select(TicketAttachment.ticket_id)
            .where(TicketAttachment.storage_url == file_path)
            .limit(1)
        )).scalar_one_or_none()
        if ticket_id is None:
            raise _deny
        t = await db.get(Ticket, ticket_id)
        if t is None or t.department != department:
            raise _deny
        return

    if file_path.startswith("ai_uploads/"):
        # AiUpload gets a ticket_id set only when a PA approves it into a
        # Ticket (see ai_upload_service.move_to_petition / dashboard_service
        # approval path). Rows still at AWAITING_REVIEW / DISMISSED have
        # ticket_id = NULL — those are PA-only and must remain a 403 for
        # dept accounts. scalar_one_or_none() collapses "no such row" and
        # "row exists with ticket_id NULL" to None — both correctly deny.
        ticket_id = (await db.execute(
            select(AiUpload.ticket_id)
            .where(AiUpload.storage_url == file_path)
            .limit(1)
        )).scalar_one_or_none()
        if ticket_id is None:
            raise _deny
        t = await db.get(Ticket, ticket_id)
        if t is None or t.department != department:
            raise _deny
        return

    # Fail-closed on every other namespace — dept has no UI for proposals/
    # associations/ and must never be able to enumerate them.
    raise _deny


@dept_router.get("/api/files/{file_path:path}")
async def dept_serve_upload(
    file_path: str,
    request: Request,
    department: str = Depends(require_department),
    db: AsyncSession = Depends(get_db),
):
    """Serve an uploaded file scoped by the dept session cookie AND
    row-level-scoped to the caller's own department (see _dept_authorize_file).

    Delegates to the shared streamer so the dept workspace gets the same
    behaviour as the PA portal: worker-thread MinIO fetches (no event-loop
    stalls), hard browser caching + 304, Range/audio-seek support, and the
    traversal-safe local-disk path resolution.
    """
    from src.api.v1.dashboard import serve_stored_file

    await _dept_authorize_file(file_path, department, db)
    return await serve_stored_file(file_path, request)


# ── Department auth ────────────────────────────────────────────────────────────
@dept_router.post("/api/login")
@limiter.limit("5/minute")
async def dept_login(request: Request, username: str = Form(...), password: str = Form(...),
                     db: AsyncSession = Depends(get_db)):
    acct = (await db.execute(
        select(DepartmentAccount).where(DepartmentAccount.username == username.strip())
    )).scalar_one_or_none()
    # Always call verify_password (even with None) so unknown-username and
    # wrong-password branches take the same time.
    ok = verify_password(password, acct.password_hash if acct else None)
    if acct is None or not ok:
        return JSONResponse({"error": "Invalid username or password."}, status_code=401)
    if needs_rehash(acct.password_hash):        # migrate legacy hash → PBKDF2
        acct.password_hash = hash_password(password)
        await db.commit()
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
    import secrets
    from src.services.appointment_service import appointment_service
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
        # Sanitize + unique token: the raw client filename must never go straight
        # into the object key. Unsanitized it (a) collides — two "photo.jpg" on one
        # ticket overwrite silently, (b) can 500 at store time on control chars /
        # 1000+ char names that break MinIO key limits, and (c) lets "../" leak on
        # local-disk reads. Mirrors every other attachment stream.
        safe = appointment_service._sanitize_filename(f.filename)
        rel = f"ticket_attachments/{ticket_id}/{secrets.token_hex(6)}_{safe}"
        url = await asyncio.to_thread(save_file, raw, rel, mime)
        metas.append({"storage_url": url, "mime_type": mime,
                      "file_size_bytes": len(raw), "original_filename": f.filename})
    return JSONResponse(await department_service.dept_resolve(db, ticket_id, department, remarks, metas))


@dept_router.post("/api/tickets/{ticket_id}/attachment")
async def dept_add_ticket_attachment(ticket_id: int, file: UploadFile = File(...),
                                     department: str = Depends(require_department),
                                     db: AsyncSession = Depends(get_db)):
    """Attach a supporting file (≤5 MB, image/PDF) to a ticket's case from the dept detail."""
    raw = await file.read()
    try:
        result = await department_service.dept_add_attachment(
            db, ticket_id, department, file.filename or "file", raw,
            file.content_type or "application/octet-stream",
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if result is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(result)


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
