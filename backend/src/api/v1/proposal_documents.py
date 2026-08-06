"""
Proposal Documents — manifest + rendered page thumbnails + original passthrough.

Serves a Finder-style gallery of uploaded proposal files for the super_admin
Proposal Review surface. PDFs are rendered page-by-page on demand with PyMuPDF
and cached back into MinIO so re-visits are cheap.

Mounted at /api/v1/admin/proposals/{proposal_id}/documents so it rides the same
super_admin gate as proposal_review.py.
"""
from __future__ import annotations

import hashlib
import io
import logging
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.rbac import require_super_admin
from src.models.proposal_models import ProposalSubmission
from src.services.storage_service import (
    get_file_bytes, save_file, get_file_content_type,
)

logger = logging.getLogger("proposal_docs")

router = APIRouter(
    prefix="/api/v1/admin/proposals",
    tags=["Proposal Documents (super_admin)"],
    dependencies=[Depends(require_super_admin)],
)

_THUMB_CACHE_PREFIX = "proposal-thumbs"
_JPEG_QUALITY = 78
_DEFAULT_THUMB_W = 480
_MAX_THUMB_W = 1600


def _doc_id_for(storage_url: str) -> str:
    """Stable, URL-safe document id derived from its storage key.

    We don't persist a separate id — the storage key is already unique per file.
    """
    return hashlib.sha1((storage_url or "").encode("utf-8")).hexdigest()[:16]


def _find_doc(row: ProposalSubmission, doc_id: str) -> Optional[dict]:
    for d in (row.documents or []):
        if _doc_id_for(d.get("storage_url", "")) == doc_id:
            return d
    return None


def _kind_for(mime: Optional[str], filename: Optional[str]) -> str:
    """Classify a stored document. We optimistically treat unknown MIMEs as
    PDFs because PyMuPDF handles many formats, but if a proposal ever stores a
    truly opaque blob (e.g. a .docx), page rendering will 500 — that's caught
    and turned into a 500 response by the handler, not silently broken."""
    m = (mime or "").lower()
    if m.startswith("image/"):
        return "image"
    if m == "application/pdf" or (filename or "").lower().endswith(".pdf"):
        return "pdf"
    # Explicitly unknown — try PDF renderer (many formats work); it 500s if not.
    return "pdf"


def _page_count(raw: bytes, kind: str) -> int:
    if kind != "pdf":
        return 1
    try:
        import fitz  # PyMuPDF
        with fitz.open(stream=raw, filetype="pdf") as doc:
            return int(doc.page_count)
    except Exception as e:
        logger.warning("page_count failed: %s", repr(e))
        return 1


def _render_pdf_page_jpeg(raw: bytes, page_no: int, width: int) -> bytes:
    import fitz
    with fitz.open(stream=raw, filetype="pdf") as doc:
        if page_no < 1 or page_no > doc.page_count:
            raise HTTPException(status_code=404, detail="Page out of range.")
        page = doc.load_page(page_no - 1)
        # zoom to reach target pixel width (roughly 1.5x device pixels)
        src_w = page.rect.width or 1
        zoom = max(0.25, min(6.0, (width * 1.5) / src_w))
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        buf = io.BytesIO()
        # write via PIL for JPEG quality control
        try:
            from PIL import Image
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            # downscale if we overshot
            if img.width > width:
                new_h = int(img.height * (width / img.width))
                img = img.resize((width, new_h), Image.LANCZOS)
            img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
        except Exception:
            buf.write(pix.tobytes("jpeg"))
        return buf.getvalue()


