from __future__ import annotations

import asyncio
import hashlib
import re
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
    TaxInvoiceIssueCounter,
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
        return await self._create_import(
            rows=rows,
            import_mode="sample",
            source_names=[file_name],
            source_files=[(file_name, content)],
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
        seen_business_keys: set[tuple[str, str | None]] = set()
        seen_document_numbers: set[str] = set()
        for row in rows:
            business_key = (row["ci_no"], row.get("cdn"))
            if business_key in seen_business_keys:
                raise TaxInvoiceConflictError(
                    f"invoice {business_key[0]} / {business_key[1] or '-'} "
                    "appears more than once in the import"
                )
            seen_business_keys.add(business_key)
            duplicate = await self.session.scalar(
                select(TaxInvoice.id).where(
                    TaxInvoice.ci_no == business_key[0],
                    TaxInvoice.cdn == business_key[1],
                    TaxInvoice.status != "voided",
                )
            )
            if duplicate is not None:
                raise TaxInvoiceConflictError(
                    f"invoice {business_key[0]} / {business_key[1] or '-'} already exists"
                )
            document_no = row.get("document_no")
            if not document_no:
                continue
            if document_no in seen_document_numbers:
                raise TaxInvoiceConflictError(
                    f"document number {document_no} appears more than once in the import"
                )
            seen_document_numbers.add(document_no)
            existing_document = await self.session.scalar(
                select(TaxInvoice.id).where(TaxInvoice.document_no == document_no)
            )
            if existing_document is not None:
                raise TaxInvoiceConflictError(
                    f"document number {document_no} already exists"
                )

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
                status = self._review_status(row, len(item_rows))
                if status == "needs_review":
                    needs_review_count += 1
                document_no = row.pop("document_no", None)
                invoice = TaxInvoice(
                    **row,
                    batch_id=batch.id,
                    document_no=document_no,
                    status="approved" if document_no else status,
                    source_invoice_file_name=source_names[0],
                    source_customs_file_name=(
                        source_names[1] if len(source_names) > 1 else None
                    ),
                    created_by_name=self.actor_name,
                    updated_by_name=self.actor_name,
                    approved_at=datetime.now(UTC) if document_no else None,
                )
                self.session.add(invoice)
                await self.session.flush()
                if document_no:
                    await self._advance_counter_for_existing_number(
                        document_no,
                        invoice.invoice_date,
                    )
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
        missing = [
            name
            for name, value in {
                "invoiceDate": invoice.invoice_date,
                "exchangeTargetDate": invoice.exchange_target_date,
                "exchangeRate": invoice.exchange_rate,
                "customerName": invoice.customer_name,
                "customerAddress": invoice.customer_address,
                "CDN": invoice.cdn,
            }.items()
            if value in (None, "")
        ]
        if not items:
            missing.append("items")
        if len(items) > 18:
            raise TaxInvoiceStateError(
                "this template supports 18 product lines; "
                "split or approve a multi-page design first"
            )
        if missing:
            raise TaxInvoiceStateError(
                f"invoice is incomplete; required fields: {', '.join(missing)}"
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

    async def _advance_counter_for_existing_number(
        self,
        document_no: str,
        invoice_date: date | None,
    ) -> None:
        match = re.fullmatch(r"ZWT-IV(\d{8})-(\d{2,})", document_no)
        if match is None or invoice_date is None:
            return
        if match.group(1) != invoice_date.strftime("%Y%m%d"):
            raise TaxInvoiceStateError(
                f"document number {document_no} does not match its invoice date"
            )
        next_sequence = int(match.group(2)) + 1
        statement = insert(TaxInvoiceIssueCounter).values(
            invoice_date=invoice_date,
            next_sequence=next_sequence,
        )
        await self.session.execute(
            statement.on_conflict_do_update(
                constraint="uq_tax_invoice_issue_counter_date",
                set_={
                    "next_sequence": func.greatest(
                        TaxInvoiceIssueCounter.next_sequence,
                        statement.excluded.next_sequence,
                    ),
                    "updated_at": func.now(),
                },
            )
        )


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
