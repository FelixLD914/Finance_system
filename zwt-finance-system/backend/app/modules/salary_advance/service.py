from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from anyio import to_thread
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ServiceError
from app.core.models import SignatureAsset
from app.modules.salary_advance import pdf_layout
from app.modules.salary_advance.document_generator import CURRENT_RECORD_FIELDS
from app.modules.salary_advance.importer import (
    SalaryAdvanceImportError,
    parse_salary_advance_workbook,
)
from app.modules.salary_advance.models import (
    SalaryAdvanceEvent,
    SalaryAdvanceImportBatch,
    SalaryAdvanceRecord,
    SalaryAdvanceTemplate,
)
from app.modules.salary_advance.schemas import SalaryAdvanceRecordUpdate
from app.modules.salary_advance.validation import (
    data_fingerprint,
    validate_and_normalize_record,
)


class SalaryAdvanceServiceError(ServiceError):
    pass


class SalaryAdvanceNotFoundError(SalaryAdvanceServiceError):
    status_code = 404


class SalaryAdvanceConflictError(SalaryAdvanceServiceError):
    status_code = 409


class SalaryAdvanceStateError(SalaryAdvanceServiceError):
    status_code = 422


@dataclass(frozen=True)
class BatchAggregate:
    batch: SalaryAdvanceImportBatch
    records: list[SalaryAdvanceRecord]


