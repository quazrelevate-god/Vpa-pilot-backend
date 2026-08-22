"""
Regression suite for the pre-production audit fixes.

Every test here maps to a specific finding ID in VPA-Pre-Prod-Audit.xlsx.
If any of these fail, the corresponding audit fix has regressed.

Run with:  ./env/bin/python -m pytest tests/test_pre_prod_fixes.py -v

Test policy:
  - Pure-function tests (validators, IST helpers, mask helpers) run against
    the real code with no mocks — they're deterministic.
  - RBAC / route tests use FastAPI's TestClient against the real app.
  - Anything that needs a live DB / MinIO / Gemini is skipped in this file
    (see tests/test_core_flows.py + the *_live.py suites for those).
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest


# ─── CITZ-04: server-side name + mobile validators ────────────────────────────

class TestValidators:
    def test_clean_name_rejects_xss(self):
        from src.core.validators import clean_name
        with pytest.raises(ValueError):
            clean_name('<img src=x onerror=alert(1)>')

    def test_clean_name_rejects_empty(self):
        from src.core.validators import clean_name
        for bad in ("", "   ", "\t\n"):
            with pytest.raises(ValueError):
                clean_name(bad)

    def test_clean_name_rejects_digits_only(self):
        """At least one letter required — a legal name isn't '123'."""
        from src.core.validators import clean_name
        with pytest.raises(ValueError):
            clean_name("12345")

    def test_clean_name_normalises_whitespace(self):
        from src.core.validators import clean_name
        assert clean_name("  Yogesh   Kumar  ") == "Yogesh Kumar"

    def test_clean_name_accepts_tamil(self):
        """Tamil block should be accepted (Tamil-first citizen intake)."""
        from src.core.validators import clean_name
        assert clean_name("யோகேஷ்") == "யோகேஷ்"

    def test_clean_mobile_strips_country_code(self):
        from src.core.validators import clean_mobile
        assert clean_mobile("+91 98765 43210") == "9876543210"
        assert clean_mobile("919876543210") == "9876543210"
        assert clean_mobile("98765-43210") == "9876543210"

    def test_clean_mobile_rejects_short(self):
        from src.core.validators import clean_mobile
        for bad in ("", "abc", "12345", "1876543210", "5876543210"):
            with pytest.raises(ValueError):
                clean_mobile(bad)


# ─── CORR-07/08/09: IST wall-clock helpers ────────────────────────────────────

class TestIstHelpers:
    def test_ist_offset_is_5h30m(self):
        from src.core.timeutil import ist_now, now_utc
        delta = (ist_now() - now_utc()).total_seconds()
        # ±60s slack for clock reads across the two calls
        assert 5 * 3600 + 30 * 60 - 60 < delta < 5 * 3600 + 30 * 60 + 60

    def test_ist_today_is_ist_calendar_day(self):
        from src.core.timeutil import ist_today, IST_TZ
        expected = datetime.now(IST_TZ).date()
        assert ist_today() == expected

    def test_now_utc_naive(self):
        """now_utc must return a naive datetime — comparing tz-aware and naive
        raises across the codebase."""
        from src.core.timeutil import now_utc
        assert now_utc().tzinfo is None


# ─── AUTH-18 / CORR-12: PII masking + OTP strict validation ───────────────────

class TestMobileMasking:
    def test_mask_mobile_hides_all_but_last_4(self):
        from src.services.appointment_service import _mask_mobile
        assert _mask_mobile("9876543210") == "******3210"

    def test_mask_mobile_strips_non_digits(self):
        from src.services.appointment_service import _mask_mobile
        assert _mask_mobile("+91 98765 43210") == "********3210"  # 8 digits before last 4

    def test_mask_mobile_short_returns_stars(self):
        from src.services.appointment_service import _mask_mobile
        assert _mask_mobile("") == "***"
        assert _mask_mobile("123") == "***"

    def test_mask_mobile_none(self):
        from src.services.appointment_service import _mask_mobile
        assert _mask_mobile(None) == "***"


# ─── AUTH-08: check_env_credentials is constant-time ──────────────────────────

class TestConstantTimeCreds:
    def test_correct_creds_accepted(self):
        from src.core.config import check_env_credentials
        assert check_env_credentials("admin", "pw123", "admin", "pw123") is True

    def test_wrong_password_rejected(self):
        from src.core.config import check_env_credentials
        assert check_env_credentials("admin", "wrong", "admin", "pw123") is False

    def test_wrong_username_rejected(self):
        from src.core.config import check_env_credentials
        assert check_env_credentials("attacker", "pw123", "admin", "pw123") is False

    def test_both_wrong_rejected(self):
        from src.core.config import check_env_credentials
        assert check_env_credentials("x", "y", "admin", "pw123") is False


# ─── AUTH-09: verify_password constant-time on unknown user ───────────────────

