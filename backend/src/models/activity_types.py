"""Canonical action_type strings for the unified Activity table.

Two shadow definitions used to live in ticket_service._EventType and
department_service.TicketEventType — they overlapped for a few common values
(closed / reopened / resolved / forwarded_to_dept) but drifted in others
(one file used ROUTED_TO_DEPARTMENT, the other REVERTED / REAPPROVED). One
edit had to be repeated in two places or the logs / audit trail would fall
out of sync. This module is the single source of truth.

Values are the string literals stored in Activity.action_type — never
change one without a data migration.
"""
from __future__ import annotations

from enum import Enum


class ActivityAction(str, Enum):
    # ── Ticket workflow ─────────────────────────────────────────────────
    STATUS_CHANGED       = "status_changed"
    PRIORITY_CHANGED     = "priority_changed"
    DISTRICT_CHANGED     = "district_changed"
    ASSIGNED             = "assigned"
    UNASSIGNED           = "unassigned"
    DUE_DATE_SET         = "due_date_set"
    COMMENT_ADDED        = "comment_added"
    # ── Ticket routing / closure ────────────────────────────────────────
    ROUTED_TO_DEPARTMENT = "routed_to_department"
    FORWARDED_TO_DEPT    = "forwarded_to_dept"
    CLOSED               = "closed"
    REOPENED             = "reopened"
    REVERTED             = "reverted"          # PA sent an OPEN ticket back to review
    REAPPROVED           = "reapproved"        # PA re-approved a reverted ticket
    # ── Department-side ─────────────────────────────────────────────────
    DEPARTMENT_ACCEPTED  = "department_accepted"
    DEPARTMENT_FORWARDED = "department_forwarded"
    PROGRESS_UPDATE      = "progress_update"
    RESOLVED             = "resolved"


# Legacy aliases so both old shadow classes keep working transparently while
# their imports are migrated. New code should import `ActivityAction` directly.
_EventType = ActivityAction         # ticket_service.py old name
TicketEventType = ActivityAction    # department_service.py old name
