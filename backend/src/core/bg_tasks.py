"""Fire-and-forget background tasks that survive garbage collection.

asyncio.create_task() only holds a WEAK reference to the returned Task, so
a bare ``asyncio.create_task(coro)`` can be garbage-collected mid-run — the
CPython test suite documents this and it is intentional. In this codebase
the failure mode is silent: an SMS reschedule notification is queued, the
handler returns 200, the task is GC'd before it actually runs, the citizen
never gets the SMS, and no error is logged anywhere.

`spawn_bg(coro)` pins the Task in a module-level set until it completes, so
the loop keeps a strong reference for the task's lifetime. The done-callback
removes it from the set so the set never grows unbounded.

Import and use:

    from src.core.bg_tasks import spawn_bg
    spawn_bg(self._notify_citizen(appt_id))   # replaces asyncio.create_task(...)

Do NOT use this for the app's own long-running "worker" loops (the ones
launched from lifespan startup) — those should be held on a well-known
attribute so shutdown can cancel them cleanly. This is only for the many
short "fire it and forget it" side effects that used to be leaked with
bare create_task().
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Coroutine

_log = logging.getLogger("bg_tasks")

# Module-level set — the strong reference that keeps a Task alive across
# await boundaries. Never inspect or iterate this externally.
_BG_TASKS: set[asyncio.Task] = set()


def _on_done(task: asyncio.Task) -> None:
    _BG_TASKS.discard(task)
    # Retrieve the exception (if any) so asyncio doesn't emit its default
    # "Task exception was never retrieved" warning at GC time — and log it
    # ourselves so the failure isn't silent.
    if not task.cancelled():
        exc = task.exception()
        if exc is not None:
            _log.warning("background task %r raised: %r", task.get_name(), exc, exc_info=exc)


def spawn_bg(coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
    """create_task that survives garbage collection.

    Returns the Task in case the caller wants to await it later; the more
    common pattern is to ignore the return value entirely. Any exception the
    coroutine raises is logged with WARN + stack (not swallowed silently).
    """
    task = asyncio.create_task(coro)
    _BG_TASKS.add(task)
    task.add_done_callback(_on_done)
    return task
