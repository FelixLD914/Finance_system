import uuid
from datetime import date
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_session
from app.modules.tax_invoice.document_service import TaxInvoiceDocumentService
from app.modules.tax_invoice.recognition import (
    TaxInvoiceRecognitionError,
    parse_bot_fx_workbook,
    parse_customs_pdf,
    parse_invoice_workbook,
    parse_sample_workbook,
)
from app.modules.tax_invoice.schemas import (
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

router = APIRouter(prefix="/v1/tax-invoice", tags=["tax-invoice"])


async def get_tax_invoice_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> TaxInvoiceService:
    settings = get_settings()
    return TaxInvoiceService(
        session=session,
        actor_name=settings.bootstrap_admin_display_name,
        settings=settings,
    )


ServiceDependency = Annotated[TaxInvoiceService, Depends(get_tax_invoice_service)]


async def get_tax_invoice_document_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> TaxInvoiceDocumentService:
    settings = get_settings()
    return TaxInvoiceDocumentService(
        session=session,
        actor_name=settings.bootstrap_admin_display_name,
        settings=settings,
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


@router.get("/invoices/{invoice_id}", response_model=TaxInvoiceResponse)
async def get_invoice(
    invoice_id: uuid.UUID,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    return _response(await service.get_invoice(invoice_id))


@router.patch("/invoices/{invoice_id}", response_model=TaxInvoiceResponse)
async def update_invoice(
    invoice_id: uuid.UUID,
    payload: TaxInvoiceUpdate,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    return _response(await service.update_invoice(invoice_id, payload))


@router.post("/invoices/{invoice_id}/approve", response_model=TaxInvoiceResponse)
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


@router.post("/invoices/{invoice_id}/void", response_model=TaxInvoiceResponse)
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


@router.post("/import/dual", response_model=TaxInvoiceImportResponse)
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


@router.post("/import/sample", response_model=TaxInvoiceImportResponse)
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


@router.post("/exchange-rates/import", response_model=ExchangeRateImportResponse)
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


@router.post("/exchange-rates/fetch", response_model=ExchangeRateImportResponse)
async def fetch_exchange_rates(
    payload: ExchangeRateFetchRequest,
    service: ServiceDependency,
) -> ExchangeRateImportResponse:
    try:
        return await service.fetch_bot_exchange_rates(payload)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="BOT API request failed",
        ) from exc


@router.post(
    "/invoices/{invoice_id}/generate-documents",
    response_model=list[TaxInvoiceDocumentResponse],
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
