from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import get_settings
from app.modules.wht.service import WhtServiceError


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Database connectivity is checked by the readiness endpoint and deployment
    # preflight. Startup remains deterministic so WinSW can report useful errors.
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url=f"{settings.api_prefix}/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url=(
            f"{settings.api_prefix}/openapi.json" if settings.environment != "production" else None
        ),
        lifespan=lifespan,
    )

    @application.exception_handler(WhtServiceError)
    async def handle_wht_service_error(
        _: Request,
        exc: WhtServiceError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": str(exc)},
        )

    application.include_router(api_router, prefix=settings.api_prefix)
    return application


app = create_app()
