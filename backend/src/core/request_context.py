"""
Per-request correlation id (P2-3, go-live review).

A single id is assigned to each HTTP request (honouring an inbound X-Request-ID
from nginx, else minted), stashed in a contextvar, echoed back on the response,
and injected into every log line via RequestIdFilter. That turns "why did
petition #1234 take 12s?" into a grep for one id across the whole request's logs.
"""
from __future__ import annotations

import contextvars
import logging
import secrets
from typing import Optional

# Default "-" so log records outside a request (startup, workers) still format.
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


def new_request_id() -> str:
    return secrets.token_hex(8)


def incoming_request_id(scope) -> Optional[str]:
    """Return a caller-supplied X-Request-ID from an ASGI scope, if present."""
    for k, v in (scope.get("headers") or []):
        if k == b"x-request-id":
            try:
                return (v.decode("latin-1").strip()[:64]) or None
            except Exception:
                return None
    return None


class RequestIdFilter(logging.Filter):
    """Inject the current request id onto every record as %(request_id)s."""
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True
