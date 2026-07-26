import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.modules.wht.document_service import WhtDocumentService
from app.modules.wht.legacy_import import (
    LegacyWorkbookError,
    parse_payee_sheet,
    parse_task_sheet,
)
from app.modules.wht.numbering import build_normal_number, build_supplement_number
from app.modules.wht.schemas import (
    DocumentGenerateRequest,
    ImportResult,
    PayeeCreate,
    PayeeListResponse,
    PayeeResponse,
    PayeeUpdate,
    SignatureAssetResponse,
    SignatureAssetUpdate,
    WhtDocumentResponse,
    WhtNumberPreview,
    WhtTaskCreate,
    WhtTaskEventResponse,
    WhtTaskListResponse,
    WhtTaskResponse,
    WhtTaskUpdate,
    WhtWorkflowRequest,
)
from app.modules.wht.service import TaskAggregate, WhtService

router = APIRouter(prefix="/v1/wht", tags=["wht"])


async def get_wht_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> WhtService:
    return WhtService(
        session=session,
        actor_name=get_settings().bootstrap_admin_display_name,
    )


WhtServiceDependency = Annotated[WhtService, Depends(get_wht_service)]


async def get_wht_document_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> WhtDocumentService:
    return WhtDocumentService(
        session=session,
        actor_name=get_settings().bootstrap_admin_display_name,
    )


WhtDocumentServiceDependency = Annotated[
    WhtDocumentService,
    Depends(get_wht_document_service),
]


def _task_response(aggregate: TaskAggregate) -> WhtTaskResponse:
    response = WhtTaskResponse.model_validate(aggregate.task)
    return response.model_copy(
        update={
            "events": [WhtTaskEventResponse.model_validate(event) for event in aggregate.events]
        }
    )


async def _read_xlsx(upload: UploadFile) -> tuple[bytes, str]:
    file_name = upload.filename or "upload.xlsx"
    if not file_name.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="only .xlsx files are accepted",
        )
    maximum = get_settings().max_file_mib * 1024 * 1024
    content = await upload.read(maximum + 1)
    if len(content) > maximum:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"each file must not exceed {get_settings().max_file_mib} MiB",
        )
    return content, file_name


@router.get("/number-preview", response_model=WhtNumberPreview)
async def number_preview(
    period: str,
    issue_type: Literal["normal", "supplement"] = Query(default="normal", alias="issueType"),
    sequence: int = Query(default=1, ge=1),
    supplement_run: int | None = Query(default=None, ge=1, le=9, alias="supplementRun"),
) -> WhtNumberPreview:
    try:
        if issue_type == "normal":
            number = build_normal_number(period, sequence)
        else:
            if supplement_run is None:
                raise ValueError("supplement_run is required for supplement issue type")
            number = build_supplement_number(period, supplement_run, sequence)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return WhtNumberPreview(
        issue_type=issue_type,
        period=period,
        supplement_run=supplement_run,
        sequence=sequence,
        task_no=number.task_no,
        book_no=number.book_no,
    )


