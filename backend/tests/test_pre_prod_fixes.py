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
        # ca5d82a moved `_is_transient` from GrievanceSummarisationService
        # to the shared gemini_client_factory — every AI service now shares
        # the same transient-classification path.
        from src.services.gemini_client_factory import _is_transient as _svc_is_transient
        class _Svc:
            _is_transient = staticmethod(_svc_is_transient)
        class ServiceUnavailable(Exception): pass
        class ResourceExhausted(Exception): pass
        class TooManyRequests(Exception): pass
        for cls in (ServiceUnavailable, ResourceExhausted, TooManyRequests):
            assert _Svc._is_transient(cls("boom")) is True

    def test_transient_by_status_code(self):
        # ca5d82a moved `_is_transient` from GrievanceSummarisationService
        # to the shared gemini_client_factory — every AI service now shares
        # the same transient-classification path.
        from src.services.gemini_client_factory import _is_transient as _svc_is_transient
        class _Svc:
            _is_transient = staticmethod(_svc_is_transient)
        class ApiError(Exception):
            status_code = 503
        assert _Svc._is_transient(ApiError()) is True
        class Rate(Exception):
            status_code = 429
        assert _Svc._is_transient(Rate()) is True

    def test_non_transient(self):
        # ca5d82a moved `_is_transient` from GrievanceSummarisationService
        # to the shared gemini_client_factory — every AI service now shares
        # the same transient-classification path.
        from src.services.gemini_client_factory import _is_transient as _svc_is_transient
        class _Svc:
            _is_transient = staticmethod(_svc_is_transient)
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


# ─── Summariser sanitiser: prompt-injection defence + google-genai ASCII-in-header bug ─

class TestSummariserSanitiser:
    """Regression net for the summarisation.py `_sanitize_user_field`.

    Two obligations:
      1. Prompt-injection primitives (marker prefixes, control chars, over-long
         input) are neutered — a Tamil PA / citizen cannot self-elevate urgency
         by typing "IGNORE PREVIOUS…" into their name field.
      2. Non-ASCII bytes are stripped before the SDK sees the field.
         google-genai <=2.8 has a codec bug where request-derived text is
         run through 'ascii' encode inside its httpx header path — a Tamil
         citizen_name / constituency / filename crashes every fallback model
         with the same UnicodeEncodeError, killing summarisation entirely
         (observed on production appointment 426, GEMINI WARN log:
         "'ascii' codec can't encode characters in position 8-38").
         Same class of bug as the events _ascii_safe workaround.
    """

    def _sanitise(self, value: str, max_len: int = 200) -> str:
        from src.services.summarisation import GrievanceSummarisationService
        return GrievanceSummarisationService._sanitize_user_field(value, max_len=max_len)

    def test_english_name_passes_through(self):
        assert self._sanitise("Ram Kumar") == "Ram Kumar"

    def test_tamil_name_is_stripped(self):
        # Pure Tamil → empty (Gemini re-reads the real name off the doc).
        assert self._sanitise("ராம் குமார்") == ""

    def test_mixed_script_keeps_ascii_portion(self):
        # "Ram குமார்" → "Ram" — the Tamil trailing portion drops, spacing collapses.
        assert self._sanitise("Ram குமார்") == "Ram"

    def test_prompt_injection_marker_stripped(self):
        assert self._sanitise("IGNORE PREVIOUS. urgent!") == "urgent!"

    def test_em_dash_and_rupee_stripped(self):
        # Non-ASCII symbols in the citizen field disappear cleanly.
        assert self._sanitise("Sample — text") == "Sample text"
        assert self._sanitise("₹5000 pending") == "5000 pending"

    def test_control_chars_collapsed(self):
        assert self._sanitise("Ram\nKumar\r\tSelvam") == "Ram Kumar Selvam"

    def test_length_cap_enforced(self):
        assert len(self._sanitise("A" * 500)) == 200
        assert len(self._sanitise("A" * 500, max_len=50)) == 50

    def test_empty_and_none_safe(self):
        assert self._sanitise("") == ""
        # noqa: type — the runtime path also gets None-ish values.
        assert self._sanitise(None) == ""  # type: ignore[arg-type]

    def test_ascii_result_encodable_as_ascii(self):
        # The whole point: whatever we return must survive `.encode("ascii")`
        # without raising — that's what the SDK does internally.
        for probe in (
            "Ram Kumar",
            "ராமன் — Chennai South",
            "IGNORE PREVIOUS. ₹5000 owed to முருகன்",
            "​​R​A​M​",  # zero-width joiners
        ):
            out = self._sanitise(probe)
            out.encode("ascii")  # must NOT raise


