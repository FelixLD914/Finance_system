"""Scope each signature to the documents it may be stamped on

Revision ID: 20260728_0008
Revises: 20260728_0007
Create Date: 2026-07-28

签名图库原本只服务 WHT。旧的两个工具用的是**不同的人**——WHT 是「签名图-Yao」，
TAX INV 是「Sign_zhao」——所以一张图能盖在哪种单据上必须显式记录，不能靠约定。

现存记录一律标成 wht：图库是随 WHT 模块上线的，此前没有任何一张是给 TAX INV 用的，
默认成 both 会让它们立刻可用于税票，那是没人批准过的。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0008"
down_revision: str | None = "20260728_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "signature_assets",
        sa.Column("usage", sa.String(20), nullable=False, server_default="wht"),
        schema="core",
    )
    op.create_check_constraint(
        "ck_signature_assets_usage",
        "signature_assets",
        "usage IN ('wht', 'tax_inv', 'both')",
        schema="core",
    )
    # server_default 只为了填历史行，之后由应用显式给值，避免"忘了传"时静默落 wht。
    op.alter_column("signature_assets", "usage", server_default=None, schema="core")


def downgrade() -> None:
    op.drop_constraint(
        "ck_signature_assets_usage",
        "signature_assets",
        schema="core",
        type_="check",
    )
    op.drop_column("signature_assets", "usage", schema="core")
