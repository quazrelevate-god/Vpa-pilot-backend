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


# Create async engine with psycopg driver
# Connection pool configured for high-traffic scenarios
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,  # SQL query logging in debug mode
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
    
    Yields an async database session and ensures proper cleanup.
    Transaction is automatically committed on success or rolled back on exception.
    
    Usage in FastAPI route:
        @router.get("/endpoint")
        async def endpoint(db: AsyncSession = Depends(get_db)):
            # Use db session here
            pass
    
    Yields:
        AsyncSession: Database session context
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
