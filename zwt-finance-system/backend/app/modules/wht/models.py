import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class IssueCounter(Base):
    __tablename__ = "issue_counters"
    __table_args__ = (
        UniqueConstraint(
            "period",
            "issue_type",
            "supplement_run",
            name="uq_wht_issue_counter_scope",
        ),
        CheckConstraint(
            "supplement_run >= 0 AND supplement_run <= 9",
            name="supplement_run_range",
        ),
        CheckConstraint("next_sequence >= 1", name="next_sequence_positive"),
        {"schema": "wht"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    issue_type: Mapped[str] = mapped_column(String(20), nullable=False)
    supplement_run: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WhtTask(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("task_no", name="uq_wht_tasks_task_no"),
        CheckConstraint(
            "issuance_type IN ('normal', 'supplement')",
            name="issuance_type_allowed",
        ),
        CheckConstraint(
            "status IN ('draft', 'pending_review', 'approved', 'issued', 'voided')",
            name="status_allowed",
        ),
        CheckConstraint(
            "(issuance_type = 'normal' AND supplement_run = 0) OR "
            "(issuance_type = 'supplement' AND supplement_run BETWEEN 1 AND 9)",
            name="supplement_run_matches_type",
        ),
        CheckConstraint("version >= 1", name="version_positive"),
        Index("ix_wht_tasks_period_status", "period", "status"),
        {"schema": "wht"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    book_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    issuance_type: Mapped[str] = mapped_column(String(20), nullable=False)
    supplement_run: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    payee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wht.payees.id", name="fk_wht_tasks_payee_id_payees"),
        nullable=True,
    )
    company_name: Mapped[str] = mapped_column(String(300), nullable=False)
    company_name_en: Mapped[str | None] = mapped_column(String(300), nullable=True)
    payee_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    tax_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    wht_type: Mapped[str | None] = mapped_column(String(12), nullable=True)
    income_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    wht_rate: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, default=Decimal("0")
    )
    wht_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, default=Decimal("0")
    )
    amount_text_thai: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_text_thai: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False, default="系统管理员")
    updated_by_name: Mapped[str] = mapped_column(String(160), nullable=False, default="系统管理员")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PayeeProfile(Base):
    __tablename__ = "payees"
    __table_args__ = (
        UniqueConstraint("tax_id", name="uq_wht_payees_tax_id"),
        CheckConstraint("wht_type IN ('PND3', 'PND53')", name="wht_type_allowed"),
        Index("ix_wht_payees_name_th", "name_th"),
        {"schema": "wht"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tax_id: Mapped[str] = mapped_column(String(20), nullable=False)
    name_th: Mapped[str] = mapped_column(String(300), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(300), nullable=True)
    address_th: Mapped[str] = mapped_column(Text, nullable=False)
    wht_type: Mapped[str] = mapped_column(String(12), nullable=False)
    aliases: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source_file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
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


class WhtTaskEvent(Base):
    __tablename__ = "task_events"
    __table_args__ = (
        Index("ix_wht_task_events_task_created", "task_id", "created_at"),
        {"schema": "wht"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "wht.tasks.id",
            name="fk_wht_task_events_task_id_tasks",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str] = mapped_column(String(24), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(160), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WhtDocument(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "file_format",
            "version",
            name="uq_wht_documents_task_format_version",
        ),
        CheckConstraint("file_format IN ('xlsx', 'pdf')", name="file_format_allowed"),
        CheckConstraint("version >= 1", name="version_positive"),
        Index("ix_wht_documents_task_created", "task_id", "created_at"),
        {"schema": "wht"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("wht.tasks.id", name="fk_wht_documents_task_id_tasks"),
        nullable=False,
    )
    signature_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "core.signature_assets.id",
            name="fk_wht_documents_signature_id_signature_assets",
        ),
        nullable=True,
    )
    file_format: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    file_name: Mapped[str] = mapped_column(String(260), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    template_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
