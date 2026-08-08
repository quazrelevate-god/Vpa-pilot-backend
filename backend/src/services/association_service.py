"""
Association service — persist an association/union submission from an
AssociationExtraction (produced by the intake router when the classifier tags a
document as `association`), and mint the downstream Ticket when the reviewer
decides on the collective ask.

Design
======
An AssociationSubmission is the review-surface record: identity + collective
ask + extraction brief. On its own it never becomes a Ticket.

`mint_ticket_from_association()` bridges the association into the existing
petition Ticket pipeline WITHOUT duplicating any of it. It creates a "shadow"
Citizen + Appointment (with `source_kind='association'`) then flips that
Appointment to REVIEWED — reusing every downstream side-effect the citizen
petition path already ships: Ticket creation, ticket_events audit row,
`forward_if_non_school` ministry routing, GrievanceSummaryRecord adoption.

The shadow Appointment is hidden from every citizen-visit surface (walk-in
queue, scheduler, appointments list) via `source_kind='citizen'` filters;
it's only meaningful on the tickets surface, where the Association badge
tells the PA where the ticket came from.
"""
from __future__ import annotations

import logging
from datetime import datetime
from src.core.timeutil import now_utc
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core import crypto
from src.models.association_extraction import AssociationExtraction
from src.models.association_models import (
    AssociationSubmission, STATUS_AWAITING_REVIEW, STATUS_REVIEWED, STATUS_FORWARDED,
)

logger = logging.getLogger(__name__)


