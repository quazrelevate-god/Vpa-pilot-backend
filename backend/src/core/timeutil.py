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

from datetime import date, datetime, timedelta, timezone


def now_utc() -> datetime:
    """Current UTC time as a naive datetime (drop-in for datetime.utcnow())."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# The office runs on IST wall-clock. Comparing "today" against server-local
# time (the servers run UTC) drifts by 5h30 — daily rollovers that should fire
# at IST 00:00 fire at UTC 00:00 = IST 05:30, and "today" from UTC 18:30–23:59
# (= IST 00:00–05:30 the next day) is a day BEHIND the office's calendar.
# Every "did today's meeting already happen?" / "is this token still valid
# today?" / "midnight sweep" comparison MUST use these helpers.
IST_TZ = timezone(timedelta(hours=5, minutes=30))


def ist_now() -> datetime:
    """Current IST time as a naive datetime (tz-aware would ripple through
    every naive-column comparison in the codebase — keeping it naive keeps
    it a drop-in replacement for the many `datetime.now()` sites that were
    silently server-local before)."""
    return datetime.now(IST_TZ).replace(tzinfo=None)


def ist_today() -> date:
    """IST calendar date. Use this instead of `date.today()` anywhere the
    office's wall-clock day matters (daily QR tokens, midnight sweeps,
    "did today's meeting already happen?" checks)."""
    return datetime.now(IST_TZ).date()
