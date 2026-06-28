"""
Shared slowapi rate limiter.

A single Limiter instance must be registered on the FastAPI app
(app.state.limiter + the RateLimitExceeded handler + SlowAPIMiddleware in
main.py) for the @limiter.limit decorators to actually fire. Import THIS limiter
everywhere rather than constructing per-module limiters (which silently no-op
because they were never attached to the app).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
