from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from anyio import to_thread
from openpyxl import Workbook
from pypdf import PdfReader, PdfWriter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import SessionFactory
from app.core.models import SignatureAsset
from app.core.signature_usage import signature_allows
from app.modules.salary_advance.document_generator import (
    GenerationSnapshot,
    SalaryAdvanceDocumentError,
    document_file_stem,
    export_pdf_from_template,
    render_salary_advance_workbook,
)
from app.modules.salary_advance.models import (
    SalaryAdvanceEvent,
    SalaryAdvanceGeneratedDocument,
    SalaryAdvanceGenerationJob,
    SalaryAdvanceImportBatch,
    SalaryAdvanceRecord,
    SalaryAdvanceTemplate,
)
from app.modules.salary_advance.service import (
    SalaryAdvanceNotFoundError,
    SalaryAdvanceService,
    SalaryAdvanceStateError,
)


@dataclass(frozen=True)
class JobAggregate:
    job: SalaryAdvanceGenerationJob
    documents: list[SalaryAdvanceGeneratedDocument]


@dataclass(frozen=True)
class ResolvedSignature:
    asset: SignatureAsset
    path: Path

    def version_snapshot(self) -> dict[str, str | int]:
        return {
            "assetId": str(self.asset.id),
            "assetName": self.asset.name,
            "assetVersion": self.asset.version,
            "assetSha256": self.asset.sha256,
        }


