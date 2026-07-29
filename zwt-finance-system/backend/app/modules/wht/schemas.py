import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.core.signature_usage import parse_signature_usage

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
    # 税率偏离收入类型目录的法定值时必填的理由，落进建单事件的 note 留痕。
    # 是否真的偏离由服务端按目录自己判定，不信客户端的说法。
    rate_override_note: str | None = Field(default=None, max_length=1000)

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


class IncomeTypeRate(ApiSchema):
    """某个收入类型在某张申报表下的法定默认税率。"""

    wht_type: WhtType
    rate: Decimal


class IncomeTypeOptionResponse(ApiSchema):
    code: str
    label_th: str
    label_en: str
    label_zh: str
    section: str
    rates: list[IncomeTypeRate]
    in_use: bool


class BatchCreateResult(ApiSchema):
    """批量开具导入的结果。失败时整批退回（422），所以这里只有成功路径。"""

    source_file_name: str
    created: int
    task_ids: list[uuid.UUID] = Field(default_factory=list)


class BatchTransitionRequestItem(ApiSchema):
    task_id: uuid.UUID
    version: int = Field(ge=1)


class BatchTransitionRequest(ApiSchema):
    action: Literal["submit-review", "approve", "return-to-draft"]
    items: list[BatchTransitionRequestItem] = Field(min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=1000)


class BatchTransitionItem(ApiSchema):
    task_id: uuid.UUID
    succeeded: bool
    task_no: str | None = None
    error: str | None = None


class BatchTransitionResponse(ApiSchema):
    action: str
    succeeded: int
    failed: int
    items: list[BatchTransitionItem]


# 一张签名可以同时适用于多个模块，所以对外是集合而不是单值。
# 存库仍是逗号分隔的字符串，转换在 app.core.signature_usage。
SignatureUsage = Literal["wht", "tax_inv", "salary_advance"]


class SignatureAssetUpdate(ApiSchema):
    status: Literal["active", "inactive"] | None = None
    is_default: bool | None = None
    usage: list[SignatureUsage] | None = Field(default=None, min_length=1)


class SignatureAssetResponse(ApiSchema):
    id: uuid.UUID
    name: str
    original_file_name: str
    mime_type: str
    sha256: str
    version: int
    status: Literal["active", "inactive"]
    usage: list[SignatureUsage]
    is_default: bool
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime

    @field_validator("usage", mode="before")
    @classmethod
    def split_usage(cls, value: object) -> object:
        """ORM 里 usage 是逗号分隔字符串，对外一律展开成数组。"""
        if isinstance(value, str):
            return sorted(parse_signature_usage(value))
        return value


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
