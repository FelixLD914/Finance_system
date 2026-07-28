from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ApiSchema(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class ValidationIssue(ApiSchema):
    field: str
    code: str
    message: str


class SalaryAdvanceBatchResponse(ApiSchema):
    id: uuid.UUID
    batch_no: str
    period: str
    source_file_name: str
    source_sha256: str
    status: str
    total_rows: int
    valid_rows: int
    warning_rows: int
    invalid_rows: int
    created_by_name: str
    locked_by_name: str | None
    created_at: datetime
    locked_at: datetime | None


class SalaryAdvanceRecordResponse(ApiSchema):
    id: uuid.UUID
    batch_id: uuid.UUID
    source_row_no: int
    period: str
    emp_id: str
    raw_data: dict[str, Any]
    normalized_data: dict[str, Any]
    data_fingerprint: str
    validation_status: Literal["valid", "warning", "invalid"]
    validation_errors: list[ValidationIssue] = Field(default_factory=list)
    validation_warnings: list[ValidationIssue] = Field(default_factory=list)
    generation_status: Literal["pending", "generating", "success", "failed"]
    version: int
    updated_at: datetime


class SalaryAdvanceBatchDetail(ApiSchema):
    batch: SalaryAdvanceBatchResponse
    records: list[SalaryAdvanceRecordResponse]


class SalaryAdvanceRecordUpdate(ApiSchema):
    version: int = Field(ge=1)
    values: dict[str, Any]


class SalaryAdvanceLockRequest(ApiSchema):
    note: str | None = Field(default=None, max_length=1000)


class SalaryAdvanceTemplateResponse(ApiSchema):
    id: uuid.UUID
    template_code: str
    version: str
    file_name: str
    sha256: str
    pdf_underlay_sha256: str
    pdf_layout_version: str
    visible_sheet: str
    active: bool
    created_by_name: str
    created_at: datetime


class SalaryAdvanceDocumentResponse(ApiSchema):
    id: uuid.UUID
    job_id: uuid.UUID
    record_id: uuid.UUID
    generation_version: int
    xlsx_file_name: str | None
    pdf_file_name: str | None
    xlsx_sha256: str | None
    pdf_sha256: str | None
    template_sha256: str
    pdf_underlay_sha256: str
    pdf_layout_version: str
    signature_versions: dict[str, Any]
    data_fingerprint: str
    status: Literal["success", "failed"]
    error_code: str | None
    error_message: str | None
    created_at: datetime


class SalaryAdvanceJobResponse(ApiSchema):
    id: uuid.UUID
    batch_id: uuid.UUID
    template_id: uuid.UUID
    status: str
    total_count: int
    success_count: int
    failed_count: int
    requested_by_name: str
    started_at: datetime | None
    finished_at: datetime | None
    error_summary: str | None


class SalaryAdvanceJobDetail(ApiSchema):
    job: SalaryAdvanceJobResponse
    documents: list[SalaryAdvanceDocumentResponse]