class SalaryAdvanceDocumentService:
    def __init__(
        self,
        session: AsyncSession,
        actor_name: str,
        settings: Settings,
    ) -> None:
        self.session = session
        self.actor_name = actor_name
        self.settings = settings

    async def create_job(
        self,
        batch_id: uuid.UUID,
        *,
        retry_job_id: uuid.UUID | None = None,
    ) -> SalaryAdvanceGenerationJob:
        batch = await self.session.scalar(
            select(SalaryAdvanceImportBatch)
            .where(SalaryAdvanceImportBatch.id == batch_id)
            .with_for_update()
        )
        if batch is None:
            raise SalaryAdvanceNotFoundError("工资预支批次不存在")
        allowed_statuses = (
            {"partially_completed", "failed"}
            if retry_job_id is not None
            else {"locked"}
        )
        if batch.status not in allowed_statuses:
            raise SalaryAdvanceStateError(
                "批次必须先锁定才能生成"
                if retry_job_id is None
                else "只有部分完成或失败的批次可以重试"
            )

        target_ids: list[uuid.UUID]
        if retry_job_id is None:
            target_ids = list(
                (
                    await self.session.scalars(
                        select(SalaryAdvanceRecord.id).where(
                            SalaryAdvanceRecord.batch_id == batch.id,
                            SalaryAdvanceRecord.validation_status != "invalid",
                        )
                    )
                ).all()
            )
        else:
            source_job = await self.session.scalar(
                select(SalaryAdvanceGenerationJob).where(
                    SalaryAdvanceGenerationJob.id == retry_job_id,
                    SalaryAdvanceGenerationJob.batch_id == batch.id,
                )
            )
            if source_job is None:
                raise SalaryAdvanceNotFoundError("原生成任务不存在")
            # 只挑当前仍是 failed 的记录：某记录在更晚的重试里已成功的话，
            # 它还留在旧任务的失败文档清单里，不能再被拉回来重复生成。
            failed_document_ids = select(
                SalaryAdvanceGeneratedDocument.record_id
            ).where(
                SalaryAdvanceGeneratedDocument.job_id == source_job.id,
                SalaryAdvanceGeneratedDocument.status == "failed",
            )
            target_ids = list(
                (
                    await self.session.scalars(
                        select(SalaryAdvanceRecord.id).where(
                            SalaryAdvanceRecord.id.in_(failed_document_ids),
                            SalaryAdvanceRecord.generation_status == "failed",
                        )
                    )
                ).all()
            )

        if not target_ids:
            raise SalaryAdvanceStateError("没有可生成或可重试的记录")
        template = await SalaryAdvanceService(
            self.session,
            self.actor_name,
            self.settings,
        ).ensure_template_seed()
        job_id = uuid.uuid4()
        job = SalaryAdvanceGenerationJob(
            id=job_id,
            batch_id=batch.id,
            template_id=template.id,
            status="queued",
            total_count=len(target_ids),
            success_count=0,
            failed_count=0,
            requested_by_name=self.actor_name,
        )
        self.session.add(job)
        records = list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceRecord)
                    .where(SalaryAdvanceRecord.id.in_(target_ids))
                    .with_for_update()
                )
            ).all()
        )
        for record in records:
            record.generation_status = "pending"
        batch.status = "generating"
        self.session.add(
            SalaryAdvanceEvent(
                object_type="job",
                object_id=str(job_id),
                event_type="queued" if retry_job_id is None else "retry_queued",
                actor_name=self.actor_name,
                after_data={
                    "batchId": str(batch.id),
                    "recordIds": [str(item) for item in target_ids],
                    "sourceJobId": str(retry_job_id) if retry_job_id else None,
                },
            )
        )
        await self.session.commit()
        await self.session.refresh(job)
        return job

    async def retry_failed(
        self,
        source_job_id: uuid.UUID,
    ) -> SalaryAdvanceGenerationJob:
        source = await self.session.scalar(
            select(SalaryAdvanceGenerationJob).where(
                SalaryAdvanceGenerationJob.id == source_job_id
            )
        )
        if source is None:
            raise SalaryAdvanceNotFoundError("生成任务不存在")
        return await self.create_job(source.batch_id, retry_job_id=source.id)

    async def get_job(self, job_id: uuid.UUID) -> JobAggregate:
        job = await self.session.scalar(
            select(SalaryAdvanceGenerationJob).where(
                SalaryAdvanceGenerationJob.id == job_id
            )
        )
        if job is None:
            raise SalaryAdvanceNotFoundError("生成任务不存在")
        documents = list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceGeneratedDocument)
                    .where(SalaryAdvanceGeneratedDocument.job_id == job.id)
                    .order_by(SalaryAdvanceGeneratedDocument.created_at)
                )
            ).all()
        )
        return JobAggregate(job=job, documents=documents)

    async def list_jobs(
        self,
        batch_id: uuid.UUID,
    ) -> list[SalaryAdvanceGenerationJob]:
        batch_exists = await self.session.scalar(
            select(SalaryAdvanceImportBatch.id).where(
                SalaryAdvanceImportBatch.id == batch_id
            )
        )
        if batch_exists is None:
            raise SalaryAdvanceNotFoundError("工资预支批次不存在")
        return list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceGenerationJob)
                    .where(SalaryAdvanceGenerationJob.batch_id == batch_id)
                    .order_by(
                        SalaryAdvanceGenerationJob.started_at.desc().nullsfirst()
                    )
                )
            ).all()
        )

    async def preview_record(self, record_id: uuid.UUID) -> tuple[str, bytes]:
        record = await self.session.scalar(
            select(SalaryAdvanceRecord).where(SalaryAdvanceRecord.id == record_id)
        )
        if record is None:
            raise SalaryAdvanceNotFoundError("工资预支记录不存在")
        if record.validation_status == "invalid":
            raise SalaryAdvanceStateError("记录校验未通过，不能预览")
        snapshot = await self._snapshot(record)
        temp_root = self._storage_path(
            (Path("salary-advance") / "temp" / str(uuid.uuid4())).as_posix()
        )
        temp_root.mkdir(parents=True, exist_ok=False)
        output_path = temp_root / f"{document_file_stem(1, record.normalized_data)}.pdf"
        try:
            await to_thread.run_sync(
                lambda: export_pdf_from_template(
                    self.settings.salary_advance_pdf_template_path,
                    output_path,
                    snapshot,
                    self.settings.thai_font_path,
                    xlsx_template_path=self.settings.salary_advance_template_path,
                )
            )
            return output_path.name, await to_thread.run_sync(output_path.read_bytes)
        except SalaryAdvanceDocumentError as exc:
            raise SalaryAdvanceStateError(str(exc)) from exc
        finally:
            await to_thread.run_sync(shutil.rmtree, temp_root, True)

    async def document_content(
        self,
        document_id: uuid.UUID,
        file_format: str,
    ) -> tuple[str, Path]:
        document = await self.session.scalar(
            select(SalaryAdvanceGeneratedDocument).where(
                SalaryAdvanceGeneratedDocument.id == document_id
            )
        )
        if document is None:
            raise SalaryAdvanceNotFoundError("生成文件不存在")
        if document.status != "success":
            raise SalaryAdvanceStateError("失败记录没有可下载文件")
        if file_format == "xlsx":
            file_name, storage_key = (
                document.xlsx_file_name,
                document.xlsx_storage_key,
            )
        elif file_format == "pdf":
            file_name, storage_key = document.pdf_file_name, document.pdf_storage_key
        else:
            raise SalaryAdvanceStateError("文件格式只能是 xlsx 或 pdf")
        if not file_name or not storage_key:
            raise SalaryAdvanceNotFoundError("请求的生成文件不存在")
        path = self._storage_path(storage_key)
        if not path.is_file():
            raise SalaryAdvanceNotFoundError("生成文件已丢失")
        return file_name, path

    async def job_zip(self, job_id: uuid.UUID) -> tuple[str, bytes]:
        aggregate = await self.get_job(job_id)
        buffer = BytesIO()
        with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
            for document in aggregate.documents:
                if document.status != "success":
                    continue
                for file_name, storage_key in (
                    (document.xlsx_file_name, document.xlsx_storage_key),
                    (document.pdf_file_name, document.pdf_storage_key),
                ):
                    if file_name and storage_key:
                        path = self._storage_path(storage_key)
                        if path.is_file():
                            archive.write(path, arcname=file_name)
            archive.writestr(
                "manifest.json",
                json.dumps(
                    self._manifest(aggregate),
                    ensure_ascii=False,
                    indent=2,
                ),
            )
        return f"salary-advance-{aggregate.job.id}.zip", buffer.getvalue()

    async def merged_pdf(self, job_id: uuid.UUID) -> tuple[str, bytes]:
        aggregate = await self.get_job(job_id)
        writer = PdfWriter()
        for document in aggregate.documents:
            if document.status != "success" or not document.pdf_storage_key:
                continue
            path = self._storage_path(document.pdf_storage_key)
            if path.is_file():
                for page in PdfReader(str(path)).pages:
                    writer.add_page(page)
        if len(writer.pages) == 0:
            raise SalaryAdvanceStateError("任务没有可合并的 PDF")
        buffer = BytesIO()
        writer.write(buffer)
        return f"salary-advance-{aggregate.job.id}-merged.pdf", buffer.getvalue()

    async def manifest(self, job_id: uuid.UUID) -> tuple[str, bytes]:
        aggregate = await self.get_job(job_id)
        content = json.dumps(
            self._manifest(aggregate),
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        return f"salary-advance-{aggregate.job.id}-manifest.json", content

    async def validation_report(
        self,
        batch_id: uuid.UUID,
    ) -> tuple[str, bytes]:
        batch = await self.session.scalar(
            select(SalaryAdvanceImportBatch).where(
                SalaryAdvanceImportBatch.id == batch_id
            )
        )
        if batch is None:
            raise SalaryAdvanceNotFoundError("工资预支批次不存在")
        records = list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceRecord)
                    .where(SalaryAdvanceRecord.batch_id == batch.id)
                    .order_by(SalaryAdvanceRecord.source_row_no)
                )
            ).all()
        )
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "校验报告"
        sheet.append(
            [
                "源行号",
                "期间",
                "工号",
                "状态",
                "错误",
                "警告",
                "数据指纹",
            ]
        )
        for record in records:
            sheet.append(
                [
                    record.source_row_no,
                    record.period,
                    record.emp_id,
                    record.validation_status,
                    self._issue_text(record.validation_errors),
                    self._issue_text(record.validation_warnings),
                    record.data_fingerprint,
                ]
            )
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for column, width in {
            "A": 10,
            "B": 10,
            "C": 16,
            "D": 14,
            "E": 60,
            "F": 60,
            "G": 68,
        }.items():
            sheet.column_dimensions[column].width = width
        buffer = BytesIO()
        workbook.save(buffer)
        workbook.close()
        return f"{batch.batch_no}-validation-report.xlsx", buffer.getvalue()

    async def _snapshot(self, record: SalaryAdvanceRecord) -> GenerationSnapshot:
        finance = await self._resolve_signature(record, "finance")
        managing_director = await self._resolve_signature(record, "md")
        return GenerationSnapshot(
            normalized_data=dict(record.normalized_data),
            finance_signature_path=finance.path,
            md_signature_path=managing_director.path,
            finance_signature_version=finance.version_snapshot(),
            md_signature_version=managing_director.version_snapshot(),
        )

    async def _resolve_signature(
        self,
        record: SalaryAdvanceRecord,
        role: str,
    ) -> ResolvedSignature:
        code_key = "finance_signature_code" if role == "finance" else "md_signature_code"
        code = str(record.normalized_data.get(code_key) or "").strip().upper()
        if not code:
            raise SalaryAdvanceStateError(f"记录缺少 {role} 签名代码")
        # 签名代码 = 共享签名库里的名称；同名重传会自动升版本，
        # 这里取最新的 active 版本，与签名库自身的版本语义一致。
        # 适用范围必须包含 salary_advance——只批给 WHT 的签名不能盖到预支单上。
        candidates = (
            await self.session.scalars(
                select(SignatureAsset)
                .where(
                    func.upper(SignatureAsset.name) == code,
                    SignatureAsset.status == "active",
                )
                .order_by(SignatureAsset.version.desc())
            )
        ).all()
        asset = next(
            (
                candidate
                for candidate in candidates
                if signature_allows(candidate.usage, "salary_advance")
            ),
            None,
        )
        if asset is None:
            detail = (
                "，该签名未勾选「工资预支单」适用范围"
                if candidates
                else ""
            )
            raise SalaryAdvanceStateError(
                f"签名库中没有可用于工资预支的签名 {code}{detail}，"
                "请在系统管理 → 签名库维护"
            )
        path = self._storage_path(asset.storage_key)
        if not path.is_file():
            raise SalaryAdvanceStateError(f"签名资产文件不存在：{code}")
        return ResolvedSignature(asset=asset, path=path)

    def _storage_path(self, storage_key: str) -> Path:
        root = self.settings.attachment_root.resolve()
        path = (root / storage_key).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise SalaryAdvanceStateError("附件路径越过配置根目录") from exc
        return path

    @staticmethod
    def _issue_text(issues: list[dict[str, str]]) -> str:
        return "；".join(
            f"{item.get('field', '')}: {item.get('message', '')}" for item in issues
        )

    @staticmethod
    def _manifest(aggregate: JobAggregate) -> dict[str, object]:
        return {
            "job": {
                "id": str(aggregate.job.id),
                "batchId": str(aggregate.job.batch_id),
                "templateId": str(aggregate.job.template_id),
                "status": aggregate.job.status,
                "totalCount": aggregate.job.total_count,
                "successCount": aggregate.job.success_count,
                "failedCount": aggregate.job.failed_count,
                "requestedByName": aggregate.job.requested_by_name,
                "startedAt": (
                    aggregate.job.started_at.isoformat()
                    if aggregate.job.started_at
                    else None
                ),
                "finishedAt": (
                    aggregate.job.finished_at.isoformat()
                    if aggregate.job.finished_at
                    else None
                ),
            },
            "documents": [
                {
                    "id": str(document.id),
                    "recordId": str(document.record_id),
                    "generationVersion": document.generation_version,
                    "status": document.status,
                    "xlsxFileName": document.xlsx_file_name,
                    "xlsxSha256": document.xlsx_sha256,
                    "pdfFileName": document.pdf_file_name,
                    "pdfSha256": document.pdf_sha256,
                    "templateSha256": document.template_sha256,
                    "pdfUnderlaySha256": document.pdf_underlay_sha256,
                    "pdfLayoutVersion": document.pdf_layout_version,
                    "signatureVersions": document.signature_versions,
                    "dataFingerprint": document.data_fingerprint,
                    "errorCode": document.error_code,
                    "errorMessage": document.error_message,
                }
                for document in aggregate.documents
            ],
        }


