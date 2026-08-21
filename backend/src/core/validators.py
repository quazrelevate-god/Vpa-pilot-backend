"""Shared input validators for citizen-facing endpoints.

The Jinja templates and Next.js wizards all enforce the same shape client-
side (name: at least one letter, Latin OR Tamil block; mobile: [6-9]\\d{9}).
The server used to accept much looser input (min_length=1, no regex), so
a JS-off browser / curl / broken transpile could POST '<img src=x>', a
string of 500 spaces, or emojis as the citizen's legal name.

Every citizen intake endpoint (appointments/submit, referral/submit,
crowd intake, petition scan submit) SHOULD call one of these validators
so client + server share the same shape rule.
"""
from __future__ import annotations

import re
from typing import Optional


# Name: at least one letter (Latin or Tamil block), only letters + digits +
# space allowed. Matches the client-side regex in the templates. Deliberately
# does NOT accept punctuation, emoji, or control characters — a legal name
# doesn't need them and their presence is almost always intake garbage.
_NAME_RE = re.compile(r"^(?=.*[a-zA-Z஀-௿])[a-zA-Z0-9஀-௿ ]{1,150}$")

# Indian mobile: 10 digits starting 6-9.
_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")


def clean_name(name: Optional[str]) -> str:
    """Normalise + validate a citizen name. Raises ValueError on rejection.

    Trims, collapses inner whitespace. Rejects empty / non-matching input.
    """
    n = " ".join((name or "").split())
    if not n or not _NAME_RE.fullmatch(n):
        raise ValueError(
            "Name must be 1-150 chars, letters (English or Tamil) + digits + "
            "spaces only, with at least one letter."
        )
    return n


def clean_mobile(mobile: Optional[str]) -> str:
    """Normalise + validate a mobile number. Raises ValueError on rejection.

    Strips '+', spaces, hyphens. Strips a leading '91' country code (12
    digits total) since APM SMS expects the 10-digit form. Returns the
    normalised 10-digit number.
    """
    digits = "".join(c for c in (mobile or "") if c.isdigit())
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if not _MOBILE_RE.fullmatch(digits):
        raise ValueError(
            "Please enter a valid 10-digit Indian mobile number "
            "(starts with 6-9)."
        )
    return digits


def is_valid_name(name: Optional[str]) -> bool:
    """Non-raising sibling of clean_name — True when the name would pass."""
    try:
        clean_name(name)
        return True
    except ValueError:
        return False


def is_valid_mobile(mobile: Optional[str]) -> bool:
    """Non-raising sibling of clean_mobile."""
    try:
        clean_mobile(mobile)
        return True
    except ValueError:
        return False
