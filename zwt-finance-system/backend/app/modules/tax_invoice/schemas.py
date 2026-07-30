import re
import uuid
from calendar import monthrange
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
    "rejected",
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
    rejected_at: datetime | None = None
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


class TaxInvoiceMatchRateRequest(ApiSchema):
    version: int = Field(ge=1)


class TaxInvoiceRejectRequest(ApiSchema):
    version: int = Field(ge=1)
    # 拒批像删草稿，理由可选（想留痕就填，进事件时间线）。
    reason: str | None = Field(default=None, max_length=1000)


class TaxInvoiceRestoreRequest(ApiSchema):
    version: int = Field(ge=1)


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


# ── 双文件识别：先"认身份并配对"，再逐组导入 ──────────────────────────────────
# 配对必须看内容（C/I No.），而文件内容只有后端解析得动，所以配对结果由后端算好
# 返回给界面预览。导入仍走 /import/dual 一组一次——每组各自一个事务这条不变。


class DualIdentifiedInvoice(ApiSchema):
    """Export Invoice Excel 认出来的身份与摘要，供界面在配对行上显示。"""

    file_name: str
    ci_no: str
    ci_date: date | None
    incoterms: str | None
    customer_name: str | None
    item_count: int
    fob_amount_usd: Decimal | None
    quantity_total: Decimal | None


class DualIdentifiedCustoms(ApiSchema):
    """出口报关单认出来的身份 + 核对字段（海关汇率 / 货代 / 出口泰铢金额）。"""

    file_name: str
    ci_no: str
    cdn: str | None
    declaration_ref_no: str | None
    submission_date: date | None
    submission_date_confidence: str | None
    submission_date_low_confidence: bool
    customs_exchange_rate: Decimal | None
    #: 报关单印英文就是英文，只印泰文就是泰文（业务口径 2026-07-30）。
    forwarder_name: str | None
    forwarder_name_th: str | None
    forwarder_name_en: str | None
    forwarder_tax_no: str | None
    customs_fob_usd_total: Decimal | None
    customs_fob_thb_line_total: Decimal | None
    customs_fob_thb_printed_total: Decimal | None
    warnings: list[str] = []


class DualPairPreview(ApiSchema):
    key: str
    #: conflict = 撮合阶段就发现要人工处理（同一 C/I No. 配到多份不同的报关单）。
    status: Literal["ready", "invoice_only", "customs_only", "conflict"]
    invoice: DualIdentifiedInvoice | None = None
    customs: DualIdentifiedCustoms | None = None
    #: 同一 C/I No. 命中多份报关单时未被选用的那几份的文件名。
    superseded_customs_file_names: list[str] = []
    conflicts: list[str] = []


class DualRejectedFile(ApiSchema):
    """读不了、或者读得了但没有 C/I No. 的文件。必须回报，不能静默丢掉。"""

    file_name: str
    kind: Literal["invoice", "customs", "unsupported"]
    reason: str


class DualIdentifyResponse(ApiSchema):
    pairs: list[DualPairPreview]
    rejected: list[DualRejectedFile]
    ready_count: int
    invoice_only_count: int
    customs_only_count: int
    conflict_count: int


# ── 双文件批量导入：一次上传的全部可导入配对 → 一个复核批次 ────────────────────
# 与 /import/dual/identify 的关系：identify 只预览不入库；/import/dual/batch 是真正
# 落库那一步——整批一个事务、进 review 态、不自动出编号（编号仍只在 approve 事务里发）。


class DualBatchPairResult(ApiSchema):
    """成功落库的一组：这一对文件建成的税票。"""

    key: str
    invoice_file_name: str
    customs_file_name: str | None
    invoice_id: uuid.UUID
    item_count: int
    needs_review: bool


class DualSkippedPair(ApiSchema):
    """识别出来但没导入的一组：孤立关单（缺发票）或冲突（多份不同关单）。"""

    key: str
    status: Literal["customs_only", "conflict"]
    reason: str


class DualBatchImportResponse(ApiSchema):
    # 全批没有一组可导入（只有孤立关单/冲突/读不了的文件）时 batch_id 为空。
    batch_id: uuid.UUID | None = None
    invoice_count: int
    item_count: int
    needs_review_count: int
    results: list[DualBatchPairResult]
    rejected: list[DualRejectedFile]
    skipped: list[DualSkippedPair]


