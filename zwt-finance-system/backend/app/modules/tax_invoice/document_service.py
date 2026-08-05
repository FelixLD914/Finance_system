from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from anyio import to_thread
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.models import SignatureAsset
from app.core.signature_usage import signature_allows
from app.modules.tax_invoice.document_generator import (
    TaxInvoiceDocumentGenerationError,
    export_pdf_from_template,
    render_tax_invoice_workbook,
    tax_invoice_file_stem,
)
from app.modules.tax_invoice.models import (
    TaxInvoice,
    TaxInvoiceDocument,
    TaxInvoiceEvent,
    TaxInvoiceImportBatch,
    TaxInvoiceItem,
)
from app.modules.tax_invoice.schemas import (
    BatchGenerateDocumentsRequest,
    TaxInvoiceDocumentGenerateRequest,
)
from app.modules.tax_invoice.service import (
    TaxInvoiceNotFoundError,
    TaxInvoiceServiceError,
    TaxInvoiceStateError,
)
from app.modules.wht.document_generator import signature_path


@dataclass(frozen=True)
class BatchGenerateOutcome:
    """批量开具的结果。skipped 里是 (票 id, 票号, 原因)——票号给界面直接显示。"""

    generated_invoice_ids: list[uuid.UUID]
    document_count: int
    skipped: list[tuple[uuid.UUID, str | None, str]]


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
        pdf_template_path = self.settings.tax_invoice_pdf_template_path
        if "xlsx" in payload.formats and not template_path.is_file():
            raise TaxInvoiceStateError(f"TAX INV template was not found: {template_path}")
        if "pdf" in payload.formats and not pdf_template_path.is_file():
            raise TaxInvoiceStateError(
                f"TAX INV PDF template was not found: {pdf_template_path}"
            )
        try:
            stem = tax_invoice_file_stem(invoice)
        except TaxInvoiceDocumentGenerationError as exc:
            raise TaxInvoiceStateError(str(exc)) from exc

        generation_id = uuid.uuid4()
        relative_root = (
            Path("tax_invoice")
            / "documents"
            / str(invoice.id)
            / str(generation_id)
        )
        output_root = self._storage_path(relative_root.as_posix())
        output_root.mkdir(parents=True, exist_ok=False)

        signature, signature_file = await self._resolve_generation_signature(payload)

        template_hashes: dict[str, str] = {}
        created_files: list[Path] = []
        documents: list[TaxInvoiceDocument] = []
        try:
            if "xlsx" in payload.formats:
                content = render_tax_invoice_workbook(template_path, invoice, items)
                xlsx_path = output_root / f"{stem}.xlsx"
                xlsx_path.write_bytes(content)
                template_hashes["xlsx"] = hashlib.sha256(
                    template_path.read_bytes()
                ).hexdigest()
                created_files.append(xlsx_path)
            if "pdf" in payload.formats:
                pdf_path = output_root / f"{stem}.pdf"
                # ReportLab 画三页是纯同步 CPU 活，扔到线程池，别卡住事件循环。
                await to_thread.run_sync(
                    export_pdf_from_template,
                    pdf_template_path,
                    pdf_path,
                    invoice,
                    items,
                    self.settings.thai_font_path,
                    signature_file,
                    signature.scale_percent if signature else 100,
                )
                template_hashes["pdf"] = hashlib.sha256(
                    pdf_template_path.read_bytes()
                ).hexdigest()
                created_files.append(pdf_path)

            for path in created_files:
                file_format = path.suffix.removeprefix(".")
                version = (
                    await self.session.scalar(
                        select(func.coalesce(func.max(TaxInvoiceDocument.version), 0)).where(
                            TaxInvoiceDocument.invoice_id == invoice.id,
                            TaxInvoiceDocument.file_format == file_format,
                        )
                    )
                    or 0
                ) + 1
                document = TaxInvoiceDocument(
                    invoice_id=invoice.id,
                    # 只有 PDF 会盖章；xlsx 走 Excel 模板，不叠图。
                    signature_id=signature.id if signature and file_format == "pdf" else None,
                    file_format=file_format,
                    version=version,
                    file_name=path.name,
                    storage_key=path.relative_to(
                        self.settings.attachment_root.resolve()
                    ).as_posix(),
                    sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    template_sha256=template_hashes[file_format],
                    created_by_name=self.actor_name,
                )
                self.session.add(document)
                documents.append(document)

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
                    note=", ".join(payload.formats),
                )
            )
            await self.session.commit()
        except Exception as exc:
            # 必须先 rollback：commit 失败后 session 不可用，
            # 依赖收尾时的任何语句都会再抛 PendingRollbackError 盖掉真正的原因。
            await self.session.rollback()
            for path in output_root.glob("*"):
                path.unlink(missing_ok=True)
            output_root.rmdir()
            if isinstance(exc, TaxInvoiceDocumentGenerationError):
                raise TaxInvoiceStateError(str(exc)) from exc
            raise

        for document in documents:
            await self.session.refresh(document)
        return documents

    async def _resolve_generation_signature(
        self,
        payload: TaxInvoiceDocumentGenerateRequest,
    ) -> tuple[SignatureAsset | None, Path | None]:
        """定这次开具盖哪张章。

        图库是 WHT 与 TAX INV 共用的，但一张图能盖在哪种单据上由 usage 决定——
        两种单据在旧工具里用的是不同的人。

        单独成一个方法：批量开具要在开跑之前先验一次，不然签名有问题时会得到
        200 条一模一样的 skipped，而不是一句"这张签名不能用"。
        """
        if not payload.include_signature:
            return None, None

        signature: SignatureAsset | None
        if payload.signature_id is None:
            signatures = list(
                (
                    await self.session.scalars(
                        select(SignatureAsset)
                        .where(
                            SignatureAsset.deleted_at.is_(None),
                            SignatureAsset.status == "active",
                        )
                        .order_by(
                            SignatureAsset.is_default.desc(),
                            SignatureAsset.created_at.desc(),
                        )
                    )
                ).all()
            )
            matching = [s for s in signatures if signature_allows(s.usage, "tax_inv")]
            if not matching:
                raise TaxInvoiceStateError(
                    "no active default signature available for tax invoices"
                )
            signature = matching[0]
        else:
            # 必须连 deleted_at 一起过滤：软删除只设 deleted_at 和 is_default=False，
            # **不动 status**（见 WhtDocumentService.delete_signature）。只判 status
            # 的话，回收站里的签名照样能被显式选中盖到正式税票上——而
            # delete_signature 的注释写的是"该模块生成文件时会拿到 404"。
            signature = await self.session.scalar(
                select(SignatureAsset).where(
                    SignatureAsset.id == payload.signature_id,
                    SignatureAsset.deleted_at.is_(None),
                )
            )
            if signature is None:
                raise TaxInvoiceNotFoundError("signature image was not found")
            if signature.status != "active":
                raise TaxInvoiceStateError("the selected signature is inactive")
            if not signature_allows(signature.usage, "tax_inv"):
                raise TaxInvoiceStateError(
                    "the selected signature is not approved for tax invoices"
                )

        signature_file = signature_path(
            self.settings.attachment_root,
            signature.storage_key,
        )
        if not signature_file.is_file():
            raise TaxInvoiceNotFoundError("signature image file was not found")
        return signature, signature_file

    async def generate_documents_for_batch(
        self,
        batch_id: uuid.UUID,
        payload: BatchGenerateDocumentsRequest,
    ) -> BatchGenerateOutcome:
        """按批次批量开具，与 TaxInvoiceService.approve_batch 同构。

        选票范围：invoice_ids 为空＝这批里**已批准但还没开**的全部（不碰已开具的，
        重开会多出一版文件，得由人点名）；给了子集就只开那几张，此时已开具的也
        允许重开——和单张端点语义一致。

        逐张走 generate_documents()：每张各自 commit、各自落盘。出错的那张
        generate_documents 内部会回滚并清掉半成品目录，这里只把原因收进 skipped，
        不因为一张开不出来就把整批挡住——否则 200 张里坏 1 张就得全部重来。
        """
        batch = await self.session.get(TaxInvoiceImportBatch, batch_id)
        if batch is None:
            raise TaxInvoiceNotFoundError("import batch was not found")

        statement = select(TaxInvoice).where(TaxInvoice.batch_id == batch_id)
        if payload.invoice_ids is None:
            statement = statement.where(TaxInvoice.status == "approved")
        else:
            statement = statement.where(
                TaxInvoice.id.in_(payload.invoice_ids),
                TaxInvoice.status.in_(("approved", "issued")),
            )
        targets = list(
            (await self.session.scalars(statement.order_by(TaxInvoice.created_at))).all()
        )
        # 先把 (id, document_no) 抓下来：generate_documents 每张都会 commit，
        # 之后会话里其余对象会被 expire，循环里再读属性就要触发重查。
        refs = [(target.id, target.document_no) for target in targets]

        # 签名先验一次再开跑：签名不可用是整批性的问题，应当直接失败，
        # 而不是让每一张都自己撞一遍、回报 200 条相同的 skipped。
        await self._resolve_generation_signature(payload)

        generated_ids: list[uuid.UUID] = []
        skipped: list[tuple[uuid.UUID, str | None, str]] = []
        document_count = 0
        for invoice_id, document_no in refs:
            try:
                documents = await self.generate_documents(invoice_id, payload)
            except TaxInvoiceServiceError as exc:
                skipped.append((invoice_id, document_no, str(exc)))
                continue
            generated_ids.append(invoice_id)
            document_count += len(documents)
        return BatchGenerateOutcome(
            generated_invoice_ids=generated_ids,
            document_count=document_count,
            skipped=skipped,
        )

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

    async def export_period_zip(
        self,
        *,
        period: str | None = None,
        status: str | None = None,
        include_signature: bool = True,
        signature_id: uuid.UUID | None = None,
    ) -> tuple[bytes, str]:
        """打包导出整期正式文件（ZIP 归档）。

        按报关单/发票（CDN）为一份递增分配序号前缀（`1. `, `2. `），
        同一报关单号对应的 Excel 和 PDF 拥有完全一致的序号前缀。
        """
        import io
        import zipfile

        query_stmt = select(TaxInvoice).order_by(
            TaxInvoice.cdn, TaxInvoice.document_no, TaxInvoice.created_at
        )
        if period and period.strip() and period.lower() != "all":
            query_stmt = query_stmt.where(TaxInvoice.revenue_period == period.replace("-", ""))
        if status:
            query_stmt = query_stmt.where(TaxInvoice.status == status)
        else:
            query_stmt = query_stmt.where(TaxInvoice.status.in_(("approved", "issued")))

        invoices = list((await self.session.scalars(query_stmt)).all())
        if not invoices:
            raise TaxInvoiceNotFoundError("no matching approved/issued invoices found for period export")

        zip_buffer = io.BytesIO()
        seen_names: set[str] = set()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for idx, invoice in enumerate(invoices, start=1):
                docs = await self.list_documents(invoice.id)
                if not docs:
                    docs = await self.generate_documents(
                        invoice.id,
                        TaxInvoiceDocumentGenerateRequest(
                            include_signature=include_signature,
                            signature_id=signature_id,
                            formats=["xlsx", "pdf"],
                        ),
                    )
                for doc in docs:
                    doc_obj, file_path = await self.document_content(doc.id)
                    arcname = f"{idx}. {file_path.name}"
                    if arcname not in seen_names:
                        seen_names.add(arcname)
                        zip_file.writestr(arcname, file_path.read_bytes())

        zip_buffer.seek(0)
        period_label = period.replace("-", "") if period else "ALL"
        filename = f"TAX-INV-Period-{period_label}-Documents.zip"
        return zip_buffer.getvalue(), filename
