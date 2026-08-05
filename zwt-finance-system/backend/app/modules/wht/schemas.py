import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.core.signature_usage import parse_signature_usage
from app.modules.wht.branching import BranchType, normalize_branch

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
    branch_type: BranchType | None = None
    branch_number: str | None = Field(default=None, max_length=5)
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
    # 与建单同一条口径：改完之后税率偏离目录法定值就必须给理由。
    # 是否真的偏离由服务端按改后的值自己判定，不信客户端的说法。
    rate_override_note: str | None = Field(default=None, max_length=1000)
    payee_id: uuid.UUID | None = None
    company_name: str | None = Field(default=None, min_length=1, max_length=300)
    company_name_en: str | None = Field(default=None, max_length=300)
    payee_address: str | None = None
    tax_id: str | None = Field(default=None, max_length=20)
    wht_type: WhtType | None = None
    branch_type: BranchType | None = None
    branch_number: str | None = Field(default=None, max_length=5)
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
    branch_type: BranchType
    branch_number: str | None
    income_type: str | None
    payment_date: date | None
    due_date: date | None
    wht_rate: Decimal | None
    total_amount: Decimal
    wht_amount: Decimal
    amount_text_thai: str | None
    date_text_thai: str | None
    source_file_name: str | None
    # true = 这条单的收款方还没进主数据，批准时才写库（见 migration 0017）。
    payee_pending: bool = False
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
    branch_type: BranchType | None = None
    branch_number: str | None = Field(default=None, max_length=5)
    aliases: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_branch(self) -> "PayeeCreate":
        self.branch_type, self.branch_number = normalize_branch(
            self.wht_type, self.branch_type, self.branch_number
        )
        return self


class PayeeUpdate(ApiSchema):
    name_th: str | None = Field(default=None, min_length=1, max_length=300)
    name_en: str | None = Field(default=None, max_length=300)
    address_th: str | None = Field(default=None, min_length=1)
    wht_type: WhtType | None = None
    branch_type: BranchType | None = None
    branch_number: str | None = Field(default=None, max_length=5)
    aliases: list[str] | None = None
    is_active: bool | None = None


class PayeeResponse(ApiSchema):
    id: uuid.UUID
    tax_id: str
    name_th: str
    name_en: str | None
    address_th: str
    wht_type: WhtType
    branch_type: BranchType
    branch_number: str | None
    aliases: list[str]
    is_active: bool
    source_file_name: str | None
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime
    # 非空即代表这条在回收站里。前端据此决定行内出「删除」还是「恢复」。
    deleted_at: datetime | None = None
    deleted_by_name: str | None = None


class PayeeListResponse(ApiSchema):
    items: list[PayeeResponse]
    total: int


class PayeeDeletePreview(ApiSchema):
    """删除前的影响面预览。referencing_tasks 只用于确认框提示，不拦截删除——
    历史单据已反规范化存了收款方信息，外键也继续指向回收站里那行。"""

    payee_id: uuid.UUID
    tax_id: str
    name_th: str
    referencing_tasks: int


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
    # 其中有多少条带着「批准时才写进主数据」的新收款方。前端据此提示
    # "本批含 N 个新收款方，批准后自动建档"，避免有人以为已经建好了。
    payees_pending: int = 0


RowStatus = Literal["ready", "payee_missing", "needs_input"]


class BatchPreviewPayee(ApiSchema):
    """核对表里那一列收款方。payeeId 为空即「主数据里没有，等人手工补录」。"""

    payee_id: uuid.UUID | None = None
    tax_id: str
    name_th: str | None = None
    name_en: str | None = None
    address_th: str | None = None
    wht_type: WhtType | None = None
    branch_type: BranchType = "none"
    branch_number: str | None = None
    is_active: bool = True


class BatchPreviewRow(ApiSchema):
    row_number: int
    status: RowStatus
    period: str
    issuance_type: IssuanceType
    supplement_run: int
    income_type: str
    payment_date: date
    total_amount: Decimal
    payee: BatchPreviewPayee
    wht_rate: Decimal | None = None
    # 目录里该收入类型 + 该 PND 表的法定税率。前端拿它标"已偏离"，
    # 收款方还没补录时为空（不知道走哪张表，算不出来）。
    statutory_rate: Decimal | None = None
    wht_amount: Decimal | None = None
    rate_reason: str | None = None
    errors: list[str] = Field(default_factory=list)