# ── 复核台：批次总览 + 单条 / 整批批准 ────────────────────────────────────────


class ImportBatchResponse(ApiSchema):
    id: uuid.UUID
    import_mode: str
    status: str
    currency: str
    source_file_names: str
    created_by_name: str
    created_at: datetime
    # 当前各状态实时计数（随逐条批准变动），不是导入时定死的 invoice_count。
    total: int
    pending: int
    needs_review: int
    approved: int


class BatchApproveRequest(ApiSchema):
    # 为空＝批准这批里所有未批准的；给子集就只批那几张（总览里单条/多选批准）。
    invoice_ids: list[uuid.UUID] | None = None
    accept_warnings: bool = False


class BatchApproveSkipped(ApiSchema):
    invoice_id: uuid.UUID
    reason: str


class BatchApproveResponse(ApiSchema):
    approved_count: int
    approved_ids: list[uuid.UUID]
    skipped: list[BatchApproveSkipped]


class BatchRejectRequest(ApiSchema):
    # 为空＝拒批这批所有未批准的；给子集就只拒那几张。理由可选。
    invoice_ids: list[uuid.UUID] | None = None
    reason: str | None = Field(default=None, max_length=1000)


class BatchRejectResponse(ApiSchema):
    rejected_count: int
    rejected_ids: list[uuid.UUID]


MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def month_bounds(month: str) -> tuple[date, date]:
    """把 YYYY-MM 展开成 [当月 1 号, 当月最后一天]。

    用 calendar.monthrange 而不是「下月 1 号减一天」的手写算术：后者在 12 月
    要额外处理跨年，是这类工具函数最常见的错法。
    """
    if not re.fullmatch(MONTH_PATTERN, month):
        raise ValueError("month must look like YYYY-MM")
    year, month_number = (int(part) for part in month.split("-"))
    return (
        date(year, month_number, 1),
        date(year, month_number, monthrange(year, month_number)[1]),
    )


class ExchangeRateResponse(ApiSchema):
    # id 是行内编辑/停用/删除的定位依据。此前这个响应不带 id，因为汇率只读。
    id: int
    currency: str
    rate_date: date
    # 出口税票取 buying_transfer；其余三种留档备查，Excel 导入的行会是 null。
    buying_transfer: Decimal
    buying_sight: Decimal | None = None
    selling: Decimal | None = None
    mid_rate: Decimal | None = None
    source: str
    source_file_name: str | None
    is_active: bool
    updated_by_name: str
    updated_at: datetime
    deleted_at: datetime | None = None
    deleted_by_name: str | None = None


class ExchangeRateMonth(ApiSchema):
    """月份列表的一行。点进去才拉当月的每日明细。"""

    currency: str
    month: str
    day_count: int
    # 当月有多少天被停用。列表上直接标出来，免得点进去才发现这个月是残缺的。
    inactive_count: int
    min_rate: Decimal
    max_rate: Decimal
    latest_date: date
    updated_at: datetime


class ExchangeRateUpsert(ApiSchema):
    """手工录入某一天的汇率。同币种同日期已有在用记录时覆盖它。"""

    currency: str = Field(min_length=3, max_length=3)
    rate_date: date
    buying_transfer: Decimal = Field(gt=0, max_digits=18, decimal_places=6)
    buying_sight: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    selling: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    mid_rate: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    is_active: bool = True

    @model_validator(mode="after")
    def normalize(self) -> "ExchangeRateUpsert":
        self.currency = self.currency.upper()
        return self


class ExchangeRateUpdate(ApiSchema):
    """行内编辑。币种和日期不可改——它们是这条记录的业务身份，
    要改就是另一条记录，走 upsert 新建再把这条删掉。"""

    buying_transfer: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    buying_sight: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    selling: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    mid_rate: Decimal | None = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    is_active: bool | None = None


class ExchangeRateImportResponse(ApiSchema):
    source_file_name: str
    currency: str
    created: int
    updated: int


class BotApiStatus(ApiSchema):
    """BOT 汇率接口的配置自检结果。

    key_hint 只回首尾各 4 位，用来确认"服务器读到的是不是我填的那把"，
    完整密钥永远不出服务器——前端拿到也没用，只会多一处泄露面。
    """

    configured: bool
    base_url: str
    endpoint: str
    auth_header: str
    key_hint: str | None = None
    env_var: str


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