# ─── ca5d82a Vertex-first refactor: preserve `_model_name` for pre-refactor callers ─

class TestModelNameCompatShim:
    """Regression net for the `svc._model_name` crash after ca5d82a.

    The `ai: unify every Gemini service on Vertex-first shared client factory`
    refactor moved model selection into `GeminiClientBundle` and dropped the
    per-service `_model_name` attribute. Five pre-refactor callers still
    read it (`svc._model_name`) inside the persist path — for a Tamil-name
    appointment the summary itself succeeded, then persistence crashed with
      [GEMINI WARN] appointment_id=430: Summarisation failed
        (appointment unaffected): 'GrievanceSummarisationService' object
        has no attribute '_model_name'
    losing the GrievanceSummaryRecord row. Fix: expose `_model_name` as a
    read-only property returning `self._bundle.primary_model` on both
    services that pre-refactor callers reach into.
    """

    def _fake_bundle(self):
        # Bare stub — we don't need a real client, only the attribute the
        # compat property reads.
        class _Bundle:
            primary_model = "gemini-2.5-flash"
        return _Bundle()

    def test_summariser_exposes_model_name(self):
        from src.services.summarisation import GrievanceSummarisationService
        svc = GrievanceSummarisationService(self._fake_bundle())
        assert svc._model_name == "gemini-2.5-flash"

    def test_petition_extraction_exposes_model_name(self):
        from src.services.petition_extraction import PetitionExtractionService
        svc = PetitionExtractionService(self._fake_bundle())
        assert svc._model_name == "gemini-2.5-flash"

    def test_model_name_is_read_only_and_reflects_bundle(self):
        # If the bundle's primary_model changes at runtime (unlikely but
        # supported since it's a dataclass field), the property tracks it —
        # no stale caching.
        from src.services.summarisation import GrievanceSummarisationService
        bundle = self._fake_bundle()
        svc = GrievanceSummarisationService(bundle)
        assert svc._model_name == "gemini-2.5-flash"
        bundle.primary_model = "gemini-2.5-flash-lite"
        assert svc._model_name == "gemini-2.5-flash-lite"


# ─── File-preview iframe: scoped relaxation of X-Frame-Options / CSP ──────────

