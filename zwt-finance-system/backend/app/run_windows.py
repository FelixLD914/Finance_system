"""Windows-native Uvicorn bootstrap.

Psycopg's asyncio implementation requires a selector event loop on Windows.
Uvicorn otherwise deliberately selects a proactor loop for a single Windows
worker, so the application provides an explicit loop factory.
"""

import asyncio

import uvicorn

from app.core.config import get_settings


def selector_loop_factory() -> asyncio.AbstractEventLoop:
    """Create the selector event loop expected by Uvicorn's plug-in API."""
    return asyncio.SelectorEventLoop()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        workers=settings.api_workers,
        loop="app.run_windows:selector_loop_factory",
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