class TestVerifyPasswordConstantTime:
    def test_verify_password_none_returns_false(self):
        """Unknown user path — stored=None must NOT short-circuit."""
        from src.core.passwords import verify_password
        assert verify_password("anything", None) is False
        assert verify_password("anything", "") is False

    def test_verify_password_valid_still_works(self):
        """Positive path unchanged."""
        from src.core.passwords import hash_password, verify_password
        h = hash_password("s3cret")
        assert verify_password("s3cret", h) is True
        assert verify_password("wrong", h) is False


# ─── CORR-01/02: spawn_bg pins tasks in a module-level set ────────────────────

class TestSpawnBg:
    def test_spawn_bg_pins_task_until_done(self):
        from src.core.bg_tasks import spawn_bg, _BG_TASKS
        async def _run():
            async def _sleep():
                await asyncio.sleep(0.01)
                return 42
            task = spawn_bg(_sleep())
            # Registered while running
            assert task in _BG_TASKS
            await asyncio.sleep(0.05)
            # Discarded once done
            assert task not in _BG_TASKS
            assert task.result() == 42
        asyncio.run(_run())

    def test_spawn_bg_logs_but_swallows_exceptions(self, caplog):
        """The done-callback must retrieve exceptions so asyncio doesn't
        emit "Task exception was never retrieved" AND our WARN log fires."""
        from src.core.bg_tasks import spawn_bg
        import logging
        async def _run():
            async def _bad():
                raise RuntimeError("intentional-test")
            task = spawn_bg(_bad())
            await asyncio.sleep(0.05)
            # The task is done; the callback should have retrieved the exception.
            assert task.done()
            assert isinstance(task.exception(), RuntimeError)
        with caplog.at_level(logging.WARNING, logger="bg_tasks"):
            asyncio.run(_run())
        assert any("intentional-test" in r.message for r in caplog.records)


# ─── SEC-03: crypto.decrypt no longer silently accepts base64 ─────────────────

class TestCryptoNoSilentBase64:
    def test_decrypt_non_fernet_returns_raw_and_logs(self, caplog):
        """Non-Fernet input used to be transparently base64-decoded (pretending
        to be encryption). Now returns the raw value + WARN, so ops can grep."""
        import base64
        import logging
        from src.core.crypto import decrypt
        # Deliberately construct base64 that decodes to plaintext — the old
        # branch would have decoded and returned "plaintext-value".
        legacy_b64 = base64.b64encode(b"plaintext-value").decode("utf-8")
        with caplog.at_level(logging.WARNING, logger="src.core.crypto"):
            result = decrypt(legacy_b64)
        # New behaviour: return the raw token unchanged (no silent decode).
        assert result == legacy_b64
        assert any("not a Fernet token" in r.message for r in caplog.records)


# ─── CORR-11: Gemini transient check by exception type ────────────────────────

class TestGeminiTransientClassification:
    def test_transient_by_type_name(self):
        from src.services.summarisation import GrievanceSummarisationService as _Svc
        class ServiceUnavailable(Exception): pass
        class ResourceExhausted(Exception): pass
        class TooManyRequests(Exception): pass
        for cls in (ServiceUnavailable, ResourceExhausted, TooManyRequests):
            assert _Svc._is_transient(cls("boom")) is True

    def test_transient_by_status_code(self):
        from src.services.summarisation import GrievanceSummarisationService as _Svc
        class ApiError(Exception):
            status_code = 503
        assert _Svc._is_transient(ApiError()) is True
        class Rate(Exception):
            status_code = 429
        assert _Svc._is_transient(Rate()) is True

    def test_non_transient(self):
        from src.services.summarisation import GrievanceSummarisationService as _Svc
        class NotFound(Exception):
            status_code = 404
        assert _Svc._is_transient(NotFound()) is False


# ─── CORR-27: activity types unified ──────────────────────────────────────────

class TestActivityAction:
    def test_legacy_aliases_resolve_to_same_enum(self):
        from src.models.activity_types import ActivityAction
        from src.services.ticket_service import _EventType
        from src.services.department_service import TicketEventType
        assert _EventType is ActivityAction
        assert TicketEventType is ActivityAction

    def test_covers_both_predecessor_sets(self):
        from src.models.activity_types import ActivityAction
        for name in [
            "STATUS_CHANGED", "PRIORITY_CHANGED", "ASSIGNED", "COMMENT_ADDED",
            "ROUTED_TO_DEPARTMENT", "FORWARDED_TO_DEPT", "CLOSED", "REOPENED",
            "REVERTED", "REAPPROVED", "DEPARTMENT_ACCEPTED",
            "DEPARTMENT_FORWARDED", "PROGRESS_UPDATE", "RESOLVED",
        ]:
            assert hasattr(ActivityAction, name)


