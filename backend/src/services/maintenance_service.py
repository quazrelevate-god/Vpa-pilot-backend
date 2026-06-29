"""
Background housekeeping — keep short-lived auth tables from growing forever.

otp_verifications and gatekeeper_sessions are write-heavy and only useful until
they expire. Nothing deleted them before, so they grew unbounded. This sweep
removes rows whose expires_at is well past, keeping a small grace window for
audit/debugging. Run from the standalone worker (see src/worker.py).
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import text

from src.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Keep recently-expired rows briefly for audit, then drop them.
RETENTION_HOURS = 24


async def cleanup_expired(retention_hours: int = RETENTION_HOURS) -> dict:
    """Delete expired OTP + gatekeeper-session rows older than the grace window."""
    cutoff = datetime.utcnow() - timedelta(hours=retention_hours)
    async with AsyncSessionLocal() as db:
        otp = await db.execute(
            text("DELETE FROM otp_verifications WHERE expires_at < :cutoff"),
            {"cutoff": cutoff},
        )
        sessions = await db.execute(
            text("DELETE FROM gatekeeper_sessions WHERE expires_at < :cutoff"),
            {"cutoff": cutoff},
        )
        await db.commit()
    result = {"otp_deleted": otp.rowcount, "sessions_deleted": sessions.rowcount}
    if result["otp_deleted"] or result["sessions_deleted"]:
        logger.info(
            "maintenance: pruned %s expired OTPs, %s expired sessions",
            result["otp_deleted"], result["sessions_deleted"],
        )
    return result
