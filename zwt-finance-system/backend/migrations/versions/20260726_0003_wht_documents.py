"""WHT signature library and generated documents

Revision ID: 20260726_0003
Revises: 20260726_0002
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260726_0003"
down_revision: str | None = "20260726_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "signature_assets",
        sa.Column("original_file_name", sa.String(length=260), nullable=True),
        schema="core",
    )
    op.add_column(
        "signature_assets",
        sa.Column(
            "is_default",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="core",
    )
    op.add_column(
        "signature_assets",
        sa.Column("created_by_name", sa.String(length=160), nullable=True),
        schema="core",
    )
    op.add_column(
        "signature_assets",
        sa.Column("updated_by_name", sa.String(length=160), nullable=True),
        schema="core",
    )
    op.add_column(
        "signature_assets",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema="core",
    )
    op.alter_column(
        "signature_assets",
        "created_by",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
        schema="core",
    )
    op.execute(
        """
        UPDATE core.signature_assets
        SET original_file_name = COALESCE(original_file_name, name),
            created_by_name = COALESCE(created_by_name, '历史数据'),
            updated_by_name = COALESCE(updated_by_name, '历史数据')
        """
    )
    op.alter_column(
        "signature_assets",
        "original_file_name",
        existing_type=sa.String(length=260),
        nullable=False,
        schema="core",
    )
    op.alter_column(
        "signature_assets",
        "created_by_name",
        existing_type=sa.String(length=160),
        nullable=False,
        schema="core",
    )
    op.alter_column(
        "signature_assets",
        "updated_by_name",
        existing_type=sa.String(length=160),
        nullable=False,
        schema="core",
    )

    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
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
            ["signature_id"],
            ["core.signature_assets.id"],
            name="fk_wht_documents_signature_id_signature_assets",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["wht.tasks.id"],
            name="fk_wht_documents_task_id_tasks",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_documents")),
        sa.UniqueConstraint(
            "task_id",
            "file_format",
            "version",
            name="uq_wht_documents_task_format_version",
        ),
        schema="wht",
    )
    op.create_index(
        "ix_wht_documents_task_created",
        "documents",
        ["task_id", "created_at"],
        unique=False,
        schema="wht",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_wht_documents_task_created",
        table_name="documents",
        schema="wht",
    )
    op.drop_table("documents", schema="wht")
    op.alter_column(
        "signature_assets",
        "created_by",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
        schema="core",
    )
    for column in (
        "updated_at",
        "updated_by_name",
        "created_by_name",
        "is_default",
        "original_file_name",
    ):
        op.drop_column("signature_assets", column, schema="core")
