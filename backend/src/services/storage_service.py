"""
File storage service — abstracts local disk vs remote MinIO (S3-compatible).

Set FILE_STORAGE_ENDPOINT in .env to enable MinIO on VPS.
Leave it unset to fall back to local disk (default for VPS-hosted backend).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from src.core.config import settings


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
    except Exception:
        return None


def _bucket() -> str:
    return getattr(settings, "FILE_STORAGE_BUCKET", "vpa-uploads")


def save_file(data: bytes, relative_path: str, content_type: str = None) -> str:
    """
    Save file bytes. Returns the storage key/path.
    Uses MinIO if FILE_STORAGE_ENDPOINT is set, otherwise saves to local disk.
    """
    client = _get_client()
    if client:
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
    else:
        # Local disk
        full_path = Path("uploads") / relative_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(data)
        return str(full_path)


def get_file_url(storage_path: str) -> str:
    """
    Return a URL to serve the file.
    MinIO: returns a presigned URL (direct, time-limited, no auth needed).
    Local: returns /api/files/... path (goes through authenticated endpoint).
    """
    endpoint = getattr(settings, "FILE_STORAGE_ENDPOINT", None)
    if endpoint:
        # Normalize: strip any leading "uploads/" so old DB records
        # (uploads/audio/...) and new ones (audio/...) both resolve to
        # the same MinIO key.
        key = storage_path.replace("\\", "/")
        if key.startswith("uploads/"):
            key = key[len("uploads/"):]
        client = _get_client()
        if client:
            try:
                url = client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": _bucket(), "Key": key},
                    ExpiresIn=86400,  # 24 hours
                )
                return url
            except Exception:
                pass
        return f"{endpoint}/{_bucket()}/{key}"
    else:
        # Local disk — serve via authenticated /api/files/ endpoint
        p = storage_path.replace("\\", "/")
        idx = p.find("uploads/")
        rel = p[idx + len("uploads/"):] if idx != -1 else p
        return "/api/files/" + rel


def get_file_bytes(storage_path: str) -> Optional[bytes]:
    """Fetch raw bytes for a stored file."""
    client = _get_client()
    if client:
        key = storage_path.replace("\\", "/")
        if key.startswith("uploads/"):
            key = key[len("uploads/"):]
        try:
            obj = client.get_object(Bucket=_bucket(), Key=key)
            return obj["Body"].read()
        except Exception:
            return None
    else:
        p = Path(storage_path)
        return p.read_bytes() if p.exists() else None
