"""Signature usage becomes a module set instead of a single enum.

加入工资预支后 "both"（两者）这个取值不再成立，改成逗号分隔的模块集合：
wht / tax_inv / salary_advance 任意组合。旧值 both 迁为 "tax_inv,wht"。

Revision ID: 20260728_0011
Revises: 20260728_0010
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0011"
down_revision: str | None = "20260728_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE core.signature_assets DROP CONSTRAINT IF EXISTS ck_signature_assets_ck_signature_assets_usage"
    )
    op.execute(
        "ALTER TABLE core.signature_assets DROP CONSTRAINT IF EXISTS ck_signature_assets_usage"
    )
    op.alter_column(
        "signature_assets",
        "usage",
        existing_type=sa.String(length=20),
        type_=sa.String(length=60),
        existing_nullable=False,
        schema="core",
    )
    # 序列化顺序与 app.core.signature_usage.SIGNATURE_MODULES 一致（wht 在前）。
    op.execute(
        "UPDATE core.signature_assets SET usage = 'wht,tax_inv' WHERE usage = 'both'"
    )


def downgrade() -> None:
    # 回退只能取一个模块：含多个模块的记录折回 both（历史语义），
    # 只勾了工资预支的折回 wht —— 旧版本没有这个概念。
    op.execute(
        "UPDATE core.signature_assets SET usage = 'both' WHERE usage LIKE '%,%'"
    )
    op.execute(
        "UPDATE core.signature_assets SET usage = 'wht' WHERE usage = 'salary_advance'"
    )
    op.alter_column(
        "signature_assets",
        "usage",
        existing_type=sa.String(length=60),
        type_=sa.String(length=20),
        existing_nullable=False,
        schema="core",
    )
