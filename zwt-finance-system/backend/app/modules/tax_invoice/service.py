from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.models import ExchangeRate
from app.modules.tax_invoice.models import (
    TaxInvoice,
    TaxInvoiceEvent,
    TaxInvoiceImportBatch,
    TaxInvoiceItem,
)
from app.modules.tax_invoice.number_service import assign_tax_invoice_number
from app.modules.tax_invoice.recognition import (
    combine_invoice_and_customs,
    lookup_fx_rate,
    recompute_line_thb,
)
from app.modules.tax_invoice.schemas import (
    BotApiStatus,
    ExchangeRateFetchRequest,
    ExchangeRateImportResponse,
    ExchangeRateMonth,
    ExchangeRateUpdate,
    ExchangeRateUpsert,
    TaxInvoiceImportResponse,
    TaxInvoiceUpdate,
    month_bounds,
)
from app.modules.wht.service import WhtServiceError


class TaxInvoiceServiceError(WhtServiceError):
    pass


class TaxInvoiceNotFoundError(TaxInvoiceServiceError):
    status_code = 404


class TaxInvoiceConflictError(TaxInvoiceServiceError):
    status_code = 409


class TaxInvoiceStateError(TaxInvoiceServiceError):
    status_code = 422


# 一次导出最多带走这么多张税票。纯粹是内存护栏：整份台账都摊平成商品行
# 塞进一个 openpyxl 工作簿，没有上限的话总有一天会把进程撑爆。
MAX_EXPORT_INVOICES = 2000

# BOT 汇率最多往报关提交日之前回溯这么多天。查询窗口与 lookup_fx_rate 的
# 回溯步数必须同源——分开写两个 9，改一处漏一处就会一边查得到、一边取不到。
RATE_LOOKBACK_DAYS = 9

# 正式模板的物理容量。超过就必须拒绝批准，不得截断。
APPROVAL_ITEM_LIMIT = 18


@dataclass(frozen=True)
class ApprovalReadiness:
    """一张税票离「够格成为已批准」还差什么。"""

    missing_fields: list[str]
    too_many_items: bool

    @property
    def ok(self) -> bool:
        return not self.missing_fields and not self.too_many_items

    def blockers(self) -> list[str]:
        """给前端的稳定字段码，itemLimit 表示超出模板容量。"""
        codes = list(self.missing_fields)
        if self.too_many_items:
            codes.append("itemLimit")
        return codes


def check_approval_readiness(
    *,
    invoice_date: date | None,
    exchange_target_date: date | None,
    exchange_rate: Decimal | None,
    customer_name: str | None,
    customer_address: str | None,
    cdn: str | None,
    item_count: int,
) -> ApprovalReadiness:
    """「可批准」的完整性口径，只有这一份。

    历史迁移那条能绕过复核直接落成 approved 的通道摘掉之后，approve() 是通往
    approved 的唯一入口，这里也就成了唯一的守门人。口径留在这个独立函数里而不是
    内联进 approve()：前端要靠它预判哪些字段还差，两处判断必须同源，各写一套迟早
    漂移，而漂移的后果是发出一张残缺的已批准税票——客户地址空着、汇率没有，或者
    19 条商品（超过模板容量，要等到生成文件时才炸，那时编号早就发出去了）。
    """
    missing = [
        name
        for name, value in {
            "invoiceDate": invoice_date,
            "exchangeTargetDate": exchange_target_date,
            "exchangeRate": exchange_rate,
            "customerName": customer_name,
            "customerAddress": customer_address,
            "CDN": cdn,
        }.items()
        if value in (None, "")
    ]
    if item_count == 0:
        missing.append("items")
    return ApprovalReadiness(
        missing_fields=missing,
        too_many_items=item_count > APPROVAL_ITEM_LIMIT,
    )


@dataclass(frozen=True)
class DailyRate:
    """BOT 一天一个币种的四种报价。只有 buying_transfer 是必有的。"""

    buying_transfer: Decimal
    buying_sight: Decimal | None = None
    selling: Decimal | None = None
    mid_rate: Decimal | None = None


class BotApiError(TaxInvoiceServiceError):
    """BOT 网关返回了非 2xx。502 表示"上游拒了"，与本系统自身的 4xx 区分开。"""

    status_code = 502

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.upstream_status = status_code


@dataclass(frozen=True)
class DualBatchPairInput:
    """一次上传里、一组可导入的配对——已在识别阶段解析好，直接拿去落库。

    孤立关单和 conflict 组不会走到这里（路由层已挡下）：能进来的都至少有发票。
    关单缺失（待补关单）允许：customs_* 为 None。
    """

    key: str
    invoice_data: dict[str, Any]
    customs_data: dict[str, Any]
    invoice_file_name: str
    invoice_content: bytes
    customs_file_name: str | None
    customs_content: bytes | None


@dataclass(frozen=True)
class DualBatchPairOutcome:
    key: str
    invoice_id: uuid.UUID
    invoice_file_name: str
    customs_file_name: str | None
    item_count: int
    needs_review: bool


@dataclass(frozen=True)
class DualBatchResult:
    batch_id: uuid.UUID
    invoice_count: int
    item_count: int
    needs_review_count: int
    pairs: list[DualBatchPairOutcome]


@dataclass(frozen=True)
class ImportBatchOverview:
    """一个导入批次 + 它现在各状态各有几张票，供复核台列表用。

    计数按**当前**票状态实时聚合，而不是读批次行上导入时定死的 invoice_count：
    复核台要显示的是「这批还剩几张要处理」，会随逐条批准变动。
    """

    batch: TaxInvoiceImportBatch
    total: int
    pending: int  # draft / needs_review / ready
    needs_review: int
    approved: int  # approved / issued


@dataclass(frozen=True)
class BatchApproveOutcome:
    approved_ids: list[uuid.UUID]
    skipped: list[tuple[uuid.UUID, str]]


@dataclass(frozen=True)
class BatchRejectOutcome:
    rejected_ids: list[uuid.UUID]


@dataclass
class InvoiceAggregate:
    invoice: TaxInvoice
    items: list[TaxInvoiceItem]
    events: list[TaxInvoiceEvent]


