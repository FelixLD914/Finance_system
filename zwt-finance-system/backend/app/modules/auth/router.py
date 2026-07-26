from fastapi import APIRouter, Response, status

from app.core.authz import permissions_for
from app.core.config import Settings
from app.core.dependencies import (
    AuthServiceDependency,
    PrincipalDependency,
    SettingsDependency,
)
from app.modules.auth.schemas import (
    CurrentUserResponse,
    LoginRequest,
    LogoutResponse,
)
from app.modules.auth.service import IssuedSession

router = APIRouter(prefix="/v1/auth", tags=["auth"])


def _set_session_cookies(
    response: Response,
    issued: IssuedSession,
    settings: Settings,
) -> None:
    max_age = settings.session_idle_minutes * 60
    # 会话令牌：HttpOnly，JS 完全读不到，XSS 无法把它偷走。
    response.set_cookie(
        key=settings.session_cookie_name,
        value=issued.token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookies_require_https,
        samesite="strict",
        path="/",
    )
    # CSRF 令牌：故意不设 HttpOnly，前端要读出来放进 X-CSRF-Token 请求头。
    # 它本身不是凭证，只有和会话 Cookie 一起才有意义。
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=issued.csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookies_require_https,
        samesite="strict",
        path="/",
    )


def _clear_session_cookies(response: Response, settings: Settings) -> None:
    for name in (settings.session_cookie_name, settings.csrf_cookie_name):
        response.delete_cookie(
            key=name,
            path="/",
            secure=settings.cookies_require_https,
            samesite="strict",
        )


@router.post("/login", response_model=CurrentUserResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    auth: AuthServiceDependency,
    settings: SettingsDependency,
) -> CurrentUserResponse:
    user, issued = await auth.login(
        username=payload.username,
        password=payload.password,
    )
    _set_session_cookies(response, issued, settings)
    return CurrentUserResponse(
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        permissions=sorted(permissions_for(user.role)),
    )


@router.get("/me", response_model=CurrentUserResponse)
async def current_user(principal: PrincipalDependency) -> CurrentUserResponse:
    return CurrentUserResponse(
        username=principal.username,
        display_name=principal.actor_name,
        role=principal.role,
        permissions=sorted(principal.permissions),
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    response: Response,
    principal: PrincipalDependency,
    auth: AuthServiceDependency,
    settings: SettingsDependency,
) -> LogoutResponse:
    await auth.logout(principal.session_id)
    _clear_session_cookies(response, settings)
    return LogoutResponse(revoked=1)


@router.post(
    "/logout-all",
    response_model=LogoutResponse,
    status_code=status.HTTP_200_OK,
)
async def logout_all(
    response: Response,
    principal: PrincipalDependency,
    auth: AuthServiceDependency,
    settings: SettingsDependency,
) -> LogoutResponse:
    """吊销当前用户的所有会话。换设备或怀疑口令泄露时使用。"""
    revoked = await auth.logout_all(principal.user_id)
    _clear_session_cookies(response, settings)
    return LogoutResponse(revoked=revoked)
