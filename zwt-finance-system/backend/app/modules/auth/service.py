from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authz import permissions_for
from app.core.config import Settings
from app.core.errors import AuthenticationError, AuthorizationError
from app.core.models import User, UserSession
from app.core.security import (
    hash_password,
    hash_session_token,
    needs_rehash,
    new_session_token,
    verify_password,
    verify_password_sync,
)


class AuthError(AuthenticationError):
    pass


class InvalidCredentialsError(AuthError):
    pass


class SessionExpiredError(AuthError):
    pass


class PermissionDeniedError(AuthorizationError):
    pass


@dataclass(frozen=True)
class IssuedSession:
    token: str
    csrf_token: str
    expires_at: datetime


@dataclass(frozen=True)
class Principal:
    """一次请求背后的已认证用户。actor_name 会被写进所有审计字段。"""

    user_id: uuid.UUID
    username: str
    actor_name: str
    role: str
    permissions: frozenset[str]
    session_id: uuid.UUID

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def require(self, permission: str) -> None:
        if not self.has(permission):
            raise PermissionDeniedError(
                f"当前角色 {self.role} 没有 {permission} 权限"
            )


# 用户名不存在时也要跑一次同等成本的派生，否则响应时间会泄露"该用户名是否存在"。
# 这是一个格式合法但永不匹配的哈希，参数与当前配置一致。
_DUMMY_HASH = (
    "scrypt$65536$8$2$"
    "AAAAAAAAAAAAAAAAAAAAAA==$"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
)


class AuthService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def login(self, *, username: str, password: str) -> tuple[User, IssuedSession]:
        clean_username = username.strip().lower()
        user = await self.session.scalar(
            select(User).where(User.username == clean_username)
        )

        if user is None:
            # 恒定时间路径：不存在的用户名也付一次完整派生的代价。
            await verify_password(password, _DUMMY_HASH)
            raise InvalidCredentialsError("用户名或口令不正确")

        if not await verify_password(password, user.password_hash):
            raise InvalidCredentialsError("用户名或口令不正确")

        # 停用检查放在口令校验之后：否则"口令错"与"账号已停用"的响应差异
        # 会让人用错口令探出哪些账号是有效的。
        if not user.is_active:
            raise InvalidCredentialsError("用户名或口令不正确")

        if needs_rehash(user.password_hash):
            user.password_hash = await hash_password(password)

        issued = await self._create_session(user)
        await self.session.commit()
        return user, issued

    async def _create_session(self, user: User) -> IssuedSession:
        now = datetime.now(UTC)
        token, token_hash = new_session_token()
        idle_expiry = now + timedelta(minutes=self.settings.session_idle_minutes)
        absolute_expiry = now + timedelta(minutes=self.settings.session_absolute_minutes)
        self.session.add(
            UserSession(
                user_id=user.id,
                token_hash=token_hash,
                expires_at=min(idle_expiry, absolute_expiry),
                absolute_expires_at=absolute_expiry,
            )
        )
        return IssuedSession(
            token=token,
            csrf_token=secrets.token_urlsafe(32),
            expires_at=min(idle_expiry, absolute_expiry),
        )

    async def resolve(self, token: str) -> Principal:
        """校验会话令牌并顺延滑动过期时间。"""
        now = datetime.now(UTC)
        row = (
            await self.session.execute(
                select(UserSession, User)
                .join(User, User.id == UserSession.user_id)
                .where(UserSession.token_hash == hash_session_token(token))
            )
        ).first()
        if row is None:
            raise SessionExpiredError("会话无效，请重新登录")

        user_session, user = row
        if user_session.expires_at <= now or user_session.absolute_expires_at <= now:
            # 过期会话直接删掉，不留垃圾行。
            await self.session.delete(user_session)
            await self.session.commit()
            raise SessionExpiredError("会话已过期，请重新登录")

        # 用户被停用后，已签发的会话必须立刻失效 —— 这正是选服务端会话的理由，
        # JWT 做不到不加黑名单就即时吊销。
        if not user.is_active:
            await self.session.delete(user_session)
            await self.session.commit()
            raise SessionExpiredError("账号已停用")

        new_expiry = min(
            now + timedelta(minutes=self.settings.session_idle_minutes),
            user_session.absolute_expires_at,
        )
        # 只在明显推进时才写库，避免每个请求都产生一次 UPDATE。
        if new_expiry - user_session.expires_at > timedelta(minutes=1):
            user_session.expires_at = new_expiry
            user_session.last_seen_at = now
            await self.session.commit()

        return Principal(
            user_id=user.id,
            username=user.username,
            actor_name=user.display_name,
            role=user.role,
            permissions=permissions_for(user.role),
            session_id=user_session.id,
        )

    async def logout(self, session_id: uuid.UUID) -> None:
        await self.session.execute(
            delete(UserSession).where(UserSession.id == session_id)
        )
        await self.session.commit()

    async def logout_all(self, user_id: uuid.UUID) -> int:
        result = await self.session.execute(
            delete(UserSession).where(UserSession.user_id == user_id)
        )
        await self.session.commit()
        return int(result.rowcount or 0)

    async def purge_expired(self) -> int:
        """清理过期会话。发布脚本或维护任务可以调用。"""
        now = datetime.now(UTC)
        result = await self.session.execute(
            delete(UserSession).where(UserSession.absolute_expires_at <= now)
        )
        await self.session.commit()
        return int(result.rowcount or 0)


__all__ = [
    "AuthError",
    "AuthService",
    "InvalidCredentialsError",
    "IssuedSession",
    "PermissionDeniedError",
    "Principal",
    "SessionExpiredError",
    "verify_password_sync",
]
