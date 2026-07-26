"""WHT workflow and legacy data persistence

Revision ID: 20260726_0002
Revises: 20260723_0001
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260726_0002"
down_revision: str | None = "20260723_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payees",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tax_id", sa.String(length=20), nullable=False),
        sa.Column("name_th", sa.String(length=300), nullable=False),
        sa.Column("name_en", sa.String(length=300), nullable=True),
        sa.Column("address_th", sa.Text(), nullable=False),
        sa.Column("wht_type", sa.String(length=12), nullable=False),
        sa.Column(
            "aliases",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("source_file_name", sa.String(length=260), nullable=True),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column("updated_by_name", sa.String(length=160), nullable=False),
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
            "wht_type IN ('PND3', 'PND53')",
            name=op.f("ck_payees_wht_type_allowed"),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_payees"),
        sa.UniqueConstraint("tax_id", name="uq_wht_payees_tax_id"),
        schema="wht",
    )
    op.create_index(
        "ix_wht_payees_name_th",
        "payees",
        ["name_th"],
        unique=False,
        schema="wht",
    )

    op.add_column(
        "tasks",
        sa.Column("payee_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("company_name_en", sa.String(length=300), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("payee_address", sa.Text(), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("payment_date", sa.Date(), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("due_date", sa.Date(), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column(
            "document_count",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("amount_text_thai", sa.Text(), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("date_text_thai", sa.Text(), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("source_file_name", sa.String(length=260), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column(
            "version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column(
            "created_by_name",
            sa.String(length=160),
            server_default=sa.text("'系统管理员'"),
            nullable=False,
        ),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column(
            "updated_by_name",
            sa.String(length=160),
            server_default=sa.text("'系统管理员'"),
            nullable=False,
        ),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        schema="wht",
    )
    op.add_column(
        "tasks",
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        schema="wht",
    )
    op.create_foreign_key(
        "fk_wht_tasks_payee_id_payees",
        "tasks",
        "payees",
        ["payee_id"],
        ["id"],
        source_schema="wht",
        referent_schema="wht",
    )
    op.create_check_constraint(
        op.f("ck_tasks_supplement_run_matches_type"),
        "tasks",
        "(issuance_type = 'normal' AND supplement_run = 0) OR "
        "(issuance_type = 'supplement' AND supplement_run BETWEEN 1 AND 9)",
        schema="wht",
    )
    op.create_check_constraint(
        op.f("ck_tasks_document_count_non_negative"),
        "tasks",
        "document_count >= 0",
        schema="wht",
    )
    op.create_check_constraint(
        op.f("ck_tasks_version_positive"),
        "tasks",
        "version >= 1",
        schema="wht",
    )
    op.create_index(
        "ix_wht_tasks_period_status",
        "tasks",
        ["period", "status"],
        unique=False,
        schema="wht",
    )

    op.create_table(
        "task_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=False),
        sa.Column("actor_name", sa.String(length=160), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["wht.tasks.id"],
            name="fk_wht_task_events_task_id_tasks",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_task_events"),
        schema="wht",
    )
    op.create_index(
        "ix_wht_task_events_task_created",
        "task_events",
        ["task_id", "created_at"],
        unique=False,
        schema="wht",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_wht_task_events_task_created",
        table_name="task_events",
        schema="wht",
    )
    op.drop_table("task_events", schema="wht")

    op.drop_index("ix_wht_tasks_period_status", table_name="tasks", schema="wht")
    op.drop_constraint(
        op.f("ck_tasks_version_positive"),
        "tasks",
        schema="wht",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_tasks_document_count_non_negative"),
        "tasks",
        schema="wht",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_tasks_supplement_run_matches_type"),
        "tasks",
        schema="wht",
        type_="check",
    )
    op.drop_constraint(
        "fk_wht_tasks_payee_id_payees",
        "tasks",
        schema="wht",
        type_="foreignkey",
    )
    for column in (
        "voided_at",
        "issued_at",
        "approved_at",
        "updated_by_name",
        "created_by_name",
        "version",
        "source_file_name",
        "date_text_thai",
        "amount_text_thai",
        "document_count",
        "due_date",
        "payment_date",
        "payee_address",
        "company_name_en",
        "payee_id",
    ):
        op.drop_column("tasks", column, schema="wht")

    op.drop_index("ix_wht_payees_name_th", table_name="payees", schema="wht")
    op.drop_table("payees", schema="wht")
