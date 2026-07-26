from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.modules.tax_invoice.document_generator import (
    TaxInvoiceDocumentGenerationError,
    render_tax_invoice_workbook,
    tax_invoice_file_stem,
)
from app.modules.tax_invoice.models import (
    TaxInvoice,
    TaxInvoiceDocument,
    TaxInvoiceEvent,
    TaxInvoiceItem,
)
from app.modules.tax_invoice.schemas import TaxInvoiceDocumentGenerateRequest
from app.modules.tax_invoice.service import (
    TaxInvoiceNotFoundError,
    TaxInvoiceStateError,
)


class TaxInvoiceDocumentService:
    def __init__(
        self,
        session: AsyncSession,
        actor_name: str,
        settings: Settings,
    ) -> None:
        self.session = session
        self.actor_name = actor_name
        self.settings = settings

    async def list_documents(
        self,
        invoice_id: uuid.UUID,
    ) -> list[TaxInvoiceDocument]:
        exists = await self.session.scalar(
            select(TaxInvoice.id).where(TaxInvoice.id == invoice_id)
        )
        if exists is None:
            raise TaxInvoiceNotFoundError("TAX INV record was not found")
        return list(
            (
                await self.session.scalars(
                    select(TaxInvoiceDocument)
                    .where(TaxInvoiceDocument.invoice_id == invoice_id)
                    .order_by(
                        TaxInvoiceDocument.created_at.desc(),
                        TaxInvoiceDocument.file_format,
                    )
                )
            ).all()
        )

    async def generate_documents(
        self,
        invoice_id: uuid.UUID,
        payload: TaxInvoiceDocumentGenerateRequest,
    ) -> list[TaxInvoiceDocument]:
        if "pdf" in payload.formats:
            raise TaxInvoiceStateError(
                "TAX INV PDF underlay is not installed yet; generate XLSX only"
            )
        invoice = await self.session.scalar(
            select(TaxInvoice).where(TaxInvoice.id == invoice_id).with_for_update()
        )
        if invoice is None:
            raise TaxInvoiceNotFoundError("TAX INV record was not found")
        if invoice.status not in {"approved", "issued"}:
            raise TaxInvoiceStateError(
                "only approved or issued TAX INV records can generate documents"
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
        template_path = self.settings.tax_invoice_template_path
        try:
            content = render_tax_invoice_workbook(template_path, invoice, items)
            stem = tax_invoice_file_stem(invoice)
        except TaxInvoiceDocumentGenerationError as exc:
            raise TaxInvoiceStateError(str(exc)) from exc
        template_sha256 = hashlib.sha256(template_path.read_bytes()).hexdigest()
        generation_id = uuid.uuid4()
        relative_root = (
            Path("tax_invoice")
            / "documents"
            / str(invoice.id)
            / str(generation_id)
        )
        output_root = self._storage_path(relative_root.as_posix())
        output_root.mkdir(parents=True, exist_ok=False)
        output_path = output_root / f"{stem}.xlsx"
        output_path.write_bytes(content)

        version = (
            await self.session.scalar(
                select(func.coalesce(func.max(TaxInvoiceDocument.version), 0)).where(
                    TaxInvoiceDocument.invoice_id == invoice.id,
                    TaxInvoiceDocument.file_format == "xlsx",
                )
            )
            or 0
        ) + 1
        document = TaxInvoiceDocument(
            invoice_id=invoice.id,
            signature_id=None,
            file_format="xlsx",
            version=version,
            file_name=output_path.name,
            storage_key=output_path.relative_to(
                self.settings.attachment_root.resolve()
            ).as_posix(),
            sha256=hashlib.sha256(content).hexdigest(),
            template_sha256=template_sha256,
            created_by_name=self.actor_name,
        )
        self.session.add(document)
        previous_status = invoice.status
        if invoice.status == "approved":
            invoice.status = "issued"
            invoice.issued_at = datetime.now(UTC)
            invoice.version += 1
            invoice.updated_by_name = self.actor_name
        self.session.add(
            TaxInvoiceEvent(
                invoice_id=invoice.id,
                event_type="documents_generated",
                from_status=previous_status,
                to_status=invoice.status,
                actor_name=self.actor_name,
                note="xlsx",
            )
        )
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            output_path.unlink(missing_ok=True)
            output_root.rmdir()
            raise
        await self.session.refresh(document)
        return [document]

    async def document_content(
        self,
        document_id: uuid.UUID,
    ) -> tuple[TaxInvoiceDocument, Path]:
        document = await self.session.scalar(
            select(TaxInvoiceDocument).where(TaxInvoiceDocument.id == document_id)
        )
        if document is None:
            raise TaxInvoiceNotFoundError("TAX INV document was not found")
        path = self._storage_path(document.storage_key)
        if not path.is_file():
            raise TaxInvoiceNotFoundError("generated TAX INV file was not found")
        return document, path

    def _storage_path(self, storage_key: str) -> Path:
        root = self.settings.attachment_root.resolve()
        path = (root / storage_key).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise TaxInvoiceStateError(
                "attachment path escaped the configured root"
            ) from exc
        return path
