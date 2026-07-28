from __future__ import annotations

import uuid
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.dependencies import PrincipalDependency, require_permission
from app.modules.salary_advance.document_service import (
    JobAggregate,
    SalaryAdvanceDocumentService,
    run_salary_advance_job,
)
from app.modules.salary_advance.schemas import (
    SalaryAdvanceBatchDetail,
    SalaryAdvanceBatchResponse,
    SalaryAdvanceDocumentResponse,
    SalaryAdvanceJobDetail,
    SalaryAdvanceJobResponse,
    SalaryAdvanceLockRequest,
    SalaryAdvanceRecordResponse,
    SalaryAdvanceRecordUpdate,
    SalaryAdvanceTemplateResponse,
)
from app.modules.salary_advance.service import (
    BatchAggregate,
    SalaryAdvanceNotFoundError,
    SalaryAdvanceService,
)


async def require_module_enabled() -> None:
    # 开关必须挡住整个模块，而不是只挡导入——否则关掉后仍能锁定、生成。
    if not get_settings().salary_advance_enabled:
        raise SalaryAdvanceNotFoundError("工资预支模块未启用")


router = APIRouter(
    prefix="/v1/salary-advance",
    tags=["salary-advance"],
    dependencies=[
        Depends(require_module_enabled),
        Depends(require_permission("salary_advance:read")),
    ],
)


async def get_salary_advance_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    principal: PrincipalDependency,
) -> SalaryAdvanceService:
    return SalaryAdvanceService(
        session=session,
        actor_name=principal.actor_name,
        settings=get_settings(),
    )


async def get_salary_advance_document_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    principal: PrincipalDependency,
) -> SalaryAdvanceDocumentService:
    return SalaryAdvanceDocumentService(
        session=session,
        actor_name=principal.actor_name,
        settings=get_settings(),
    )


SalaryAdvanceServiceDependency = Annotated[
    SalaryAdvanceService,
    Depends(get_salary_advance_service),
]
SalaryAdvanceDocumentServiceDependency = Annotated[
    SalaryAdvanceDocumentService,
    Depends(get_salary_advance_document_service),
]


def _batch_detail(aggregate: BatchAggregate) -> SalaryAdvanceBatchDetail:
    return SalaryAdvanceBatchDetail(
        batch=SalaryAdvanceBatchResponse.model_validate(aggregate.batch),
        records=[
            SalaryAdvanceRecordResponse.model_validate(record)
            for record in aggregate.records
        ],
    )


def _job_detail(aggregate: JobAggregate) -> SalaryAdvanceJobDetail:
    return SalaryAdvanceJobDetail(
        job=SalaryAdvanceJobResponse.model_validate(aggregate.job),
        documents=[
            SalaryAdvanceDocumentResponse.model_validate(document)
            for document in aggregate.documents
        ],
    )


def _download_response(
    content: bytes,
    file_name: str,
    media_type: str,
) -> Response:
    encoded = quote(file_name)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )


@router.get("/batches", response_model=list[SalaryAdvanceBatchResponse])
async def list_batches(
    service: SalaryAdvanceServiceDependency,
    period: str | None = None,
    batch_status: str | None = Query(default=None, alias="status"),
) -> list[SalaryAdvanceBatchResponse]:
    batches = await service.list_batches(period=period, status=batch_status)
    return [SalaryAdvanceBatchResponse.model_validate(batch) for batch in batches]


@router.post(
    "/batches/import",
    response_model=SalaryAdvanceBatchDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("salary_advance:write"))],
)
async def import_batch(
    service: SalaryAdvanceServiceDependency,
    period: Annotated[str, Form(pattern=r"^\d{6}$")],
    file: Annotated[UploadFile, File(description="Salary advance .xlsx workbook")],
) -> SalaryAdvanceBatchDetail:
    maximum = get_settings().max_file_mib * 1024 * 1024
    content = await file.read(maximum + 1)
    aggregate = await service.import_batch(
        content=content,
        file_name=file.filename or "salary-advance.xlsx",
        period=period,
    )
    return _batch_detail(aggregate)


@router.get("/batches/{batch_id}", response_model=SalaryAdvanceBatchDetail)
async def get_batch(
    batch_id: uuid.UUID,
    service: SalaryAdvanceServiceDependency,
) -> SalaryAdvanceBatchDetail:
    return _batch_detail(await service.get_batch(batch_id))


