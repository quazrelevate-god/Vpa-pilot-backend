"""
Shared slowapi rate limiter.

A single Limiter instance must be registered on the FastAPI app
(app.state.limiter + the RateLimitExceeded handler + SlowAPIMiddleware in
main.py) for the @limiter.limit decorators to actually fire. Import THIS limiter
everywhere rather than constructing per-module limiters (which silently no-op
because they were never attached to the app).

Key function: behind nginx, request.client.host is the PROXY's IP, so
get_remote_address would bucket every citizen together — the whole site would
then share one OTP limit and mass-429. Read the real client IP from
X-Forwarded-For (the first hop) so each citizen gets their own bucket.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address


def client_ip(request) -> str:
    """Real client IP, honouring the reverse proxy's X-Forwarded-For header."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # "client, proxy1, proxy2" — the first entry is the original client.
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return get_remote_address(request)


limiter = Limiter(key_func=client_ip)