def _render_image_jpeg(raw: bytes, width: int) -> bytes:
    from PIL import Image
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")
    if img.width > width:
        new_h = int(img.height * (width / img.width))
        img = img.resize((width, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
    return buf.getvalue()


# ── manifest ─────────────────────────────────────────────────────────────────
@router.get("/{proposal_id}/documents", summary="List document pages for a proposal")
async def list_documents(
    proposal_id: int, db: AsyncSession = Depends(get_db),
) -> dict:
    row = await db.get(ProposalSubmission, proposal_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")

    docs: List[dict] = []
    for d in (row.documents or []):
        storage_url = d.get("storage_url", "")
        if not storage_url:
            continue
        did = _doc_id_for(storage_url)
        filename = d.get("original_filename") or "document"
        mime = d.get("mime_type") or None
        kind = _kind_for(mime, filename)

        page_count = 1
        size_bytes: Optional[int] = None
        # For PDFs, open once to get page count. This is cheap.
        if kind == "pdf":
            try:
                raw = await _load_bytes(storage_url)
                if raw is not None:
                    size_bytes = len(raw)
                    page_count = _page_count(raw, kind)
            except Exception as e:
                logger.warning("manifest page_count failed for %s: %s", storage_url, repr(e))

        base = f"/api/v1/admin/proposals/{proposal_id}/documents/{did}"
        pages = [
            {"page_no": i, "thumb_url": f"{base}/pages/{i}.jpg?w={_DEFAULT_THUMB_W}"}
            for i in range(1, page_count + 1)
        ]
        docs.append({
            "id": did,
            "filename": filename,
            "mime": mime,
            "kind": kind,
            "size_bytes": size_bytes,
            "page_count": page_count,
            "pages": pages,
            "original_url": f"{base}/original",
        })

    return {"documents": docs}


async def _load_bytes(storage_url: str) -> Optional[bytes]:
    import asyncio
    return await asyncio.to_thread(get_file_bytes, storage_url)


# ── page thumbnail ───────────────────────────────────────────────────────────
@router.get(
    "/{proposal_id}/documents/{doc_id}/pages/{n}.jpg",
    summary="Rendered JPEG for a document page (cached)",
)
async def get_page_thumb(
    proposal_id: int, doc_id: str, n: int,
    w: int = Query(_DEFAULT_THUMB_W, ge=64, le=_MAX_THUMB_W),
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(ProposalSubmission, proposal_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    d = _find_doc(row, doc_id)
    if d is None:
        # 404 is the right code — the doc isn't there for this proposal. Auth
        # already succeeded (super_admin dep at router), so 403 (forbidden)
        # would confuse client-side error handling.
        raise HTTPException(status_code=404, detail="Document not found for this proposal.")

    cache_key = f"{_THUMB_CACHE_PREFIX}/{doc_id}/{n}-{w}.jpg"
    # Try cache first.
    try:
        cached = await _load_bytes(cache_key)
    except Exception:
        cached = None
    if cached:
        return Response(
            content=cached, media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    storage_url = d.get("storage_url", "")
    raw = await _load_bytes(storage_url)
    if raw is None:
        raise HTTPException(status_code=404, detail="Source file missing.")

    kind = _kind_for(d.get("mime_type"), d.get("original_filename"))
    try:
        if kind == "image":
            jpeg = _render_image_jpeg(raw, w)
        else:
            jpeg = _render_pdf_page_jpeg(raw, n, w)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("render failed proposal=%s doc=%s page=%s w=%s: %s",
                       proposal_id, doc_id, n, w, repr(e))
        raise HTTPException(status_code=500, detail="Render failed.")

    # Cache — swallow errors so a slow MinIO write doesn't break the response.
    try:
        import asyncio
        await asyncio.to_thread(save_file, jpeg, cache_key, "image/jpeg")
    except Exception as e:
        logger.warning("thumb cache write failed for %s: %s", cache_key, repr(e))

    return Response(
        content=jpeg, media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ── original passthrough ─────────────────────────────────────────────────────
@router.get(
    "/{proposal_id}/documents/{doc_id}/original",
    summary="Raw source file for a document (inline download)",
)
async def get_original(
    proposal_id: int, doc_id: str,
    db: AsyncSession = Depends(get_db),
) -> Response:
    row = await db.get(ProposalSubmission, proposal_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    d = _find_doc(row, doc_id)
    if d is None:
        # 404 is the right code — the doc isn't there for this proposal. Auth
        # already succeeded (super_admin dep at router), so 403 (forbidden)
        # would confuse client-side error handling.
        raise HTTPException(status_code=404, detail="Document not found for this proposal.")

    storage_url = d.get("storage_url", "")
    raw = await _load_bytes(storage_url)
    if raw is None:
        raise HTTPException(status_code=404, detail="Source file missing.")

    # Prefer the stored ContentType; fall back to the recorded mime.
    ctype = get_file_content_type(storage_url) or d.get("mime_type") or "application/octet-stream"
    fname = d.get("original_filename") or "document"
    # RFC 5987 filename* for non-ASCII (Tamil) filenames.
    disp = f"inline; filename*=UTF-8''{quote(fname)}"
    return Response(
        content=raw, media_type=ctype,
        headers={
            "Content-Disposition": disp,
            "Cache-Control": "private, max-age=3600",
        },
    )