@router.delete(
    "/batches/{batch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("salary_advance:write"))],
)
async def delete_batch(
    batch_id: uuid.UUID,
    service: SalaryAdvanceServiceDependency,
) -> Response:
    """删除未锁定的批次。同期间+工号会跨批次查重，传错文件后必须能删掉重来。"""
    await service.delete_batch(batch_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/records/{record_id}", response_model=SalaryAdvanceRecordResponse)
async def get_record(
    record_id: uuid.UUID,
    service: SalaryAdvanceServiceDependency,
) -> SalaryAdvanceRecordResponse:
    return SalaryAdvanceRecordResponse.model_validate(
        await service.get_record(record_id)
    )


@router.patch(
    "/records/{record_id}",
    response_model=SalaryAdvanceRecordResponse,
    dependencies=[Depends(require_permission("salary_advance:write"))],
)
async def update_record(
    record_id: uuid.UUID,
    payload: SalaryAdvanceRecordUpdate,
    service: SalaryAdvanceServiceDependency,
) -> SalaryAdvanceRecordResponse:
    return SalaryAdvanceRecordResponse.model_validate(
        await service.update_record(record_id, payload)
    )


@router.post(
    "/batches/{batch_id}/revalidate",
    response_model=SalaryAdvanceBatchDetail,
    dependencies=[Depends(require_permission("salary_advance:write"))],
)
async def revalidate_batch(
    batch_id: uuid.UUID,
    service: SalaryAdvanceServiceDependency,
) -> SalaryAdvanceBatchDetail:
    return _batch_detail(await service.revalidate_batch(batch_id))


@router.get("/batches/{batch_id}/validation-report")
async def validation_report(
    batch_id: uuid.UUID,
    service: SalaryAdvanceDocumentServiceDependency,
) -> Response:
    file_name, content = await service.validation_report(batch_id)
    return _download_response(
        content,
        file_name,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.post(
    "/batches/{batch_id}/lock",
    response_model=SalaryAdvanceBatchResponse,
    dependencies=[Depends(require_permission("salary_advance:generate"))],
)
async def lock_batch(
    batch_id: uuid.UUID,
    payload: SalaryAdvanceLockRequest,
    service: SalaryAdvanceServiceDependency,
) -> SalaryAdvanceBatchResponse:
    return SalaryAdvanceBatchResponse.model_validate(
        await service.lock_batch(batch_id, payload.note)
    )


@router.get("/templates", response_model=list[SalaryAdvanceTemplateResponse])
async def list_templates(
    service: SalaryAdvanceServiceDependency,
) -> list[SalaryAdvanceTemplateResponse]:
    templates = await service.list_templates()
    return [
        SalaryAdvanceTemplateResponse.model_validate(template)
        for template in templates
    ]


@router.post(
    "/records/{record_id}/preview",
    dependencies=[Depends(require_permission("salary_advance:generate"))],
)
async def preview_record(
    record_id: uuid.UUID,
    service: SalaryAdvanceDocumentServiceDependency,
) -> Response:
    file_name, content = await service.preview_record(record_id)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"inline; filename*=UTF-8''{quote(file_name)}"
            )
        },
    )


@router.post(
    "/batches/{batch_id}/generation-jobs",
    response_model=SalaryAdvanceJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_permission("salary_advance:generate"))],
)
async def create_generation_job(
    batch_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    service: SalaryAdvanceDocumentServiceDependency,
) -> SalaryAdvanceJobResponse:
    job = await service.create_job(batch_id)
    background_tasks.add_task(run_salary_advance_job, job.id)
    return SalaryAdvanceJobResponse.model_validate(job)


@router.get(
    "/batches/{batch_id}/generation-jobs",
    response_model=list[SalaryAdvanceJobResponse],
)
async def list_generation_jobs(
    batch_id: uuid.UUID,
    service: SalaryAdvanceDocumentServiceDependency,
) -> list[SalaryAdvanceJobResponse]:
    jobs = await service.list_jobs(batch_id)
    return [SalaryAdvanceJobResponse.model_validate(job) for job in jobs]


@router.get(
    "/generation-jobs/{job_id}",
    response_model=SalaryAdvanceJobDetail,
)
async def get_generation_job(
    job_id: uuid.UUID,
    service: SalaryAdvanceDocumentServiceDependency,
) -> SalaryAdvanceJobDetail:
    return _job_detail(await service.get_job(job_id))


@router.post(
    "/generation-jobs/{job_id}/retry-failed",
    response_model=SalaryAdvanceJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_permission("salary_advance:generate"))],
)
async def retry_failed(
    job_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    service: SalaryAdvanceDocumentServiceDependency,
) -> SalaryAdvanceJobResponse:
    job = await service.retry_failed(job_id)
    background_tasks.add_task(run_salary_advance_job, job.id)
    return SalaryAdvanceJobResponse.model_validate(job)


@router.get("/generation-jobs/{job_id}/zip")
async def job_zip(
    job_id: uuid.UUID,
    service: SalaryAdvanceDocumentServiceDependency,
) -> Response:
    file_name, content = await service.job_zip(job_id)
    return _download_response(content, file_name, "application/zip")


@router.get("/generation-jobs/{job_id}/merged-pdf")
async def merged_pdf(
    job_id: uuid.UUID,
    service: SalaryAdvanceDocumentServiceDependency,
) -> Response:
    file_name, content = await service.merged_pdf(job_id)
    return _download_response(content, file_name, "application/pdf")


@router.get("/generation-jobs/{job_id}/manifest")
async def manifest(
    job_id: uuid.UUID,
    service: SalaryAdvanceDocumentServiceDependency,
) -> Response:
    file_name, content = await service.manifest(job_id)
    return _download_response(content, file_name, "application/json")


@router.get("/documents/{document_id}/{file_format}")
async def download_document(
    document_id: uuid.UUID,
    file_format: Literal["xlsx", "pdf"],
    service: SalaryAdvanceDocumentServiceDependency,
) -> FileResponse:
    file_name, path = await service.document_content(document_id, file_format)
    media_type = (
        "application/pdf"
        if file_format == "pdf"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return FileResponse(path, media_type=media_type, filename=file_name)
