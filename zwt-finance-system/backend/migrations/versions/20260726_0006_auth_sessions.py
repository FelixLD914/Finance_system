"""Server-side sessions for cookie authentication

Revision ID: 20260726_0006
Revises: 20260726_0005
Create Date: 2026-07-26

只建表。管理员账号由 `python -m app.cli create-user` 创建：口令绝不能进迁移
脚本，否则会同时落在 Git 历史和 alembic 的执行日志里。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260726_0006"
down_revision: str | None = "20260726_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        # 存的是令牌的 SHA-256 十六进制摘要（64 字符），不是令牌原值。
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.UniqueConstraint("token_hash", name="uq_core_sessions_token_hash"),
        # 停用或删除用户时连带清掉其所有会话，避免留下可用的孤儿凭证。
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["core.users.id"],
            name="fk_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        schema="core",
    )
    op.create_index(
        "ix_core_sessions_user",
        "sessions",
        ["user_id"],
        schema="core",
    )
    # 清理过期会话的维护任务按 absolute_expires_at 扫描。
    op.create_index(
        "ix_core_sessions_expires_at",
        "sessions",
        ["expires_at"],
        schema="core",
    )
    # 用户名统一按小写存储和比对，数据库层再加一道保证，
    # 避免出现 Admin / admin 两个账号。
    op.execute("UPDATE core.users SET username = lower(username)")
    op.create_check_constraint(
        "ck_users_username_lowercase",
        "users",
        "username = lower(username)",
        schema="core",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_users_username_lowercase",
        "users",
        schema="core",
        type_="check",
    )
    op.drop_index("ix_core_sessions_expires_at", table_name="sessions", schema="core")
    op.drop_index("ix_core_sessions_user", table_name="sessions", schema="core")
    op.drop_table("sessions", schema="core")
