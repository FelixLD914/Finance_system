from __future__ import annotations

import hashlib
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from typing import Any

from openpyxl import load_workbook

from app.modules.salary_advance.validation import (
    data_fingerprint,
    map_headers,
    validate_and_normalize_record,
)

MAX_ARCHIVE_FILES = 2_000
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024


class SalaryAdvanceImportError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedRecord:
    source_row_no: int
    period: str
    emp_id: str
    raw_data: dict[str, Any]
    normalized_data: dict[str, Any]
    data_fingerprint: str
    validation_status: str
    validation_errors: list[dict[str, str]]
    validation_warnings: list[dict[str, str]]


@dataclass(frozen=True)
class ParsedBatch:
    source_sha256: str
    records: list[ParsedRecord]

    @property
    def valid_rows(self) -> int:
        return sum(record.validation_status == "valid" for record in self.records)

    @property
    def warning_rows(self) -> int:
        return sum(record.validation_status == "warning" for record in self.records)

    @property
    def invalid_rows(self) -> int:
        return sum(record.validation_status == "invalid" for record in self.records)


def _json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _validate_archive(content: bytes) -> None:
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            files = archive.infolist()
            if len(files) > MAX_ARCHIVE_FILES:
                raise SalaryAdvanceImportError("Excel 压缩包包含过多文件")
            total = 0
            for item in files:
                path = item.filename.replace("\\", "/")
                if path.startswith("/") or ".." in path.split("/"):
                    raise SalaryAdvanceImportError("Excel 压缩包包含越界路径")
                total += item.file_size
                if total > MAX_UNCOMPRESSED_BYTES:
                    raise SalaryAdvanceImportError("Excel 解压后内容超过安全限制")
                if path.lower().endswith("vbaproject.bin"):
                    raise SalaryAdvanceImportError("不接受包含宏的 Excel 文件")
    except zipfile.BadZipFile as exc:
        raise SalaryAdvanceImportError("上传文件不是有效的 .xlsx 工作簿") from exc


def parse_salary_advance_workbook(
    content: bytes,
    *,
    period: str,
    active_signature_codes: set[str],
    existing_keys: set[tuple[str, str]] | None = None,
) -> ParsedBatch:
    _validate_archive(content)
    try:
        workbook = load_workbook(
            BytesIO(content),
            read_only=True,
            data_only=True,
            keep_links=False,
        )
    except Exception as exc:
        raise SalaryAdvanceImportError(f"无法解析 Excel：{exc}") from exc

    try:
        if "导入数据模板" in workbook.sheetnames:
            worksheet = workbook["导入数据模板"]
        elif workbook.sheetnames:
            worksheet = workbook[workbook.sheetnames[0]]
        else:
            raise SalaryAdvanceImportError("工作簿中没有工作表")

        rows = worksheet.iter_rows(values_only=True)
        header = next(rows, None)
        if header is None:
            raise SalaryAdvanceImportError("工作表为空")
        mapping = map_headers(header)
        missing = [field for field in ("period", "emp_id") if field not in mapping]
        if missing:
            raise SalaryAdvanceImportError(f"缺少必要列：{', '.join(missing)}")

        parsed: list[ParsedRecord] = []
        seen: dict[tuple[str, str], int] = {}
        external = existing_keys or set()
        for row_number, row in enumerate(rows, start=2):
            if all(value is None or str(value).strip() == "" for value in row):
                continue
            raw = {
                field: row[column]
                for field, column in mapping.items()
                if column < len(row)
            }
            row_period = raw.get("period")
            if row_period is not None:
                try:
                    row_period_text = str(int(float(row_period)))
                except (TypeError, ValueError):
                    row_period_text = str(row_period).strip()
                if row_period_text and row_period_text != period:
                    continue

            status, errors, warnings, normalized = validate_and_normalize_record(
                raw,
                batch_period=period,
                active_signature_codes=active_signature_codes,
            )
            key = (normalized.get("period", ""), normalized.get("emp_id", ""))
            if all(key):
                if key in seen:
                    status = "invalid"
                    errors.append(
                        {
                            "field": "emp_id",
                            "code": "DUPLICATE_PERIOD_EMPLOYEE",
                            "message": f"同一批次期间+工号重复，首次出现在第 {seen[key]} 行",
                        }
                    )
                elif key in external:
                    status = "invalid"
                    errors.append(
                        {
                            "field": "emp_id",
                            "code": "DUPLICATE_ACTIVE_RECORD",
                            "message": "系统中已存在相同期间和工号的有效记录",
                        }
                    )
                seen[key] = row_number

            parsed.append(
                ParsedRecord(
                    source_row_no=row_number,
                    period=normalized.get("period") or period,
                    emp_id=normalized.get("emp_id") or "",
                    raw_data=_json_value(raw),
                    normalized_data=_json_value(normalized),
                    data_fingerprint=data_fingerprint(normalized),
                    validation_status=status,
                    validation_errors=errors,
                    validation_warnings=warnings,
                )
            )
    finally:
        workbook.close()

    if not parsed:
        raise SalaryAdvanceImportError("所选期间没有可导入的数据行")
    return ParsedBatch(
        source_sha256=hashlib.sha256(content).hexdigest(),
        records=parsed,
    )

