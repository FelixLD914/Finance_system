from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import engine
from app.modules.auth.router import router as auth_router
from app.modules.salary_advance.router import router as salary_advance_router
from app.modules.tax_invoice.router import router as tax_invoice_router
from app.modules.wht.router import router as wht_router

api_router = APIRouter()


@api_router.get("/health/live", tags=["platform"])
async def liveness() -> dict[str, str]:
    return {"status": "ok", "service": "zwt-finance-api"}


@api_router.get("/health/ready", tags=["platform"])
async def readiness() -> dict[str, str]:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database is unavailable",
        ) from exc
    return {
        "status": "ready",
        "service": "zwt-finance-api",
        "database": "ok",
    }


# health/* 与 auth/login 是唯二不需要登录的端点：前者供 WinSW 与发布验收探活，
# 后者是取得会话的入口。其余业务路由在各自模块里挂 PrincipalDependency。
api_router.include_router(auth_router)
api_router.include_router(wht_router)
api_router.include_router(tax_invoice_router)
api_router.include_router(salary_advance_router)
