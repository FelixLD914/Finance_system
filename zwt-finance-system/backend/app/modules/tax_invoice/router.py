import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
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
from app.modules.tax_invoice.document_service import TaxInvoiceDocumentService
from app.modules.tax_invoice.ledger_export import build_ledger_workbook
from app.modules.tax_invoice.recognition import (
    TaxInvoiceRecognitionError,
    parse_bot_fx_workbook,
    parse_customs_pdf,
    parse_invoice_workbook,
    parse_sample_workbook,
)
from app.modules.tax_invoice.schemas import (
    BotApiStatus,
    ExchangeRateFetchRequest,
    ExchangeRateImportResponse,
    ExchangeRateResponse,
    TaxInvoiceApproveRequest,
    TaxInvoiceCorrectionRequest,
    TaxInvoiceDocumentGenerateRequest,
    TaxInvoiceDocumentResponse,
    TaxInvoiceEventResponse,
    TaxInvoiceImportResponse,
    TaxInvoiceItemResponse,
    TaxInvoiceListResponse,
    TaxInvoiceResponse,
    TaxInvoiceUpdate,
    TaxInvoiceVoidRequest,
)
from app.modules.tax_invoice.service import InvoiceAggregate, TaxInvoiceService

# 整个 TAX INV 路由组要求已登录。逐个端点再用 require_permission 收紧。
router = APIRouter(
    prefix="/v1/tax-invoice",
    tags=["tax-invoice"],
    dependencies=[Depends(require_permission("invoice:read"))],
)


async def get_tax_invoice_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    principal: PrincipalDependency,
) -> TaxInvoiceService:
    # actor_name 取自登录用户：税票的批准/作废/更正必须能归因到具体的人。
    return TaxInvoiceService(
        session=session,
        actor_name=principal.actor_name,
        settings=get_settings(),
    )


ServiceDependency = Annotated[TaxInvoiceService, Depends(get_tax_invoice_service)]


async def get_tax_invoice_document_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    principal: PrincipalDependency,
) -> TaxInvoiceDocumentService:
    return TaxInvoiceDocumentService(
        session=session,
        actor_name=principal.actor_name,
        settings=get_settings(),
    )


DocumentServiceDependency = Annotated[
    TaxInvoiceDocumentService,
    Depends(get_tax_invoice_document_service),
]


def _response(aggregate: InvoiceAggregate) -> TaxInvoiceResponse:
    response = TaxInvoiceResponse.model_validate(aggregate.invoice)
    return response.model_copy(
        update={
            "items": [
                TaxInvoiceItemResponse.model_validate(item) for item in aggregate.items
            ],
            "events": [
                TaxInvoiceEventResponse.model_validate(event)
                for event in aggregate.events
            ],
        }
    )


async def _read_upload(
    upload: UploadFile,
    allowed_suffixes: tuple[str, ...],
) -> tuple[bytes, str]:
    file_name = upload.filename or "upload"
    if not file_name.lower().endswith(allowed_suffixes):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"accepted file types: {', '.join(allowed_suffixes)}",
        )
    maximum = get_settings().max_file_mib * 1024 * 1024
    content = await upload.read(maximum + 1)
    if len(content) > maximum:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"each file must not exceed {get_settings().max_file_mib} MiB",
        )
    return content, file_name


@router.get("/invoices", response_model=TaxInvoiceListResponse)
async def list_invoices(
    service: ServiceDependency,
    invoice_status: Literal[
        "draft",
        "needs_review",
        "ready",
        "approved",
        "issued",
        "voided",
    ]
    | None = Query(default=None, alias="status"),
    period: str | None = None,
    query: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100, alias="pageSize"),
) -> TaxInvoiceListResponse:
    invoices, total = await service.list_invoices(
        status=invoice_status,
        period=period,
        query=query,
        page=page,
        page_size=page_size,
    )
    return TaxInvoiceListResponse(
        items=[TaxInvoiceResponse.model_validate(invoice) for invoice in invoices],
        total=total,
        page=page,
        page_size=page_size,
    )


# 必须排在 /invoices/{invoice_id} 前面：那条路由的 invoice_id 是 UUID，
# "export" 会先命中它并以 422 收场，永远走不到这里。
@router.get("/invoices/export")
async def export_ledger(
    service: ServiceDependency,
    invoice_status: Literal[
        "draft",
        "needs_review",
        "ready",
        "approved",
        "issued",
        "voided",
    ]
    | None = Query(default=None, alias="status"),
    period: str | None = None,
    query: str | None = None,
) -> Response:
    """按台账当前筛选条件导出 Sample 格式 Excel，改完可以原样再导回。"""
    entries = await service.export_entries(
        status=invoice_status,
        period=period,
        query=query,
    )
    content = build_ledger_workbook(entries)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
    return Response(
        content=content,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": f'attachment; filename="tax-inv-ledger-{stamp}.xlsx"',
        },
    )


