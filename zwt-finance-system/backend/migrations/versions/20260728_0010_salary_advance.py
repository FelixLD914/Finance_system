"""Salary advance import, validation and generated documents.

签名不建独立绑定表：签名代码直接解析共享签名库 core.signature_assets 的
名称（取最新 active 版本），维护统一走系统管理 → 签名库。

Revision ID: 20260728_0010
Revises: 20260728_0009
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260728_0010"
down_revision: str | None = "20260728_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS salary_advance")
    op.create_table(
        "templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_code", sa.String(length=50), nullable=False),
        sa.Column("version", sa.String(length=30), nullable=False),
        sa.Column("file_name", sa.String(length=260), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("pdf_underlay_storage_key", sa.String(length=500), nullable=False),
        sa.Column("pdf_underlay_sha256", sa.String(length=64), nullable=False),
        sa.Column("pdf_layout_version", sa.String(length=64), nullable=False),
        sa.Column("mapping_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "signature_anchors_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("visible_sheet", sa.String(length=80), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "template_code = 'SALARY_ADVANCE'",
            name=op.f("ck_templates_template_code_fixed"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_templates")),
        sa.UniqueConstraint(
            "template_code",
            "version",
            name="uq_salary_advance_templates_code_version",
        ),
        schema="salary_advance",
    )
    op.create_table(
        "import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_no", sa.String(length=80), nullable=False),
        sa.Column("period", sa.String(length=6), nullable=False),
        sa.Column("source_file_name", sa.String(length=260), nullable=False),
        sa.Column("source_storage_key", sa.String(length=500), nullable=False),
        sa.Column("source_sha256", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("total_rows", sa.Integer(), nullable=False),
        sa.Column("valid_rows", sa.Integer(), nullable=False),
        sa.Column("warning_rows", sa.Integer(), nullable=False),
        sa.Column("invalid_rows", sa.Integer(), nullable=False),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column("locked_by_name", sa.String(length=160), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('validating', 'validation_failed', 'ready', 'locked', "
            "'generating', 'completed', 'partially_completed', 'failed')",
            name=op.f("ck_import_batches_status_allowed"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_batches")),
        sa.UniqueConstraint(
            "batch_no",
            name="uq_salary_advance_batches_batch_no",
        ),
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_batches_created",
        "import_batches",
        ["created_at"],
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_batches_period_status",
        "import_batches",
        ["period", "status"],
        schema="salary_advance",
    )
    op.create_table(
        "records",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_row_no", sa.Integer(), nullable=False),
        sa.Column("period", sa.String(length=6), nullable=False),
        sa.Column("emp_id", sa.String(length=80), nullable=False),
        sa.Column("raw_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "normalized_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("data_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("validation_status", sa.String(length=20), nullable=False),
        sa.Column(
            "validation_errors",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "validation_warnings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("generation_status", sa.String(length=20), nullable=False),
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
        sa.CheckConstraint(
            "validation_status IN ('valid', 'warning', 'invalid')",
            name=op.f("ck_records_validation_status_allowed"),
        ),
        sa.CheckConstraint(
            "generation_status IN ('pending', 'generating', 'success', 'failed')",
            name=op.f("ck_records_generation_status_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["salary_advance.import_batches.id"],
            name="fk_salary_advance_records_batch_id_import_batches",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_records")),
        sa.UniqueConstraint(
            "batch_id",
            "source_row_no",
            name="uq_salary_advance_records_batch_row",
        ),
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_records_period_emp",
        "records",
        ["period", "emp_id"],
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_records_batch_status",
        "records",
        ["batch_id", "validation_status"],
        schema="salary_advance",
    )
    op.create_table(
        "generation_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("total_count", sa.Integer(), nullable=False),
        sa.Column("success_count", sa.Integer(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("requested_by_name", sa.String(length=160), nullable=False),
        sa.Column("git_commit_sha", sa.String(length=64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'generating', 'completed', "
            "'partially_completed', 'failed')",
            name=op.f("ck_generation_jobs_status_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["salary_advance.import_batches.id"],
            name="fk_salary_advance_jobs_batch_id_import_batches",
        ),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["salary_advance.templates.id"],
            name="fk_salary_advance_jobs_template_id_templates",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_generation_jobs")),
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_jobs_batch_started",
        "generation_jobs",
        ["batch_id", "started_at"],
        schema="salary_advance",
    )
    op.create_table(
        "generated_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("record_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("generation_version", sa.Integer(), nullable=False),
        sa.Column("xlsx_file_name", sa.String(length=260), nullable=True),
        sa.Column("xlsx_storage_key", sa.String(length=500), nullable=True),
        sa.Column("pdf_file_name", sa.String(length=260), nullable=True),
        sa.Column("pdf_storage_key", sa.String(length=500), nullable=True),
        sa.Column("xlsx_sha256", sa.String(length=64), nullable=True),
        sa.Column("pdf_sha256", sa.String(length=64), nullable=True),
        sa.Column("template_sha256", sa.String(length=64), nullable=False),
        sa.Column("pdf_underlay_sha256", sa.String(length=64), nullable=False),
        sa.Column("pdf_layout_version", sa.String(length=64), nullable=False),
        sa.Column(
            "signature_versions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("data_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by_name", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('success', 'failed')",
            name=op.f("ck_generated_documents_status_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["salary_advance.generation_jobs.id"],
            name="fk_salary_advance_documents_job_id_generation_jobs",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["record_id"],
            ["salary_advance.records.id"],
            name="fk_salary_advance_documents_record_id_records",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_generated_documents")),
        sa.UniqueConstraint(
            "record_id",
            "generation_version",
            name="uq_salary_advance_documents_record_version",
        ),
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_documents_job",
        "generated_documents",
        ["job_id", "created_at"],
        schema="salary_advance",
    )
    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("object_type", sa.String(length=50), nullable=False),
        sa.Column("object_id", sa.String(length=80), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("actor_name", sa.String(length=160), nullable=False),
        sa.Column(
            "before_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "after_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_events")),
        schema="salary_advance",
    )
    op.create_index(
        "ix_salary_advance_events_object_created",
        "events",
        ["object_type", "object_id", "created_at"],
        schema="salary_advance",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_salary_advance_events_object_created",
        table_name="events",
        schema="salary_advance",
    )
    op.drop_table("events", schema="salary_advance")
    op.drop_index(
        "ix_salary_advance_documents_job",
        table_name="generated_documents",
        schema="salary_advance",
    )
    op.drop_table("generated_documents", schema="salary_advance")
    op.drop_index(
        "ix_salary_advance_jobs_batch_started",
        table_name="generation_jobs",
        schema="salary_advance",
    )
    op.drop_table("generation_jobs", schema="salary_advance")
    for index_name in (
        "ix_salary_advance_records_batch_status",
        "ix_salary_advance_records_period_emp",
    ):
        op.drop_index(
            index_name,
            table_name="records",
            schema="salary_advance",
        )
    op.drop_table("records", schema="salary_advance")
    for index_name in (
        "ix_salary_advance_batches_period_status",
        "ix_salary_advance_batches_created",
    ):
        op.drop_index(
            index_name,
            table_name="import_batches",
            schema="salary_advance",
        )
    op.drop_table("import_batches", schema="salary_advance")
    op.drop_table("templates", schema="salary_advance")
    op.execute("DROP SCHEMA IF EXISTS salary_advance")
