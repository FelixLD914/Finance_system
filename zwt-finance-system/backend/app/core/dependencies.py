"""认证与授权依赖。

所有业务路由都必须经过 PrincipalDependency。审计字段的 actor_name 一律取自
这里解析出的登录用户，不再使用配置里的静态名字。
"""

from __future__ import annotations

import hmac
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db_session
from app.core.errors import AuthorizationError
from app.modules.auth.service import (
    AuthService,
    Principal,
    SessionExpiredError,
)

# GET/HEAD/OPTIONS 不改状态，不需要 CSRF 令牌。
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class CsrfError(AuthorizationError):
    pass


def get_settings_dependency() -> Settings:
    return get_settings()


SettingsDependency = Annotated[Settings, Depends(get_settings_dependency)]


async def get_auth_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    settings: SettingsDependency,
) -> AuthService:
    return AuthService(session=session, settings=settings)


AuthServiceDependency = Annotated[AuthService, Depends(get_auth_service)]


def _check_csrf(request: Request, settings: Settings) -> None:
    """双提交校验。

    会话 Cookie 是 HttpOnly + SameSite=Strict，单靠这两项在同源部署下已经基本
    挡住 CSRF。这里再加一道：CSRF 令牌同时放在非 HttpOnly Cookie 和请求头里，
    两者必须一致。跨站的脚本读不到本站 Cookie，也无法在不触发 CORS 预检的情况下
    带上自定义头，因此拿不到可用的组合。
    """
    if request.method in SAFE_METHODS:
        return
    cookie_token = request.cookies.get(settings.csrf_cookie_name)
    header_token = request.headers.get("x-csrf-token")
    if not cookie_token or not header_token:
        raise CsrfError("缺少 CSRF 令牌，请重新登录后重试")
    if not hmac.compare_digest(cookie_token, header_token):
        raise CsrfError("CSRF 令牌不匹配，请重新登录后重试")


async def get_principal(
    request: Request,
    auth: AuthServiceDependency,
    settings: SettingsDependency,
) -> Principal:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise SessionExpiredError("需要登录")
    _check_csrf(request, settings)
    return await auth.resolve(token)


PrincipalDependency = Annotated[Principal, Depends(get_principal)]


def require_permission(
    permission: str,
) -> Callable[[Principal], Coroutine[Any, Any, Principal]]:
    """生成一个校验指定权限点的依赖。

    用法：`_: Annotated[Principal, Depends(require_permission("invoice:approve"))]`
    """

    async def dependency(principal: PrincipalDependency) -> Principal:
        principal.require(permission)
        return principal

    return dependency
