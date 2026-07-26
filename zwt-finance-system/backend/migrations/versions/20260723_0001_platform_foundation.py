"""platform foundation

Revision ID: 20260723_0001
Revises:
Create Date: 2026-07-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260723_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for schema in ("core", "wht", "tax_invoice", "audit"):
        op.execute(sa.schema.CreateSchema(schema, if_not_exists=True))

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("username", sa.String(length=80), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("username", name="uq_core_users_username"),
        schema="core",
    )
    op.create_table(
        "signature_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["core.users.id"],
            name="fk_signature_assets_created_by_users",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_signature_assets"),
        sa.UniqueConstraint("storage_key", name="uq_core_signature_assets_storage_key"),
        sa.UniqueConstraint(
            "name",
            "version",
            name="uq_core_signature_assets_name_version",
        ),
        schema="core",
    )
    op.create_table(
        "issue_counters",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("issue_type", sa.String(length=20), nullable=False),
        sa.Column("supplement_run", sa.Integer(), nullable=False),
        sa.Column("next_sequence", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "next_sequence >= 1",
            name=op.f("ck_issue_counters_next_sequence_positive"),
        ),
        sa.CheckConstraint(
            "supplement_run >= 0 AND supplement_run <= 9",
            name=op.f("ck_issue_counters_supplement_run_range"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_issue_counters"),
        sa.UniqueConstraint(
            "period",
            "issue_type",
            "supplement_run",
            name="uq_wht_issue_counter_scope",
        ),
        schema="wht",
    )
    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_no", sa.String(length=32), nullable=True),
        sa.Column("book_no", sa.String(length=20), nullable=True),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("issuance_type", sa.String(length=20), nullable=False),
        sa.Column("supplement_run", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("company_name", sa.String(length=300), nullable=False),
        sa.Column("tax_id", sa.String(length=20), nullable=True),
        sa.Column("wht_type", sa.String(length=12), nullable=True),
        sa.Column("income_type", sa.String(length=160), nullable=True),
        sa.Column("wht_rate", sa.Numeric(precision=7, scale=4), nullable=True),
        sa.Column("total_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("wht_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "issuance_type IN ('normal', 'supplement')",
            name=op.f("ck_tasks_issuance_type_allowed"),
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'pending_review', 'approved', 'issued', 'voided')",
            name=op.f("ck_tasks_status_allowed"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_tasks"),
        sa.UniqueConstraint("task_no", name="uq_wht_tasks_task_no"),
        schema="wht",
    )


def downgrade() -> None:
    op.drop_table("tasks", schema="wht")
    op.drop_table("issue_counters", schema="wht")
    op.drop_table("signature_assets", schema="core")
    op.drop_table("users", schema="core")
    for schema in ("audit", "tax_invoice", "wht", "core"):
        op.execute(sa.schema.DropSchema(schema))
