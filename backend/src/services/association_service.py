"""
Association service — persist an association/union submission from an
AssociationExtraction (produced by the intake router when the classifier tags a
document as `association`). Its own table + review surface, never a Ticket.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.association_extraction import AssociationExtraction
from src.models.association_models import AssociationSubmission, STATUS_AWAITING_REVIEW

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
            created_at=datetime.utcnow(),
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        logger.info("association submission created id=%s assoc=%r category=%s",
                    row.id, row.association_name, row.category)
        return row


association_service = AssociationService()
