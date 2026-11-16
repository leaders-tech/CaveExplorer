"""Handle the JSON endpoints: health check, saving a finished run, and run stats.

Edit this file when the game needs another endpoint.
Copy the route pattern here when you add another endpoint backed by backend/db code.
"""

from __future__ import annotations

import logging

from aiohttp import web

from backend.app_keys import DB
from backend.db.runs import run_stats, save_run
from backend.http.json_api import AppError, ok, read_json
from backend.http.middleware import require_allowed_origin

LOGGER = logging.getLogger("backend.runs")
MAX_RUN_SECONDS = 24 * 60 * 60


async def health(request: web.Request) -> web.Response:
    return ok({"status": "ok"})


async def runs_finish(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    payload = await read_json(request)
    outcome = payload.get("outcome")
    recorders = payload.get("recorders")
    seconds = payload.get("seconds")
    if outcome not in {"died", "escaped"}:
        raise AppError(400, "bad_request", "Outcome must be died or escaped.")
    if type(recorders) is not int or not 0 <= recorders <= 4:
        raise AppError(400, "bad_request", "Recorders must be a whole number from 0 to 4.")
    if type(seconds) is not int or not 0 <= seconds <= MAX_RUN_SECONDS:
        raise AppError(400, "bad_request", "Seconds must be a whole number from 0 to 86400.")
    run = await save_run(request.app[DB], outcome, recorders, seconds)
    LOGGER.info("Run finished id=%s outcome=%s recorders=%s seconds=%s", run["id"], outcome, recorders, seconds)
    return ok({"run": run})


async def runs_stats(request: web.Request) -> web.Response:
    return ok(await run_stats(request.app[DB]))


def setup_api_routes(app: web.Application) -> None:
    app.router.add_get("/api/health", health)
    app.router.add_post("/api/runs/finish", runs_finish)
    app.router.add_post("/api/runs/stats", runs_stats)