@router.get("/tasks", response_model=WhtTaskListResponse)
async def list_tasks(
    service: WhtServiceDependency,
    period: str | None = None,
    task_status: Literal["draft", "pending_review", "approved", "issued", "voided"] | None = Query(
        default=None, alias="status"
    ),
    book_no: str | None = Query(default=None, alias="bookNo"),
    query: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100, alias="pageSize"),
) -> WhtTaskListResponse:
    tasks, total = await service.list_tasks(
        period=period,
        status=task_status,
        book_no=book_no,
        query=query,
        page=page,
        page_size=page_size,
    )
    return WhtTaskListResponse(
        items=[WhtTaskResponse.model_validate(task) for task in tasks],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/tasks",
    response_model=WhtTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_task(
    payload: WhtTaskCreate,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.create_task(payload))


@router.get("/tasks/{task_id}", response_model=WhtTaskResponse)
async def get_task(
    task_id: uuid.UUID,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.get_task(task_id))


@router.patch("/tasks/{task_id}", response_model=WhtTaskResponse)
async def update_task(
    task_id: uuid.UUID,
    payload: WhtTaskUpdate,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.update_task(task_id, payload))


@router.post("/tasks/{task_id}/submit-review", response_model=WhtTaskResponse)
async def submit_for_review(
    task_id: uuid.UUID,
    payload: WhtWorkflowRequest,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.submit_for_review(task_id, payload.version, payload.note))


@router.post("/tasks/{task_id}/approve", response_model=WhtTaskResponse)
async def approve_task(
    task_id: uuid.UUID,
    payload: WhtWorkflowRequest,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.approve(task_id, payload.version, payload.note))


@router.post("/tasks/{task_id}/return-to-draft", response_model=WhtTaskResponse)
async def return_to_draft(
    task_id: uuid.UUID,
    payload: WhtWorkflowRequest,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.return_to_draft(task_id, payload.version, payload.note))


@router.post("/tasks/import", response_model=ImportResult)
async def import_historical_tasks(
    service: WhtServiceDependency,
    file: Annotated[UploadFile, File(description="Legacy WHT Data.xlsx")],
) -> ImportResult:
    content, file_name = await _read_xlsx(file)
    try:
        rows = parse_task_sheet(content)
    except LegacyWorkbookError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_tasks(rows, file_name)


@router.get("/payees", response_model=PayeeListResponse)
async def list_payees(
    service: WhtServiceDependency,
    query: str | None = None,
    active_only: bool = Query(default=True, alias="activeOnly"),
) -> PayeeListResponse:
    payees, total = await service.list_payees(query, active_only)
    return PayeeListResponse(
        items=[PayeeResponse.model_validate(payee) for payee in payees],
        total=total,
    )


@router.post(
    "/payees",
    response_model=PayeeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_payee(
    payload: PayeeCreate,
    service: WhtServiceDependency,
) -> PayeeResponse:
    return PayeeResponse.model_validate(await service.create_payee(payload))


@router.patch("/payees/{payee_id}", response_model=PayeeResponse)
async def update_payee(
    payee_id: uuid.UUID,
    payload: PayeeUpdate,
    service: WhtServiceDependency,
) -> PayeeResponse:
    return PayeeResponse.model_validate(await service.update_payee(payee_id, payload))


@router.post("/payees/import", response_model=ImportResult)
async def import_payees(
    service: WhtServiceDependency,
    file: Annotated[UploadFile, File(description="WHT Data.xlsx with Sheet2")],
) -> ImportResult:
    content, file_name = await _read_xlsx(file)
    try:
        rows = parse_payee_sheet(content)
    except LegacyWorkbookError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_payees(rows, file_name)


@router.get("/signatures", response_model=list[SignatureAssetResponse])
async def list_signatures(
    service: WhtDocumentServiceDependency,
    include_inactive: bool = Query(default=False, alias="includeInactive"),
) -> list[SignatureAssetResponse]:
    signatures = await service.list_signatures(include_inactive)
    return [SignatureAssetResponse.model_validate(signature) for signature in signatures]


@router.post(
    "/signatures",
    response_model=SignatureAssetResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_signature(
    service: WhtDocumentServiceDependency,
    name: Annotated[str, Form(min_length=1, max_length=160)],
    make_default: Annotated[bool, Form(alias="makeDefault")] = False,
    file: Annotated[UploadFile, File(description="Approved PNG or JPEG signature image")] = ...,
) -> SignatureAssetResponse:
    maximum = min(get_settings().max_file_mib, 5) * 1024 * 1024
    content = await file.read(maximum + 1)
    if len(content) > maximum:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="signature image must not exceed 5 MiB",
        )
    signature = await service.create_signature(
        name=name,
        original_file_name=file.filename or "signature",
        content=content,
        make_default=make_default,
    )
    return SignatureAssetResponse.model_validate(signature)


@router.patch("/signatures/{signature_id}", response_model=SignatureAssetResponse)
async def update_signature(
    signature_id: uuid.UUID,
    payload: SignatureAssetUpdate,
    service: WhtDocumentServiceDependency,
) -> SignatureAssetResponse:
    signature = await service.update_signature(signature_id, payload)
    return SignatureAssetResponse.model_validate(signature)


@router.get("/signatures/{signature_id}/content")
async def signature_content(
    signature_id: uuid.UUID,
    service: WhtDocumentServiceDependency,
) -> FileResponse:
    signature, path = await service.signature_content(signature_id)
    return FileResponse(
        path,
        media_type=signature.mime_type,
        filename=signature.original_file_name,
    )


@router.post(
    "/tasks/{task_id}/generate-documents",
    response_model=list[WhtDocumentResponse],
)
async def generate_documents(
    task_id: uuid.UUID,
    payload: DocumentGenerateRequest,
    service: WhtDocumentServiceDependency,
) -> list[WhtDocumentResponse]:
    documents = await service.generate_documents(task_id, payload)
    return [WhtDocumentResponse.model_validate(document) for document in documents]


@router.get(
    "/tasks/{task_id}/documents",
    response_model=list[WhtDocumentResponse],
)
async def list_documents(
    task_id: uuid.UUID,
    service: WhtDocumentServiceDependency,
) -> list[WhtDocumentResponse]:
    documents = await service.list_documents(task_id)
    return [WhtDocumentResponse.model_validate(document) for document in documents]


@router.get("/documents/{document_id}/download")
async def download_document(
    document_id: uuid.UUID,
    service: WhtDocumentServiceDependency,
) -> FileResponse:
    document, path = await service.document_content(document_id)
    media_type = (
        "application/pdf"
        if document.file_format == "pdf"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return FileResponse(path, media_type=media_type, filename=document.file_name)
