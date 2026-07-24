"""events: bilingual title/venue columns + updated_by

Revision ID: 035
Revises: 034
Create Date: 2026-07-22

The /events PWA has an English / Tamil toggle for the whole calendar UI.
Pre-refactor the extractor stored one `title` and one `venue` in whichever
script the card was printed in — so a Tamil card gave the English-toggle
view a Tamil title (unreadable to English-only staff) and vice versa. The
extractor now returns BOTH scripts every time; this migration adds the
columns to hold them + backfills the existing 13 rows from the raw
`extraction_json` we already store.

Also adds `updated_by` — the PWA is a shared team calendar and "who edited
this event" is audit-worthy.

Nothing is dropped: the legacy `title` / `venue` columns stay put and the
service keeps mirroring one side into them, so any consumer that still
reads the old shape (unlikely — this table is only touched by event_service
and the /events PWA) keeps working.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invitation_events",
                  sa.Column("title_en",   sa.VARCHAR(300), nullable=True))
    op.add_column("invitation_events",
                  sa.Column("title_ta",   sa.VARCHAR(300), nullable=True))
    op.add_column("invitation_events",
                  sa.Column("venue_en",   sa.VARCHAR(300), nullable=True))
    op.add_column("invitation_events",
                  sa.Column("venue_ta",   sa.VARCHAR(300), nullable=True))
    op.add_column("invitation_events",
                  sa.Column("updated_by", sa.VARCHAR(100), nullable=True))

    # Backfill from extraction_json where present.
    # `title_ta` is already a top-level key in older extractions; `title` is
    # the source-language title. If title is all-ASCII we can safely call it
    # title_en; otherwise it belongs in title_ta.
    # Regex: `^[[:ascii:]]*$` — postgres-native, matches strings with no
    # non-ASCII bytes (so Tamil script fails and gets sorted to _ta).
    op.execute("""
        UPDATE invitation_events
           SET title_ta = COALESCE(title_ta, NULLIF(extraction_json->>'title_ta', ''))
         WHERE extraction_json IS NOT NULL
    """)
    op.execute("""
        UPDATE invitation_events
           SET title_en = title
         WHERE title_en IS NULL
           AND title IS NOT NULL
           AND title ~ '^[[:ascii:]]*$'
    """)
    op.execute("""
        UPDATE invitation_events
           SET title_ta = title
         WHERE title_ta IS NULL
           AND title IS NOT NULL
           AND title !~ '^[[:ascii:]]*$'
    """)
    # `venue` was single-language; sort by script.
    op.execute("""
        UPDATE invitation_events
           SET venue_en = venue
         WHERE venue_en IS NULL
           AND venue IS NOT NULL
           AND venue ~ '^[[:ascii:]]*$'
    """)
    op.execute("""
        UPDATE invitation_events
           SET venue_ta = venue
         WHERE venue_ta IS NULL
           AND venue IS NOT NULL
           AND venue !~ '^[[:ascii:]]*$'
    """)


def downgrade() -> None:
    op.drop_column("invitation_events", "updated_by")
    op.drop_column("invitation_events", "venue_ta")
    op.drop_column("invitation_events", "venue_en")
    op.drop_column("invitation_events", "title_ta")
    op.drop_column("invitation_events", "title_en")