class TaxInvoiceService:
    def __init__(
        self,
        session: AsyncSession,
        actor_name: str,
        settings: Settings,
    ) -> None:
        self.session = session
        self.actor_name = actor_name
        self.settings = settings

    async def list_invoices(
        self,
        *,
        status: str | None,
        period: str | None,
        query: str | None,
        page: int,
        page_size: int,
        batch_id: uuid.UUID | None = None,
    ) -> tuple[list[TaxInvoice], int]:
        filters = []
        if batch_id is not None:
            filters.append(TaxInvoice.batch_id == batch_id)
        if status:
            filters.append(TaxInvoice.status == status)
        if period:
            filters.append(TaxInvoice.revenue_period == period.replace("-", ""))
        if query:
            pattern = f"%{query.strip()}%"
            filters.append(
                or_(
                    TaxInvoice.document_no.ilike(pattern),
                    TaxInvoice.ci_no.ilike(pattern),
                    TaxInvoice.cdn.ilike(pattern),
                    TaxInvoice.customer_name.ilike(pattern),
                )
            )
        total = await self.session.scalar(
            select(func.count()).select_from(TaxInvoice).where(*filters)
        )
        invoices = list(
            (
                await self.session.scalars(
                    select(TaxInvoice)
                    .where(*filters)
                    .order_by(TaxInvoice.updated_at.desc(), TaxInvoice.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            ).all()
        )
        return invoices, int(total or 0)

    async def list_batches(self, *, limit: int = 50) -> list[ImportBatchOverview]:
        """最近的导入批次，附**当前**各状态计数（复核台的批次列表）。"""
        batches = list(
            (
                await self.session.scalars(
                    select(TaxInvoiceImportBatch)
                    .order_by(TaxInvoiceImportBatch.created_at.desc())
                    .limit(limit)
                )
            ).all()
        )
        if not batches:
            return []
        rows = (
            await self.session.execute(
                select(
                    TaxInvoice.batch_id,
                    TaxInvoice.status,
                    func.count(),
                )
                .where(TaxInvoice.batch_id.in_([batch.id for batch in batches]))
                .group_by(TaxInvoice.batch_id, TaxInvoice.status)
            )
        ).all()
        counts: dict[uuid.UUID, dict[str, int]] = {}
        for batch_id, invoice_status, count in rows:
            counts.setdefault(batch_id, {})[invoice_status] = count
        overviews: list[ImportBatchOverview] = []
        for batch in batches:
            bucket = counts.get(batch.id, {})
            overviews.append(
                ImportBatchOverview(
                    batch=batch,
                    total=sum(bucket.values()),
                    pending=(
                        bucket.get("draft", 0)
                        + bucket.get("needs_review", 0)
                        + bucket.get("ready", 0)
                    ),
                    needs_review=bucket.get("needs_review", 0),
                    approved=bucket.get("approved", 0) + bucket.get("issued", 0),
                )
            )
        return overviews

    async def export_entries(
        self,
        *,
        status: str | None,
        period: str | None,
        query: str | None,
        batch_id: uuid.UUID | None = None,
    ) -> list[tuple[TaxInvoice, list[TaxInvoiceItem]]]:
        """按台账同一套筛选条件取出税票 + 明细，供导出用。

        不分页：导出的语义就是"把我筛出来的这批全拿走"，分页导出没有意义。
        但也不能无上限地往内存里塞，超过 MAX_EXPORT_INVOICES 就让用户先收窄
        筛选条件——报错说清楚怎么办，比慢慢跑到内存耗尽强。
        """
        invoices, total = await self.list_invoices(
            status=status,
            period=period,
            query=query,
            page=1,
            page_size=MAX_EXPORT_INVOICES,
            batch_id=batch_id,
        )
        if total > MAX_EXPORT_INVOICES:
            raise TaxInvoiceStateError(
                f"the filter matches {total} invoices; "
                f"export is capped at {MAX_EXPORT_INVOICES}. "
                "Narrow it down by period or status first."
            )
        if not invoices:
            return []
        # 一次把这批税票的明细全捞回来再按 invoice_id 归位，避免每张税票一次查询。
        rows = list(
            (
                await self.session.scalars(
                    select(TaxInvoiceItem)
                    .where(TaxInvoiceItem.invoice_id.in_([item.id for item in invoices]))
                    .order_by(TaxInvoiceItem.invoice_id, TaxInvoiceItem.line_number)
                )
            ).all()
        )
        grouped: dict[uuid.UUID, list[TaxInvoiceItem]] = {}
        for row in rows:
            grouped.setdefault(row.invoice_id, []).append(row)
        return [(invoice, grouped.get(invoice.id, [])) for invoice in invoices]

    async def aggregate(self, invoice: TaxInvoice) -> InvoiceAggregate:
        items = list(
            (
                await self.session.scalars(
                    select(TaxInvoiceItem)
                    .where(TaxInvoiceItem.invoice_id == invoice.id)
                    .order_by(TaxInvoiceItem.line_number)
                )
            ).all()
        )
        events = list(
            (
                await self.session.scalars(
                    select(TaxInvoiceEvent)
                    .where(TaxInvoiceEvent.invoice_id == invoice.id)
                    .order_by(TaxInvoiceEvent.created_at, TaxInvoiceEvent.id)
                )
            ).all()
        )
        return InvoiceAggregate(invoice=invoice, items=items, events=events)

    async def get_invoice(self, invoice_id: uuid.UUID) -> InvoiceAggregate:
        return await self.aggregate(await self._load_invoice(invoice_id))

    async def import_dual(
        self,
        *,
        invoice_data: dict[str, Any],
        customs_data: dict[str, Any],
        currency: str,
        invoice_file_name: str,
        invoice_content: bytes,
        customs_file_name: str | None,
        customs_content: bytes | None,
    ) -> TaxInvoiceImportResponse:
        submission_date = customs_data.get("submission_date")
        rates: dict[date, Decimal] = {}
        if isinstance(submission_date, date):
            rates = await self._bot_rate_window(currency, submission_date)
        recognized = combine_invoice_and_customs(
            invoice_data,
            customs_data,
            rates,
            currency=currency,
        )
        # 关单还没下来时只留发票这一份源文件。补到关单后走更正流程重新识别，
        # 那时才会有第二份——这里不留占位空文件，附件列表要如实反映手上有什么。
        source_files = [(invoice_file_name, invoice_content)]
        if customs_file_name is not None and customs_content is not None:
            source_files.append((customs_file_name, customs_content))
        return await self._create_import(
            rows=[recognized],
            import_mode="dual",
            source_names=[name for name, _ in source_files],
            source_files=source_files,
        )

    async def import_dual_batch(
        self,
        *,
        inputs: list[DualBatchPairInput],
        currency: str,
    ) -> DualBatchResult:
        """一次上传里的所有可导入配对 → 一个复核批次（不自动出编号）。

        与逐对调用 /import/dual 的区别：整批落进同一个 import_batches 行、同一个
        事务，复核台按批次展示。汇率沿用 import_dual 的匹配口径
        （_bot_rate_window + combine_invoice_and_customs），先导票后同步汇率的
        记录之后可在复核台按提交日重匹配。

        整批一个事务＝「全进或全不进」：任一行撞上重复业务键（同一 C/I No.+CDN
        已存在、或批内重复），_assert_importable 会整批退回并列全部冲突，改完再导。
        解析失败或缺关单不在此列——那类文件在识别阶段已被摘出/降级为「待补关单」，
        不会带进这个事务。
        """
        if not inputs:
            raise TaxInvoiceStateError(
                "no importable invoice/customs pairs were provided"
            )
        rows: list[dict[str, Any]] = []
        per_pair: list[tuple[int, bool]] = []
        source_files: list[tuple[str, bytes]] = []
        seen_files: set[str] = set()
        for pair in inputs:
            submission_date = pair.customs_data.get("submission_date")
            rates = (
                await self._bot_rate_window(currency, submission_date)
                if isinstance(submission_date, date)
                else {}
            )
            recognized = combine_invoice_and_customs(
                pair.invoice_data,
                pair.customs_data,
                rates,
                currency=currency,
            )
            recognized["source_invoice_file_name"] = pair.invoice_file_name
            recognized["source_customs_file_name"] = pair.customs_file_name
            item_count = len(recognized.get("items") or [])
            per_pair.append(
                (item_count, self._review_status(recognized, item_count) == "needs_review")
            )
            rows.append(recognized)
            for name, content in (
                (pair.invoice_file_name, pair.invoice_content),
                (pair.customs_file_name, pair.customs_content),
            ):
                if content is not None and name is not None and name not in seen_files:
                    seen_files.add(name)
                    source_files.append((name, content))
        response = await self._create_import(
            rows=rows,
            import_mode="dual",
            source_names=[name for name, _ in source_files],
            source_files=source_files,
        )
        # combine 每对产出恰好一行，_create_import 按 rows 顺序建票，
        # 所以 invoice_ids 与 inputs 一一对应、同序，可以直接 zip。
        outcomes = [
            DualBatchPairOutcome(
                key=pair.key,
                invoice_id=invoice_id,
                invoice_file_name=pair.invoice_file_name,
                customs_file_name=pair.customs_file_name,
                item_count=item_count,
                needs_review=needs_review,
            )
            for pair, invoice_id, (item_count, needs_review) in zip(
                inputs, response.invoice_ids, per_pair, strict=True
            )
        ]
        return DualBatchResult(
            batch_id=response.batch_id,
            invoice_count=response.invoice_count,
            item_count=response.item_count,
            needs_review_count=response.needs_review_count,
            pairs=outcomes,
        )

    async def import_sample(
        self,
        *,
        rows: list[dict[str, Any]],
        file_name: str,
        content: bytes,
    ) -> TaxInvoiceImportResponse:
        """常规批量开具：编号只能由批准时的事务生成，文件里带编号一律退回。

        补开以前月份的税票也走这条路：编号取自行里的 invoice_date（见
        `assign_tax_invoice_number`），汇率取自文件的 FX Date / FX Rate 列，
        两处都不看"今天"，所以回填历史月份不需要任何额外通道。
        """
        return await self._create_import(
            rows=rows,
            import_mode="sample",
            source_names=[file_name],
            source_files=[(file_name, content)],
        )

    async def _assert_importable(self, rows: list[dict[str, Any]]) -> None:
        """把整份文件的冲突一次查完，全部收进 issues 再抛。

        以前是查到第一条就抛，用户改一行再导一次、再撞下一条，一份几十行的
        表要往返十几轮。现在一次把问题列全，改一遍就能过。

        仍然是整批拒绝、一条都不入库：这是财务数据，允许部分成功的话，
        用户拿不到"到底哪几张进去了"的确定答案，对账反而更难。
        """
        issues: list[dict[str, object]] = []
        seen_business_keys: dict[tuple[str, str | None], list[int]] = {}

        def locate(row: dict[str, Any]) -> list[int]:
            # 双文件识别那条链路没有源行号，缺了就只报业务键。
            return list(row.get("source_rows") or [])

        for row in rows:
            source_rows = locate(row)
            business_key = (row["ci_no"], row.get("cdn"))
            label = f"{business_key[0]} / {business_key[1] or '-'}"
            if business_key in seen_business_keys:
                issues.append(
                    {
                        "rows": source_rows,
                        "key": label,
                        "reason": "duplicate_in_file",
                        "detail": (
                            f"invoice {label} also appears at row(s) "
                            f"{seen_business_keys[business_key] or '-'} of this file"
                        ),
                    }
                )
            else:
                seen_business_keys[business_key] = source_rows
                duplicate = await self.session.scalar(
                    select(TaxInvoice.id).where(
                        TaxInvoice.ci_no == business_key[0],
                        TaxInvoice.cdn == business_key[1],
                        TaxInvoice.status != "voided",
                    )
                )
                if duplicate is not None:
                    issues.append(
                        {
                            "rows": source_rows,
                            "key": label,
                            "reason": "already_exists",
                            "detail": f"invoice {label} already exists in the ledger",
                        }
                    )

            document_no = row.get("document_no")
            if not document_no:
                continue

            # 文件里带编号一律退回，没有例外——这是全系统「编号只由批准时的数据库
            # 事务生成」这条规则的实际执行点，界面上的提示只是提示，拦不住手工改过
            # 的表。历史迁移那条允许沿用旧编号的一次性通道已经摘掉；补开以前月份的
            # 票不需要它，把 Invoice Date 填成当时的报关提交日即可，编号会按那一天发。
            issues.append(
                {
                    "rows": source_rows,
                    "key": document_no,
                    "reason": "number_not_allowed",
                    "detail": (
                        f"document number {document_no} was supplied by the file; "
                        "numbers are assigned on approval. Clear the DocumentNo "
                        "column — to issue an invoice dated to an earlier month, "
                        "set Invoice Date to that date and the number will follow it."
                    ),
                }
            )

        if issues:
            raise TaxInvoiceConflictError(
                f"the import was rejected: {len(issues)} problem(s) found, "
                "nothing was imported",
                issues=issues,
            )

    async def _create_import(
        self,
        *,
        rows: list[dict[str, Any]],
        import_mode: str,
        source_names: list[str],
        source_files: list[tuple[str, bytes]],
    ) -> TaxInvoiceImportResponse:
        if not rows:
            raise TaxInvoiceStateError("the import file contains no invoice records")
        await self._assert_importable(rows)

        batch = TaxInvoiceImportBatch(
            import_mode=import_mode,
            status="processing",
            currency=(rows[0].get("currency") if rows else "USD") or "USD",
            source_file_names=" | ".join(source_names),
            created_by_name=self.actor_name,
        )
        self.session.add(batch)
        await self.session.flush()
        source_root = self._storage_path(f"tax_invoice/sources/{batch.id}")
        source_root.mkdir(parents=True, exist_ok=False)
        # 原始凭证落盘必须与批次记录同生共死。批次一旦回滚，这些文件就再没有
        # 数据库行指向它们，只能靠这里清理，否则每次导入失败都留下一份无主附件
        # 长期占用 ZWT_ATTACHMENT_ROOT，且被每日附件备份一并带走。
        # 与 generate_documents 的清理逻辑保持一致。
        try:
            for index, (file_name, content) in enumerate(source_files, start=1):
                safe_name = Path(file_name).name
                target = source_root / f"{index:02d}-{safe_name}"
                target.write_bytes(content)

            invoice_ids: list[uuid.UUID] = []
            item_count = 0
            needs_review_count = 0
            for source_row in rows:
                row = dict(source_row)
                item_rows = list(row.pop("items"))
                # 只用于定位报错，不是 TaxInvoice 的列，落库前必须摘掉。
                row.pop("source_rows", None)
                # 逐票源文件名：服务端批量识别时每张票各有自己的一对文件，行里自带
                # 这两个键；单票 dual / 表格导入不带，回退到批次级 source_names——
                # 旧两条链路的行为一字不变。
                invoice_source = row.pop("source_invoice_file_name", None) or source_names[0]
                customs_source = row.pop("source_customs_file_name", None)
                if customs_source is None and len(source_names) > 1:
                    customs_source = source_names[1]
                status = self._review_status(row, len(item_rows))
                if status == "needs_review":
                    needs_review_count += 1
                # 识别期的核对告警只用来定 needs_review，不是 TaxInvoice 的列。
                # 不摘掉会直接把 TaxInvoice(**row) 炸成 TypeError。
                row.pop("customs_warnings", None)
                # _assert_importable 已经把带编号的行整批拦下了，这里只是把键摘掉
                # 免得落进 TaxInvoice(**row)。导入永远产出未批准记录，编号统一由
                # approve() 里的 assign_tax_invoice_number 发。
                row.pop("document_no", None)
                invoice = TaxInvoice(
                    **row,
                    batch_id=batch.id,
                    status=status,
                    source_invoice_file_name=invoice_source,
                    source_customs_file_name=customs_source,
                    created_by_name=self.actor_name,
                    updated_by_name=self.actor_name,
                )
                self.session.add(invoice)
                await self.session.flush()
                for item in item_rows:
                    self.session.add(TaxInvoiceItem(invoice_id=invoice.id, **item))
                # 时间线上记这张票自己的源文件即可；批量导入时整批清单几十个名字，
                # 落到每张票上没法看。缺自身文件名（理论上不会）才退回批次清单。
                imported_note = (
                    " | ".join(name for name in (invoice_source, customs_source) if name)
                    or " | ".join(source_names)
                )
                self.session.add(
                    self._event(
                        invoice,
                        "imported",
                        None,
                        invoice.status,
                        imported_note,
                    )
                )
                invoice_ids.append(invoice.id)
                item_count += len(item_rows)
            batch.status = "review" if needs_review_count else "completed"
            batch.invoice_count = len(invoice_ids)
            batch.item_count = item_count
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            for path in source_root.glob("*"):
                path.unlink(missing_ok=True)
            source_root.rmdir()
            raise
        return TaxInvoiceImportResponse(
            batch_id=batch.id,
            invoice_ids=invoice_ids,
            invoice_count=len(invoice_ids),
            item_count=item_count,
            needs_review_count=needs_review_count,
        )

    async def update_invoice(
        self,
        invoice_id: uuid.UUID,
        payload: TaxInvoiceUpdate,
    ) -> InvoiceAggregate:
        invoice = await self._load_invoice(invoice_id, for_update=True)
        self._check_version(invoice, payload.version)
        if invoice.status not in {"draft", "needs_review", "ready"}:
            raise TaxInvoiceStateError("only unapproved invoices can be edited")
        updates = payload.model_dump(
            by_alias=False,
            exclude_unset=True,
            exclude={"version", "items"},
        )
        for field, value in updates.items():
            setattr(invoice, field, value)
        if payload.items is not None:
            await self.session.execute(
                delete(TaxInvoiceItem).where(TaxInvoiceItem.invoice_id == invoice.id)
            )
            usd_total = Decimal("0")
            thb_total = Decimal("0")
            for item_payload in payload.items:
                item_values = item_payload.model_dump(by_alias=False)
                usd_total += item_payload.fob_revenue_usd or Decimal("0")
                thb_total += item_payload.fob_revenue_thb or Decimal("0")
                self.session.add(TaxInvoiceItem(invoice_id=invoice.id, **item_values))
            invoice.fob_revenue_usd_total = usd_total
            invoice.fob_revenue_thb_total = thb_total
            await self.session.flush()
        item_total = await self.session.scalar(
            select(func.count())
            .select_from(TaxInvoiceItem)
            .where(TaxInvoiceItem.invoice_id == invoice.id)
        )
        invoice.revenue_period = (
            invoice.invoice_date.strftime("%Y%m") if invoice.invoice_date else None
        )
        invoice.status = self._review_status(
            {
                "invoice_date": invoice.invoice_date,
                "exchange_target_date": invoice.exchange_target_date,
                "exchange_rate": invoice.exchange_rate,
                "customer_name": invoice.customer_name,
                "customer_address": invoice.customer_address,
                "fob_verification_failed": invoice.fob_verification_failed,
                "submission_date_low_confidence": invoice.submission_date_low_confidence,
            },
            int(item_total or len(payload.items or [])),
        )
        invoice.version += 1
        invoice.updated_by_name = self.actor_name
        self.session.add(
            self._event(invoice, "updated", None, invoice.status)
        )
        await self.session.commit()
        await self.session.refresh(invoice)
        return await self.aggregate(invoice)

    async def _bot_rate_window(
        self,
        currency: str,
        target: date,
    ) -> dict[date, Decimal]:
        """报关提交日往前 RATE_LOOKBACK_DAYS 天内、该币种在用的 BOT 买入汇率。

        识别建单（import_dual）和事后重匹配（match_exchange_rate）共用这一段查询，
        计价口径才只有一处。停用/已删的汇率查得到但不参与计价，所以在这里就滤掉。
        """
        rate_rows = list(
            (
                await self.session.scalars(
                    select(ExchangeRate).where(
                        ExchangeRate.currency == currency.upper(),
                        ExchangeRate.rate_date.between(
                            target - timedelta(days=RATE_LOOKBACK_DAYS),
                            target,
                        ),
                        ExchangeRate.is_active.is_(True),
                        ExchangeRate.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        return {row.rate_date: row.buying_transfer for row in rate_rows}

    async def match_exchange_rate(
        self,
        invoice_id: uuid.UUID,
        *,
        version: int,
    ) -> InvoiceAggregate:
        """事后按报关提交日重新匹配 BOT 汇率，并重算每一行的 THB。

        为什么需要它：识别建单时的汇率匹配是一次性的——若那时汇率表里还没有
        当期数据（常见：先导票、后同步 BOT 汇率），这张票就一直空着汇率，只能
        逐张手填。这里把同一套匹配逻辑做成可重跑的动作，接在「同步汇率」之后用。

        只动未批准的记录：已批准/已开具的编号和金额都定了，要改必须走作废→更正。
        """
        invoice = await self._load_invoice(invoice_id, for_update=True)
        self._check_version(invoice, version)
        if invoice.status not in {"draft", "needs_review", "ready"}:
            raise TaxInvoiceStateError(
                "only an unapproved invoice can be re-matched to a rate"
            )
        target = invoice.exchange_target_date
        if target is None:
            raise TaxInvoiceStateError(
                "set the exchange target date (customs submission date) "
                "before matching a rate"
            )
        rates = await self._bot_rate_window(invoice.currency, target)
        rate, matched = lookup_fx_rate(rates, target)
        if rate is None:
            raise TaxInvoiceStateError(
                f"no active BOT {invoice.currency} rate within "
                f"{RATE_LOOKBACK_DAYS} days before {target:%Y-%m-%d}; "
                "sync or import the BOT rate table for that period first"
            )
        items = list(
            (
                await self.session.scalars(
                    select(TaxInvoiceItem)
                    .where(TaxInvoiceItem.invoice_id == invoice.id)
                    .order_by(TaxInvoiceItem.line_number)
                )
            ).all()
        )
        invoice.exchange_rate = rate
        invoice.exchange_rate_date = matched
        thb_total = Decimal("0")
        for item in items:
            item.fob_revenue_thb = recompute_line_thb(item.fob_revenue_usd, rate)
            thb_total += item.fob_revenue_thb or Decimal("0")
        invoice.fob_revenue_thb_total = thb_total
        # 填上汇率后可能就从「需复核」升到「就绪」，用同一套口径重判一次。
        invoice.status = self._review_status(
            {
                "invoice_date": invoice.invoice_date,
                "exchange_target_date": invoice.exchange_target_date,
                "exchange_rate": invoice.exchange_rate,
                "customer_name": invoice.customer_name,
                "customer_address": invoice.customer_address,
                "fob_verification_failed": invoice.fob_verification_failed,
                "submission_date_low_confidence": invoice.submission_date_low_confidence,
            },
            len(items),
        )
        invoice.version += 1
        invoice.updated_by_name = self.actor_name
        self.session.add(
            self._event(
                invoice,
                "rate_matched",
                None,
                invoice.status,
                f"{invoice.currency} {rate} @ {matched:%Y-%m-%d}",
            )
        )
        await self.session.commit()
        await self.session.refresh(invoice)
        return await self.aggregate(invoice)

    async def approve(
        self,
        invoice_id: uuid.UUID,
        *,
        version: int,
        accept_warnings: bool,
        note: str | None,
    ) -> InvoiceAggregate:
        invoice = await self._load_invoice(invoice_id, for_update=True)
        self._check_version(invoice, version)
        if invoice.status not in {"draft", "needs_review", "ready"}:
            raise TaxInvoiceStateError("only an unapproved invoice can be approved")
        items = list(
            (
                await self.session.scalars(
                    select(TaxInvoiceItem)
                    .where(TaxInvoiceItem.invoice_id == invoice.id)
                    .order_by(TaxInvoiceItem.line_number)
                )
            ).all()
        )
        readiness = check_approval_readiness(
            invoice_date=invoice.invoice_date,
            exchange_target_date=invoice.exchange_target_date,
            exchange_rate=invoice.exchange_rate,
            customer_name=invoice.customer_name,
            customer_address=invoice.customer_address,
            cdn=invoice.cdn,
            item_count=len(items),
        )
        if readiness.too_many_items:
            raise TaxInvoiceStateError(
                f"this template supports {APPROVAL_ITEM_LIMIT} product lines; "
                "split or approve a multi-page design first"
            )
        if readiness.missing_fields:
            raise TaxInvoiceStateError(
                "invoice is incomplete; required fields: "
                f"{', '.join(readiness.missing_fields)}"
            )
        has_warnings = (
            invoice.is_dap
            or invoice.fob_verification_failed
            or invoice.submission_date_low_confidence
        )
        if has_warnings and not accept_warnings:
            raise TaxInvoiceStateError(
                "review warnings must be explicitly accepted before approval"
            )
        from_status = invoice.status
        await assign_tax_invoice_number(self.session, invoice)
        invoice.version += 1
        invoice.approved_at = datetime.now(UTC)
        invoice.updated_by_name = self.actor_name
        self.session.add(
            self._event(invoice, "approved", from_status, "approved", note)
        )
        await self.session.commit()
        await self.session.refresh(invoice)
        return InvoiceAggregate(
            invoice=invoice,
            items=items,
            events=(
                await self.aggregate(invoice)
            ).events,
        )

    async def approve_batch(
        self,
        batch_id: uuid.UUID,
        *,
        invoice_ids: list[uuid.UUID] | None,
        accept_warnings: bool,
    ) -> BatchApproveOutcome:
        """总览里「单条 / 全部批准」——按批次批量批准未批准的税票。

        invoice_ids 为 None＝批准这批里所有还未批准的；给了子集就只批那几张。
        逐张走 approve()（每张一个事务、各自发编号）：够格的批准、不够格的
        （缺字段 / 缺汇率 / 超 18 行）记进 skipped 回报，不因为一张不齐就把整批挡住——
        这正是「导入不自动出号、复核后再逐条 / 整批批准」这套语义要的效果。
        """
        batch = await self.session.get(TaxInvoiceImportBatch, batch_id)
        if batch is None:
            raise TaxInvoiceNotFoundError("import batch was not found")
        statement = select(TaxInvoice).where(
            TaxInvoice.batch_id == batch_id,
            TaxInvoice.status.in_(("draft", "needs_review", "ready")),
        )
        if invoice_ids is not None:
            statement = statement.where(TaxInvoice.id.in_(invoice_ids))
        targets = list(
            (
                await self.session.scalars(statement.order_by(TaxInvoice.created_at))
            ).all()
        )
        # 先把 (id, version) 抓下来：approve() 每张都会 commit，逐条批准后
        # 会话里其余对象会被 expire，循环里再读属性就要触发重查。
        target_refs = [(target.id, target.version) for target in targets]
        approved_ids: list[uuid.UUID] = []
        skipped: list[tuple[uuid.UUID, str]] = []
        for target_id, version in target_refs:
            try:
                result = await self.approve(
                    target_id,
                    version=version,
                    accept_warnings=accept_warnings,
                    note="batch approve",
                )
                approved_ids.append(result.invoice.id)
            except TaxInvoiceServiceError as exc:
                # approve() 自身不回滚——够不上批准的那张可能已经在事务里改了一半
                # （极端情况下 commit 失败）。必须回滚，否则它的半成品会被下一张的
                # commit 一起提交。回滚只影响这一张。
                await self.session.rollback()
                skipped.append((target_id, str(exc)))
        return BatchApproveOutcome(approved_ids=approved_ids, skipped=skipped)

    async def reject_invoice(
        self,
        invoice_id: uuid.UUID,
        *,
        version: int,
        reason: str | None = None,
    ) -> InvoiceAggregate:
        """拒批一张未批准的税票：像软删除一样置 rejected 进历史，可再恢复。

        只对 draft/needs_review/ready 生效——已批准/已开具的有正式编号，要作废得走
        void→correction，不能从这条无痕地拿掉。
        """
        invoice = await self._load_invoice(invoice_id, for_update=True)
        self._check_version(invoice, version)
        if invoice.status not in {"draft", "needs_review", "ready"}:
            raise TaxInvoiceStateError("only an unapproved invoice can be rejected")
        previous = invoice.status
        invoice.status = "rejected"
        invoice.rejected_at = datetime.now(UTC)
        invoice.version += 1
        invoice.updated_by_name = self.actor_name
        self.session.add(
            self._event(
                invoice,
                "rejected",
                previous,
                "rejected",
                (reason or "").strip() or None,
            )
        )
        await self.session.commit()
        await self.session.refresh(invoice)
        return await self.aggregate(invoice)

    async def restore_invoice(
        self,
        invoice_id: uuid.UUID,
        *,
        version: int,
    ) -> InvoiceAggregate:
        """把拒批的税票恢复回复核队列，按完整性重判 needs_review / ready。"""
        invoice = await self._load_invoice(invoice_id, for_update=True)
        self._check_version(invoice, version)
        if invoice.status != "rejected":
            raise TaxInvoiceStateError("only a rejected invoice can be restored")
        item_count = await self.session.scalar(
            select(func.count())
            .select_from(TaxInvoiceItem)
            .where(TaxInvoiceItem.invoice_id == invoice.id)
        )
        invoice.status = self._review_status(
            {
                "invoice_date": invoice.invoice_date,
                "exchange_target_date": invoice.exchange_target_date,
                "exchange_rate": invoice.exchange_rate,
                "customer_name": invoice.customer_name,
                "customer_address": invoice.customer_address,
                "fob_verification_failed": invoice.fob_verification_failed,
                "submission_date_low_confidence": invoice.submission_date_low_confidence,
            },
            int(item_count or 0),
        )
        invoice.rejected_at = None
        invoice.version += 1
        invoice.updated_by_name = self.actor_name
        self.session.add(
            self._event(invoice, "restored", "rejected", invoice.status)
        )
        await self.session.commit()
        await self.session.refresh(invoice)
        return await self.aggregate(invoice)

    async def reject_batch(
        self,
        batch_id: uuid.UUID,
        *,
        invoice_ids: list[uuid.UUID] | None,
        reason: str | None = None,
    ) -> BatchRejectOutcome:
        """复核台的「单条 / 整批拒批」。invoice_ids 为空＝拒批这批所有未批准的。

        与 approve_batch 不同，拒批只是状态翻转、不发编号，所以整批一个事务就够，
        不必逐张各自提交。已批准/已开具的天然不在选取范围内。
        """
        batch = await self.session.get(TaxInvoiceImportBatch, batch_id)
        if batch is None:
            raise TaxInvoiceNotFoundError("import batch was not found")
        statement = select(TaxInvoice).where(
            TaxInvoice.batch_id == batch_id,
            TaxInvoice.status.in_(("draft", "needs_review", "ready")),
        )
        if invoice_ids is not None:
            statement = statement.where(TaxInvoice.id.in_(invoice_ids))
        targets = list(
            (
                await self.session.scalars(statement.order_by(TaxInvoice.created_at))
            ).all()
        )
        note = (reason or "").strip() or None
        now = datetime.now(UTC)
        rejected_ids: list[uuid.UUID] = []
        for target in targets:
            previous = target.status
            target.status = "rejected"
            target.rejected_at = now
            target.version += 1
            target.updated_by_name = self.actor_name
            self.session.add(
                self._event(target, "rejected", previous, "rejected", note)
            )
            rejected_ids.append(target.id)
        await self.session.commit()
        return BatchRejectOutcome(rejected_ids=rejected_ids)

    async def void(
        self,
        invoice_id: uuid.UUID,
        *,
        version: int,
        reason: str,
    ) -> InvoiceAggregate:
        invoice = await self._load_invoice(invoice_id, for_update=True)
        self._check_version(invoice, version)
        if invoice.status not in {"approved", "issued"}:
            raise TaxInvoiceStateError(
                "only an approved or issued TAX INV record can be voided"
            )
        clean_reason = reason.strip()
        if len(clean_reason) < 2:
            raise TaxInvoiceStateError("a void reason is required")
        previous_status = invoice.status
        invoice.status = "voided"
        invoice.voided_at = datetime.now(UTC)
        invoice.version += 1
        invoice.updated_by_name = self.actor_name
        self.session.add(
            self._event(
                invoice,
                "voided",
                previous_status,
                "voided",
                clean_reason,
            )
        )
        await self.session.commit()
        await self.session.refresh(invoice)
        return await self.aggregate(invoice)

    async def create_correction(
        self,
        invoice_id: uuid.UUID,
        *,
        version: int,
        reason: str,
    ) -> InvoiceAggregate:
        original = await self._load_invoice(invoice_id, for_update=True)
        self._check_version(original, version)
        if original.status != "voided":
            raise TaxInvoiceStateError(
                "a correction can only be created from a voided TAX INV record"
            )
        clean_reason = reason.strip()
        if len(clean_reason) < 2:
            raise TaxInvoiceStateError("a correction reason is required")
        existing = await self.session.scalar(
            select(TaxInvoice.id).where(
                TaxInvoice.ci_no == original.ci_no,
                TaxInvoice.cdn == original.cdn,
                TaxInvoice.status != "voided",
            )
        )
        if existing is not None:
            raise TaxInvoiceConflictError(
                "an active correction for this C/I and CDN already exists"
            )
        original_items = list(
            (
                await self.session.scalars(
                    select(TaxInvoiceItem)
                    .where(TaxInvoiceItem.invoice_id == original.id)
                    .order_by(TaxInvoiceItem.line_number)
                )
            ).all()
        )
        correction = TaxInvoice(
            batch_id=original.batch_id,
            correction_of_id=original.id,
            status="needs_review",
            ci_no=original.ci_no,
            cdn=original.cdn,
            ci_date=original.ci_date,
            invoice_date=original.invoice_date,
            exchange_target_date=original.exchange_target_date,
            exchange_rate_date=original.exchange_rate_date,
            revenue_period=original.revenue_period,
            currency=original.currency,
            exchange_rate=original.exchange_rate,
            customer_name=original.customer_name,
            customer_address=original.customer_address,
            tax_id=original.tax_id,
            po_no=original.po_no,
            incoterms=original.incoterms,
            payment_term=original.payment_term,
            fob_revenue_usd_total=original.fob_revenue_usd_total,
            fob_revenue_thb_total=original.fob_revenue_thb_total,
            is_dap=original.is_dap,
            fob_verification_failed=original.fob_verification_failed,
            submission_date_low_confidence=original.submission_date_low_confidence,
            submission_date_confidence=original.submission_date_confidence,
            submission_date_source=original.submission_date_source,
            source_invoice_file_name=original.source_invoice_file_name,
            source_customs_file_name=original.source_customs_file_name,
            created_by_name=self.actor_name,
            updated_by_name=self.actor_name,
        )
        self.session.add(correction)
        await self.session.flush()
        for item in original_items:
            self.session.add(
                TaxInvoiceItem(
                    invoice_id=correction.id,
                    line_number=item.line_number,
                    product_name=item.product_name,
                    product_code=item.product_code,
                    hs_code=item.hs_code,
                    unit=item.unit,
                    quantity=item.quantity,
                    ci_unit_price=item.ci_unit_price,
                    fob_unit_price_usd=item.fob_unit_price_usd,
                    fob_revenue_usd=item.fob_revenue_usd,
                    fob_revenue_thb=item.fob_revenue_thb,
                )
            )
        self.session.add(
            self._event(
                correction,
                "correction_created",
                None,
                "needs_review",
                f"{clean_reason} | replaces {original.document_no}",
            )
        )
        await self.session.commit()
        await self.session.refresh(correction)
        return await self.aggregate(correction)

    async def list_exchange_rates(
        self,
        *,
        currency: str,
        start_date: date | None,
        end_date: date | None,
        month: str | None = None,
        deleted: bool = False,
    ) -> list[ExchangeRate]:
        """某币种的每日汇率。month（YYYY-MM）是 start/end 的便捷写法。

        月份边界故意放在服务端算：闰年和月末天数交给前端算，迟早会有人用
        `new Date(y, m, 31)` 把 2 月溢出到 3 月，而汇率查错一天就是税票金额错。
        """
        filters: list[Any] = [
            ExchangeRate.currency == currency.upper(),
            ExchangeRate.deleted_at.is_not(None)
            if deleted
            else ExchangeRate.deleted_at.is_(None),
        ]
        if month:
            first, last = month_bounds(month)
            filters.extend([ExchangeRate.rate_date >= first, ExchangeRate.rate_date <= last])
        if start_date:
            filters.append(ExchangeRate.rate_date >= start_date)
        if end_date:
            filters.append(ExchangeRate.rate_date <= end_date)
        return list(
            (
                await self.session.scalars(
                    select(ExchangeRate)
                    .where(*filters)
                    .order_by(ExchangeRate.rate_date.desc())
                    .limit(500)
                )
            ).all()
        )

    async def list_exchange_rate_months(self, *, currency: str) -> list[ExchangeRateMonth]:
        """按月汇总，供「先看月份、点进去再看每天」的两级界面用。

        汇总在 SQL 里做而不是把整年日行拉回来在 Python 里 group：一个币种攒几年
        就是上千行，而月份列表只需要每月一行。to_char 是 PG 专有，与本模块其它
        地方（JSONB、ON CONFLICT）的取舍一致。
        """
        month_expr = func.to_char(ExchangeRate.rate_date, "YYYY-MM").label("month")
        rows = (
            await self.session.execute(
                select(
                    month_expr,
                    func.count().label("day_count"),
                    func.count()
                    .filter(ExchangeRate.is_active.is_(False))
                    .label("inactive_count"),
                    func.min(ExchangeRate.buying_transfer).label("min_rate"),
                    func.max(ExchangeRate.buying_transfer).label("max_rate"),
                    func.max(ExchangeRate.rate_date).label("latest_date"),
                    func.max(ExchangeRate.updated_at).label("updated_at"),
                )
                .where(
                    ExchangeRate.currency == currency.upper(),
                    ExchangeRate.deleted_at.is_(None),
                )
                .group_by(month_expr)
                .order_by(month_expr.desc())
            )
        ).all()
        return [
            ExchangeRateMonth(
                currency=currency.upper(),
                month=row.month,
                day_count=row.day_count,
                inactive_count=row.inactive_count,
                min_rate=row.min_rate,
                max_rate=row.max_rate,
                latest_date=row.latest_date,
                updated_at=row.updated_at,
            )
            for row in rows
        ]

    async def list_rate_currencies(self) -> list[str]:
        return list(
            (
                await self.session.scalars(
                    select(ExchangeRate.currency)
                    .distinct()
                    .where(ExchangeRate.deleted_at.is_(None))
                    .order_by(ExchangeRate.currency)
                )
            ).all()
        )

    async def upsert_exchange_rate(self, payload: ExchangeRateUpsert) -> ExchangeRate:
        """手工录入/覆盖某一天的汇率。

        与 Excel/BOT 导入的区别只在 source='manual' 和「四个价位一律按传入值写」：
        导入路径用 coalesce 保护另外三种价位不被单来源的表抹掉，而手工录入是人
        当面填的完整一行，填空就是要清空。
        """
        existing = await self.session.scalar(
            select(ExchangeRate)
            .where(
                ExchangeRate.currency == payload.currency,
                ExchangeRate.rate_date == payload.rate_date,
                ExchangeRate.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if existing is None:
            existing = ExchangeRate(
                currency=payload.currency,
                rate_date=payload.rate_date,
                source="manual",
            )
            self.session.add(existing)
        existing.buying_transfer = payload.buying_transfer
        existing.buying_sight = payload.buying_sight
        existing.selling = payload.selling
        existing.mid_rate = payload.mid_rate
        existing.source = "manual"
        existing.source_file_name = None
        existing.is_active = payload.is_active
        existing.updated_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(existing)
        return existing

    async def update_exchange_rate(
        self,
        rate_id: int,
        payload: ExchangeRateUpdate,
    ) -> ExchangeRate:
        rate = await self._load_exchange_rate(rate_id, for_update=True)
        for name, value in payload.model_dump(by_alias=False, exclude_unset=True).items():
            setattr(rate, name, value)
        rate.updated_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(rate)
        return rate

    async def delete_exchange_rate(self, rate_id: int) -> ExchangeRate:
        """移入回收站。不动 is_active，恢复时还原成删除前的样子。"""
        rate = await self._load_exchange_rate(rate_id, for_update=True)
        rate.deleted_at = datetime.now(UTC)
        rate.deleted_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(rate)
        return rate

    async def restore_exchange_rate(self, rate_id: int) -> ExchangeRate:
        """从回收站恢复。

        (currency, rate_date) 在删除时就释放了，期间完全可能有人重新导入或手工
        录了同一天的汇率，所以恢复前必须复查。撞车时报 409 —— 自动覆盖在用的
        那条等于用一份被人主动删掉的数据悄悄改掉税票计价依据。
        """
        rate = await self._load_exchange_rate(rate_id, for_update=True, include_deleted=True)
        if rate.deleted_at is None:
            raise TaxInvoiceStateError("exchange rate is not in the recycle bin")
        occupied = await self.session.scalar(
            select(ExchangeRate.id).where(
                ExchangeRate.currency == rate.currency,
                ExchangeRate.rate_date == rate.rate_date,
                ExchangeRate.deleted_at.is_(None),
            )
        )
        if occupied is not None:
            raise TaxInvoiceConflictError(
                f"{rate.currency} {rate.rate_date.isoformat()} already has an active rate; "
                f"delete that one before restoring this record"
            )
        rate.deleted_at = None
        rate.deleted_by_name = None
        rate.updated_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(rate)
        return rate

    async def _load_exchange_rate(
        self,
        rate_id: int,
        *,
        for_update: bool = False,
        include_deleted: bool = False,
    ) -> ExchangeRate:
        statement = select(ExchangeRate).where(ExchangeRate.id == rate_id)
        if not include_deleted:
            statement = statement.where(ExchangeRate.deleted_at.is_(None))
        if for_update:
            statement = statement.with_for_update()
        rate = await self.session.scalar(statement)
        if rate is None:
            raise TaxInvoiceNotFoundError("exchange rate was not found")
        return rate

    async def import_exchange_rates(
        self,
        rates: Mapping[date, Decimal | DailyRate],
        *,
        currency: str,
        source: str,
        source_file_name: str | None,
    ) -> ExchangeRateImportResponse:
        created = 0
        updated = 0
        for rate_date, value in rates.items():
            # BOT Excel 只给 buying transfer，API 四种全给。两种入口共用这里，
            # 裸 Decimal 视为只有 transfer。
            daily = value if isinstance(value, DailyRate) else DailyRate(buying_transfer=value)
            existing = await self.session.scalar(
                select(ExchangeRate.id).where(
                    ExchangeRate.currency == currency.upper(),
                    ExchangeRate.rate_date == rate_date,
                    ExchangeRate.deleted_at.is_(None),
                )
            )
            statement = insert(ExchangeRate).values(
                currency=currency.upper(),
                rate_date=rate_date,
                buying_transfer=daily.buying_transfer,
                buying_sight=daily.buying_sight,
                selling=daily.selling,
                mid_rate=daily.mid_rate,
                source=source,
                source_file_name=source_file_name,
                updated_by_name=self.actor_name,
            )
            # 冲突目标必须按「索引元素 + 索引条件」指定，不能再按约束名。
            # 20260729_0013 把 uq_core_exchange_rates_currency_date 换成了部分唯一
            # 索引（只约束 deleted_at IS NULL 的行），而 PG 的 ON CONFLICT ON
            # CONSTRAINT 只接受真正的约束，引用部分索引会直接报错。
            #
            # 语义上这也正是想要的：命中的只可能是「在用」的那一行，回收站里的
            # 同币种同日期记录不参与 upsert，重导会正常插入一条新的生效行。
            statement = statement.on_conflict_do_update(
                index_elements=[ExchangeRate.currency, ExchangeRate.rate_date],
                index_where=ExchangeRate.deleted_at.is_(None),
                set_={
                    "buying_transfer": statement.excluded.buying_transfer,
                    # coalesce 而不是直接覆盖：API 同步过四种汇率之后再导一次
                    # 只含 transfer 的 Excel，不应该把另外三种抹成 NULL。
                    "buying_sight": func.coalesce(
                        statement.excluded.buying_sight, ExchangeRate.buying_sight
                    ),
                    "selling": func.coalesce(
                        statement.excluded.selling, ExchangeRate.selling
                    ),
                    "mid_rate": func.coalesce(
                        statement.excluded.mid_rate, ExchangeRate.mid_rate
                    ),
                    "source": statement.excluded.source,
                    "source_file_name": statement.excluded.source_file_name,
                    "updated_by_name": statement.excluded.updated_by_name,
                    "updated_at": func.now(),
                },
            )
            await self.session.execute(statement)
            if existing is None:
                created += 1
            else:
                updated += 1
        await self.session.commit()
        return ExchangeRateImportResponse(
            source_file_name=source_file_name or "BOT API",
            currency=currency.upper(),
            created=created,
            updated=updated,
        )

    def bot_api_status(self) -> BotApiStatus:
        """给前端的配置自检。密钥本身绝不外传，只回是否配好和一小段掩码。"""
        key = self.settings.bot_api_key.strip()
        return BotApiStatus(
            configured=bool(key),
            base_url=self.settings.bot_api_base_url,
            endpoint=self.settings.bot_api_endpoint,
            auth_header=self.settings.bot_api_auth_header,
            key_hint=f"{key[:4]}…{key[-4:]}" if len(key) >= 12 else None,
            env_var="ZWT_BOT_API_KEY",
        )

    def _bot_headers(self) -> dict[str, str]:
        scheme = self.settings.bot_api_auth_scheme.strip()
        key = self.settings.bot_api_key.strip()
        return {
            "accept": "application/json",
            self.settings.bot_api_auth_header: f"{scheme} {key}".strip() if scheme else key,
        }

    async def fetch_bot_exchange_rates(
        self,
        payload: ExchangeRateFetchRequest,
    ) -> ExchangeRateImportResponse:
        if not self.settings.bot_api_configured:
            raise TaxInvoiceStateError(
                "BOT API key is not configured. Set ZWT_BOT_API_KEY in the server .env "
                "and restart the API; until then use the BOT Excel import."
            )
        rates: dict[date, DailyRate] = {}
        async with httpx.AsyncClient(
            base_url=self.settings.bot_api_base_url,
            headers=self._bot_headers(),
            timeout=20,
        ) as client:
            chunk_start = payload.start_date
            while chunk_start <= payload.end_date:
                chunk_end = min(chunk_start + timedelta(days=29), payload.end_date)
                response = await client.get(
                    self.settings.bot_api_endpoint,
                    params={
                        "start_period": chunk_start.isoformat(),
                        "end_period": chunk_end.isoformat(),
                        # 网关支持按币种过滤，传上去可以少下载十几种不用的货币。
                        "currency": payload.currency,
                    },
                )
                if response.status_code >= 400:
                    # 光说 "BOT API request failed" 排查不动：401 是密钥不对、
                    # 429 是打太快、404 是端点路径变了，把上游原话带回去。
                    raise BotApiError(
                        f"BOT API returned HTTP {response.status_code} for "
                        f"{chunk_start.isoformat()}~{chunk_end.isoformat()}: "
                        f"{response.text[:200]}",
                        status_code=response.status_code,
                    )
                details = (
                    response.json()
                    .get("result", {})
                    .get("data", {})
                    .get("data_detail", [])
                )
                for item in details:
                    if _currency(item) != payload.currency:
                        continue
                    try:
                        rate_date = date.fromisoformat(str(item.get("period", "")))
                        value = Decimal(
                            str(item.get("buying_transfer", "")).replace(",", "")
                        )
                    except (ValueError, ArithmeticError):
                        continue
                    if value <= 0:
                        continue
                    rates[rate_date] = DailyRate(
                        buying_transfer=value,
                        buying_sight=_optional_rate(item.get("buying_sight")),
                        selling=_optional_rate(item.get("selling")),
                        mid_rate=_optional_rate(item.get("mid_rate")),
                    )
                chunk_start = chunk_end + timedelta(days=1)
                # 旧工具在这里 sleep 1 秒，跨年区间会拆成十几块，连着打会被网关限流。
                if chunk_start <= payload.end_date and self.settings.bot_api_chunk_pause_seconds:
                    await asyncio.sleep(self.settings.bot_api_chunk_pause_seconds)
        if not rates:
            raise TaxInvoiceStateError(
                f"BOT API returned no {payload.currency} rate between "
                f"{payload.start_date.isoformat()} and {payload.end_date.isoformat()}. "
                "Check the date range: weekends and Thai public holidays have no rate."
            )
        return await self.import_exchange_rates(
            rates,
            currency=payload.currency,
            source="bot_api",
            source_file_name=None,
        )

    async def _load_invoice(
        self,
        invoice_id: uuid.UUID,
        *,
        for_update: bool = False,
    ) -> TaxInvoice:
        statement = select(TaxInvoice).where(TaxInvoice.id == invoice_id)
        if for_update:
            statement = statement.with_for_update()
        invoice = await self.session.scalar(statement)
        if invoice is None:
            raise TaxInvoiceNotFoundError("TAX INV record was not found")
        return invoice

    @staticmethod
    def _review_status(row: dict[str, Any], item_count: int) -> str:
        required = (
            row.get("invoice_date"),
            row.get("exchange_target_date"),
            row.get("exchange_rate"),
            row.get("customer_name"),
            row.get("customer_address"),
        )
        warnings = (
            row.get("fob_verification_failed"),
            row.get("submission_date_low_confidence"),
            item_count == 0,
            item_count > 18,
            # 报关单识别阶段发现的不一致（行级 vs 自印合计、泰铢 vs 汇率×美元）。
            # 数字可能个个看着都合理，只有互相一比才露馅，所以必须转人工。
            bool(row.get("customs_warnings")),
        )
        return "needs_review" if not all(required) or any(warnings) else "ready"

    @staticmethod
    def _check_version(invoice: TaxInvoice, expected: int) -> None:
        if invoice.version != expected:
            raise TaxInvoiceConflictError(
                "the invoice was changed by another user; reload before continuing"
            )

    def _event(
        self,
        invoice: TaxInvoice,
        event_type: str,
        from_status: str | None,
        to_status: str,
        note: str | None = None,
    ) -> TaxInvoiceEvent:
        return TaxInvoiceEvent(
            invoice_id=invoice.id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            actor_name=self.actor_name,
            note=note,
        )

    def _storage_path(self, storage_key: str) -> Path:
        root = self.settings.attachment_root.resolve()
        path = (root / storage_key).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise TaxInvoiceStateError("attachment path escaped the configured root") from exc
        return path


def _currency(item: dict[str, Any]) -> str:
    return str(item.get("currency_id", "")).upper()


def _optional_rate(raw: Any) -> Decimal | None:
    """BOT 对非交易日会返回空串；解析不出来就当没有，不要让整条记录失败。"""
    text = str(raw or "").replace(",", "").strip()
    if not text:
        return None
    try:
        value = Decimal(text)
    except ArithmeticError:
        return None
    return value if value > 0 else None


def file_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
