"""Name the shared objects stored on the aiohttp app.

Edit this file when the backend needs another shared object, such as a new client or cache.
Copy one line here when you add another app-wide value.
"""

from __future__ import annotations

import aiosqlite
from aiohttp import web

from backend.config import Settings

# Use them like `request.app[DB]` instead of `request.app["db"]`. aiohttp then knows the type of each value.
SETTINGS = web.AppKey("settings", Settings)
DB = web.AppKey("db", aiosqlite.Connection)
