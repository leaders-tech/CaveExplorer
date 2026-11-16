"""Create the runs table: one row for every finished game (died or escaped).

Edit this file only if this migration has not been used yet.
Create a new migration file instead when you need another schema change.
"""

from yoyo import step

steps = [
    step(
        """
        CREATE TABLE runs (
            id INTEGER PRIMARY KEY,
            outcome TEXT NOT NULL CHECK (outcome IN ('died', 'escaped')),
            recorders INTEGER NOT NULL CHECK (recorders BETWEEN 0 AND 4),
            seconds INTEGER NOT NULL CHECK (seconds >= 0),
            created_at TEXT NOT NULL
        ) STRICT
        """,
        "DROP TABLE runs",
    )
]
