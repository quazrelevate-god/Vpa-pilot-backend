"""Shared pytest fixtures. psycopg async needs the selector loop on Windows."""
import sys
import asyncio

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import pytest


@pytest.fixture
async def db():
    """Read-only DB session against the configured database.

    The admin lookup cache is loaded first — the app process does this in its
    lifespan and the worker at startup, so tests must too now that
    status/category/priority/ministry/district are id-normalised (their hybrid
    getters and the id→name mapping in aggregates resolve through this cache).
    """
    from src.core.database import AsyncSessionLocal
    from src.services.v2_helpers import v2
    async with AsyncSessionLocal() as session:
        await v2.init(session)
        yield session
        await session.rollback()
