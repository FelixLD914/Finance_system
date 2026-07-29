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
from app.modules.tax_invoice.recognition import combine_invoice_and_customs
from app.modules.tax_invoice.schemas import (
    BotApiStatus,
    ExchangeRateFetchRequest,
    ExchangeRateImportResponse,
    TaxInvoiceImportResponse,
    TaxInvoiceUpdate,
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
    ) -> tuple[list[TaxInvoice], int]:
        filters = []
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

    async def export_entries(
        self,
        *,
        status: str | None,
        period: str | None,
        query: str | None,
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
        customs_file_name: str,
        customs_content: bytes,
    ) -> TaxInvoiceImportResponse:
        submission_date = customs_data.get("submission_date")
        rates: dict[date, Decimal] = {}
        if isinstance(submission_date, date):
            rate_rows = list(
                (
                    await self.session.scalars(
                        select(ExchangeRate).where(
                            ExchangeRate.currency == currency.upper(),
                            ExchangeRate.rate_date.between(
                                submission_date - timedelta(days=9),
                                submission_date,
                            ),
                        )
                    )
                ).all()
            )
            rates = {row.rate_date: row.buying_transfer for row in rate_rows}
        recognized = combine_invoice_and_customs(
            invoice_data,
            customs_data,
            rates,
            currency=currency,
        )
        return await self._create_import(
            rows=[recognized],
            import_mode="dual",
            source_names=[invoice_file_name, customs_file_name],
            source_files=[
                (invoice_file_name, invoice_content),
                (customs_file_name, customs_content),
            ],
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
                status = self._review_status(row, len(item_rows))
                if status == "needs_review":
                    needs_review_count += 1
                # _assert_importable 已经把带编号的行整批拦下了，这里只是把键摘掉
                # 免得落进 TaxInvoice(**row)。导入永远产出未批准记录，编号统一由
                # approve() 里的 assign_tax_invoice_number 发。
                row.pop("document_no", None)
                invoice = TaxInvoice(
                    **row,
                    batch_id=batch.id,
                    status=status,
                    source_invoice_file_name=source_names[0],
                    source_customs_file_name=(
                        source_names[1] if len(source_names) > 1 else None
                    ),
                    created_by_name=self.actor_name,
                    updated_by_name=self.actor_name,
                )
                self.session.add(invoice)
                await self.session.flush()
                for item in item_rows:
                    self.session.add(TaxInvoiceItem(invoice_id=invoice.id, **item))
                self.session.add(
                    self._event(
                        invoice,
                        "imported",
                        None,
                        invoice.status,
                        " | ".join(source_names),
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
    ) -> list[ExchangeRate]:
        filters = [ExchangeRate.currency == currency.upper()]
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

    async def list_rate_currencies(self) -> list[str]:
        return list(
            (
                await self.session.scalars(
                    select(ExchangeRate.currency)
                    .distinct()
                    .order_by(ExchangeRate.currency)
                )
            ).all()
        )

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
            statement = statement.on_conflict_do_update(
                constraint="uq_core_exchange_rates_currency_date",
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
