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
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TaxInvoiceImportBatch(Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        CheckConstraint(
            "import_mode IN ('dual', 'sample', 'migration')",
            name="import_mode_allowed",
        ),
        CheckConstraint(
            "status IN ('processing', 'review', 'completed', 'failed')",
            name="status_allowed",
        ),
        Index("ix_tax_invoice_batches_created", "created_at"),
        {"schema": "tax_invoice"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    import_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="processing")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    source_file_names: Mapped[str] = mapped_column(Text, nullable=False)
    invoice_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaxInvoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("document_no", name="uq_tax_invoice_invoices_document_no"),
        CheckConstraint(
            "status IN ('draft', 'needs_review', 'ready', 'approved', 'issued', 'voided')",
            name="status_allowed",
        ),
        CheckConstraint("version >= 1", name="version_positive"),
        Index("ix_tax_invoice_invoices_date_status", "invoice_date", "status"),
        Index("ix_tax_invoice_invoices_ci_no", "ci_no"),
        Index("ix_tax_invoice_invoices_cdn", "cdn"),
        Index("ix_tax_invoice_invoices_correction_of", "correction_of_id"),
        {"schema": "tax_invoice"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "tax_invoice.import_batches.id",
            name="fk_tax_invoice_invoices_batch_id_import_batches",
        ),
        nullable=True,
    )
    correction_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "tax_invoice.invoices.id",
            name="fk_tax_invoice_invoices_correction_of_id_invoices",
        ),
        nullable=True,
    )
    document_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    ci_no: Mapped[str] = mapped_column(String(100), nullable=False)
    cdn: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ci_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exchange_target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exchange_rate_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    revenue_period: Mapped[str | None] = mapped_column(String(6), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    exchange_rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    customer_name: Mapped[str] = mapped_column(String(400), nullable=False)
    customer_address: Mapped[str] = mapped_column(Text, nullable=False)
    tax_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    po_no: Mapped[str | None] = mapped_column(String(200), nullable=True)
    incoterms: Mapped[str | None] = mapped_column(String(10), nullable=True)
    payment_term: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fob_revenue_usd_total: Mapped[Decimal] = mapped_column(
        Numeric(20, 2),
        nullable=False,
        default=Decimal("0"),
    )
    fob_revenue_thb_total: Mapped[Decimal] = mapped_column(
        Numeric(20, 2),
        nullable=False,
        default=Decimal("0"),
    )
    is_dap: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fob_verification_failed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    submission_date_low_confidence: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    submission_date_confidence: Mapped[str | None] = mapped_column(
        # 24 而不是 20：可信度改用 BOI 那套分级后最长的是 needs_review_repaired（21）。
        String(24),
        nullable=True,
    )
    submission_date_source: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # ── 报关单侧留痕（业务 2026-07-30 新增，全部要出现在导出核对表里）──────────
    # 这些值一律**不参与计价**：计价汇率仍取 BOT 表。它们的用途是让人能核对
    # "海关按什么折的、谁报的关、报关单自己印的金额是多少"，事后对账不用再翻 PDF。
    declaration_ref_no: Mapped[str | None] = mapped_column(String(60), nullable=True)
    customs_exchange_rate: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 6),
        nullable=True,
    )
    # 业务口径：报关单印英文就写英文，只印泰文就写泰文。这一列是落库/导出用的
    # 那一个值；下面 th/en 两列留原文，人核对时要知道名字是从哪一栏抄来的。
    forwarder_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    forwarder_name_th: Mapped[str | None] = mapped_column(String(300), nullable=True)
    forwarder_name_en: Mapped[str | None] = mapped_column(String(300), nullable=True)
    forwarder_tax_no: Mapped[str | None] = mapped_column(String(20), nullable=True)
    customs_fob_usd_total: Mapped[Decimal | None] = mapped_column(
        Numeric(20, 2),
        nullable=True,
    )
    # 行级加总与报关单自印合计分开存。存成一个"已核对过的数"就把这道核对做没了——
    # 两个都留着，导出表里并排显示，对不上一眼就能看见。
    customs_fob_thb_line_total: Mapped[Decimal | None] = mapped_column(
        Numeric(20, 2),
        nullable=True,
    )
    customs_fob_thb_printed_total: Mapped[Decimal | None] = mapped_column(
        Numeric(20, 2),
        nullable=True,
    )
    source_invoice_file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
    source_customs_file_name: Mapped[str | None] = mapped_column(String(260), nullable=True)
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
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TaxInvoiceItem(Base):
    __tablename__ = "invoice_items"
    __table_args__ = (
        UniqueConstraint(
            "invoice_id",
            "line_number",
            name="uq_tax_invoice_items_invoice_line",
        ),
        CheckConstraint("line_number >= 1", name="line_number_positive"),
        Index("ix_tax_invoice_items_invoice", "invoice_id"),
        {"schema": "tax_invoice"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "tax_invoice.invoices.id",
            name="fk_tax_invoice_items_invoice_id_invoices",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    product_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    product_code: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hs_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    ci_unit_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    fob_unit_price_usd: Mapped[Decimal | None] = mapped_column(Numeric(20, 4), nullable=True)
    fob_revenue_usd: Mapped[Decimal | None] = mapped_column(Numeric(20, 2), nullable=True)
    fob_revenue_thb: Mapped[Decimal | None] = mapped_column(Numeric(20, 2), nullable=True)


class TaxInvoiceIssueCounter(Base):
    __tablename__ = "issue_counters"
    __table_args__ = (
        UniqueConstraint("invoice_date", name="uq_tax_invoice_issue_counter_date"),
        CheckConstraint("next_sequence >= 1", name="next_sequence_positive"),
        {"schema": "tax_invoice"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    next_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaxInvoiceEvent(Base):
    __tablename__ = "invoice_events"
    __table_args__ = (
        Index("ix_tax_invoice_events_invoice_created", "invoice_id", "created_at"),
        {"schema": "tax_invoice"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "tax_invoice.invoices.id",
            name="fk_tax_invoice_events_invoice_id_invoices",
            ondelete="CASCADE",
        ),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str] = mapped_column(String(24), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(160), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TaxInvoiceDocument(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint(
            "invoice_id",
            "file_format",
            "version",
            name="uq_tax_invoice_documents_invoice_format_version",
        ),
        CheckConstraint("file_format IN ('xlsx', 'pdf')", name="file_format_allowed"),
        CheckConstraint("version >= 1", name="version_positive"),
        Index("ix_tax_invoice_documents_invoice_created", "invoice_id", "created_at"),
        {"schema": "tax_invoice"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "tax_invoice.invoices.id",
            name="fk_tax_invoice_documents_invoice_id_invoices",
        ),
        nullable=False,
    )
    signature_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "core.signature_assets.id",
            name="fk_tax_invoice_documents_signature_id_signature_assets",
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
