"""drop outdated ck_signature_assets_usage check constraint

Revision ID: 20260804_0020
Revises: 20260804_0019
Create Date: 2026-08-04
"""
from collections.abc import Sequence

from alembic import op

revision: str = "20260804_0020"
down_revision: str | None = "20260804_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 彻底废除旧的 enum check 约束 ck_signature_assets_usage（原约束要求 usage IN ('wht', 'tax_inv', 'both')）。
    # 适用范围已重构成逗号分隔的多选集合 ('wht,tax_inv' / 'wht,tax_inv,salary_advance')，
    # 旧 Check 约束未删除会导致勾选多个适用单据时数据库抛出 500 CheckViolation 错误。
    op.execute("ALTER TABLE core.signature_assets DROP CONSTRAINT IF EXISTS ck_signature_assets_usage")


def downgrade() -> None:
    pass
