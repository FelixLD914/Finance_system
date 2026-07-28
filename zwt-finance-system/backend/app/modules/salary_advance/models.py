from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SalaryAdvanceTemplate(Base):
    __tablename__ = "templates"
    __table_args__ = (
        UniqueConstraint(
            "template_code",
            "version",
            name="uq_salary_advance_templates_code_version",
        ),
        CheckConstraint("template_code = 'SALARY_ADVANCE'", name="template_code_fixed"),
        {"schema": "salary_advance"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_code: Mapped[str] = mapped_column(
        String(50), nullable=False, default="SALARY_ADVANCE"
    )
    version: Mapped[str] = mapped_column(String(30), nullable=False)
    file_name: Mapped[str] = mapped_column(String(260), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pdf_underlay_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    pdf_underlay_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pdf_layout_version: Mapped[str] = mapped_column(String(64), nullable=False)
    mapping_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    signature_anchors_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    visible_sheet: Mapped[str] = mapped_column(String(80), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SalaryAdvanceSignatureBinding(Base):
    __tablename__ = "signature_bindings"
    __table_args__ = (
        UniqueConstraint(
            "signature_code",
            "version",
            name="uq_salary_advance_signature_bindings_code_version",
        ),
        CheckConstraint("role IN ('finance', 'md')", name="role_allowed"),
        CheckConstraint(
            "scope_type IN ('company', 'period', 'employee', 'custom')",
            name="scope_type_allowed",
        ),
        Index("ix_salary_advance_signature_bindings_active", "signature_code", "active"),
        {"schema": "salary_advance"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    signature_code: Mapped[str] = mapped_column(String(80), nullable=False)
    signature_asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "core.signature_assets.id",
            name="fk_salary_advance_signature_bindings_asset_id_signature_assets",
        ),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False, default="company")
    scope_value: Mapped[str | None] = mapped_column(String(160), nullable=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SalaryAdvanceImportBatch(Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        UniqueConstraint("batch_no", name="uq_salary_advance_batches_batch_no"),
        CheckConstraint(
            "status IN ('validating', 'validation_failed', 'ready', 'locked', "
            "'generating', 'completed', 'partially_completed', 'failed')",
            name="status_allowed",
        ),
        Index("ix_salary_advance_batches_created", "created_at"),
        Index("ix_salary_advance_batches_period_status", "period", "status"),
        {"schema": "salary_advance"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_no: Mapped[str] = mapped_column(String(80), nullable=False)
    period: Mapped[str] = mapped_column(String(6), nullable=False)
    source_file_name: Mapped[str] = mapped_column(String(260), nullable=False)
    source_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="validating")
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warning_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    invalid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    locked_by_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SalaryAdvanceRecord(Base):
    __tablename__ = "records"
    __table_args__ = (
        UniqueConstraint(
            "batch_id",
            "source_row_no",
            name="uq_salary_advance_records_batch_row",
        ),
        CheckConstraint(
            "validation_status IN ('valid', 'warning', 'invalid')",
            name="validation_status_allowed",
        ),
        CheckConstraint(
            "generation_status IN ('pending', 'generating', 'success', 'failed')",
            name="generation_status_allowed",
        ),
        Index("ix_salary_advance_records_period_emp", "period", "emp_id"),
        Index("ix_salary_advance_records_batch_status", "batch_id", "validation_status"),
        {"schema": "salary_advance"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "salary_advance.import_batches.id",
            name="fk_salary_advance_records_batch_id_import_batches",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    source_row_no: Mapped[int] = mapped_column(Integer, nullable=False)
    period: Mapped[str] = mapped_column(String(6), nullable=False)
    emp_id: Mapped[str] = mapped_column(String(80), nullable=False)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    normalized_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    data_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    validation_status: Mapped[str] = mapped_column(String(20), nullable=False)
    validation_errors: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    validation_warnings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    generation_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    updated_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SalaryAdvanceGenerationJob(Base):
    __tablename__ = "generation_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'generating', 'completed', 'partially_completed', 'failed')",
            name="status_allowed",
        ),
        Index("ix_salary_advance_jobs_batch_started", "batch_id", "started_at"),
        {"schema": "salary_advance"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "salary_advance.import_batches.id",
            name="fk_salary_advance_jobs_batch_id_import_batches",
        ),
        nullable=False,
    )
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "salary_advance.templates.id",
            name="fk_salary_advance_jobs_template_id_templates",
        ),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="queued")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    success_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    requested_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    git_commit_sha: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)


class SalaryAdvanceGeneratedDocument(Base):
    __tablename__ = "generated_documents"
    __table_args__ = (
        UniqueConstraint(
            "record_id",
            "generation_version",
            name="uq_salary_advance_documents_record_version",
        ),
        CheckConstraint("status IN ('success', 'failed')", name="status_allowed"),
        Index("ix_salary_advance_documents_job", "job_id", "created_at"),
        {"schema": "salary_advance"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "salary_advance.generation_jobs.id",
            name="fk_salary_advance_documents_job_id_generation_jobs",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "salary_advance.records.id",
            name="fk_salary_advance_documents_record_id_records",
        ),
        nullable=False,
    )
    generation_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    xlsx_file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
    xlsx_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pdf_file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
    pdf_storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    xlsx_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pdf_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    template_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pdf_underlay_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pdf_layout_version: Mapped[str] = mapped_column(String(64), nullable=False)
    signature_versions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    data_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SalaryAdvanceEvent(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_salary_advance_events_object_created", "object_type", "object_id", "created_at"),
        {"schema": "salary_advance"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    object_type: Mapped[str] = mapped_column(String(50), nullable=False)
    object_id: Mapped[str] = mapped_column(String(80), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(160), nullable=False)
    before_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

