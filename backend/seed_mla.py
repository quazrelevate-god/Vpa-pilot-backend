"""
Seed default MLA record for scheduling.
Run this once to create the default MLA with id=1.

Override MLA name/constituency via .env:
  MLA_NAME="Your MLA Name"
  MLA_CONSTITUENCY="Your Constituency"
"""
import asyncio
import sys
from sqlalchemy import text
from src.core.database import engine
from src.core.config import settings

# Windows event loop fix for psycopg async
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def seed_mla():
    mla_name = getattr(settings, 'MLA_NAME', None) or 'Default MLA'
    mla_constituency = getattr(settings, 'MLA_CONSTITUENCY', None) or 'Default Constituency'
    mla_mobile = getattr(settings, 'MLA_CONTACT_MOBILE', None) or ''
    mla_email = getattr(settings, 'MLA_CONTACT_EMAIL', None) or ''
    mla_office = getattr(settings, 'MLA_OFFICE_ADDRESS', None) or ''

    async with engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO mlas (id, name, constituency, contact_mobile, contact_email, office_address, is_active, created_at)
                VALUES (1, :name, :constituency, :mobile, :email, :office, true, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    constituency = EXCLUDED.constituency,
                    contact_mobile = EXCLUDED.contact_mobile,
                    contact_email = EXCLUDED.contact_email,
                    office_address = EXCLUDED.office_address,
                    is_active = true
            """),
            {
                "name": mla_name,
                "constituency": mla_constituency,
                "mobile": mla_mobile or None,
                "email": mla_email or None,
                "office": mla_office or None,
            }
        )
        print(f"[SEED] MLA (id=1) '{mla_name}' / '{mla_constituency}' created/updated successfully.")


if __name__ == "__main__":
    asyncio.run(seed_mla())
