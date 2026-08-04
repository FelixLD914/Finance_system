"""add scale_percent to signature_assets

Revision ID: 20260804_0019
Revises: 20260801_0018_wht_payee_branches
Create Date: 2026-08-04 07:12:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260804_0019"
down_revision: str | None = "20260801_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "signature_assets",
        sa.Column(
            "scale_percent",
            sa.Integer(),
            nullable=False,
            server_default="100",
        ),
        schema="core",
    )


def downgrade() -> None:
    op.drop_column("signature_assets", "scale_percent", schema="core")
