"""
Central logging setup. Call setup_logging() once at process start.

Replaces ad-hoc print() with a single levelled, timestamped logger config so the
PA office's ops can actually search/filter logs (and so Sentry can hook in).
Level follows DEBUG in settings; format is consistent across web + worker.
"""
import logging
import re as _re
import sys

from src.core.config import settings
from src.core.request_context import RequestIdFilter

_CONFIGURED = False


def setup_logging() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    level = logging.DEBUG if settings.DEBUG else logging.INFO
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    # Stamp the per-request correlation id (default "-") onto every record so
    # the [%(request_id)s] field always resolves.
    handler.addFilter(RequestIdFilter())
    root = logging.getLogger()
    root.setLevel(level)
    # Avoid duplicate handlers on reload
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)

    # Silence noisy libraries — always, regardless of DEBUG flag
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.dialects").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("multipart").setLevel(logging.WARNING)
    # Uvicorn access log is useful but /health spam isn't — handled by filter below
    logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())
    _CONFIGURED = True


class _HealthCheckFilter(logging.Filter):
    """Drop noisy access-log lines. Static + favicon suppression is safe
    (substring); /health uses an exact-path regex so /health/ready and
    /health/deps stay visible — they're LB readiness probes and losing
    their log lines when the LB is flapping is a real observability hole.
    OBS-01: was `/health` substring which swallowed those child paths too.
    """
    _SKIP_SUBSTRINGS = ("/static/", "/favicon")
    # Match the classic access log format: `"GET /health HTTP/1.1"` or
    # `GET /health ` — bounded so /health/ready is NOT matched.
    _HEALTH_RE = _re.compile(r'\bGET\s+/health(\?[^\s"]*)?(\s|")')

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if any(s in msg for s in self._SKIP_SUBSTRINGS):
            return False
        if self._HEALTH_RE.search(msg):
            return False
        return True


def init_sentry() -> bool:
    """Initialise Sentry if SENTRY_DSN is set. Safe no-op otherwise."""
    if not settings.SENTRY_DSN:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            integrations=[FastApiIntegration()],
            traces_sample_rate=0.1,
            environment="production" if settings.COOKIE_SECURE else "development",
            send_default_pii=False,   # never ship citizen PII to Sentry
        )
        return True
    except Exception as e:  # never let monitoring break startup
        logging.getLogger(__name__).warning("Sentry init failed: %s", e)
        return False
