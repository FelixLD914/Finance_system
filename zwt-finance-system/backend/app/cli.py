"""用户与会话维护命令。

    python -m app.cli create-user --username admin --role admin --display-name 张三
    python -m app.cli set-password --username admin
    python -m app.cli list-users
    python -m app.cli deactivate --username someone
    python -m app.cli purge-sessions

口令永远不作为命令行参数传入：命令行会进入 shell 历史，在 Windows 上还能被
其他进程通过进程列表读到。默认交互式提示（不回显），脚本化场景用
`--password-env VARNAME` 从环境变量读。
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys
from datetime import UTC, datetime

from sqlalchemy import delete, select

from app.core.authz import DEFAULT_ROLE, ROLE_PERMISSIONS
from app.core.database import SessionFactory
from app.core.models import User, UserSession
from app.core.security import hash_password

MIN_PASSWORD_LENGTH = 12


def _read_password(password_env: str | None, *, confirm: bool) -> str:
    if password_env:
        password = os.environ.get(password_env)
        if not password:
            raise SystemExit(f"环境变量 {password_env} 未设置或为空")
    else:
        password = getpass.getpass("口令: ")
        if confirm and password != getpass.getpass("再输一次: "):
            raise SystemExit("两次输入不一致")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(f"口令至少 {MIN_PASSWORD_LENGTH} 位")
    return password


async def create_user(args: argparse.Namespace) -> int:
    if args.role not in ROLE_PERMISSIONS:
        raise SystemExit(
            f"未知角色 {args.role}；可用角色：{', '.join(sorted(ROLE_PERMISSIONS))}"
        )
    username = args.username.strip().lower()
    password = _read_password(args.password_env, confirm=True)
    async with SessionFactory() as session:
        if await session.scalar(select(User.id).where(User.username == username)):
            raise SystemExit(f"用户 {username} 已存在；改口令请用 set-password")
        session.add(
            User(
                username=username,
                password_hash=await hash_password(password),
                display_name=args.display_name or username,
                role=args.role,
                is_active=True,
            )
        )
        await session.commit()
    print(f"已创建 {username}（角色 {args.role}）")
    return 0


async def set_password(args: argparse.Namespace) -> int:
    username = args.username.strip().lower()
    password = _read_password(args.password_env, confirm=True)
    async with SessionFactory() as session:
        user = await session.scalar(select(User).where(User.username == username))
        if user is None:
            raise SystemExit(f"用户 {username} 不存在")
        user.password_hash = await hash_password(password)
        # 改口令必须踢掉该用户全部既有会话，否则旧 Cookie 仍然可用，
        # "怀疑泄露所以改口令"就失去了意义。
        revoked = await session.execute(
            delete(UserSession).where(UserSession.user_id == user.id)
        )
        await session.commit()
    print(f"已更新 {username} 的口令，吊销 {revoked.rowcount or 0} 个会话")
    return 0


async def list_users(_: argparse.Namespace) -> int:
    async with SessionFactory() as session:
        users = (
            await session.scalars(select(User).order_by(User.username))
        ).all()
    if not users:
        print("尚无用户。先执行 create-user。")
        return 0
    print(f"{'用户名':<20} {'角色':<12} {'状态':<8} 显示名")
    for user in users:
        state = "启用" if user.is_active else "停用"
        print(f"{user.username:<20} {user.role:<12} {state:<8} {user.display_name}")
    return 0


async def deactivate(args: argparse.Namespace) -> int:
    username = args.username.strip().lower()
    async with SessionFactory() as session:
        user = await session.scalar(select(User).where(User.username == username))
        if user is None:
            raise SystemExit(f"用户 {username} 不存在")
        user.is_active = False
        revoked = await session.execute(
            delete(UserSession).where(UserSession.user_id == user.id)
        )
        await session.commit()
    print(f"已停用 {username}，吊销 {revoked.rowcount or 0} 个会话")
    return 0


async def purge_sessions(_: argparse.Namespace) -> int:
    async with SessionFactory() as session:
        result = await session.execute(
            delete(UserSession).where(
                UserSession.absolute_expires_at <= datetime.now(UTC)
            )
        )
        await session.commit()
    print(f"已清理 {result.rowcount or 0} 个过期会话")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_password_flag(target: argparse.ArgumentParser) -> None:
        target.add_argument(
            "--password-env",
            metavar="VARNAME",
            help="从该环境变量读口令，供无人值守脚本使用；省略则交互式提示",
        )

    create = sub.add_parser("create-user", help="创建用户")
    create.add_argument("--username", required=True)
    create.add_argument("--display-name", help="审计字段里显示的姓名，默认取用户名")
    create.add_argument(
        "--role",
        default=DEFAULT_ROLE,
        help=f"角色，默认 {DEFAULT_ROLE}；可用：{', '.join(sorted(ROLE_PERMISSIONS))}",
    )
    add_password_flag(create)
    create.set_defaults(handler=create_user)

    change = sub.add_parser("set-password", help="重设口令并吊销该用户所有会话")
    change.add_argument("--username", required=True)
    add_password_flag(change)
    change.set_defaults(handler=set_password)

    listing = sub.add_parser("list-users", help="列出所有用户")
    listing.set_defaults(handler=list_users)

    off = sub.add_parser("deactivate", help="停用用户并吊销其所有会话")
    off.add_argument("--username", required=True)
    off.set_defaults(handler=deactivate)

    purge = sub.add_parser("purge-sessions", help="清理已过绝对上限的会话")
    purge.set_defaults(handler=purge_sessions)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # Windows 上 psycopg 的异步实现要求 selector 事件循环，与 run_windows 同理。
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    return asyncio.run(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
