"""
Time helpers.

`datetime.utcnow()` is deprecated in Python 3.12 and returns a naive datetime.
This codebase stores timestamps in naive `TIMESTAMP WITHOUT TIME ZONE` columns
and compares against naive datetimes throughout, so we standardise on a single
helper that returns **naive UTC** — identical in value to the old
`datetime.utcnow()`, just without the deprecation and defined in one place.

Deliberately naive (not tz-aware): switching to aware datetimes would mean
`can't compare offset-naive and offset-aware` errors against every existing
naive column/comparison. A move to tz-aware datetimes is a separate, larger
migration (would also alter the DB column types); this helper is the safe,
behaviour-preserving replacement for the deprecation.
"""
from __future__ import annotations

from datetime import datetime, timezone


def now_utc() -> datetime:
    """Current UTC time as a naive datetime (drop-in for datetime.utcnow())."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
