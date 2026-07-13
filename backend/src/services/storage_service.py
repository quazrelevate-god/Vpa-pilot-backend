"""
File storage service — abstracts local disk vs remote MinIO (S3-compatible).

Set FILE_STORAGE_ENDPOINT in .env to enable MinIO on VPS.
Leave it unset to fall back to local disk (default for VPS-hosted backend).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from src.core.config import settings

logger = logging.getLogger("storage")


def _get_client():
    """Return a boto3 S3 client pointed at MinIO, or None if not configured."""
    endpoint = getattr(settings, "FILE_STORAGE_ENDPOINT", None)
    if not endpoint:
        return None
    try:
        import boto3
        from botocore.config import Config
        return boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=settings.FILE_STORAGE_ACCESS_KEY,
            aws_secret_access_key=settings.FILE_STORAGE_SECRET_KEY,
            region_name="us-east-1",
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
            ),
        )
    except Exception as e:
        logger.warning("MinIO client init failed (endpoint=%s): %s", endpoint, repr(e))
        return None


def _bucket() -> str:
    return getattr(settings, "FILE_STORAGE_BUCKET", "vpa-uploads")


def save_file(data: bytes, relative_path: str, content_type: str = None) -> str:
    """
    Save file bytes to MinIO and return the object key.

    Writes ALWAYS go to MinIO — in every environment (dev, local, prod). There
    is no local-disk fallback: silently writing to disk is what left uploads
    unviewable (stored on the app server, absent from MinIO). If object storage
    isn't configured/reachable, this raises so the misconfiguration is obvious
    instead of corrupting data onto local disk.
    """
    client = _get_client()
    if client is None:
        raise RuntimeError(
            "File storage (MinIO) is not configured — set FILE_STORAGE_ENDPOINT, "
            "FILE_STORAGE_ACCESS_KEY, FILE_STORAGE_SECRET_KEY and FILE_STORAGE_BUCKET. "
            "Refusing to write uploads to local disk."
        )
    # Ensure bucket exists (create if missing)
    try:
        client.head_bucket(Bucket=_bucket())
    except Exception:
        client.create_bucket(Bucket=_bucket())
    kwargs = {"Bucket": _bucket(), "Key": relative_path, "Body": data}
    if content_type:
        kwargs["ContentType"] = content_type
    client.put_object(**kwargs)
    return relative_path  # stored as MinIO object key


def get_file_url(storage_path: str) -> str:
    """
    Return a same-origin, session-authenticated URL to serve the file.

    Both storage modes now route through the /api/files/... endpoint on the
    backend, which streams bytes from local disk or MinIO server-side. This
    keeps attachments same-origin HTTPS (no mixed content), lets the existing
    dashboard session cookie authorize them, and avoids the SigV4 fragility
    of front-proxying presigned MinIO URLs through nginx.
    """
    from urllib.parse import quote

    p = storage_path.replace("\\", "/")
    # Strip a leading "uploads/" from either mode so the URL path is the same
    # bucket-relative / disk-relative key. MUST use startswith — a substring
    # match here silently ate the whole `ai_uploads/` prefix for AI-uploaded
    # petitions in MinIO mode, breaking every folder-scan / postal preview.
    rel = p[len("uploads/"):] if p.startswith("uploads/") else p
    # Percent-encode spaces + non-ASCII (Tamil filenames, folder names like
    # "direct pettition/…") while keeping "/" as the segment separator, so a
    # <object data="…"> or <img src="…"> preview doesn't 404 on the raw path.
    return "/api/files/" + quote(rel, safe="/")


def get_file_size(storage_path: str) -> Optional[int]:
    """Return the total byte size of a stored file, or None if missing.

    Used by the range-aware file server to build Content-Range / Content-Length
    headers without reading the whole object into memory first."""
    client = _get_client()
    if client:
        key = storage_path.replace("\\", "/")
        if key.startswith("uploads/"):
            key = key[len("uploads/"):]
        try:
            obj = client.head_object(Bucket=_bucket(), Key=key)
            return int(obj["ContentLength"])
        except Exception as e:
            logger.warning(
                "get_file_size MinIO head failed | bucket=%s key=%s err=%s",
                _bucket(), key, repr(e),
            )
            return None
    p = Path(storage_path)
    return p.stat().st_size if p.exists() else None


def get_file_range_bytes(storage_path: str, start: int, end: int) -> Optional[bytes]:
    """Return bytes [start, end] (inclusive) of a stored file, or None if missing.

    On MinIO the range is delegated to get_object so only the requested slice is
    transferred; on local disk we seek + read the slice directly."""
    client = _get_client()
    if client:
        key = storage_path.replace("\\", "/")
        if key.startswith("uploads/"):
            key = key[len("uploads/"):]
        try:
            obj = client.get_object(
                Bucket=_bucket(), Key=key, Range=f"bytes={start}-{end}"
            )
            return obj["Body"].read()
        except Exception as e:
            logger.warning(
                "get_file_range_bytes MinIO fetch failed | bucket=%s key=%s range=%s-%s err=%s",
                _bucket(), key, start, end, repr(e),
            )
            return None
    p = Path(storage_path)
    if not p.exists():
        return None
    with p.open("rb") as f:
        f.seek(start)
        return f.read(end - start + 1)


def get_file_bytes(storage_path: str) -> Optional[bytes]:
    """Fetch raw bytes for a stored file. Logs the underlying error on failure
    so 404s from the file-serving endpoint can be traced back to a real cause
    (bad creds, unreachable endpoint, missing key, wrong bucket, etc.)."""
    client = _get_client()
    if client:
        key = storage_path.replace("\\", "/")
        if key.startswith("uploads/"):
            key = key[len("uploads/"):]
        try:
            obj = client.get_object(Bucket=_bucket(), Key=key)
            return obj["Body"].read()
        except Exception as e:
            logger.warning(
                "get_file_bytes MinIO fetch failed | bucket=%s key=%s endpoint=%s err=%s",
                _bucket(), key, getattr(settings, "FILE_STORAGE_ENDPOINT", None), repr(e),
            )
            return None
    else:
        logger.warning(
            "get_file_bytes: no MinIO client (endpoint=%r access_key_set=%s). "
            "Falling back to local disk read.",
            getattr(settings, "FILE_STORAGE_ENDPOINT", None),
            bool(getattr(settings, "FILE_STORAGE_ACCESS_KEY", None)),
        )
        p = Path(storage_path)
        return p.read_bytes() if p.exists() else None
