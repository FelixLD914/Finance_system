import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

TaxInvoiceStatus = Literal[
    "draft",
    "needs_review",
    "ready",
    "approved",
    "issued",
    "voided",
]


class ApiSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class TaxInvoiceItemPayload(ApiSchema):
    line_number: int = Field(ge=1)
    product_name: str | None = Field(default=None, max_length=500)
    product_code: str | None = Field(default=None, max_length=200)
    hs_code: str | None = Field(default=None, max_length=100)
    unit: str | None = Field(default=None, max_length=100)
    quantity: Decimal | None = Field(default=None, ge=0)
    ci_unit_price: Decimal | None = Field(default=None, ge=0)
    fob_unit_price_usd: Decimal | None = Field(default=None, ge=0)
    fob_revenue_usd: Decimal | None = Field(default=None, ge=0)
    fob_revenue_thb: Decimal | None = Field(default=None, ge=0)


class TaxInvoiceItemResponse(TaxInvoiceItemPayload):
    id: int
    invoice_id: uuid.UUID


class TaxInvoiceEventResponse(ApiSchema):
    id: int
    event_type: str
    from_status: str | None
    to_status: str
    actor_name: str
    note: str | None
    created_at: datetime


class TaxInvoiceResponse(ApiSchema):
    id: uuid.UUID
    batch_id: uuid.UUID | None
    correction_of_id: uuid.UUID | None
    document_no: str | None
    status: TaxInvoiceStatus
    ci_no: str
    cdn: str | None
    ci_date: date | None
    invoice_date: date | None
    exchange_target_date: date | None
    exchange_rate_date: date | None
    revenue_period: str | None
    currency: str
    exchange_rate: Decimal | None
    customer_name: str
    customer_address: str
    tax_id: str | None
    po_no: str | None
    incoterms: str | None
    payment_term: str | None
    fob_revenue_usd_total: Decimal
    fob_revenue_thb_total: Decimal
    is_dap: bool
    fob_verification_failed: bool
    submission_date_low_confidence: bool
    submission_date_confidence: str | None
    submission_date_source: str | None
    source_invoice_file_name: str | None
    source_customs_file_name: str | None
    version: int
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime
    approved_at: datetime | None
    issued_at: datetime | None
    voided_at: datetime | None
    items: list[TaxInvoiceItemResponse] = Field(default_factory=list)
    events: list[TaxInvoiceEventResponse] = Field(default_factory=list)


class TaxInvoiceListResponse(ApiSchema):
    items: list[TaxInvoiceResponse]
    total: int
    page: int
    page_size: int


class TaxInvoiceUpdate(ApiSchema):
    version: int = Field(ge=1)
    invoice_date: date | None = None
    exchange_target_date: date | None = None
    exchange_rate_date: date | None = None
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    customer_name: str | None = Field(default=None, min_length=1, max_length=400)
    customer_address: str | None = Field(default=None, min_length=1)
    tax_id: str | None = Field(default=None, max_length=40)
    po_no: str | None = Field(default=None, max_length=200)
    incoterms: str | None = Field(default=None, max_length=10)
    payment_term: str | None = Field(default=None, max_length=500)
    items: list[TaxInvoiceItemPayload] | None = Field(default=None, max_length=100)


class TaxInvoiceApproveRequest(ApiSchema):
    version: int = Field(ge=1)
    accept_warnings: bool = False
    note: str | None = Field(default=None, max_length=1000)


class TaxInvoiceVoidRequest(ApiSchema):
    version: int = Field(ge=1)
    reason: str = Field(min_length=2, max_length=1000)


class TaxInvoiceCorrectionRequest(ApiSchema):
    version: int = Field(ge=1)
    reason: str = Field(min_length=2, max_length=1000)


class TaxInvoiceImportResponse(ApiSchema):
    batch_id: uuid.UUID
    invoice_ids: list[uuid.UUID]
    invoice_count: int
    item_count: int
    needs_review_count: int


class ExchangeRateResponse(ApiSchema):
    currency: str
    rate_date: date
    buying_transfer: Decimal
    source: str
    source_file_name: str | None
    updated_by_name: str
    updated_at: datetime


class ExchangeRateImportResponse(ApiSchema):
    source_file_name: str
    currency: str
    created: int
    updated: int


class ExchangeRateFetchRequest(ApiSchema):
    currency: str = Field(default="USD", min_length=3, max_length=3)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_range(self) -> "ExchangeRateFetchRequest":
        if self.end_date < self.start_date:
            raise ValueError("endDate must not be before startDate")
        if (self.end_date - self.start_date).days > 366:
            raise ValueError("BOT fetch range must not exceed 366 days")
        self.currency = self.currency.upper()
        return self


class TaxInvoiceDocumentGenerateRequest(ApiSchema):
    signature_id: uuid.UUID | None = None
    include_signature: bool = False
    # 底版 app/assets/templates/TAX-INV-Template.pdf 已随应用发布，
    # 两种格式都能出，默认一次生成 xlsx + pdf。
    formats: list[Literal["xlsx", "pdf"]] = Field(
        default_factory=lambda: ["xlsx", "pdf"],
        min_length=1,
        max_length=2,
    )

    @model_validator(mode="after")
    def normalize_formats(self) -> "TaxInvoiceDocumentGenerateRequest":
        self.formats = list(dict.fromkeys(self.formats))
        if self.include_signature and self.signature_id is None:
            raise ValueError("signatureId is required when includeSignature is true")
        return self


class TaxInvoiceDocumentResponse(ApiSchema):
    id: uuid.UUID
    invoice_id: uuid.UUID
    signature_id: uuid.UUID | None
    file_format: Literal["xlsx", "pdf"]
    version: int
    file_name: str
    sha256: str
    template_sha256: str
    created_by_name: str
    created_at: datetime
