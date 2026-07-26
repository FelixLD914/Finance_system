"""TAX INV recognition, workflow and shared exchange rates

Revision ID: 20260726_0004
Revises: 20260726_0003
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260726_0004"
down_revision: str | None = "20260726_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exchange_rates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("rate_date", sa.Date(), nullable=False),
        sa.Column("buying_transfer", sa.Numeric(18, 6), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("source_file_name", sa.String(length=260), nullable=True),
        sa.Column("updated_by_name", sa.String(length=160), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_exchange_rates")),
        sa.UniqueConstraint(
            "currency",
            "rate_date",
            name="uq_core_exchange_rates_currency_date",
        ),
        schema="core",
    )
    op.create_table(
        "import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("import_mode", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("source_file_names", sa.Text(), nullable=False),
        sa.Column("invoice_count", sa.Integer(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "import_mode IN ('dual', 'sample')",
            name=op.f("ck_import_batches_import_mode_allowed"),
        ),
        sa.CheckConstraint(
            "status IN ('processing', 'review', 'completed', 'failed')",
            name=op.f("ck_import_batches_status_allowed"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_batches")),
        schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_batches_created",
        "import_batches",
        ["created_at"],
        schema="tax_invoice",
    )
    op.create_table(
        "invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("document_no", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("ci_no", sa.String(length=100), nullable=False),
        sa.Column("cdn", sa.String(length=100), nullable=True),
        sa.Column("ci_date", sa.Date(), nullable=True),
        sa.Column("invoice_date", sa.Date(), nullable=True),
        sa.Column("exchange_target_date", sa.Date(), nullable=True),
        sa.Column("exchange_rate_date", sa.Date(), nullable=True),
        sa.Column("revenue_period", sa.String(length=6), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(18, 6), nullable=True),
        sa.Column("customer_name", sa.String(length=400), nullable=False),
        sa.Column("customer_address", sa.Text(), nullable=False),
        sa.Column("tax_id", sa.String(length=40), nullable=True),
        sa.Column("po_no", sa.String(length=200), nullable=True),
        sa.Column("incoterms", sa.String(length=10), nullable=True),
        sa.Column("payment_term", sa.String(length=500), nullable=True),
        sa.Column("fob_revenue_usd_total", sa.Numeric(20, 2), nullable=False),
        sa.Column("fob_revenue_thb_total", sa.Numeric(20, 2), nullable=False),
        sa.Column("is_dap", sa.Boolean(), nullable=False),
        sa.Column("fob_verification_failed", sa.Boolean(), nullable=False),
        sa.Column("submission_date_low_confidence", sa.Boolean(), nullable=False),
        sa.Column("submission_date_confidence", sa.String(length=20), nullable=True),
        sa.Column("submission_date_source", sa.String(length=80), nullable=True),
        sa.Column("source_invoice_file_name", sa.String(length=260), nullable=True),
        sa.Column("source_customs_file_name", sa.String(length=260), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column("updated_by_name", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'needs_review', 'ready', 'approved', 'issued', 'voided')",
            name=op.f("ck_invoices_status_allowed"),
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_invoices_version_positive")),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["tax_invoice.import_batches.id"],
            name="fk_tax_invoice_invoices_batch_id_import_batches",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoices")),
        sa.UniqueConstraint(
            "document_no",
            name="uq_tax_invoice_invoices_document_no",
        ),
        schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_invoices_date_status",
        "invoices",
        ["invoice_date", "status"],
        schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_invoices_ci_no",
        "invoices",
        ["ci_no"],
        schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_invoices_cdn",
        "invoices",
        ["cdn"],
        schema="tax_invoice",
    )
    op.create_table(
        "invoice_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=False),
        sa.Column("product_name", sa.String(length=500), nullable=True),
        sa.Column("product_code", sa.String(length=200), nullable=True),
        sa.Column("hs_code", sa.String(length=100), nullable=True),
        sa.Column("unit", sa.String(length=100), nullable=True),
        sa.Column("quantity", sa.Numeric(20, 4), nullable=True),
        sa.Column("ci_unit_price", sa.Numeric(20, 4), nullable=True),
        sa.Column("fob_unit_price_usd", sa.Numeric(20, 4), nullable=True),
        sa.Column("fob_revenue_usd", sa.Numeric(20, 2), nullable=True),
        sa.Column("fob_revenue_thb", sa.Numeric(20, 2), nullable=True),
        sa.CheckConstraint(
            "line_number >= 1",
            name=op.f("ck_invoice_items_line_number_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["tax_invoice.invoices.id"],
            name="fk_tax_invoice_items_invoice_id_invoices",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoice_items")),
        sa.UniqueConstraint(
            "invoice_id",
            "line_number",
            name="uq_tax_invoice_items_invoice_line",
        ),
        schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_items_invoice",
        "invoice_items",
        ["invoice_id"],
        schema="tax_invoice",
    )
    op.create_table(
        "issue_counters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("next_sequence", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "next_sequence >= 1",
            name=op.f("ck_issue_counters_next_sequence_positive"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_issue_counters")),
        sa.UniqueConstraint(
            "invoice_date",
            name="uq_tax_invoice_issue_counter_date",
        ),
        schema="tax_invoice",
    )
    op.create_table(
        "invoice_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=False),
        sa.Column("actor_name", sa.String(length=160), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["tax_invoice.invoices.id"],
            name="fk_tax_invoice_events_invoice_id_invoices",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoice_events")),
        schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_events_invoice_created",
        "invoice_events",
        ["invoice_id", "created_at"],
        schema="tax_invoice",
    )
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("signature_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("file_format", sa.String(length=8), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=260), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("template_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "file_format IN ('xlsx', 'pdf')",
            name=op.f("ck_documents_file_format_allowed"),
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_documents_version_positive")),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["tax_invoice.invoices.id"],
            name="fk_tax_invoice_documents_invoice_id_invoices",
        ),
        sa.ForeignKeyConstraint(
            ["signature_id"],
            ["core.signature_assets.id"],
            name="fk_tax_invoice_documents_signature_id_signature_assets",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_documents")),
        sa.UniqueConstraint(
            "invoice_id",
            "file_format",
            "version",
            name="uq_tax_invoice_documents_invoice_format_version",
        ),
        schema="tax_invoice",
    )
    op.create_index(
        "ix_tax_invoice_documents_invoice_created",
        "documents",
        ["invoice_id", "created_at"],
        schema="tax_invoice",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tax_invoice_documents_invoice_created",
        table_name="documents",
        schema="tax_invoice",
    )
    op.drop_table("documents", schema="tax_invoice")
    op.drop_index(
        "ix_tax_invoice_events_invoice_created",
        table_name="invoice_events",
        schema="tax_invoice",
    )
    op.drop_table("invoice_events", schema="tax_invoice")
    op.drop_table("issue_counters", schema="tax_invoice")
    op.drop_index(
        "ix_tax_invoice_items_invoice",
        table_name="invoice_items",
        schema="tax_invoice",
    )
    op.drop_table("invoice_items", schema="tax_invoice")
    for index_name in (
        "ix_tax_invoice_invoices_cdn",
        "ix_tax_invoice_invoices_ci_no",
        "ix_tax_invoice_invoices_date_status",
    ):
        op.drop_index(index_name, table_name="invoices", schema="tax_invoice")
    op.drop_table("invoices", schema="tax_invoice")
    op.drop_index(
        "ix_tax_invoice_batches_created",
        table_name="import_batches",
        schema="tax_invoice",
    )
    op.drop_table("import_batches", schema="tax_invoice")
    op.drop_table("exchange_rates", schema="core")
