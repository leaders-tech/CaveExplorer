"""Save finished game runs and count deaths and escapes for the title screen.

Edit this file when the runs table or its queries change.
Copy this file as a starting point when you add queries for another table.
"""

from __future__ import annotations

from typing import Any

import aiosqlite

from backend.db.connection import utc_now_text


async def save_run(db: aiosqlite.Connection, outcome: str, recorders: int, seconds: int) -> dict[str, Any]:
    cursor = await db.execute(
        """
        INSERT INTO runs (outcome, recorders, seconds, created_at)
        VALUES (?, ?, ?, ?)
        RETURNING id, outcome, recorders, seconds, created_at
        """,
        (outcome, recorders, seconds, utc_now_text()),
    )
    row = await cursor.fetchone()
    await db.commit()
    assert row is not None
    return dict(row)


async def run_stats(db: aiosqlite.Connection) -> dict[str, int | None]:
    cursor = await db.execute(
        """
        SELECT
            COALESCE(SUM(CASE WHEN outcome = 'died' THEN 1 ELSE 0 END), 0) AS deaths,
            COALESCE(SUM(CASE WHEN outcome = 'escaped' THEN 1 ELSE 0 END), 0) AS escapes,
            MIN(CASE WHEN outcome = 'escaped' AND recorders = 4 THEN seconds END) AS best_full_escape_seconds
        FROM runs
        """
    )
    row = await cursor.fetchone()
    assert row is not None
    return dict(row)