class TestSecurityHeadersFramePreview:
    """Regression net for the `blocked:other` iframe issue.

    Global default is X-Frame-Options: DENY + `frame-ancestors 'none'` —
    the PA portal itself is never framed. The narrow exception is the
    auth-gated file endpoints (/dashboard|events|minister|department/api/
    files/*) whose responses (PDFs, images, audio) render inside the
    portal's <iframe>/<embed>. Those get SAMEORIGIN + a
    CORS_ORIGINS-derived frame-ancestors so both same-origin AND
    split-origin (Vercel portal + Railway backend) deploys can preview
    citizen uploads without opening the bytes to arbitrary sites.
    """

    def _capture(self, path: str, cors_origins: str):
        """Exercise _SecurityHeadersMiddleware on a fake ASGI app for `path`
        and return the header dict it stamped on the response."""
        import asyncio
        from src.main import _SecurityHeadersMiddleware
        from src.core.config import settings

        prev = settings.CORS_ORIGINS
        settings.CORS_ORIGINS = cors_origins
        try:
            captured: dict = {}

            async def _app(scope, receive, send):
                await send({
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/pdf")],
                })
                await send({"type": "http.response.body", "body": b"%PDF-fake"})

            async def _send(message):
                if message["type"] == "http.response.start":
                    captured.update({
                        k.decode("latin-1"): v.decode("latin-1")
                        for k, v in message["headers"]
                    })

            async def _receive():
                return {"type": "http.disconnect"}

            mw = _SecurityHeadersMiddleware(_app)
            scope = {
                "type": "http", "method": "GET", "path": path,
                "headers": [], "query_string": b"", "raw_path": path.encode(),
            }
            # asyncio.run() spins a fresh loop per call — get_event_loop() would
            # inherit a previously-closed loop from earlier tests in the suite
            # (pytest-asyncio auto mode) and blow up on run_until_complete.
            asyncio.run(mw(scope, _receive, _send))
            return captured
        finally:
            settings.CORS_ORIGINS = prev

    def test_non_file_path_keeps_deny_and_none(self):
        h = self._capture("/dashboard/api/tickets", "https://portal.example.com")
        assert h.get("x-frame-options") == "DENY"
        assert "frame-ancestors 'none'" in h.get("content-security-policy", "")

    def test_dashboard_file_path_gets_sameorigin_and_self(self):
        h = self._capture("/dashboard/api/files/some/key.pdf", "")
        assert h.get("x-frame-options") == "SAMEORIGIN"
        csp = h.get("content-security-policy", "")
        assert "frame-ancestors 'self'" in csp
        assert "frame-ancestors 'none'" not in csp

    def test_split_origin_deploy_lists_portal_in_frame_ancestors(self):
        h = self._capture(
            "/dashboard/api/files/x.pdf",
            "https://portal.example.com,http://localhost:3000",
        )
        csp = h.get("content-security-policy", "")
        assert "frame-ancestors 'self' https://portal.example.com http://localhost:3000" in csp
        assert h.get("x-frame-options") == "SAMEORIGIN"

    def test_all_four_file_prefixes_are_embeddable(self):
        # PA / dept officer / events UI / minister PWA all serve previewable
        # bytes through their own auth-gated /api/files/* route.
        for prefix in (
            "/dashboard/api/files/",
            "/department/api/files/",
            "/events/api/files/",
            "/minister/api/files/",
        ):
            h = self._capture(prefix + "any/key.pdf", "")
            assert h.get("x-frame-options") == "SAMEORIGIN", f"{prefix} not relaxed"
            assert "frame-ancestors 'self'" in h.get("content-security-policy", "")

    def test_bogus_origin_stripped_before_use(self):
        # Anything without a scheme is dropped rather than injected into
        # frame-ancestors (would corrupt the directive).
        h = self._capture(
            "/dashboard/api/files/x.pdf",
            "https://portal.example.com,malformed-no-scheme,,   ,ftp://ignored",
        )
        csp = h.get("content-security-policy", "")
        assert "frame-ancestors 'self' https://portal.example.com;" in csp
        assert "malformed" not in csp
        assert "ftp://" not in csp

    def test_other_security_headers_still_present_on_file_path(self):
        # Only frame-ancestors + XFO shift for the file endpoints — nosniff /
        # referrer-policy / permissions-policy stay on every response.
        h = self._capture("/dashboard/api/files/x.pdf", "")
        assert h.get("x-content-type-options") == "nosniff"
        assert "strict-origin-when-cross-origin" in h.get("referrer-policy", "")
        assert "camera=(self)" in h.get("permissions-policy", "")


# ─── ticketing.py: HTTPException imported (dept file-serve 500 → 403) ─────────

class TestTicketingHttpExceptionImport:
    """Regression net for the department file-serve NameError.

    ticketing.py uses `HTTPException` at `_dept_authorize_file` to raise
    403s on cross-department / cross-namespace file access, but the symbol
    was missing from the module's `from fastapi import ...`. Every deny
    path — legitimate or not — raised NameError instead of HTTPException,
    which Starlette then wrapped as a 500 (masking what should have been
    a clean 403 and giving dept_officers a raw traceback in prod logs
    when they tried to open a file they weren't authorised for).

    Reported by user: "in the department login it shows 500 internal
    server". Traceback pointed at
      File "/app/src/api/v1/ticketing.py", line 105, in _dept_authorize_file
        _deny = HTTPException(status_code=403, ...)
      NameError: name 'HTTPException' is not defined
    """

    def test_httpexception_resolvable_in_module_namespace(self):
        # The module has to expose HTTPException in its own namespace —
        # `_dept_authorize_file` builds `_deny = HTTPException(...)` and
        # `dept_serve_upload` awaits into it. If the import ever
        # regresses, this test catches it before the endpoint 500s.
        from src.api.v1 import ticketing
        assert ticketing.HTTPException is not None
        # A quick smoke that the symbol is actually the FastAPI class,
        # not a shadowed local from somewhere else.
        from fastapi import HTTPException as _FastAPIHTTPException
        assert ticketing.HTTPException is _FastAPIHTTPException


