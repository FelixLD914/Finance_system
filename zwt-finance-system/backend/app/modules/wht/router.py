import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.core.dependencies import PrincipalDependency, require_permission
from app.core.signature_usage import format_signature_usage
from app.modules.wht.batch_import import (
    BatchWorkbookError,
    build_template_workbook,
    parse_batch_sheet,
)
from app.modules.wht.document_service import WhtDocumentService
from app.modules.wht.income_types import options_for
from app.modules.wht.legacy_import import parse_payee_sheet, parse_task_sheet
from app.modules.wht.numbering import build_normal_number, build_supplement_number
from app.modules.wht.schemas import (
    BatchCreateResult,
    BatchTransitionRequest,
    BatchTransitionResponse,
    DocumentGenerateRequest,
    ImportResult,
    IncomeTypeOptionResponse,
    IncomeTypeRate,
    PayeeCreate,
    PayeeListResponse,
    PayeeResponse,
    PayeeUpdate,
    SignatureAssetResponse,
    SignatureAssetUpdate,
    SignatureUsage,
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
from app.modules.wht.workbook import WorkbookError

# 整个 WHT 路由组要求已登录。逐个端点再用 require_permission 收紧到具体权限点。
router = APIRouter(
    prefix="/v1/wht",
    tags=["wht"],
    dependencies=[Depends(require_permission("wht:read"))],
)


async def get_wht_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    principal: PrincipalDependency,
) -> WhtService:
    # actor_name 取自登录用户，审计字段因此能落到具体的人；
    # 此前这里用的是配置里的静态名字，所有操作看起来都是同一个人做的。
    return WhtService(session=session, actor_name=principal.actor_name)


WhtServiceDependency = Annotated[WhtService, Depends(get_wht_service)]


async def get_wht_document_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    principal: PrincipalDependency,
) -> WhtDocumentService:
    return WhtDocumentService(session=session, actor_name=principal.actor_name)


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


@router.get("/income-types", response_model=list[IncomeTypeOptionResponse])
async def list_income_types(
    wht_type: Literal["PND3", "PND53"] | None = Query(default=None, alias="whtType"),
) -> list[IncomeTypeOptionResponse]:
    """收入类型目录。前端据此把「收入类型」渲染成可选项并带出默认税率。"""
    return [
        IncomeTypeOptionResponse(
            code=option.code,
            label_th=option.label_th,
            label_en=option.label_en,
            label_zh=option.label_zh,
            section=option.section,
            rates=[
                IncomeTypeRate(wht_type=name, rate=rate) for name, rate in option.rates.items()
            ],
            in_use=option.in_use,
        )
        for option in options_for(wht_type)
    ]


# 必须排在 /tasks/{task_id} 之前：task_id 声明为 UUID，
# "batch-template" 到不了这个路由就会先被 UUID 校验拒成 422。
@router.get("/tasks/batch-template")
async def batch_issue_template() -> Response:
    return Response(
        content=build_template_workbook(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="ZWT-WHT-BatchIssue-Template.xlsx"'
        },
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
    dependencies=[Depends(require_permission("wht:write"))],
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


@router.patch(
    "/tasks/{task_id}",
    response_model=WhtTaskResponse,
    dependencies=[Depends(require_permission("wht:write"))],
)
async def update_task(
    task_id: uuid.UUID,
    payload: WhtTaskUpdate,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.update_task(task_id, payload))


@router.post(
    "/tasks/{task_id}/submit-review",
    response_model=WhtTaskResponse,
    dependencies=[Depends(require_permission("wht:write"))],
)
async def submit_for_review(
    task_id: uuid.UUID,
    payload: WhtWorkflowRequest,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.submit_for_review(task_id, payload.version, payload.note))


@router.post(
    "/tasks/{task_id}/approve",
    response_model=WhtTaskResponse,
    dependencies=[Depends(require_permission("wht:approve"))],
)
async def approve_task(
    task_id: uuid.UUID,
    payload: WhtWorkflowRequest,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.approve(task_id, payload.version, payload.note))


@router.post(
    "/tasks/{task_id}/return-to-draft",
    response_model=WhtTaskResponse,
    dependencies=[Depends(require_permission("wht:approve"))],
)
async def return_to_draft(
    task_id: uuid.UUID,
    payload: WhtWorkflowRequest,
    service: WhtServiceDependency,
) -> WhtTaskResponse:
    return _task_response(await service.return_to_draft(task_id, payload.version, payload.note))


@router.post(
    "/tasks/import",
    response_model=ImportResult,
    dependencies=[Depends(require_permission("wht:write"))],
)
async def import_historical_tasks(
    service: WhtServiceDependency,
    file: Annotated[UploadFile, File(description="Legacy WHT Data.xlsx")],
) -> ImportResult:
    """历史迁移：导入旧系统**已经开过**的 WHT 台账（表里必须有 RefNo 正式编号）。

    落库状态直接是 issued，并把编号计数器推到该序号之后。要批量录入还没开的票，
    用 /tasks/batch-create。
    """
    content, file_name = await _read_xlsx(file)
    try:
        rows = parse_task_sheet(content)
    except WorkbookError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_tasks(rows, file_name)


@router.post(
    "/tasks/batch-create",
    response_model=BatchCreateResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("wht:write"))],
)
async def batch_create_tasks(
    service: WhtServiceDependency,
    file: Annotated[UploadFile, File(description="Batch issuance .xlsx")],
) -> BatchCreateResult:
    """批量开具：一张表建多条**草稿**，正式编号仍在批准时由服务器事务生成。"""
    content, file_name = await _read_xlsx(file)
    try:
        rows = parse_batch_sheet(content)
    except BatchWorkbookError as exc:
        # 逐行问题一次性全给出来，用户改一轮就能过，不用一次试一行。
        raise HTTPException(
            status_code=422,
            detail={"message": str(exc), "errors": exc.errors},
        ) from exc
    except WorkbookError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.batch_create_tasks(rows, file_name)


