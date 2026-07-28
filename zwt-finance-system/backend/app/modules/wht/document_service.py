from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path

from anyio import to_thread
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import SignatureAsset
from app.core.signature_usage import (
    format_signature_usage,
    signature_allows,
    signature_usages_overlap,
)
from app.modules.wht.document_generator import (
    DocumentGenerationError,
    document_file_stem,
    export_pdf_from_template,
    render_wht_workbook,
    signature_path,
    validate_signature_image,
)
from app.modules.wht.models import WhtDocument, WhtTask, WhtTaskEvent
from app.modules.wht.schemas import DocumentGenerateRequest, SignatureAssetUpdate
from app.modules.wht.service import WhtNotFoundError, WhtStateError


class WhtDocumentService:
    def __init__(self, session: AsyncSession, actor_name: str) -> None:
        self.session = session
        self.actor_name = actor_name
        self.settings = get_settings()

    async def list_signatures(
        self,
        include_inactive: bool,
        usage: str | None = None,
    ) -> list[SignatureAsset]:
        statement = select(SignatureAsset)
        if not include_inactive:
            statement = statement.where(SignatureAsset.status == "active")
        signatures = list(
            (
                await self.session.scalars(
                    statement.order_by(
                        SignatureAsset.is_default.desc(),
                        SignatureAsset.name,
                        SignatureAsset.version.desc(),
                    )
                )
            ).all()
        )
        if usage:
            # 适用范围存成逗号串，成员判定放 Python（见 signature_usage 模块注释）。
            signatures = [
                signature
                for signature in signatures
                if signature_allows(signature.usage, usage)
            ]
        return signatures

    async def create_signature(
        self,
        *,
        name: str,
        original_file_name: str,
        content: bytes,
        make_default: bool,
        usage: str = "wht",
    ) -> SignatureAsset:
        clean_name = name.strip()
        if not clean_name:
            raise WhtStateError("signature name is required")
        try:
            mime_type, suffix = validate_signature_image(content)
        except DocumentGenerationError as exc:
            raise WhtStateError(str(exc)) from exc

        version = (
            await self.session.scalar(
                select(func.coalesce(func.max(SignatureAsset.version), 0)).where(
                    SignatureAsset.name == clean_name
                )
            )
            or 0
        ) + 1
        signature_id = uuid.uuid4()
        storage_key = f"signatures/{signature_id}{suffix}"
        stored_path = signature_path(self.settings.attachment_root, storage_key)
        stored_path.parent.mkdir(parents=True, exist_ok=True)
        stored_path.write_bytes(content)

        if make_default:
            # 只清掉适用范围有交集的那些默认：各模块的默认签名可以是不同的人，
            # 把全表清成 false 会顺手废掉别的单据的默认。
            await self._clear_defaults_overlapping(usage)
        signature = SignatureAsset(
            id=signature_id,
            usage=usage,
            name=clean_name,
            storage_key=storage_key,
            original_file_name=Path(original_file_name).name[:260],
            sha256=hashlib.sha256(content).hexdigest(),
            mime_type=mime_type,
            version=version,
            status="active",
            is_default=make_default,
            created_by=None,
            created_by_name=self.actor_name,
            updated_by_name=self.actor_name,
        )
        self.session.add(signature)
        try:
            await self.session.commit()
        except Exception:
            # 必须先 rollback：commit 失败后 session 处于不可用状态，
            # FastAPI 依赖收尾时的任何后续语句都会再抛 PendingRollbackError，
            # 把真正的失败原因盖掉。generate_documents 已是这个顺序。
            await self.session.rollback()
            stored_path.unlink(missing_ok=True)
            raise
        await self.session.refresh(signature)
        return signature

    async def update_signature(
        self,
        signature_id: uuid.UUID,
        payload: SignatureAssetUpdate,
    ) -> SignatureAsset:
        signature = await self._load_signature(signature_id, for_update=True)
        if payload.status is not None:
            signature.status = payload.status
            if payload.status == "inactive":
                signature.is_default = False
        if payload.usage is not None:
            signature.usage = format_signature_usage(payload.usage)
        if payload.is_default is True:
            if signature.status != "active":
                raise WhtStateError("an inactive signature cannot be the default")
            await self._clear_defaults_overlapping(
                signature.usage,
                exclude_id=signature.id,
            )
            signature.is_default = True
        elif payload.is_default is False:
            signature.is_default = False
        signature.updated_by_name = self.actor_name
        await self.session.commit()
        await self.session.refresh(signature)
        return signature

    async def signature_content(self, signature_id: uuid.UUID) -> tuple[SignatureAsset, Path]:
        signature = await self._load_signature(signature_id)
        path = signature_path(self.settings.attachment_root, signature.storage_key)
        if not path.is_file():
            raise WhtNotFoundError("signature image file was not found")
        return signature, path

    async def list_documents(self, task_id: uuid.UUID) -> list[WhtDocument]:
        task_exists = await self.session.scalar(select(WhtTask.id).where(WhtTask.id == task_id))
        if task_exists is None:
            raise WhtNotFoundError("WHT task was not found")
        return list(
            (
                await self.session.scalars(
                    select(WhtDocument)
                    .where(WhtDocument.task_id == task_id)
                    .order_by(WhtDocument.created_at.desc(), WhtDocument.file_format)
                )
            ).all()
        )

    async def generate_documents(
        self,
        task_id: uuid.UUID,
        payload: DocumentGenerateRequest,
    ) -> list[WhtDocument]:
        task = await self.session.scalar(
            select(WhtTask).where(WhtTask.id == task_id).with_for_update()
        )
        if task is None:
            raise WhtNotFoundError("WHT task was not found")
        if task.status not in {"approved", "issued"}:
            raise WhtStateError("only approved or issued tasks can generate documents")

        signature: SignatureAsset | None = None
        signature_file: Path | None = None
        if payload.include_signature:
            signature = await self._load_signature(payload.signature_id)
            if signature.status != "active":
                raise WhtStateError("the selected signature is inactive")
            # 适用范围是 tax_inv 的图不能盖在 WHT 凭证上。前端已经按范围过滤，
            # 这里再挡一次：签名决定单据上出现谁的名字，不能只靠界面把关。
            if not signature_allows(signature.usage, "wht"):
                raise WhtStateError(
                    "the selected signature is not approved for WHT certificates"
                )
            signature_file = signature_path(
                self.settings.attachment_root,
                signature.storage_key,
            )
            if not signature_file.is_file():
                raise WhtNotFoundError("signature image file was not found")

        template_path = self.settings.wht_template_path
        if not template_path.is_file():
            raise WhtStateError(f"WHT template was not found: {template_path}")
        template_sha256 = hashlib.sha256(template_path.read_bytes()).hexdigest()
        pdf_template_sha256 = template_sha256
        if "pdf" in payload.formats:
            pdf_template_path = self.settings.wht_pdf_template_path
            if not pdf_template_path.is_file():
                raise WhtStateError(f"WHT PDF template was not found: {pdf_template_path}")
            pdf_template_sha256 = hashlib.sha256(pdf_template_path.read_bytes()).hexdigest()
        try:
            workbook_content = render_wht_workbook(template_path, task)
        except DocumentGenerationError as exc:
            raise WhtStateError(str(exc)) from exc

        stem = document_file_stem(task)
        generation_id = uuid.uuid4()
        relative_root = Path("wht") / "documents" / str(task.id) / str(generation_id)
        output_root = signature_path(self.settings.attachment_root, str(relative_root))
        output_root.mkdir(parents=True, exist_ok=False)
        working_xlsx = output_root / f"{stem}.xlsx"
        working_xlsx.write_bytes(workbook_content)

        created_files: list[Path] = []
        documents: list[WhtDocument] = []
        try:
            if "pdf" in payload.formats:
                pdf_path = output_root / f"{stem}.pdf"
                try:
                    await to_thread.run_sync(
                        export_pdf_from_template,
                        self.settings.wht_pdf_template_path,
                        pdf_path,
                        task,
                        self.settings.thai_font_path,
                        signature_file,
                    )
                except DocumentGenerationError as exc:
                    raise WhtStateError(str(exc)) from exc
                created_files.append(pdf_path)
            if "xlsx" in payload.formats:
                created_files.append(working_xlsx)
            else:
                working_xlsx.unlink()

            for path in created_files:
                file_format = path.suffix.removeprefix(".")
                version = (
                    await self.session.scalar(
                        select(func.coalesce(func.max(WhtDocument.version), 0)).where(
                            WhtDocument.task_id == task.id,
                            WhtDocument.file_format == file_format,
                        )
                    )
                    or 0
                ) + 1
                relative = path.relative_to(self.settings.attachment_root.resolve())
                document = WhtDocument(
                    task_id=task.id,
                    signature_id=signature.id if signature else None,
                    file_format=file_format,
                    version=version,
                    file_name=path.name,
                    storage_key=relative.as_posix(),
                    sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    template_sha256=(
                        pdf_template_sha256 if file_format == "pdf" else template_sha256
                    ),
                    created_by_name=self.actor_name,
                )
                self.session.add(document)
                documents.append(document)

            previous_status = task.status
            if task.status == "approved":
                task.status = "issued"
                task.issued_at = datetime.now(UTC)
                task.version += 1
                task.updated_by_name = self.actor_name
            self.session.add(
                WhtTaskEvent(
                    task_id=task.id,
                    event_type="documents_generated",
                    from_status=previous_status,
                    to_status=task.status,
                    actor_name=self.actor_name,
                    note=", ".join(payload.formats),
                )
            )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            for path in output_root.glob("*"):
                path.unlink(missing_ok=True)
            output_root.rmdir()
            raise

        for document in documents:
            await self.session.refresh(document)
        return documents

    async def document_content(self, document_id: uuid.UUID) -> tuple[WhtDocument, Path]:
        document = await self.session.scalar(
            select(WhtDocument).where(WhtDocument.id == document_id)
        )
        if document is None:
            raise WhtNotFoundError("WHT document was not found")
        path = signature_path(self.settings.attachment_root, document.storage_key)
        if not path.is_file():
            raise WhtNotFoundError("generated document file was not found")
        return document, path

    async def _load_signature(
        self,
        signature_id: uuid.UUID | None,
        *,
        for_update: bool = False,
    ) -> SignatureAsset:
        if signature_id is None:
            raise WhtStateError("signatureId is required")
        statement = select(SignatureAsset).where(SignatureAsset.id == signature_id)
        if for_update:
            statement = statement.with_for_update()
        signature = await self.session.scalar(statement)
        if signature is None:
            raise WhtNotFoundError("signature image was not found")
        return signature

    async def _clear_defaults_overlapping(
        self,
        usage: str,
        *,
        exclude_id: uuid.UUID | None = None,
    ) -> None:
        """把适用范围与 usage 有交集的默认签名取消掉。

        范围是集合，交集判断在 Python 做——签名资产只有几十行，
        而对逗号串做 SQL LIKE 迟早会在加新模块时踩中子串。
        """
        candidates = (
            await self.session.scalars(
                select(SignatureAsset).where(SignatureAsset.is_default.is_(True))
            )
        ).all()
        for candidate in candidates:
            if candidate.id == exclude_id:
                continue
            if signature_usages_overlap(candidate.usage, usage):
                candidate.is_default = False


