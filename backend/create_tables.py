"""
Database initialization script.
Creates all tables defined in SQLAlchemy models.
Run this script once before starting the application.
"""
import asyncio
import sys
from sqlalchemy.ext.asyncio import create_async_engine
from src.core.config import settings
from src.core.database import Base
from src.models.qr_models import QRLog, GatekeeperSession

# Fix for Windows: psycopg requires SelectorEventLoop
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def create_tables():
    """
    Create all database tables asynchronously.
    
    This function:
        1. Connects to PostgreSQL using async engine
        2. Creates all tables defined in Base metadata
        3. Creates all indexes defined in model __table_args__
    
    Note: This is a simple table creation script.
    For production, use Alembic for proper migrations.
    """
    engine = create_async_engine(settings.DATABASE_URL, echo=True)
    
    async with engine.begin() as conn:
        print("Creating database tables...")
        await conn.run_sync(Base.metadata.create_all)
        print("✓ All tables created successfully!")
    
    await engine.dispose()


if __name__ == "__main__":
    print("Starting database initialization...")
    asyncio.run(create_tables())
