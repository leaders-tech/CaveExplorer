"""Test startup paths and environment validation.

Edit when startup or environment validation changes. Copy for another startup rule.
"""

from dataclasses import replace

import pytest

from backend.app_keys import DB
from backend.config import validate_settings
from backend.db.runs import run_stats
from backend.main import create_app, on_cleanup, on_startup


def test_prod_requires_https(test_settings) -> None:
    with pytest.raises(ValueError, match="https"):
        validate_settings(replace(test_settings, mode="prod", frontend_origin="http://school.example"))


def test_prod_accepts_https(test_settings) -> None:
    validate_settings(replace(test_settings, mode="prod", frontend_origin="https://school.example"))


def test_unknown_mode_is_rejected(test_settings) -> None:
    with pytest.raises(ValueError, match="APP_MODE"):
        validate_settings(replace(test_settings, mode="production"))


@pytest.mark.asyncio
async def test_prod_starts_with_nested_database(test_settings, tmp_path) -> None:
    settings = replace(test_settings, mode="prod", db_path=tmp_path / "new" / "nested" / "app.sqlite3", frontend_origin="https://school.example")
    app = create_app(settings)
    try:
        await on_startup(app)
        assert settings.db_path.exists()
        assert (await run_stats(app[DB]))["deaths"] == 0
    finally:
        await on_cleanup(app)