async def run_salary_advance_job(job_id: uuid.UUID) -> None:
    settings = get_settings()
    async with SessionFactory() as session:
        job = await session.scalar(
            select(SalaryAdvanceGenerationJob)
            .where(SalaryAdvanceGenerationJob.id == job_id)
            .with_for_update(skip_locked=True)
        )
        if job is None or job.status != "queued":
            return
        batch = await session.scalar(
            select(SalaryAdvanceImportBatch)
            .where(SalaryAdvanceImportBatch.id == job.batch_id)
            .with_for_update()
        )
        template = await session.scalar(
            select(SalaryAdvanceTemplate).where(
                SalaryAdvanceTemplate.id == job.template_id
            )
        )
        if batch is None or template is None:
            job.status = "failed"
            job.error_summary = "批次或模板已不存在"
            job.finished_at = datetime.now(UTC)
            await session.commit()
            return

        # create_job 已把本任务的目标记录精确重置为 pending，这里只认 pending。
        # 不能再联历史任务的失败文档来兜底：已在后续任务成功的记录仍留在旧任务的
        # 失败清单里，按那个口径会被重复生成。
        if batch.status == "generating":
            records = list(
                (
                    await session.scalars(
                        select(SalaryAdvanceRecord)
                        .where(
                            SalaryAdvanceRecord.batch_id == batch.id,
                            SalaryAdvanceRecord.validation_status != "invalid",
                            SalaryAdvanceRecord.generation_status == "pending",
                        )
                        .order_by(SalaryAdvanceRecord.source_row_no)
                    )
                ).all()
            )
        else:
            records = []
        job.status = "generating"
        job.started_at = datetime.now(UTC)
        for record in records:
            record.generation_status = "generating"
        await session.commit()

        service = SalaryAdvanceDocumentService(
            session,
            job.requested_by_name,
            settings,
        )
        for sequence, record in enumerate(records, start=1):
            version = (
                await session.scalar(
                    select(
                        func.coalesce(
                            func.max(
                                SalaryAdvanceGeneratedDocument.generation_version
                            ),
                            0,
                        )
                    ).where(SalaryAdvanceGeneratedDocument.record_id == record.id)
                )
                or 0
            ) + 1
            relative_root = (
                Path("salary-advance")
                / "generated"
                / record.period
                / str(job.id)
                / str(record.id)
            )
            output_root = service._storage_path(relative_root.as_posix())
            output_root.mkdir(parents=True, exist_ok=False)
            stem = document_file_stem(sequence, record.normalized_data)
            xlsx_path = output_root / f"{stem}.xlsx"
            pdf_path = output_root / f"{stem}.pdf"
            try:
                snapshot = await service._snapshot(record)
                workbook_content = await to_thread.run_sync(
                    render_salary_advance_workbook,
                    settings.salary_advance_template_path,
                    snapshot,
                )
                await to_thread.run_sync(xlsx_path.write_bytes, workbook_content)
                await to_thread.run_sync(
                    partial(
                        export_pdf_from_template,
                        settings.salary_advance_pdf_template_path,
                        pdf_path,
                        snapshot,
                        settings.thai_font_path,
                        xlsx_template_path=settings.salary_advance_template_path,
                    )
                )
                document = SalaryAdvanceGeneratedDocument(
                    job_id=job.id,
                    record_id=record.id,
                    generation_version=version,
                    xlsx_file_name=xlsx_path.name,
                    xlsx_storage_key=xlsx_path.relative_to(
                        settings.attachment_root.resolve()
                    ).as_posix(),
                    pdf_file_name=pdf_path.name,
                    pdf_storage_key=pdf_path.relative_to(
                        settings.attachment_root.resolve()
                    ).as_posix(),
                    xlsx_sha256=hashlib.sha256(workbook_content).hexdigest(),
                    pdf_sha256=hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
                    template_sha256=template.sha256,
                    pdf_underlay_sha256=template.pdf_underlay_sha256,
                    pdf_layout_version=template.pdf_layout_version,
                    signature_versions={
                        "finance": snapshot.finance_signature_version,
                        "md": snapshot.md_signature_version,
                    },
                    data_fingerprint=record.data_fingerprint,
                    status="success",
                    created_by_name=job.requested_by_name,
                )
                record.generation_status = "success"
                job.success_count += 1
            except Exception as exc:
                await to_thread.run_sync(shutil.rmtree, output_root, True)
                document = SalaryAdvanceGeneratedDocument(
                    job_id=job.id,
                    record_id=record.id,
                    generation_version=version,
                    template_sha256=template.sha256,
                    pdf_underlay_sha256=template.pdf_underlay_sha256,
                    pdf_layout_version=template.pdf_layout_version,
                    signature_versions={},
                    data_fingerprint=record.data_fingerprint,
                    status="failed",
                    error_code=type(exc).__name__[:80],
                    error_message=str(exc)[:4000],
                    created_by_name=job.requested_by_name,
                )
                record.generation_status = "failed"
                job.failed_count += 1
            session.add(document)
            await session.commit()

        job.finished_at = datetime.now(UTC)
        if job.success_count == job.total_count:
            job.status = "completed"
        elif job.success_count:
            job.status = "partially_completed"
        else:
            job.status = "failed"
        job.error_summary = (
            f"{job.failed_count} 条记录生成失败" if job.failed_count else None
        )
        failed_records = (
            await session.scalar(
                select(func.count())
                .select_from(SalaryAdvanceRecord)
                .where(
                    SalaryAdvanceRecord.batch_id == batch.id,
                    SalaryAdvanceRecord.generation_status == "failed",
                )
            )
            or 0
        )
        pending_records = (
            await session.scalar(
                select(func.count())
                .select_from(SalaryAdvanceRecord)
                .where(
                    SalaryAdvanceRecord.batch_id == batch.id,
                    SalaryAdvanceRecord.generation_status.in_(
                        {"pending", "generating"}
                    ),
                )
            )
            or 0
        )
        if failed_records:
            batch.status = "partially_completed" if job.success_count else "failed"
        elif pending_records:
            batch.status = "partially_completed"
        else:
            batch.status = "completed"
        session.add(
            SalaryAdvanceEvent(
                object_type="job",
                object_id=str(job.id),
                event_type=job.status,
                actor_name=job.requested_by_name,
                after_data={
                    "successCount": job.success_count,
                    "failedCount": job.failed_count,
                },
            )
        )
        await session.commit()
