"""TAX INV void and correction relationship

Revision ID: 20260726_0005
Revises: 20260726_0004
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260726_0005"
down_revision: str | None = "20260726_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "invoices",
        sa.Column(
            "correction_of_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        schema="tax_invoice",
    )
    op.create_foreign_key(
        "fk_tax_invoice_invoices_correction_of_id_invoices",
        "invoices",
        "invoices",
        ["correction_of_id"],
        ["id"],
        source_schema="tax_invoice",
        referent_schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_invoices_correction_of",
        "invoices",
        ["correction_of_id"],
        schema="tax_invoice",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tax_invoice_invoices_correction_of",
        table_name="invoices",
        schema="tax_invoice",
    )
    op.drop_constraint(
        "fk_tax_invoice_invoices_correction_of_id_invoices",
        "invoices",
        schema="tax_invoice",
        type_="foreignkey",
    )
    op.drop_column("invoices", "correction_of_id", schema="tax_invoice")
