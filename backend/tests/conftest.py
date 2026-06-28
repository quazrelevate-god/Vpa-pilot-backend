"""Shared pytest fixtures. psycopg async needs the selector loop on Windows."""
import sys
import asyncio

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import pytest


@pytest.fixture
async def db():
    """Read-only DB session against the configured database."""
    from src.core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        yield session
        await session.rollback()