@router.get("/invoices/{invoice_id}", response_model=TaxInvoiceResponse)
async def get_invoice(
    invoice_id: uuid.UUID,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    return _response(await service.get_invoice(invoice_id))


@router.patch(
    "/invoices/{invoice_id}",
    response_model=TaxInvoiceResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def update_invoice(
    invoice_id: uuid.UUID,
    payload: TaxInvoiceUpdate,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    return _response(await service.update_invoice(invoice_id, payload))


@router.post(
    "/invoices/{invoice_id}/approve",
    response_model=TaxInvoiceResponse,
    dependencies=[Depends(require_permission("invoice:approve"))],
)
async def approve_invoice(
    invoice_id: uuid.UUID,
    payload: TaxInvoiceApproveRequest,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    return _response(
        await service.approve(
            invoice_id,
            version=payload.version,
            accept_warnings=payload.accept_warnings,
            note=payload.note,
        )
    )


@router.post(
    "/invoices/{invoice_id}/void",
    response_model=TaxInvoiceResponse,
    dependencies=[Depends(require_permission("invoice:void"))],
)
async def void_invoice(
    invoice_id: uuid.UUID,
    payload: TaxInvoiceVoidRequest,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    return _response(
        await service.void(
            invoice_id,
            version=payload.version,
            reason=payload.reason,
        )
    )


@router.post(
    "/invoices/{invoice_id}/corrections",
    response_model=TaxInvoiceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("invoice:correct"))],
)
async def create_correction(
    invoice_id: uuid.UUID,
    payload: TaxInvoiceCorrectionRequest,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    return _response(
        await service.create_correction(
            invoice_id,
            version=payload.version,
            reason=payload.reason,
        )
    )


@router.post(
    "/import/dual",
    response_model=TaxInvoiceImportResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def import_invoice_and_customs(
    service: ServiceDependency,
    currency: Annotated[str, Form(min_length=3, max_length=3)] = "USD",
    invoice_file: Annotated[
        UploadFile,
        File(alias="invoiceFile", description="Export invoice .xlsx or .xls"),
    ] = ...,
    customs_file: Annotated[
        UploadFile,
        File(alias="customsFile", description="Thai customs declaration PDF"),
    ] = ...,
) -> TaxInvoiceImportResponse:
    invoice_content, invoice_file_name = await _read_upload(
        invoice_file,
        (".xlsx", ".xls"),
    )
    customs_content, customs_file_name = await _read_upload(
        customs_file,
        (".pdf",),
    )
    try:
        invoice_data = parse_invoice_workbook(invoice_content, invoice_file_name)
        customs_data = parse_customs_pdf(customs_content)
    except TaxInvoiceRecognitionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_dual(
        invoice_data=invoice_data,
        customs_data=customs_data,
        currency=currency.upper(),
        invoice_file_name=invoice_file_name,
        invoice_content=invoice_content,
        customs_file_name=customs_file_name,
        customs_content=customs_content,
    )


@router.post(
    "/import/sample",
    response_model=TaxInvoiceImportResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def import_existing_sample(
    service: ServiceDependency,
    file: Annotated[UploadFile, File(description="Existing TAX INV Sample.xlsx")],
) -> TaxInvoiceImportResponse:
    content, file_name = await _read_upload(file, (".xlsx", ".xls"))
    try:
        rows = parse_sample_workbook(content, file_name)
    except TaxInvoiceRecognitionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_sample(rows=rows, file_name=file_name, content=content)


# 与 /import/sample 读同一种表格，区别只在编号口径：这里允许沿用旧系统已经
# 开出的 DocumentNo，那边一律拒绝。做成独立端点而不是一个 mode 参数，是为了
# 让权限能只收紧这一条——这是全系统唯一能由外部指定税票编号的入口。
#
# 【一次性通道：历史迁移跑完后整个删掉】
# 迁移一辈子只做一次，做完之后这个端点就是纯风险敞口、没有任何业务收益。
# 摘除清单（含一条「不要把 import_mode 的 CHECK 约束收窄回去」的坑）见
# docs/windows-deployment.md 的「上线后必须摘掉的一次性通道」。
@router.post(
    "/import/migration",
    response_model=TaxInvoiceImportResponse,
    # 两个都要：invoice:write 是导入这个动作本身，invoice:migrate 是"允许沿用
    # 外部编号"这项额外授权。分开挂着，将来收回迁移权不会连带影响日常导入。
    dependencies=[
        Depends(require_permission("invoice:write")),
        Depends(require_permission("invoice:migrate")),
    ],
)
async def import_historical_migration(
    service: ServiceDependency,
    file: Annotated[UploadFile, File(description="Legacy TAX INV ledger .xlsx")],
) -> TaxInvoiceImportResponse:
    content, file_name = await _read_upload(file, (".xlsx", ".xls"))
    try:
        rows = parse_sample_workbook(content, file_name)
    except TaxInvoiceRecognitionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_migration(
        rows=rows,
        file_name=file_name,
        content=content,
    )


@router.get("/exchange-rates", response_model=list[ExchangeRateResponse])
async def list_exchange_rates(
    service: ServiceDependency,
    currency: str = Query(default="USD", min_length=3, max_length=3),
    start_date: Annotated[date | None, Query(alias="startDate")] = None,
    end_date: Annotated[date | None, Query(alias="endDate")] = None,
) -> list[ExchangeRateResponse]:
    rows = await service.list_exchange_rates(
        currency=currency,
        start_date=start_date,
        end_date=end_date,
    )
    return [ExchangeRateResponse.model_validate(row) for row in rows]


@router.post(
    "/exchange-rates/import",
    response_model=ExchangeRateImportResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def import_exchange_rates(
    service: ServiceDependency,
    currency: Annotated[str, Form(min_length=3, max_length=3)] = "USD",
    file: Annotated[UploadFile, File(description="BOT rate .xlsx or .xls")] = ...,
) -> ExchangeRateImportResponse:
    content, file_name = await _read_upload(file, (".xlsx", ".xls"))
    try:
        rates = parse_bot_fx_workbook(content, file_name)
    except TaxInvoiceRecognitionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await service.import_exchange_rates(
        rates,
        currency=currency,
        source="bot_excel",
        source_file_name=file_name,
    )


@router.get("/exchange-rates/currencies", response_model=list[str])
async def list_rate_currencies(service: ServiceDependency) -> list[str]:
    """汇率台账里已有数据的币种，用于前端的币种下拉。"""
    return await service.list_rate_currencies()


@router.get("/exchange-rates/bot-status", response_model=BotApiStatus)
async def bot_api_status(service: ServiceDependency) -> BotApiStatus:
    """页面进入时自检：密钥没配好就直接显示配置指引，而不是等用户点了才报错。"""
    return service.bot_api_status()


@router.post(
    "/exchange-rates/fetch",
    response_model=ExchangeRateImportResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def fetch_exchange_rates(
    payload: ExchangeRateFetchRequest,
    service: ServiceDependency,
) -> ExchangeRateImportResponse:
    try:
        return await service.fetch_bot_exchange_rates(payload)
    except httpx.HTTPError as exc:
        # 连不上/超时/TLS 失败：这类没有 HTTP 状态码，把 httpx 的原话带回去，
        # 至少能区分"域名解析不了"和"代理挡了"。
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"BOT API request failed: {type(exc).__name__}: {exc}",
        ) from exc


@router.post(
    "/invoices/{invoice_id}/generate-documents",
    response_model=list[TaxInvoiceDocumentResponse],
    dependencies=[Depends(require_permission("invoice:generate"))],
)
async def generate_documents(
    invoice_id: uuid.UUID,
    payload: TaxInvoiceDocumentGenerateRequest,
    service: DocumentServiceDependency,
) -> list[TaxInvoiceDocumentResponse]:
    documents = await service.generate_documents(invoice_id, payload)
    return [
        TaxInvoiceDocumentResponse.model_validate(document)
        for document in documents
    ]


@router.get(
    "/invoices/{invoice_id}/documents",
    response_model=list[TaxInvoiceDocumentResponse],
)
async def list_documents(
    invoice_id: uuid.UUID,
    service: DocumentServiceDependency,
) -> list[TaxInvoiceDocumentResponse]:
    documents = await service.list_documents(invoice_id)
    return [
        TaxInvoiceDocumentResponse.model_validate(document)
        for document in documents
    ]


@router.get("/documents/{document_id}/download")
async def download_document(
    document_id: uuid.UUID,
    service: DocumentServiceDependency,
) -> FileResponse:
    document, path = await service.document_content(document_id)
    media_type = (
        "application/pdf"
        if document.file_format == "pdf"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return FileResponse(path, media_type=media_type, filename=document.file_name)