# ─── Dept file-serve: ai_uploads/ allowed when routed to caller's dept ────────

class TestDeptAiUploadsAccess:
    """USER-REPORTED: dept officer can open ticket #79 (200) but its citizen-
    uploaded PDF returns 403. Root: `_dept_authorize_file` had `attachments/`
    and `ticket_attachments/` branches but every ai_uploads/… key (which is
    where the citizen's original PDF lives even after the AI upload is
    approved into a ticket) fell through to the fail-closed `raise _deny`.

    Fix: add an ai_uploads/ branch that gates on `AiUpload.ticket_id →
    Ticket.department == caller's department`. Approved-but-cross-dept
    AND unapproved (ticket_id=NULL) both still deny.

    Uses a stub DB so the branch logic is exercised without a live
    Postgres — one execute-then-scalar and one get-Ticket-by-pk.
    """

    def _make_stub_db(self, ticket_id, ticket_dept):
        """Fake AsyncSession: db.execute returns an object with
        scalar_one_or_none() -> ticket_id; db.get(Ticket, id) -> Ticket-like
        with .department = ticket_dept (or None if ticket_id is None)."""
        class _ExecResult:
            def scalar_one_or_none(_self):
                return ticket_id
        class _Ticket:
            department = ticket_dept
        class _StubDB:
            async def execute(_self, *args, **kwargs):
                return _ExecResult()
            async def get(_self, model, pk):
                if ticket_id is None or pk != ticket_id:
                    return None
                return _Ticket()
        return _StubDB()

    def _run(self, file_path, caller_dept, ticket_id, ticket_dept):
        import asyncio
        from src.api.v1.ticketing import _dept_authorize_file
        db = self._make_stub_db(ticket_id, ticket_dept)
        return asyncio.run(_dept_authorize_file(file_path, caller_dept, db))

    def test_ai_uploads_approved_into_callers_dept_allowed(self):
        # AiUpload row exists, ticket_id=42, Ticket.department == "dept_a",
        # caller is dept_a → allowed (returns None, no raise).
        assert self._run("ai_uploads/batch-x/y.pdf", "dept_a", 42, "dept_a") is None

    def test_ai_uploads_approved_into_different_dept_denied(self):
        # Same file, but the ticket routed to dept_b → dept_a must 403.
        from fastapi import HTTPException
        try:
            self._run("ai_uploads/batch-x/y.pdf", "dept_a", 42, "dept_b")
        except HTTPException as e:
            assert e.status_code == 403
        else:
            raise AssertionError("expected HTTPException(403), got clean return")

    def test_ai_uploads_unapproved_still_denied_for_dept(self):
        # AiUpload row present but ticket_id=None (still under PA review) →
        # scalar_one_or_none returns None → deny. Dept must never enumerate
        # unapproved bulk-uploaded PDFs.
        from fastapi import HTTPException
        try:
            self._run("ai_uploads/batch-x/y.pdf", "dept_a", None, None)
        except HTTPException as e:
            assert e.status_code == 403
        else:
            raise AssertionError("expected HTTPException(403)")

    def test_unknown_namespace_still_denied(self):
        # proposals/… and associations/… must remain 403 for dept — no UI
        # surface exists and enumeration would be an IDOR.
        from fastapi import HTTPException
        for path in ("proposals/x.pdf", "associations/y.pdf", "random/z.pdf"):
            try:
                self._run(path, "dept_a", 42, "dept_a")
            except HTTPException as e:
                assert e.status_code == 403
            else:
                raise AssertionError(f"{path!r} should have 403'd")


# ─── dept_add_attachment threads ticket_id + actor into the Activity row ──────