@router.post(
    "/tasks/batch-transition",
    response_model=BatchTransitionResponse,
    dependencies=[Depends(require_permission("wht:write"))],
)
async def batch_transition(
    payload: BatchTransitionRequest,
    service: WhtServiceDependency,
    principal: PrincipalDependency,
) -> BatchTransitionResponse:
    """批量提交复核 / 批准 / 退回。逐条独立提交，失败的那条不影响其余。"""
    # 批准和退回属于审批动作，路由级的 wht:write 不够，这里按动作再收紧一次，
    # 与单条端点 /approve、/return-to-draft 的权限要求保持一致。
    if payload.action in {"approve", "return-to-draft"}:
        principal.require("wht:approve")
    items = await service.batch_transition(
        payload.action,
        [(item.task_id, item.version) for item in payload.items],
        payload.note,
    )
    succeeded = sum(1 for item in items if item.succeeded)
    return BatchTransitionResponse(
        action=payload.action,
        succeeded=succeeded,
        failed=len(items) - succeeded,
        items=items,
    )


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
    dependencies=[Depends(require_permission("wht:write"))],
)
async def create_payee(
    payload: PayeeCreate,
    service: WhtServiceDependency,
) -> PayeeResponse:
    return PayeeResponse.model_validate(await service.create_payee(payload))


@router.patch(
    "/payees/{payee_id}",
    response_model=PayeeResponse,
    dependencies=[Depends(require_permission("wht:write"))],
)
async def update_payee(
    payee_id: uuid.UUID,
    payload: PayeeUpdate,
    service: WhtServiceDependency,
) -> PayeeResponse:
    return PayeeResponse.model_validate(await service.update_payee(payee_id, payload))


@router.post(
    "/payees/import",
    response_model=ImportResult,
    dependencies=[Depends(require_permission("wht:write"))],
)
async def import_payees(
    service: WhtServiceDependency,
    file: Annotated[UploadFile, File(description="WHT Data.xlsx with Sheet2")],
) -> ImportResult:
    content, file_name = await _read_xlsx(file)
    try:
        rows = parse_payee_sheet(content)
    except WorkbookError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_payees(rows, file_name)


@router.get("/signatures", response_model=list[SignatureAssetResponse])
async def list_signatures(
    service: WhtDocumentServiceDependency,
    include_inactive: bool = Query(default=False, alias="includeInactive"),
    usage: Literal["wht", "tax_inv", "salary_advance"] | None = Query(default=None),
) -> list[SignatureAssetResponse]:
    """usage 过滤返回适用范围包含该模块的签名；不传则返回整个图库。"""
    signatures = await service.list_signatures(include_inactive, usage)
    return [SignatureAssetResponse.model_validate(signature) for signature in signatures]


@router.post(
    "/signatures",
    response_model=SignatureAssetResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("signature:manage"))],
)
async def create_signature(
    service: WhtDocumentServiceDependency,
    name: Annotated[str, Form(min_length=1, max_length=160)],
    make_default: Annotated[bool, Form(alias="makeDefault")] = False,
    # multipart 里重复同名字段即数组：usage=wht&usage=salary_advance。
    usage: Annotated[list[SignatureUsage], Form()] = ["wht"],  # noqa: B006
    file: Annotated[UploadFile, File(description="Approved PNG or JPEG signature image")] = ...,
) -> SignatureAssetResponse:
    maximum = min(get_settings().max_file_mib, 5) * 1024 * 1024
    content = await file.read(maximum + 1)
    if len(content) > maximum:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="signature image must not exceed 5 MiB",
        )
    try:
        stored_usage = format_signature_usage(usage)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="signature usage must name at least one module",
        ) from exc
    signature = await service.create_signature(
        name=name,
        original_file_name=file.filename or "signature",
        content=content,
        make_default=make_default,
        usage=stored_usage,
    )
    return SignatureAssetResponse.model_validate(signature)


@router.patch(
    "/signatures/{signature_id}",
    response_model=SignatureAssetResponse,
    dependencies=[Depends(require_permission("signature:manage"))],
)
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
    dependencies=[Depends(require_permission("wht:generate"))],
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
