from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
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


class SingleSalaryAdvanceCreate(ApiSchema):
    emp_id: str = Field(min_length=1, max_length=80)
    period: str = Field(pattern=r"^\d{6}$")
    advance_amount: Decimal = Field(gt=0)
    monthly_deduction: Decimal | None = Field(default=None, gt=0)
    reason: str | None = Field(default=None, max_length=100)
    request_date: date
    approval_status: Literal["Approve", "Not approved", "Pending"] = "Pending"
    remark: str | None = Field(default=None)
    output_filename: str | None = Field(default=None)


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


class CreateSalaryAdvanceJobRequest(ApiSchema):
    finance_signature_id: uuid.UUID | None = None
    md_signature_id: uuid.UUID | None = None
    finance_signature_code: str | None = None
    md_signature_code: str | None = None


class SalaryAdvanceJobResponse(ApiSchema):
    id: uuid.UUID
    batch_id: uuid.UUID
    template_id: uuid.UUID
    status: str
    total_count: int
    success_count: int
    failed_count: int
    requested_by_name: str
    finance_signature_id: uuid.UUID | None = None
    md_signature_id: uuid.UUID | None = None
    started_at: datetime | None
    finished_at: datetime | None
    error_summary: str | None


class SalaryAdvanceJobDetail(ApiSchema):
    job: SalaryAdvanceJobResponse
    documents: list[SalaryAdvanceDocumentResponse]


class EmployeeCreate(ApiSchema):
    emp_id: str = Field(min_length=1, max_length=80)
    first_name: str | None = Field(default=None, max_length=160)
    surname: str | None = Field(default=None, max_length=160)
    en_name: str | None = Field(default=None, max_length=300)
    chinese_name: str | None = Field(default=None, max_length=160)
    department: str | None = Field(default=None, max_length=160)
    position: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    is_active: bool = True


class EmployeeUpdate(ApiSchema):
    first_name: str | None = Field(default=None, max_length=160)
    surname: str | None = Field(default=None, max_length=160)
    en_name: str | None = Field(default=None, max_length=300)
    chinese_name: str | None = Field(default=None, max_length=160)
    department: str | None = Field(default=None, max_length=160)
    position: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    is_active: bool = True


class EmployeeResponse(ApiSchema):
    id: uuid.UUID
    emp_id: str
    first_name: str | None
    surname: str | None
    en_name: str | None
    chinese_name: str | None
    department: str | None
    position: str | None
    start_date: date | None
    is_active: bool
    source_file_name: str | None
    created_by_name: str
    updated_by_name: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    deleted_by_name: str | None = None


class EmployeeListResponse(ApiSchema):
    items: list[EmployeeResponse]
    total: int


class EmployeeDeletePreview(ApiSchema):
    employee_id: uuid.UUID
    emp_id: str
    referencing_records: int


class EmployeeImportResult(ApiSchema):
    source_file_name: str
    created: int
    updated: int


