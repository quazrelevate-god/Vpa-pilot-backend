"""
AI Uploads API — bulk petition extraction (PA portal "AI Uploads" section).

Protected by the dashboard session (same as the rest of the PA portal API).
Frontend proxy maps /api/ai-uploads/* → /dashboard/api/ai-uploads/*.

  POST   /dashboard/api/ai-uploads/upload        bulk file upload → QUEUED rows
  GET    /dashboard/api/ai-uploads/               list (optional ?status=)
  GET    /dashboard/api/ai-uploads/{id}           one row
  PATCH  /dashboard/api/ai-uploads/{id}           save PA-edited fields
  POST   /dashboard/api/ai-uploads/{id}/approve   create case + ticket
  POST   /dashboard/api/ai-uploads/retry          re-queue failed rows (single/bulk)
  DELETE /dashboard/api/ai-uploads/batch/{id}     purge a batch (rows + files); rejects if any row is REVIEWED
"""
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.api.v1.dashboard import require_auth
from src.services.ai_upload_service import ai_upload_service

router = APIRouter(prefix="/dashboard/api/ai-uploads", tags=["AI Uploads"])


@router.post("/upload")
async def upload_batch(
    files: List[UploadFile] = File(...),
    category: str = Form(default=""),
    batch_id: str = Form(default=""),
    source: str = Form(default="ai_scan"),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    return JSONResponse(
        await ai_upload_service.create_batch(files, db, category=category, batch_id=batch_id, source=source),
        status_code=201,
    )


@router.get("")
async def list_uploads(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    # No trailing slash: the PA-portal proxy strips it, and a 307 redirect to the
    # slashed path would escape the proxy and lose the response.
    return JSONResponse(await ai_upload_service.list_uploads(db, status))


@router.get("/{upload_id}")
async def get_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    row = await ai_upload_service.get_upload(db, upload_id)
    if row is None:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return JSONResponse(row)


@router.patch("/{upload_id}")
async def update_upload(
    upload_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    try:
        return JSONResponse(await ai_upload_service.update_fields(db, upload_id, payload))
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)


@router.post("/{upload_id}/approve")
async def approve_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    try:
        return JSONResponse(await ai_upload_service.approve(db, upload_id, reviewed_by=user))
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/{upload_id}/dismiss")
async def dismiss_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Mark an awaiting-review upload as DISMISSED — reviewed by the PA with
    no ticket / citizen / appointment created. Used for courtesy audio, blank
    scans, duplicates. Row stays visible in the "All" segment only.
    """
    try:
        return JSONResponse(await ai_upload_service.dismiss(db, upload_id, reviewed_by=user))
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/retry")
async def retry_uploads(
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    ids = payload.get("ids") or []
    if not isinstance(ids, list) or not ids:
        return JSONResponse({"error": "ids (list) required"}, status_code=400)
    return JSONResponse(await ai_upload_service.retry(db, [int(i) for i in ids]))


@router.delete("/batch/{batch_id}")
async def delete_batch(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    user: str = Depends(require_auth),
):
    """Purge every AiUpload row in the batch and remove the underlying
    storage files. Refuses (400) if any row is already REVIEWED because
    those rows have a live Appointment + Ticket referencing the same
    storage_url — see delete_batch() for details."""
    try:
        return JSONResponse(await ai_upload_service.delete_batch(db, batch_id))
    except ValueError as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        await db.rollback()
        return JSONResponse({"error": str(e)}, status_code=500)