class SalaryAdvanceService:
    def __init__(
        self,
        session: AsyncSession,
        actor_name: str,
        settings: Settings,
    ) -> None:
        self.session = session
        self.actor_name = actor_name
        self.settings = settings

    async def list_batches(
        self,
        *,
        period: str | None = None,
        status: str | None = None,
    ) -> list[SalaryAdvanceImportBatch]:
        filters = []
        if period:
            filters.append(SalaryAdvanceImportBatch.period == period)
        if status:
            filters.append(SalaryAdvanceImportBatch.status == status)
        return list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceImportBatch)
                    .where(*filters)
                    .order_by(SalaryAdvanceImportBatch.created_at.desc())
                )
            ).all()
        )

    async def get_batch(self, batch_id: uuid.UUID) -> BatchAggregate:
        batch = await self._load_batch(batch_id)
        records = list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceRecord)
                    .where(SalaryAdvanceRecord.batch_id == batch.id)
                    .order_by(SalaryAdvanceRecord.source_row_no)
                )
            ).all()
        )
        return BatchAggregate(batch=batch, records=records)

    async def get_record(self, record_id: uuid.UUID) -> SalaryAdvanceRecord:
        return await self._load_record(record_id)

    async def import_batch(
        self,
        *,
        content: bytes,
        file_name: str,
        period: str,
    ) -> BatchAggregate:
        if not file_name.lower().endswith(".xlsx"):
            raise SalaryAdvanceStateError("只接受 .xlsx 文件")
        if len(content) > self.settings.max_file_mib * 1024 * 1024:
            raise SalaryAdvanceStateError(
                f"文件不能超过 {self.settings.max_file_mib} MiB"
            )
        source_hash = hashlib.sha256(content).hexdigest()
        existing = await self.session.scalar(
            select(SalaryAdvanceImportBatch).where(
                SalaryAdvanceImportBatch.period == period,
                SalaryAdvanceImportBatch.source_sha256 == source_hash,
            )
        )
        if existing is not None:
            return await self.get_batch(existing.id)

        signature_codes = await self.active_signature_codes()
        existing_rows = (
            await self.session.execute(
                select(SalaryAdvanceRecord.period, SalaryAdvanceRecord.emp_id).where(
                    SalaryAdvanceRecord.period == period,
                    SalaryAdvanceRecord.validation_status != "invalid",
                )
            )
        ).all()
        try:
            parsed = await to_thread.run_sync(
                lambda: parse_salary_advance_workbook(
                    content,
                    period=period,
                    active_signature_codes=signature_codes,
                    existing_keys=set(existing_rows),
                )
            )
        except SalaryAdvanceImportError as exc:
            raise SalaryAdvanceStateError(str(exc)) from exc

        batch_id = uuid.uuid4()
        relative = (
            Path("salary-advance")
            / "source"
            / str(batch_id)
            / self._safe_file_name(file_name)
        )
        source_path = self._storage_path(relative.as_posix())
        source_path.parent.mkdir(parents=True, exist_ok=False)
        await to_thread.run_sync(source_path.write_bytes, content)

        batch = SalaryAdvanceImportBatch(
            id=batch_id,
            batch_no=f"SA-{datetime.now(UTC):%Y%m%d%H%M%S}-{source_hash[:8].upper()}",
            period=period,
            source_file_name=file_name,
            source_storage_key=relative.as_posix(),
            source_sha256=source_hash,
            status="validation_failed" if parsed.invalid_rows else "ready",
            total_rows=len(parsed.records),
            valid_rows=parsed.valid_rows,
            warning_rows=parsed.warning_rows,
            invalid_rows=parsed.invalid_rows,
            created_by_name=self.actor_name,
        )
        self.session.add(batch)
        records = [
            SalaryAdvanceRecord(
                batch_id=batch.id,
                source_row_no=item.source_row_no,
                period=item.period,
                emp_id=item.emp_id,
                raw_data=item.raw_data,
                normalized_data=item.normalized_data,
                data_fingerprint=item.data_fingerprint,
                validation_status=item.validation_status,
                validation_errors=item.validation_errors,
                validation_warnings=item.validation_warnings,
                generation_status="pending",
                created_by_name=self.actor_name,
                updated_by_name=self.actor_name,
            )
            for item in parsed.records
        ]
        self.session.add_all(records)
        self.session.add(
            self._event(
                "batch",
                batch.id,
                "imported",
                after_data={
                    "period": period,
                    "sourceSha256": source_hash,
                    "totalRows": len(records),
                    "invalidRows": parsed.invalid_rows,
                },
            )
        )
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            source_path.unlink(missing_ok=True)
            source_path.parent.rmdir()
            raise
        await self.session.refresh(batch)
        for record in records:
            await self.session.refresh(record)
        return BatchAggregate(batch=batch, records=records)

    async def update_record(
        self,
        record_id: uuid.UUID,
        payload: SalaryAdvanceRecordUpdate,
    ) -> SalaryAdvanceRecord:
        record = await self._load_record(record_id, for_update=True)
        batch = await self._load_batch(record.batch_id, for_update=True)
        if batch.status not in {"ready", "validation_failed"}:
            raise SalaryAdvanceStateError("锁定或生成中的批次不能编辑")
        if record.version != payload.version:
            raise SalaryAdvanceConflictError("记录已被其他人修改，请刷新后重试")

        before = dict(record.normalized_data)
        raw = {**record.raw_data, **payload.values}
        status, errors, warnings, normalized = validate_and_normalize_record(
            raw,
            batch_period=batch.period,
            active_signature_codes=await self.active_signature_codes(),
        )
        duplicate = await self.session.scalar(
            select(SalaryAdvanceRecord.id).where(
                SalaryAdvanceRecord.id != record.id,
                SalaryAdvanceRecord.period == normalized.get("period"),
                SalaryAdvanceRecord.emp_id == normalized.get("emp_id"),
                SalaryAdvanceRecord.validation_status != "invalid",
            )
        )
        if duplicate is not None:
            status = "invalid"
            errors.append(
                {
                    "field": "emp_id",
                    "code": "DUPLICATE_PERIOD_EMPLOYEE",
                    "message": "系统中已存在相同期间和工号的有效记录",
                }
            )

        record.raw_data = raw
        record.normalized_data = normalized
        record.period = normalized.get("period") or batch.period
        record.emp_id = normalized.get("emp_id") or ""
        record.data_fingerprint = data_fingerprint(normalized)
        record.validation_status = status
        record.validation_errors = errors
        record.validation_warnings = warnings
        record.generation_status = "pending"
        record.version += 1
        record.updated_by_name = self.actor_name
        await self._recount_batch(batch)
        self.session.add(
            self._event(
                "record",
                record.id,
                "updated",
                before_data=before,
                after_data=normalized,
            )
        )
        await self.session.commit()
        await self.session.refresh(record)
        return record

    async def revalidate_batch(self, batch_id: uuid.UUID) -> BatchAggregate:
        batch = await self._load_batch(batch_id, for_update=True)
        if batch.status not in {"ready", "validation_failed"}:
            raise SalaryAdvanceStateError("只有未锁定批次可以重新校验")
        records = list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceRecord)
                    .where(SalaryAdvanceRecord.batch_id == batch.id)
                    .order_by(SalaryAdvanceRecord.source_row_no)
                    .with_for_update()
                )
            ).all()
        )
        codes = await self.active_signature_codes()
        seen: set[tuple[str, str]] = set()
        for record in records:
            status, errors, warnings, normalized = validate_and_normalize_record(
                record.raw_data,
                batch_period=batch.period,
                active_signature_codes=codes,
            )
            key = (normalized.get("period", ""), normalized.get("emp_id", ""))
            if all(key) and key in seen:
                status = "invalid"
                errors.append(
                    {
                        "field": "emp_id",
                        "code": "DUPLICATE_PERIOD_EMPLOYEE",
                        "message": "同一批次期间+工号重复",
                    }
                )
            seen.add(key)
            record.normalized_data = normalized
            record.period = normalized.get("period") or batch.period
            record.emp_id = normalized.get("emp_id") or ""
            record.data_fingerprint = data_fingerprint(normalized)
            record.validation_status = status
            record.validation_errors = errors
            record.validation_warnings = warnings
            record.version += 1
            record.updated_by_name = self.actor_name
        await self._recount_batch(batch)
        self.session.add(self._event("batch", batch.id, "revalidated"))
        await self.session.commit()
        await self.session.refresh(batch)
        return BatchAggregate(batch=batch, records=records)

    async def lock_batch(
        self,
        batch_id: uuid.UUID,
        note: str | None,
    ) -> SalaryAdvanceImportBatch:
        batch = await self._load_batch(batch_id, for_update=True)
        await self._recount_batch(batch)
        if batch.invalid_rows:
            raise SalaryAdvanceStateError("批次仍有校验错误，不能锁定")
        if batch.status != "ready":
            raise SalaryAdvanceStateError("只有就绪批次可以锁定")
        batch.status = "locked"
        batch.locked_by_name = self.actor_name
        batch.locked_at = datetime.now(UTC)
        self.session.add(self._event("batch", batch.id, "locked", note=note))
        await self.session.commit()
        await self.session.refresh(batch)
        return batch

    async def ensure_template_seed(self) -> SalaryAdvanceTemplate:
        xlsx = self.settings.salary_advance_template_path
        pdf = self.settings.salary_advance_pdf_template_path
        if not xlsx.is_file() or not pdf.is_file():
            raise SalaryAdvanceStateError("工资预支模板资产不完整")
        xlsx_hash = hashlib.sha256(xlsx.read_bytes()).hexdigest()
        pdf_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if xlsx_hash != pdf_layout.SOURCE_XLSX_SHA256:
            raise SalaryAdvanceStateError("工资预支 Excel 模板与坐标表哈希不匹配")
        if pdf_hash != pdf_layout.PDF_UNDERLAY_SHA256:
            raise SalaryAdvanceStateError("工资预支 PDF 底版与坐标表哈希不匹配")

        existing = await self.session.scalar(
            select(SalaryAdvanceTemplate).where(
                SalaryAdvanceTemplate.sha256 == xlsx_hash,
                SalaryAdvanceTemplate.pdf_underlay_sha256 == pdf_hash,
                SalaryAdvanceTemplate.pdf_layout_version == pdf_layout.LAYOUT_VERSION,
            )
        )
        if existing is not None:
            return existing

        active_templates = list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceTemplate).where(
                        SalaryAdvanceTemplate.template_code == "SALARY_ADVANCE",
                        SalaryAdvanceTemplate.active.is_(True),
                    )
                )
            ).all()
        )
        for item in active_templates:
            item.active = False
        template_count = (
            await self.session.scalar(
                select(func.count())
                .select_from(SalaryAdvanceTemplate)
                .where(
                    SalaryAdvanceTemplate.template_code == "SALARY_ADVANCE"
                )
            )
            or 0
        )
        template = SalaryAdvanceTemplate(
            version=f"1.0.{template_count}",
            file_name=xlsx.name,
            storage_key=f"app-assets://templates/{xlsx.name}",
            sha256=xlsx_hash,
            pdf_underlay_storage_key=f"app-assets://templates/{pdf.name}",
            pdf_underlay_sha256=pdf_hash,
            pdf_layout_version=pdf_layout.LAYOUT_VERSION,
            mapping_json={
                field: f"当前记录!B{row}"
                for row, field in enumerate(CURRENT_RECORD_FIELDS, start=2)
            },
            signature_anchors_json={
                key: list(value) for key, value in pdf_layout.SIGNATURE_BOXES.items()
            },
            visible_sheet="表单模板",
            active=True,
            created_by_name=self.actor_name,
        )
        self.session.add(template)
        await self.session.commit()
        await self.session.refresh(template)
        return template

    async def list_templates(self) -> list[SalaryAdvanceTemplate]:
        await self.ensure_template_seed()
        return list(
            (
                await self.session.scalars(
                    select(SalaryAdvanceTemplate).order_by(
                        SalaryAdvanceTemplate.created_at.desc()
                    )
                )
            ).all()
        )

    async def active_signature_codes(self) -> set[str]:
        # 签名代码就是共享签名库（core.signature_assets）里的名称。
        # 维护入口统一在系统管理 → 签名库，本模块只做只读解析。
        return {
            str(name).strip().upper()
            for name in (
                await self.session.scalars(
                    select(SignatureAsset.name).where(
                        SignatureAsset.status == "active"
                    )
                )
            ).all()
        }

    async def delete_batch(self, batch_id: uuid.UUID) -> None:
        batch = await self._load_batch(batch_id, for_update=True)
        # 已锁定/已生成的批次有正式凭证在引用，不允许删；
        # 未锁定的坏批次必须能删，否则同期间+工号的查重会永远挡住修正后的重新导入。
        if batch.status not in {"validating", "validation_failed", "ready"}:
            raise SalaryAdvanceStateError("只有未锁定的批次可以删除")
        await self.session.execute(
            delete(SalaryAdvanceRecord).where(
                SalaryAdvanceRecord.batch_id == batch.id
            )
        )
        self.session.add(
            self._event(
                "batch",
                batch.id,
                "deleted",
                before_data={
                    "batchNo": batch.batch_no,
                    "period": batch.period,
                    "sourceSha256": batch.source_sha256,
                    "totalRows": batch.total_rows,
                },
            )
        )
        # 源文件留在磁盘上作导入痕迹，事件里记了 sha256 可对回去。
        await self.session.delete(batch)
        await self.session.commit()

    async def _recount_batch(self, batch: SalaryAdvanceImportBatch) -> None:
        rows = (
            await self.session.execute(
                select(SalaryAdvanceRecord.validation_status, func.count())
                .where(SalaryAdvanceRecord.batch_id == batch.id)
                .group_by(SalaryAdvanceRecord.validation_status)
            )
        ).all()
        counts = {status: int(count) for status, count in rows}
        batch.total_rows = sum(counts.values())
        batch.valid_rows = counts.get("valid", 0)
        batch.warning_rows = counts.get("warning", 0)
        batch.invalid_rows = counts.get("invalid", 0)
        batch.status = "validation_failed" if batch.invalid_rows else "ready"

    async def _load_batch(
        self,
        batch_id: uuid.UUID,
        *,
        for_update: bool = False,
    ) -> SalaryAdvanceImportBatch:
        statement = select(SalaryAdvanceImportBatch).where(
            SalaryAdvanceImportBatch.id == batch_id
        )
        if for_update:
            statement = statement.with_for_update()
        batch = await self.session.scalar(statement)
        if batch is None:
            raise SalaryAdvanceNotFoundError("工资预支批次不存在")
        return batch

    async def _load_record(
        self,
        record_id: uuid.UUID,
        *,
        for_update: bool = False,
    ) -> SalaryAdvanceRecord:
        statement = select(SalaryAdvanceRecord).where(
            SalaryAdvanceRecord.id == record_id
        )
        if for_update:
            statement = statement.with_for_update()
        record = await self.session.scalar(statement)
        if record is None:
            raise SalaryAdvanceNotFoundError("工资预支记录不存在")
        return record

    def _event(
        self,
        object_type: str,
        object_id: uuid.UUID,
        event_type: str,
        *,
        before_data: dict[str, Any] | None = None,
        after_data: dict[str, Any] | None = None,
        note: str | None = None,
    ) -> SalaryAdvanceEvent:
        return SalaryAdvanceEvent(
            object_type=object_type,
            object_id=str(object_id),
            event_type=event_type,
            actor_name=self.actor_name,
            before_data=before_data,
            after_data=after_data,
            note=note,
        )

    def _storage_path(self, storage_key: str) -> Path:
        root = self.settings.attachment_root.resolve()
        path = (root / storage_key).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise SalaryAdvanceStateError("附件路径越过配置根目录") from exc
        return path

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        name = Path(file_name).name
        return "".join(
            char for char in name if char not in '\\/:*?"<>|'
        )[:240] or "upload.xlsx"
