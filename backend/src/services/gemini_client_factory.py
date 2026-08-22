"""
Shared Gemini + Vertex client bundle.

Every AI extraction / summarisation service in this codebase — petition,
proposal, proposal-identity, association, event, classification, grievance
summarisation — uses the same "Vertex-first, direct-API-fallback" pattern with
the same retry ladder. This module centralises that so each service just
declares its prompt / schema / model list and delegates the plumbing.

Vertex is preferred (data residency, VPC-SC, IAM audit); the direct Gemini API
is the automatic fallback so a Vertex outage never blocks citizen work. When
`VERTEX_AI_ENABLED` is False, or when Vertex init raises (bad creds, wrong
project, no ADC available), the bundle falls back to direct-only silently
without ever aborting a request.

Behavioural parity with the pre-refactor code:
  · Transient markers + retry ladder mirror `summarisation.py`
  · `service_tier` is stripped before calling Vertex (Vertex rejects it)
  · Response is read from `.parsed` first, `.text` fallback second
  · Per-request `http_options` timeout of 30s injected if caller didn't set one
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional, Tuple, Type, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Transient-error detection — kept in sync with the values summarisation.py
# used pre-refactor so behaviour across the pipeline is unchanged. Add markers
# here and every service picks them up automatically.
_TRANSIENT_MARKERS = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "overloaded")
_TRANSIENT_EXC_NAMES = frozenset({
    "ServiceUnavailable", "ResourceExhausted", "TooManyRequests",
    "DeadlineExceeded", "InternalServerError", "GatewayTimeout", "APIError",
})
_MAX_RETRIES_PER_MODEL = 2
_BACKOFF_BASE_SECONDS = 0.6
# 30s per-request cap. The SDK's default is minutes, which under a partial
# upstream outage hangs request threads inside the executor pool for so long
# that other extractions can't get a slot. Callers can override by passing a
# `config` with their own http_options.
_DEFAULT_HTTP_TIMEOUT_MS = 30_000

T = TypeVar("T", bound=BaseModel)


def _is_transient(exc: Exception) -> bool:
    """True if the error looks retriable — same rule summarisation.py used
    pre-refactor. Prefer type/status inspection over substring matching so a
    repackaged / wrapped exception (SDK version bump, ApiError rewrapping)
    doesn't silently skip retry and burn fallback capacity on a transient
    blip. Substring fallback covers older SDK layers."""
    status = getattr(exc, "status_code", None) or getattr(exc, "http_status", None)
    if status in (429, 500, 502, 503, 504):
        return True
    if type(exc).__name__ in _TRANSIENT_EXC_NAMES:
        return True
    msg = str(exc)
    return any(marker in msg for marker in _TRANSIENT_MARKERS)


@dataclass
class GeminiClientBundle:
    """Vertex (optional) + direct API (always). Callers invoke
    `.call_with_fallback(response_type=..., ...)` and get Vertex-first
    routing with automatic direct-API fallback on any Vertex failure.

    Return: `(parsed_result, backend_used)` where `backend_used` is
    `"vertex"` or `"gemini_api"` — services that log which backend served
    a call can use it directly.
    """
    direct: genai.Client
    vertex: Optional[genai.Client]
    primary_model: str
    fallback_model: Optional[str] = None
    fallback_model2: Optional[str] = None
    service_tier: Optional[types.ServiceTier] = None
    _models_cache: list = field(default_factory=list, repr=False)

    @property
    def models_to_try(self) -> list:
        if not self._models_cache:
            out = [self.primary_model]
            for m in (self.fallback_model, self.fallback_model2):
                if m and m not in out:
                    out.append(m)
            self._models_cache = out
        return self._models_cache

    def call_with_fallback(
        self,
        *,
        contents: list,
        config: types.GenerateContentConfig,
        response_type: Type[T],
        service_name: str = "gemini",
    ) -> Tuple[T, str]:
        """Try Vertex first (if configured), then the direct API. Each backend
        retries the primary → fallback1 → fallback2 chain with transient-error
        backoff. Raises RuntimeError only when every backend + model + retry
        has been exhausted."""
        # Inject a 30s per-request timeout if the caller didn't set one. Copy
        # so retries and cross-backend fallback don't share a mutated config.
        if config is not None and getattr(config, "http_options", None) is None:
            config = config.model_copy(
                update={"http_options": types.HttpOptions(timeout=_DEFAULT_HTTP_TIMEOUT_MS)}
            )

        last_exc: Optional[Exception] = None
        if self.vertex is not None:
            result, last_exc = self._try_backend(
                self.vertex, contents, config, response_type,
                service_name=service_name, is_vertex=True,
            )
            if result is not None:
                return (result, "vertex")
            logger.warning(
                "%s: every Vertex model exhausted — falling through to direct Gemini API",
                service_name,
            )

        result, last_exc = self._try_backend(
            self.direct, contents, config, response_type,
            service_name=service_name, is_vertex=False,
        )
        if result is not None:
            return (result, "gemini_api")

        raise RuntimeError(
            f"{service_name}: all backends and models failed: {last_exc}"
        ) from last_exc

    def _try_backend(
        self,
        client: genai.Client,
        contents: list,
        config: types.GenerateContentConfig,
        response_type: Type[T],
        *,
        service_name: str,
        is_vertex: bool,
    ) -> Tuple[Optional[T], Optional[Exception]]:
        # Vertex rejects `service_tier` as INVALID_ARGUMENT — strip it before
        # routing there. Direct API keeps it.
        cfg = config
        if is_vertex and cfg is not None and getattr(cfg, "service_tier", None) is not None:
            cfg = cfg.model_copy(update={"service_tier": None})

        backend = "vertex" if is_vertex else "gemini_api"
        last_exc: Optional[Exception] = None
        for model in self.models_to_try:
            for retry in range(_MAX_RETRIES_PER_MODEL):
                try:
                    response = client.models.generate_content(
                        model=model, contents=contents, config=cfg,
                    )
                    parsed = self._parse(response, response_type, service_name)
                    return (parsed, None)
                except UnicodeEncodeError as exc:
                    # google-genai SDK ascii-in-header bug — every model would
                    # fail identically since the encode happens client-side
                    # before the request leaves the process. Short-circuit
                    # instead of burning the whole fallback chain.
                    # Callers should ascii-sanitise user fields upstream;
                    # this branch only fires on regressions.
                    logger.warning(
                        "%s: SDK ascii-in-header bug on model=%s — aborting "
                        "fallback chain (all models would fail identically): %s",
                        service_name, model, exc,
                    )
                    raise RuntimeError(
                        f"{service_name}: SDK unicode-in-header bug — a caller "
                        f"passed a non-ASCII field past the sanitiser. {exc}"
                    ) from exc
                except Exception as exc:
                    last_exc = exc
                    transient = _is_transient(exc)
                    logger.warning(
                        "%s failed backend=%s model=%s (try %d/%d, transient=%s): %s",
                        service_name, backend, model,
                        retry + 1, _MAX_RETRIES_PER_MODEL, transient, exc,
                    )
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    break
        return (None, last_exc)

    @staticmethod
    def _parse(response: Any, response_type: Type[T], service_name: str) -> T:
        """Read the structured response — `.parsed` first (SDK-preferred),
        `.text` as a manual-JSON fallback. Raises on unparseable output."""
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, response_type):
            return parsed
        text = getattr(response, "text", None)
        if text:
            return response_type.model_validate_json(text)
        raise ValueError(f"{service_name}: Gemini returned empty response with no parsed object")

    # ── Raw-response variant (no schema, no Pydantic parse) ─────────────────
    def call_raw_with_fallback(
        self,
        *,
        contents: list,
        config: types.GenerateContentConfig,
        service_name: str = "gemini",
    ) -> Tuple[Any, str]:
        """Same Vertex-first routing + retry ladder as call_with_fallback,
        but returns the raw SDK `response` object (for text-only callers like
        STT that don't want structured / schema output). The caller reads
        `response.text` themselves."""
        if config is not None and getattr(config, "http_options", None) is None:
            config = config.model_copy(
                update={"http_options": types.HttpOptions(timeout=_DEFAULT_HTTP_TIMEOUT_MS)}
            )
        last_exc: Optional[Exception] = None
        if self.vertex is not None:
            resp, last_exc = self._try_backend_raw(
                self.vertex, contents, config, service_name=service_name, is_vertex=True,
            )
            if resp is not None:
                return (resp, "vertex")
            logger.warning(
                "%s: every Vertex model exhausted — falling through to direct Gemini API",
                service_name,
            )
        resp, last_exc = self._try_backend_raw(
            self.direct, contents, config, service_name=service_name, is_vertex=False,
        )
        if resp is not None:
            return (resp, "gemini_api")
        raise RuntimeError(
            f"{service_name}: all backends and models failed: {last_exc}"
        ) from last_exc

    def _try_backend_raw(
        self,
        client: genai.Client,
        contents: list,
        config: types.GenerateContentConfig,
        *,
        service_name: str,
        is_vertex: bool,
    ) -> Tuple[Optional[Any], Optional[Exception]]:
        cfg = config
        if is_vertex and cfg is not None and getattr(cfg, "service_tier", None) is not None:
            cfg = cfg.model_copy(update={"service_tier": None})
        backend = "vertex" if is_vertex else "gemini_api"
        last_exc: Optional[Exception] = None
        for model in self.models_to_try:
            for retry in range(_MAX_RETRIES_PER_MODEL):
                try:
                    response = client.models.generate_content(
                        model=model, contents=contents, config=cfg,
                    )
                    return (response, None)
                except UnicodeEncodeError as exc:
                    # google-genai SDK ascii-in-header bug — every model would
                    # fail identically since the encode happens client-side
                    # before the request leaves the process. Short-circuit
                    # instead of burning the whole fallback chain.
                    # Callers should ascii-sanitise user fields upstream;
                    # this branch only fires on regressions.
                    logger.warning(
                        "%s: SDK ascii-in-header bug on model=%s — aborting "
                        "fallback chain (all models would fail identically): %s",
                        service_name, model, exc,
                    )
                    raise RuntimeError(
                        f"{service_name}: SDK unicode-in-header bug — a caller "
                        f"passed a non-ASCII field past the sanitiser. {exc}"
                    ) from exc
                except Exception as exc:
                    last_exc = exc
                    transient = _is_transient(exc)
                    logger.warning(
                        "%s (raw) failed backend=%s model=%s (try %d/%d, transient=%s): %s",
                        service_name, backend, model,
                        retry + 1, _MAX_RETRIES_PER_MODEL, transient, exc,
                    )
                    if transient and retry < _MAX_RETRIES_PER_MODEL - 1:
                        time.sleep(_BACKOFF_BASE_SECONDS * (2 ** retry))
                        continue
                    break
        return (None, last_exc)


def build_from_settings(
    *,
    primary_model: Optional[str] = None,
    fallback_model: Optional[str] = None,
    fallback_model2: Optional[str] = None,
    service_tier: Optional[str] = None,
) -> GeminiClientBundle:
    """Build a bundle from application Settings. Model + tier arguments
    override the settings defaults — most services pass nothing and inherit
    the shared defaults (GEMINI_PRIMARY_MODEL / _FALLBACK / _FALLBACK2 /
    _SERVICE_TIER)."""
    from src.core.config import settings
    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set in backend/.env")
    direct = genai.Client(api_key=settings.GEMINI_API_KEY)

    tier: Optional[types.ServiceTier] = None
    tier_str = (service_tier or settings.GEMINI_SERVICE_TIER or "").strip().lower()
    if tier_str:
        try:
            tier = types.ServiceTier(tier_str)
        except ValueError:
            logger.warning("Unknown GEMINI_SERVICE_TIER %r; ignoring (using API default)", tier_str)

    vertex: Optional[genai.Client] = None
    if settings.VERTEX_AI_ENABLED and settings.VERTEX_PROJECT_ID:
        try:
            creds = None
            creds_source = "ADC"
            if settings.VERTEX_SERVICE_ACCOUNT_JSON:
                from google.oauth2 import service_account
                # VERTEX_SERVICE_ACCOUNT_JSON is intentionally overloaded: accepts
                # either a filesystem path (local dev / VPS with the JSON on disk)
                # OR the raw JSON content itself (Railway / any hosted platform
                # where you can't mount a secret file). We detect by peeking at
                # the first non-whitespace char — service-account JSON always
                # starts with '{'; filesystem paths never do. Never push the raw
                # JSON to git — put it in the platform's secrets store and
                # inject via env var.
                stripped = settings.VERTEX_SERVICE_ACCOUNT_JSON.lstrip()
                if stripped.startswith("{"):
                    import json as _json
                    info = _json.loads(stripped)
                    creds = service_account.Credentials.from_service_account_info(
                        info,
                        scopes=["https://www.googleapis.com/auth/cloud-platform"],
                    )
                    creds_source = "env-content"
                else:
                    creds = service_account.Credentials.from_service_account_file(
                        settings.VERTEX_SERVICE_ACCOUNT_JSON,
                        scopes=["https://www.googleapis.com/auth/cloud-platform"],
                    )
                    creds_source = "explicit-file"
            vertex = genai.Client(
                vertexai=True,
                project=settings.VERTEX_PROJECT_ID,
                location=settings.VERTEX_LOCATION,
                credentials=creds,   # None → ADC / GOOGLE_APPLICATION_CREDENTIALS
            )
            logger.info(
                "Vertex AI backend ready (project=%s location=%s creds=%s)",
                settings.VERTEX_PROJECT_ID, settings.VERTEX_LOCATION, creds_source,
            )
        except Exception as exc:
            logger.error(
                "Vertex AI client failed to initialise — every extraction falls back "
                "to direct Gemini API. err=%r", exc,
            )
            vertex = None

    return GeminiClientBundle(
        direct=direct, vertex=vertex,
        primary_model=primary_model or settings.GEMINI_PRIMARY_MODEL,
        fallback_model=fallback_model or settings.GEMINI_FALLBACK_MODEL,
        fallback_model2=fallback_model2 or settings.GEMINI_FALLBACK_MODEL2,
        service_tier=tier,
    )