class BatchPreviewResponse(ApiSchema):
    """批量开具的核对结果。**完全只读**：调这个端点不会在库里留下任何东西。"""

    source_file_name: str
    rows: list[BatchPreviewRow]
    ready: int
    payee_missing: int
    needs_input: int


class BatchCommitPayee(ApiSchema):
    """落库时每一行带的收款方。

    payee_id 有值时以库里那条为准，下面的名称地址一律忽略——主数据是权威，
    前端表格里的显示值不该有机会覆盖它。payee_id 为空则是人工补录的新档案，
    这几项就成了必填，票据批准时用它们建 PayeeProfile。
    """

    payee_id: uuid.UUID | None = None
    tax_id: str = Field(min_length=1, max_length=20)
    name_th: str | None = Field(default=None, max_length=300)
    name_en: str | None = Field(default=None, max_length=300)
    address_th: str | None = None
    wht_type: WhtType | None = None
    branch_type: BranchType | None = None
    branch_number: str | None = Field(default=None, max_length=5)

    @model_validator(mode="after")
    def require_profile_for_new_payee(self) -> "BatchCommitPayee":
        if self.payee_id is not None:
            return self
        missing = [
            name
            for name, value in (
                ("nameTh", self.name_th),
                ("addressTh", self.address_th),
                ("whtType", self.wht_type),
            )
            if not value
        ]
        if missing:
            raise ValueError(
                f"a new payee needs {', '.join(missing)}; these are printed on the "
                f"certificate and cannot be derived"
            )
        self.branch_type, self.branch_number = normalize_branch(
            self.wht_type, self.branch_type, self.branch_number
        )
        return self


class BatchCommitRow(ApiSchema):
    row_number: int = Field(ge=1)
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    issuance_type: IssuanceType = "normal"
    supplement_run: int = Field(default=0, ge=0, le=9)
    income_type: str = Field(min_length=1, max_length=160)
    payment_date: date
    total_amount: Decimal = Field(gt=0)
    wht_rate: Decimal | None = Field(default=None, gt=0, le=1)
    rate_reason: str | None = Field(default=None, max_length=1000)
    payee: BatchCommitPayee

    @model_validator(mode="after")
    def validate_issue_scope(self) -> "BatchCommitRow":
        if self.issuance_type == "normal" and self.supplement_run != 0:
            raise ValueError("normal issuance must use supplementRun 0")
        if self.issuance_type == "supplement" and not 1 <= self.supplement_run <= 9:
            raise ValueError("supplement issuance requires supplementRun from 1 to 9")
        return self


class BatchCommitRequest(ApiSchema):
    """核对完成后的落库请求。上限与解析阶段的 MAX_ROWS 对齐。"""

    source_file_name: str = Field(min_length=1, max_length=260)
    rows: list[BatchCommitRow] = Field(min_length=1, max_length=500)


class WhtReviseRequest(ApiSchema):
    """把已批准/已开具的票据退回草稿以便更正。票号保持不变（业务口径 2026-08-01）。

    理由必填：这是唯一能解释「一张正式凭证为什么被改过」的地方，事后审计只看它。
    """

    version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)


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
    # 适用单据含工资预支时必填（服务端按改完之后的状态判，见
    # WhtDocumentService._clean_signer_name）。这里不设 min_length：
    # 只改缩放比例的请求不该被姓名规则连坐。
    signer_name: str | None = Field(default=None, max_length=160)
    scale_percent: int | None = Field(default=None, ge=50, le=200)


class SignatureAssetResponse(ApiSchema):
    id: uuid.UUID
    name: str
    original_file_name: str
    mime_type: str
    sha256: str
    version: int
    status: Literal["active", "inactive"]
    usage: list[SignatureUsage]
    # 只有工资预支单会印它；WHT / TAX INV 的签名这一项为空是正常的。
    signer_name: str | None = None
    is_default: bool
    scale_percent: int = 100
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    deleted_by_name: str | None = None

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
