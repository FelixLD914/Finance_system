"""Signer name on signature assets (printed on salary advance slips only).

工资预支单在签名横线下方印 "( 姓名 )"，WHT / TAX INV 的单据上只有签名图、
不出现姓名。姓名以前取自导入表的一列，而章取自签名解析链——两者来源不同、
可以是不同的人，系统拦不住。这一列把它们并到同一个源头上。

整体可空：只对适用范围含工资预支的签名必填，这条规则在应用层校验，不做
CHECK 约束——usage 是逗号分隔串，用 SQL 表达"含某个成员"要靠 LIKE，而模块名
今天互不为子串纯属巧合（见 app.core.signature_usage 的模块注释）。

Revision ID: 20260805_0022
Revises: 20260805_0021
Create Date: 2026-08-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260805_0022"
down_revision: str | None = "20260805_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "signature_assets",
        sa.Column("signer_name", sa.String(length=160), nullable=True),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("signature_assets", "signer_name", schema="core")
