"""Test saving finished game runs and reading the death/escape stats.

Edit this file when the runs endpoints or the runs table change.
Copy a test pattern here when you add another endpoint test.
"""

from __future__ import annotations

import logging

import pytest


async def finish(client, headers, **body):
    return await client.post("/api/runs/finish", json=body, headers=headers)


async def test_stats_start_empty(client) -> None:
    response = await client.post("/api/runs/stats", json={})
    assert response.status == 200
    assert await response.json() == {"ok": True, "data": {"deaths": 0, "escapes": 0, "best_full_escape_seconds": None}}


async def test_finished_runs_are_counted(client, origin_headers, caplog) -> None:
    with caplog.at_level(logging.INFO, logger="backend.runs"):
        response = await finish(client, origin_headers, outcome="died", recorders=1, seconds=95)
    assert response.status == 200
    run = (await response.json())["data"]["run"]
    assert run["outcome"] == "died" and run["recorders"] == 1 and run["seconds"] == 95
    assert "Run finished" in caplog.text and "outcome=died" in caplog.text

    await finish(client, origin_headers, outcome="died", recorders=0, seconds=20)
    await finish(client, origin_headers, outcome="escaped", recorders=2, seconds=300)
    await finish(client, origin_headers, outcome="escaped", recorders=4, seconds=640)
    await finish(client, origin_headers, outcome="escaped", recorders=4, seconds=510)

    data = (await (await client.post("/api/runs/stats", json={})).json())["data"]
    assert data == {"deaths": 2, "escapes": 3, "best_full_escape_seconds": 510}


@pytest.mark.parametrize(
    "body",
    [
        {"outcome": "won", "recorders": 1, "seconds": 10},
        {"outcome": "died", "recorders": 5, "seconds": 10},
        {"outcome": "died", "recorders": -1, "seconds": 10},
        {"outcome": "died", "recorders": True, "seconds": 10},
        {"outcome": "died", "recorders": 1, "seconds": -3},
        {"outcome": "died", "recorders": 1, "seconds": 1.5},
        {"outcome": "died", "recorders": 1, "seconds": 100000},
        {"outcome": "died", "recorders": 1},
        {},
    ],
)
async def test_bad_runs_are_rejected(client, origin_headers, body) -> None:
    response = await client.post("/api/runs/finish", json=body, headers=origin_headers)
    assert response.status == 400
    payload = await response.json()
    assert payload["ok"] is False and payload["error"]["code"] == "bad_request"


async def test_runs_from_other_websites_are_rejected(client) -> None:
    response = await finish(client, {"Origin": "https://evil.example"}, outcome="died", recorders=0, seconds=5)
    assert response.status == 403


async def test_non_json_body_is_rejected(client, origin_headers) -> None:
    response = await client.post("/api/runs/finish", data="hello", headers=origin_headers)
    assert response.status == 400


async def test_health(client) -> None:
    response = await client.get("/api/health")
    assert await response.json() == {"ok": True, "data": {"status": "ok"}}
