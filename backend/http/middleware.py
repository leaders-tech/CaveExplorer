"""Apply shared backend middleware such as errors, request logs, CORS, and origin checks.

Edit this file when request-wide backend rules change.
Copy the helper style here when you add another small shared middleware helper.
"""

from __future__ import annotations

import logging
from time import perf_counter

from aiohttp import web

from backend.app_keys import SETTINGS
from backend.http.json_api import AppError, fail

ERROR_LOGGER = logging.getLogger("backend.error")
REQUEST_LOGGER = logging.getLogger("backend.request")


def add_cors_headers(request: web.Request, response: web.StreamResponse) -> web.StreamResponse:
    settings = request.app[SETTINGS]
    origin = request.headers.get("Origin", "").rstrip("/")
    # Production stays same-origin behind a reverse proxy. These CORS headers are only for localhost-style dev splits.
    if settings.mode != "prod" and origin in settings.allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response


@web.middleware
async def error_middleware(request: web.Request, handler):
    try:
        return await handler(request)
    except AppError as error:
        return add_cors_headers(request, fail(error.status, error.code, error.message))
    except web.HTTPException as error:
        if error.status >= 400:
            return add_cors_headers(request, fail(error.status, "http_error", error.reason or "Request failed."))
        raise
    except Exception:
        ERROR_LOGGER.exception("Unhandled backend error while handling %s %s", request.method, request.path)
        return add_cors_headers(request, fail(500, "server_error", "Server error."))


@web.middleware
async def request_logging_middleware(request: web.Request, handler):
    started_at = perf_counter()
    response = await handler(request)
    settings = request.app[SETTINGS]
    duration_ms = round((perf_counter() - started_at) * 1000)
    message = f"{request.method} {request.path} {response.status} {duration_ms}ms"

    if response.status >= 500:
        REQUEST_LOGGER.error(message)
    elif settings.debug_logs:
        REQUEST_LOGGER.info(message)
    return response


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)
    return add_cors_headers(request, response)


def require_allowed_origin(request: web.Request) -> None:
    settings = request.app[SETTINGS]
    origin = request.headers.get("Origin")
    # A small check that stops other websites from posting fake runs from a visitor's browser.
    if origin is None:
        return
    if origin.rstrip("/") not in settings.allowed_origins:
        raise AppError(403, "forbidden_origin", "Origin is not allowed.")