# ─── SCHEMA-04: alembic env.py imports resolve ────────────────────────────────

class TestAlembicEnvImports:
    def test_all_previously_missing_models_now_import(self):
        """Autogenerate was blind to these — importing them from
        src.models paths (same names/paths env.py now uses) proves the
        env.py additions won't crash on next autogenerate."""
        from src.models.login_models import UserRole  # noqa
        from src.models.petition_group import PetitionGroup  # noqa
        from src.models.event_models import InvitationEvent  # noqa
        from src.models.proposal_models import ProposalSubmission  # noqa
        from src.models.association_models import AssociationSubmission  # noqa
        from src.models.push_models import PushSubscription  # noqa
        from src.models.registry_models import (  # noqa
            DepartmentRegistry, MinistryRegistry, VenueRegistry,
        )


# ─── config assert_production_ready gates ─────────────────────────────────────

class TestProdReadyGates:
    def _mk(self, **overrides):
        """Build a Settings-like namespace so we can call assert_production_ready
        without importing the whole config."""
        from types import SimpleNamespace
        defaults = dict(
            DEBUG=False,
            DATABASE_URL="postgresql+psycopg://u:p@localhost:5432/x",
            SECRET_KEY="a" * 64,
            ENCRYPTION_KEY="k" * 64,
            SERVER_BASE_URL="https://namkural.in",
            COOKIE_SECURE=True,
            CORS_ORIGINS="https://namkural.in",
            DASHBOARD_USERNAME="a", DASHBOARD_PASSWORD="b",
            DISPLAY_USERNAME="c",   DISPLAY_PASSWORD="d",
            EVENTS_USERNAME="e",    EVENTS_PASSWORD="f",
            MINISTER_USERNAME="g",  MINISTER_PASSWORD="h",
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    @pytest.mark.skip(
        reason="Guard intentionally disabled in config.py:293 for the Railway "
               "testing env (DEBUG=True + remote DB is the normal shape there). "
               "Re-enable both the guard AND this test together for real prod."
    )
    def test_debug_true_with_remote_db_always_refused(self):
        """CFG-03: even in DEBUG mode, DEBUG=True + remote DB → refuse."""
        from src.core.config import assert_production_ready
        with pytest.raises(RuntimeError, match="remote host"):
            assert_production_ready(self._mk(
                DEBUG=True,
                DATABASE_URL="postgresql+psycopg://u:p@caboose.railway.app:5432/x",
            ))

    def test_prod_refuses_placeholder_secret(self):
        from src.core.config import assert_production_ready
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            assert_production_ready(self._mk(SECRET_KEY="CHANGE_ME__foo"))

    def test_prod_refuses_short_secret(self):
        from src.core.config import assert_production_ready
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            assert_production_ready(self._mk(SECRET_KEY="abc"))

    def test_prod_refuses_cookie_secure_false(self):
        from src.core.config import assert_production_ready
        with pytest.raises(RuntimeError, match="COOKIE_SECURE"):
            assert_production_ready(self._mk(COOKIE_SECURE=False))

    def test_prod_refuses_localhost_cors(self):
        from src.core.config import assert_production_ready
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            assert_production_ready(self._mk(
                CORS_ORIGINS="http://localhost:3000,https://namkural.in",
            ))

    def test_prod_refuses_default_staff_creds(self):
        from src.core.config import assert_production_ready
        with pytest.raises(RuntimeError, match="staff credentials"):
            assert_production_ready(self._mk(
                DASHBOARD_USERNAME="admin", DASHBOARD_PASSWORD="admin123",
            ))

    def test_prod_ready_with_all_gates_passed(self):
        from src.core.config import assert_production_ready
        # Should not raise
        assert_production_ready(self._mk())


# ─── CITZ-01: intake cookie helper ────────────────────────────────────────────

class TestIntakeCookieResolve:
    def test_cookie_beats_query(self):
        from src.core.intake_cookie import resolve_intake_token
        from starlette.requests import Request
        scope = dict(
            type="http", method="GET", path="/form", query_string=b"",
            headers=[(b"cookie", b"intake_token=cookie-tok")],
            client=("127.0.0.1", 0), server=("t", 80), scheme="http",
            root_path="", app=None,
        )
        req = Request(scope)
        assert resolve_intake_token(req, "query-tok") == "cookie-tok"
        assert resolve_intake_token(req, None) == "cookie-tok"

    def test_query_fallback_when_no_cookie(self):
        from src.core.intake_cookie import resolve_intake_token
        from starlette.requests import Request
        scope = dict(
            type="http", method="GET", path="/form", query_string=b"",
            headers=[], client=("127.0.0.1", 0), server=("t", 80),
            scheme="http", root_path="", app=None,
        )
        req = Request(scope)
        assert resolve_intake_token(req, "query-tok") == "query-tok"
        assert resolve_intake_token(req, None) is None
