import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

IssuanceType = Literal["normal", "supplement"]
WhtStatus = Literal["draft", "pending_review", "approved", "issued", "voided"]
WhtType = Literal["PND3", "PND53"]


class ApiSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class WhtNumberPreview(ApiSchema):
    issue_type: IssuanceType
    period: str
    supplement_run: int | None = None
    sequence: int = Field(ge=1)
    task_no: str
    book_no: str
    preview_only: Literal[True] = True


class WhtTaskCreate(ApiSchema):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    issuance_type: IssuanceType = "normal"
    supplement_run: int = Field(default=0, ge=0, le=9)
    payee_id: uuid.UUID | None = None
    company_name: str | None = Field(default=None, min_length=1, max_length=300)
    company_name_en: str | None = Field(default=None, max_length=300)
    payee_address: str | None = None
    tax_id: str | None = Field(default=None, max_length=20)
    wht_type: WhtType | None = None
    income_type: str | None = Field(default=None, max_length=160)
    payment_date: date | None = None
    due_date: date | None = None
    wht_rate: Decimal | None = Field(default=None, gt=0, le=1)
    total_amount: Decimal = Field(default=Decimal("0"), ge=0)
    wht_amount: Decimal | None = Field(default=None, ge=0)
    document_count: int = Field(default=1, ge=0)

    @model_validator(mode="after")
    def validate_issue_scope_and_payee(self) -> "WhtTaskCreate":
        if self.issuance_type == "normal" and self.supplement_run != 0:
            raise ValueError("normal issuance must use supplementRun 0")
        if self.issuance_type == "supplement" and not 1 <= self.supplement_run <= 9:
            raise ValueError("supplement issuance requires supplementRun from 1 to 9")
        if self.payee_id is None and not self.company_name:
            raise ValueError("payeeId or companyName is required")
        return self


class WhtTaskUpdate(ApiSchema):
    version: int = Field(ge=1)
    payee_id: uuid.UUID | None = None
    company_name: str | None = Field(default=None, min_length=1, max_length=300)
    company_name_en: str | None = Field(default=None, max_length=300)
    payee_address: str | None = None
    tax_id: str | None = Field(default=None, max_length=20)
    wht_type: WhtType | None = None
    income_type: str | None = Field(default=None, max_length=160)
    payment_date: date | None = None
    due_date: date | None = None
    wht_rate: Decimal | None = Field(default=None, gt=0, le=1)
    total_amount: Decimal | None = Field(default=None, ge=0)
    wht_amount: Decimal | None = Field(default=None, ge=0)
    document_count: int | None = Field(default=None, ge=0)


class WhtWorkflowRequest(ApiSchema):
    version: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=1000)


class WhtTaskEventResponse(ApiSchema):
    id: int
    event_type: str
    from_status: str | None
    to_status: str
    actor_name: str
    note: str | None
    created_at: datetime


class WhtTaskResponse(ApiSchema):
    id: uuid.UUID
    task_no: str | None
    book_no: str | None
    period: str
    issuance_type: IssuanceType
    supplement_run: int
    status: WhtStatus
    payee_id: uuid.UUID | None
    company_name: str
    company_name_en: str | None
    payee_address: str | None
    tax_id: str | None
    wht_type: WhtType | None
    income_type: str | None
    payment_date: date | None
    due_date: date | None
    wht_rate: Decimal | None
    total_amount: Decimal
    wht_amount: Decimal
    document_count: int
    amount_text_thai: str | None
    date_text_thai: str | None
    source_file_name: str | None
    version: int
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime
    approved_at: datetime | None
    issued_at: datetime | None
    voided_at: datetime | None
    events: list[WhtTaskEventResponse] = Field(default_factory=list)


class WhtTaskListResponse(ApiSchema):
    items: list[WhtTaskResponse]
    total: int
    page: int
    page_size: int


class PayeeCreate(ApiSchema):
    tax_id: str = Field(min_length=1, max_length=20)
    name_th: str = Field(min_length=1, max_length=300)
    name_en: str | None = Field(default=None, max_length=300)
    address_th: str = Field(min_length=1)
    wht_type: WhtType
    aliases: list[str] = Field(default_factory=list)


class PayeeUpdate(ApiSchema):
    name_th: str | None = Field(default=None, min_length=1, max_length=300)
    name_en: str | None = Field(default=None, max_length=300)
    address_th: str | None = Field(default=None, min_length=1)
    wht_type: WhtType | None = None
    aliases: list[str] | None = None
    is_active: bool | None = None


class PayeeResponse(ApiSchema):
    id: uuid.UUID
    tax_id: str
    name_th: str
    name_en: str | None
    address_th: str
    wht_type: WhtType
    aliases: list[str]
    is_active: bool
    source_file_name: str | None
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime


class PayeeListResponse(ApiSchema):
    items: list[PayeeResponse]
    total: int


class ImportResult(ApiSchema):
    source_file_name: str
    created: int
    updated: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


class SignatureAssetUpdate(ApiSchema):
    status: Literal["active", "inactive"] | None = None
    is_default: bool | None = None


class SignatureAssetResponse(ApiSchema):
    id: uuid.UUID
    name: str
    original_file_name: str
    mime_type: str
    sha256: str
    version: int
    status: Literal["active", "inactive"]
    is_default: bool
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime


class DocumentGenerateRequest(ApiSchema):
    signature_id: uuid.UUID | None = None
    include_signature: bool = False
    formats: list[Literal["xlsx", "pdf"]] = Field(
        default_factory=lambda: ["xlsx", "pdf"],
        min_length=1,
        max_length=2,
    )

    @model_validator(mode="after")
    def normalize_formats(self) -> "DocumentGenerateRequest":
        self.formats = list(dict.fromkeys(self.formats))
        if self.include_signature and self.signature_id is None:
            raise ValueError("signatureId is required when includeSignature is true")
        return self


class WhtDocumentResponse(ApiSchema):
    id: uuid.UUID
    task_id: uuid.UUID
    signature_id: uuid.UUID | None
    file_format: Literal["xlsx", "pdf"]
    version: int
    file_name: str
    sha256: str
    template_sha256: str
    created_by_name: str
    created_at: datetime
