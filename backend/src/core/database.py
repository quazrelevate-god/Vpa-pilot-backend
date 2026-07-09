"""
Database configuration and session management for PostgreSQL.
Uses SQLAlchemy async engine with psycopg driver for non-blocking I/O.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from typing import AsyncGenerator

from src.core.config import settings


# SQLAlchemy declarative base for ORM models
Base = declarative_base()


# Ensure the async engine uses the async psycopg driver.
# If the .env uses the sync form (postgresql+psycopg), rewrite it.
_DATABASE_URL = settings.DATABASE_URL
if _DATABASE_URL and _DATABASE_URL.startswith("postgresql+psycopg://"):
    _DATABASE_URL = _DATABASE_URL.replace("postgresql+psycopg://", "postgresql+psycopg_async://", 1)

# Create async engine with psycopg driver
# Connection pool configured for high-traffic scenarios
engine = create_async_engine(
    _DATABASE_URL,
    echo=False,  # Never echo SQL — use sqlalchemy.engine logger level if needed
    pool_size=20,  # Number of persistent connections
    max_overflow=10,  # Additional connections when pool is exhausted
    pool_pre_ping=True,  # Verify connections before using them
    pool_recycle=3600,  # Recycle connections after 1 hour
    use_insertmanyvalues=False,  # Fix for psycopg3 parameter binding
)


# Async session factory
# expire_on_commit=False prevents lazy-loading issues after commit
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency injection function for FastAPI routes.

    Yields an async database session and ensures proper cleanup, commit on
    success and rollback on exception.

    Why no `async with AsyncSessionLocal()`: when a client aborts mid-query
    (very common now that the PA portal sets AbortController on every
    appointments/tickets fetch), the session is left mid-`_connection_for_bind()`.
    The context manager's `__aexit__` then calls `close()`, which raises
    `IllegalStateChangeError` because the session can't legally transition
    from "acquiring connection" to "closed". We manage the lifecycle
    explicitly and swallow that close error — the connection pool's
    `pool_pre_ping` will invalidate the bad connection on next checkout.
    """
    import asyncio
    from sqlalchemy.exc import IllegalStateChangeError

    session = AsyncSessionLocal()
    try:
        yield session
        await session.commit()
    except asyncio.CancelledError:
        # Don't try to rollback — the session is mid-operation and any await
        # on it will raise the same illegal-state error.
        raise
    except Exception:
        try:
            await session.rollback()
        except (IllegalStateChangeError, asyncio.CancelledError):
            # Same reasoning: session is in a state that can't be touched.
            pass
        raise
    finally:
        try:
            await session.close()
        except (IllegalStateChangeError, asyncio.CancelledError):
            # Cancellation race — pool_pre_ping will catch the bad conn
            # on the next checkout.
            pass
