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
    # 彻底废除旧的 enum check 约束（原约束要求 usage IN ('wht', 'tax_inv', 'both')）。
    # Alembic/Postgres 在原表上生成的约束名可能是 ck_signature_assets_ck_signature_assets_usage 或 ck_signature_assets_usage。
    op.execute("ALTER TABLE core.signature_assets DROP CONSTRAINT IF EXISTS ck_signature_assets_ck_signature_assets_usage")
    op.execute("ALTER TABLE core.signature_assets DROP CONSTRAINT IF EXISTS ck_signature_assets_usage")


def downgrade() -> None:
    pass
