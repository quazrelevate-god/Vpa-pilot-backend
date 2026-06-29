"""
Standalone AI-upload worker.

Run as its own process so the heavy Gemini extraction is decoupled from the web
server (a web restart/deploy no longer interrupts processing, and the two scale
independently):

    cd backend
    python -m src.worker            # or under systemd / supervisor

It polls for QUEUED ai_uploads and processes them one at a time, reusing the same
claim/process logic as the in-process fallback. SELECT ... FOR UPDATE SKIP LOCKED
makes it safe to run this alongside the web process (or several workers) without
double-processing a row.
"""
import asyncio
import logging
import sys
import time

# psycopg async needs the selector loop on Windows (same as main.py).
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from src.core.logging_config import setup_logging, init_sentry

POLL_SECONDS = 5
CLEANUP_EVERY_SECONDS = 3600  # prune expired OTP/session rows hourly


async def main() -> None:
    setup_logging()
    init_sentry()
    log = logging.getLogger("ai_upload.worker")
    log.info("AI-upload worker started (poll=%ss)", POLL_SECONDS)

    from src.services.ai_upload_service import ai_upload_service
    from src.services import maintenance_service

    last_cleanup = 0.0
    while True:
        try:
            await ai_upload_service.recover_stale()
            while True:  # drain everything currently queued
                upload_id = await ai_upload_service._claim_next_queued()
                if upload_id is None:
                    break
                await ai_upload_service._process_one(upload_id)

            # Hourly housekeeping — keep auth tables from growing forever.
            if time.monotonic() - last_cleanup >= CLEANUP_EVERY_SECONDS:
                await maintenance_service.cleanup_expired()
                last_cleanup = time.monotonic()
        except Exception as e:  # never let the loop die
            log.exception("worker loop error: %s", e)
        await asyncio.sleep(POLL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