class AssociationService:
    async def create_from_extraction(
        self,
        *,
        extraction: AssociationExtraction,
        documents: Optional[List[Dict[str, str]]],
        source: Optional[str],
        source_ref: Optional[str],
        db: AsyncSession,
    ) -> AssociationSubmission:
        ex = extraction
        row = AssociationSubmission(
            source=source,
            source_ref=source_ref,
            documents=documents or [],
            association_name=(ex.association_name or None),
            member_count=(ex.member_count or None),
            representative_name=(ex.representative_name or None),
            representative_designation=(ex.representative_designation or None),
            category=ex.category.value,
            ministry=ex.ministry.value,
            urgency=ex.urgency.value,
            district=ex.district.value,
            document_date=ex.document_date,
            extraction_json=ex.model_dump(mode="json"),
            status=STATUS_AWAITING_REVIEW,
            created_at=now_utc(),
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        logger.info("association submission created id=%s assoc=%r category=%s",
                    row.id, row.association_name, row.category)
        return row

    async def mint_ticket_from_association(
        self,
        *,
        assoc: AssociationSubmission,
        reviewed_by: str,
        db: AsyncSession,
    ) -> Optional[int]:
        """Create the shadow Citizen + Appointment for `assoc` and flip it to
        REVIEWED, which spawns the Ticket via the existing citizen-petition
        pipeline. Returns the new appointment id (also set on
        `assoc.source_appointment_id`), or None if a ticket was already minted
        for this association.

        Idempotent: if a shadow appointment + ticket ALREADY exist for this
        association we return the existing appointment id without minting a
        duplicate — the reviewer may toggle reviewed ↔ forwarded on the
        association surface without ever re-creating the ticket.
        """
        # Local imports keep the module import graph tight (dashboard_service
        # pulls in a lot of heavy modules; only load when actually minting).
        from src.services.appointment_service import appointment_service
        from src.services import dashboard_service, department_service
        from src.services.v2_helpers import v2
        from src.models.appointment_models import Appointment, Citizen, AppointmentAttachment
        from src.models.grievance_summary_record import GrievanceSummaryRecord
        from src.models.ticket_models import Ticket

        # Idempotency: skip mint ONLY if the linked appointment still exists
        # AND has a live Ticket. `source_appointment_id` is overloaded — the
        # petition-to-association migration also wrote it, pointing at
        # HARD-DELETED appointment ids (see the model comment). Treating that
        # legacy value as "already minted" left every migrated association
        # unable to ever produce a ticket. Guard with a real existence check.
        if assoc.source_appointment_id:
            existing_appt = await db.get(Appointment, int(assoc.source_appointment_id))
            if existing_appt is not None:
                existing_ticket = await db.scalar(
                    select(Ticket).where(Ticket.appointment_id == existing_appt.id)
                )
                if existing_ticket is not None:
                    logger.info(
                        "association id=%s already has ticket %s (appt=%s); skipping mint",
                        assoc.id, existing_ticket.ticket_number, existing_appt.id,
                    )
                    return int(existing_appt.id)
            # Stale pointer (migrated-and-deleted appointment, or shadow
            # deleted for cleanup). Clear it so the fresh mint below can set
            # it to the newly-created appt id on the same row.
            logger.info(
                "association id=%s: stale source_appointment_id=%s (no live ticket) — minting fresh",
                assoc.id, assoc.source_appointment_id,
            )
            assoc.source_appointment_id = None

        # Identity for the shadow Citizen. The representative is the natural
        # person we can attach the ticket to; the association's *name* is the
        # institutional entity but Citizen expects a single human. If the
        # representative isn't identifiable we fall back to the association
        # name so the ticket still has *something* readable in the citizen
        # column, but that's a rare fallback — the extraction almost always
        # captures a representative.
        rep_name = (assoc.representative_name or "").strip()
        display_name = rep_name or (assoc.association_name or "").strip()
        if not display_name:
            raise ValueError(
                "Association is missing both representative_name and "
                "association_name — cannot mint a ticket. Please fill in the "
                "identity fields on the review drawer before deciding."
            )

        now = now_utc()

        # ── 1) Shadow Citizen ────────────────────────────────────────────────
        # Associations rarely carry a mobile number for the representative
        # (the intake is a scan of a letter); we still create the Citizen row
        # so the Ticket → Appointment → Citizen chain resolves. Mobile stays
        # empty; the encrypted_name carries the identity.
        enc_name = appointment_service._encrypt_field(display_name)
        enc_mobile = appointment_service._encrypt_field("")
        citizen = Citizen(
            encrypted_name=enc_name,
            encrypted_mobile=enc_mobile,
            mobile_index=None,   # no mobile → no blind-index dedupe
            created_at=now,
        )
        db.add(citizen)
        await db.flush()

        # ── 2) Shadow Appointment (source_kind='association') ───────────────
        # Reuse the citizen-petition assignment helper so tokens stay unique
        # and the daily counter stays monotonic — an association ticket must
        # have a real token to survive every downstream ticket query.
        token_assigned, _ = await appointment_service._assign_daily_token(db, now)

        # Compose the grievance body from the association's ask + summary so
        # the citizen-ask column on the ticket page reads sensibly. The full
        # extraction lives on the AssociationSubmission row and on the GSR
        # we build below — this is just the short line the ticket table shows.
        ex_json = assoc.extraction_json or {}
        ask_text = (ex_json.get("association_ask") or "").strip()
        summary_text = (ex_json.get("summary") or "").strip()
        grievance_body = ask_text or summary_text or (assoc.association_name or "Association submission")

        ai_ids = v2.new_appointment_ids(
            status="AWAITING_REVIEW",
            category=assoc.category or None,
        )
        appt = Appointment(
            citizen_id=citizen.id,
            slot_id=None,
            token_assigned=token_assigned,
            encrypted_grievance=appointment_service._encrypt_field(grievance_body),
            grievance_category=assoc.category or None,
            status="AWAITING_REVIEW",
            status_id=ai_ids["status_id"],
            category_id=ai_ids.get("category_id"),
            schedule_meeting=False,
            summary_status="DONE",   # extraction already exists on the assoc row
            # The intake channel STAYS ai_scan (that's how it arrived); the
            # association-vs-citizen distinction is carried by source_kind so
            # the source filter on the tickets page keeps its original meaning.
            source="ai_scan",
            source_kind="association",
            created_at=now,
        )
        db.add(appt)
        await db.flush()

        # ── 3) Attach the association's documents to the shadow appointment ─
        # The Tickets drawer reads AppointmentAttachment for its preview pane;
        # without this, an association ticket would open with an empty file
        # list even though the source scan is right there on the assoc row.
        for doc in (assoc.documents or []):
            storage_url = (doc.get("storage_url") or "").strip()
            if not storage_url:
                continue
            mime = (doc.get("mime_type") or "application/octet-stream").strip()
            db.add(AppointmentAttachment(
                appointment_id=appt.id,
                attachment_type="DOCUMENT" if mime == "application/pdf" else "IMAGE",
                storage_url=storage_url,
                file_size_bytes=0,
                mime_type=mime,
                created_at=now,
            ))

        # ── 4) Adopt the AssociationExtraction onto a GSR row ───────────────
        # AssociationExtraction extends GrievanceSummary, so from_gemini_response
        # accepts it verbatim. The GSR gives the ticket drawer the same summary
        # / key_details / classification shape it renders for citizen petitions.
        try:
            ex_obj = AssociationExtraction.model_validate(ex_json)
            gsr = GrievanceSummaryRecord.from_gemini_response(
                appointment_id=appt.id,
                summary=ex_obj,
                gemini_model_used="association-extraction",
            )
            # Overwrite name fields with the association's chosen display name
            # so the ticket drawer names the representative, not whatever the
            # base grievance prompt happened to guess for name_en/name_ta.
            gsr.name_en = display_name
            gsr.name_ta = (ex_json.get("representative_name_ta") or display_name)
            db.add(gsr)
        except Exception as exc:  # noqa: BLE001 — extraction shape drift shouldn't block minting
            logger.warning(
                "association id=%s: skipping GSR creation (extraction parse failed: %s). "
                "Ticket will still be created; drawer summary may be sparser.",
                assoc.id, exc,
            )

        await db.flush()

        # ── 5) Flip the appointment to REVIEWED → spawns the Ticket ─────────
        # Same call petitions use; it commits internally and creates the
        # Ticket + ticket_events row.
        await dashboard_service.update_appointment_status(db, appt.id, "Reviewed")

        # ── 6) Cross-link: association → appointment, and auto-forward ──────
        ticket = await db.scalar(select(Ticket).where(Ticket.appointment_id == appt.id))
        assoc.source_appointment_id = appt.id
        await db.commit()

        # Non-school ministry → auto-forward to that ministry's workspace,
        # same rule that runs for citizen petitions. School stays OPEN so a
        # PA can route to one of the 10 school departments.
        if ticket and assoc.ministry:
            try:
                await department_service.forward_if_non_school(
                    db, ticket.id, assoc.ministry, reviewed_by,
                )
            except Exception as exc:  # noqa: BLE001 — forwarding failure isn't fatal
                logger.warning("association id=%s ticket=%s: auto-forward failed (%s)",
                               assoc.id, ticket.id, exc)

        logger.info(
            "association id=%s -> ticket %s (appt=%s, ministry=%s)",
            assoc.id, (ticket.ticket_number if ticket else "?"),
            appt.id, assoc.ministry,
        )
        return appt.id


association_service = AssociationService()