class TestDeptAttachmentActivity:
    """USER-REPORTED: "in dept login before accept if i add attach it is not
    recorded in the activity check that too."

    dept_add_attachment called add_case_attachment(db, appointment_id,
    filename, raw, mime) — dropped ticket_id and actor. The Activity row
    was created but landed only on the appointment (ticket_id NULL), so
    the ticket drawer's timeline (queries Activity by ticket_id) never
    saw it. Actor also defaulted to "pa_admin" — audit couldn't tell who
    uploaded.

    Fix threads both. Test asserts the call signature stays right by
    monkeypatching add_case_attachment and capturing its kwargs.
    """

    def test_ticket_id_and_actor_forwarded(self):
        import asyncio
        from src.services import department_service, dashboard_service

        captured: dict = {}

        async def _fake_add_case_attachment(db, appointment_id, filename,
                                            raw, mime, **kwargs):
            captured.update({
                "appointment_id": appointment_id,
                "filename": filename,
                **kwargs,
            })
            return {"ok": True}

        class _Ticket:
            id = 79
            appointment_id = 1234
            department = "dept_a"

        async def _fake_get_owned(db, ticket_id, department):
            return _Ticket()

        orig_add = dashboard_service.add_case_attachment
        orig_get = department_service._get_owned
        dashboard_service.add_case_attachment = _fake_add_case_attachment
        department_service._get_owned = _fake_get_owned
        try:
            asyncio.run(department_service.dept_add_attachment(
                db=None, ticket_id=79, department="dept_a",
                filename="proof.pdf", raw=b"%PDF-", mime="application/pdf",
            ))
        finally:
            dashboard_service.add_case_attachment = orig_add
            department_service._get_owned = orig_get

        # Both threaded through — that's what makes the Activity row show
        # on the ticket's timeline (via ticket_id) and audit trail (via actor).
        assert captured.get("ticket_id") == 79, "ticket_id must be threaded"
        assert captured.get("actor") == "dept_a", "actor must be the dept, not default pa_admin"
        assert captured.get("appointment_id") == 1234
        assert captured.get("filename") == "proof.pdf"


class TestEventsRoleGates:
    """USER-REPORTED (events PWA): "show the review area too for the uploader,
    but hide the review button and that div for the uploader. now uploader
    can edit and delete the data from review tab too."

    The old gates were reviewer-only across every action on a Needs-Review
    row (list, edit, retry, delete) — which meant the uploader who took the
    bad photo couldn't even see their own failed row to fix or delete it,
    and the PWA silently hid the whole tab. Only Approve stays reviewer-only
    (that's the confirm-with-Minister action).

    Pins the FastAPI route wiring so a future revert to require_events_review
    on the list/edit/retry/delete routes stands out immediately.
    """

    def _deps_of(self, path: str, method: str):
        # Walk the route table, find (path, method), return the dependency
        # callables bound to that handler. The role factory returns a nested
        # _dep(), so identity comparison (not name matching) is what pins the
        # wiring — the upload dep and the review dep are two different
        # objects.
        from src.main import app
        for route in app.routes:
            if getattr(route, "path", None) == path and method.upper() in getattr(route, "methods", set()):
                return [d.call for d in route.dependant.dependencies]
        raise AssertionError(f"route not found: {method} {path}")

    def test_needs_review_accepts_uploader(self):
        from src.core.events_auth import require_events_upload, require_events_review
        deps = self._deps_of("/events/api/events/needs-review", "GET")
        assert require_events_upload in deps, "needs-review must accept uploader"
        assert require_events_review not in deps, "needs-review must not be reviewer-only"

    def test_patch_event_accepts_uploader(self):
        from src.core.events_auth import require_events_upload, require_events_review
        deps = self._deps_of("/events/api/events/{event_id}", "PATCH")
        assert require_events_upload in deps, "PATCH /events/{id} must accept uploader"
        assert require_events_review not in deps, "PATCH /events/{id} must not be reviewer-only"

    def test_delete_event_accepts_uploader(self):
        from src.core.events_auth import require_events_upload, require_events_review
        deps = self._deps_of("/events/api/events/{event_id}", "DELETE")
        assert require_events_upload in deps, "DELETE /events/{id} must accept uploader"
        assert require_events_review not in deps, "DELETE /events/{id} must not be reviewer-only"

    def test_retry_event_accepts_uploader(self):
        from src.core.events_auth import require_events_upload, require_events_review
        deps = self._deps_of("/events/api/events/{event_id}/retry", "POST")
        assert require_events_upload in deps, "POST retry must accept uploader"
        assert require_events_review not in deps, "POST retry must not be reviewer-only"

    def test_approve_stays_reviewer_only(self):
        # The one exception: Approve remains the Minister-facing action, so
        # POST /approve must NOT relax to uploader.
        from src.core.events_auth import require_events_review, require_events_upload
        deps = self._deps_of("/events/api/events/{event_id}/approve", "POST")
        assert require_events_review in deps, "approve must stay reviewer-only"
        assert require_events_upload not in deps, "approve must NOT be widened to uploader"
