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
from app.modules.tax_invoice.dual_pairing import (
    CUSTOMS_SUFFIXES,
    INVOICE_SUFFIXES,
    DualPair,
    IdentifiedFile,
    classify_file,
    pair_identified_files,
    pairing_key,
)
from app.modules.tax_invoice.ledger_export import build_ledger_workbook
from app.modules.tax_invoice.recognition import (
    TaxInvoiceRecognitionError,
    parse_bot_fx_workbook,
    parse_customs_pdf,
    parse_invoice_workbook,
    parse_sample_workbook,
)
from app.modules.tax_invoice.schemas import (
    MONTH_PATTERN,
    BotApiStatus,
    DualBatchImportResponse,
    DualBatchPairResult,
    DualIdentifiedCustoms,
    DualIdentifiedInvoice,
    DualIdentifyResponse,
    DualPairPreview,
    DualRejectedFile,
    DualSkippedPair,
    ExchangeRateFetchRequest,
    ExchangeRateImportResponse,
    ExchangeRateMonth,
    ExchangeRateResponse,
    ExchangeRateUpdate,
    ExchangeRateUpsert,
    TaxInvoiceApproveRequest,
    TaxInvoiceCorrectionRequest,
    TaxInvoiceDocumentGenerateRequest,
    TaxInvoiceDocumentResponse,
    TaxInvoiceEventResponse,
    TaxInvoiceImportResponse,
    TaxInvoiceItemResponse,
    TaxInvoiceListResponse,
    TaxInvoiceMatchRateRequest,
    TaxInvoiceResponse,
    TaxInvoiceUpdate,
    TaxInvoiceVoidRequest,
)
from app.modules.tax_invoice.service import (
    DualBatchPairInput,
    InvoiceAggregate,
    TaxInvoiceService,
)

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


async def _identify_uploads(
    files: list[UploadFile],
) -> tuple[list[IdentifiedFile], list[DualRejectedFile], dict[str, bytes]]:
    """把一批上传解析成 IdentifiedFile，并留下每份成功读入文件的字节。

    /import/dual/identify（只预览）与 /import/dual/batch（要落库存档）共用这一步，
    解析口径才只有一处。contents 收所有成功读入的文件（含解析失败的），
    供 batch 存档源文件时按文件名取回内容。
    """
    identified: list[IdentifiedFile] = []
    rejected: list[DualRejectedFile] = []
    contents: dict[str, bytes] = {}
    for upload in files:
        file_name = upload.filename or "upload"
        kind = classify_file(file_name)
        if kind is None:
            rejected.append(
                DualRejectedFile(
                    file_name=file_name,
                    kind="unsupported",
                    reason="只认 .xlsx / .xls 的 Export Invoice 与 .pdf 的报关单",
                )
            )
            continue
        content, _ = await _read_upload(
            upload,
            INVOICE_SUFFIXES if kind == "invoice" else CUSTOMS_SUFFIXES,
        )
        contents[file_name] = content
        try:
            data = (
                parse_invoice_workbook(content, file_name)
                if kind == "invoice"
                else parse_customs_pdf(content)
            )
        except TaxInvoiceRecognitionError as exc:
            # 单份读不了不该让整批 4xx：其它文件还得配对。记下来一起回报。
            identified.append(
                IdentifiedFile(file_name=file_name, kind=kind, error=str(exc))
            )
            continue
        identified.append(
            IdentifiedFile(
                file_name=file_name,
                kind=kind,
                key=pairing_key(data.get("ci_no")),
                data=data,
            )
        )
    return identified, rejected, contents


def _report_unpairable(
    unpairable: list[IdentifiedFile],
    rejected: list[DualRejectedFile],
) -> None:
    """把配不上的文件（读不了 / 没有 C/I No. / 同名重复发票）追加进 rejected。"""
    for item in unpairable:
        rejected.append(
            DualRejectedFile(
                file_name=item.file_name,
                kind=item.kind,
                reason=item.error or "文件里没读到 C/I No.，无法配对",
            )
        )


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
    "/invoices/{invoice_id}/match-rate",
    response_model=TaxInvoiceResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def match_invoice_rate(
    invoice_id: uuid.UUID,
    payload: TaxInvoiceMatchRateRequest,
    service: ServiceDependency,
) -> TaxInvoiceResponse:
    """按报关提交日重新匹配 BOT 汇率并重算 THB。用于「先导票、后同步汇率」。"""
    return _response(
        await service.match_exchange_rate(invoice_id, version=payload.version)
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
    "/import/dual/identify",
    response_model=DualIdentifyResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def identify_dual_files(
    files: Annotated[list[UploadFile], File(description="Export invoices and customs PDFs")],
) -> DualIdentifyResponse:
    """认一批文件的身份并按 C/I No. 配对，**不入库**。

    为什么要有这一步：配对键在文件内容里（C/I No.），而内容只有后端解析得动。
    界面要在导入前把"哪个 Excel 对哪份报关单"摆给用户看，就必须先有这一趟。
    按文件名配对是原来的做法，实测 100% 配错（见 dual_pairing 模块 docstring）。

    这里只读不写：没有事务、不落盘、不产生编号。确认之后走 /import/dual/batch
    把整批可导入配对一次性落成一个复核批次（不自动出编号）。
    """
    identified, rejected, _ = await _identify_uploads(files)
    pairs, unpairable = pair_identified_files(identified)
    _report_unpairable(unpairable, rejected)
    previews = [_pair_preview(pair) for pair in pairs]
    return DualIdentifyResponse(
        pairs=previews,
        rejected=rejected,
        ready_count=sum(1 for pair in pairs if pair.status == "ready"),
        invoice_only_count=sum(1 for pair in pairs if pair.status == "invoice_only"),
        customs_only_count=sum(1 for pair in pairs if pair.status == "customs_only"),
        conflict_count=sum(1 for pair in pairs if pair.status == "conflict"),
    )


def _pair_preview(pair: DualPair) -> DualPairPreview:
    invoice = None
    if pair.invoice:
        data = pair.invoice.data
        invoice = DualIdentifiedInvoice(
            file_name=pair.invoice.file_name,
            ci_no=data.get("ci_no") or "",
            ci_date=data.get("ci_date"),
            incoterms=data.get("incoterms") or None,
            customer_name=data.get("customer_name") or None,
            item_count=len(data.get("items") or []),
            fob_amount_usd=data.get("fob_amount_usd"),
            quantity_total=data.get("quantity_total"),
        )
    customs = None
    if pair.customs:
        data = pair.customs.data
        customs = DualIdentifiedCustoms(
            file_name=pair.customs.file_name,
            ci_no=data.get("ci_no") or "",
            cdn=data.get("cdn") or None,
            declaration_ref_no=data.get("declaration_ref_no") or None,
            submission_date=data.get("submission_date"),
            submission_date_confidence=data.get("submission_date_confidence") or None,
            submission_date_low_confidence=bool(
                data.get("submission_date_low_confidence")
            ),
            customs_exchange_rate=data.get("customs_exchange_rate"),
            forwarder_name=data.get("forwarder_name") or None,
            forwarder_name_th=data.get("forwarder_name_th") or None,
            forwarder_name_en=data.get("forwarder_name_en") or None,
            forwarder_tax_no=data.get("forwarder_tax_no") or None,
            customs_fob_usd_total=data.get("customs_fob_usd_total"),
            customs_fob_thb_line_total=data.get("customs_fob_thb_line_total"),
            customs_fob_thb_printed_total=data.get("customs_fob_thb_printed_total"),
            warnings=list(data.get("customs_warnings") or []),
        )
    return DualPairPreview(
        key=pair.key,
        status=pair.status,
        invoice=invoice,
        customs=customs,
        superseded_customs_file_names=[
            item.file_name for item in pair.superseded_customs
        ],
        conflicts=list(pair.conflicts),
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
        UploadFile | None,
        File(alias="customsFile", description="Thai customs declaration PDF"),
    ] = None,
) -> TaxInvoiceImportResponse:
    """一组（Export Invoice + 报关单）→ 一张税票。

    报关单可以缺。业务口径（2026-07-30 确认）：关单还没下来时先按发票开票，这张票
    停在"待补关单"——CDN / 提交日期 / 汇率 / THB 全空，补到关单再回填。原桌面版
    本来就是这个行为（`customs_data.get(ci_key, {})` 取不到就给空 dict 继续出行），
    Web 版那条"两份不齐不许导"的限制是移植时多加的，业务上是个死结。
    """
    invoice_content, invoice_file_name = await _read_upload(
        invoice_file,
        (".xlsx", ".xls"),
    )
    customs_content: bytes | None = None
    customs_file_name: str | None = None
    if customs_file is not None and customs_file.filename:
        customs_content, customs_file_name = await _read_upload(
            customs_file,
            (".pdf",),
        )
    try:
        invoice_data = parse_invoice_workbook(invoice_content, invoice_file_name)
        customs_data = (
            parse_customs_pdf(customs_content) if customs_content is not None else {}
        )
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
    "/import/dual/batch",
    response_model=DualBatchImportResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def import_dual_batch(
    service: ServiceDependency,
    currency: Annotated[str, Form(min_length=3, max_length=3)] = "USD",
    files: Annotated[
        list[UploadFile],
        File(description="Export invoices (.xlsx/.xls) and customs PDFs, mixed"),
    ] = ...,
) -> DualBatchImportResponse:
    """一次上传里的所有可导入配对 → 一个复核批次（不自动出编号）。

    取代前端逐组串行调 /import/dual 的老做法：服务端一趟识别 + 配对 + 匹配汇率 +
    整批落进同一个 import_batches 行（进 review 态）。编号仍只在 approve 事务里发。

    - 能导的（有发票，非 conflict）进 inputs，整批一个事务；有发票缺关单也导，
      记为「待补关单」。
    - 孤立关单（只有 PDF）和 conflict（同一 C/I 配到多份不同关单）不导，进 skipped，
      让人先处理。读不了 / 没 C/I No. 的文件进 rejected。
    - 撞上重复业务键会整批退回（TaxInvoiceConflictError → 409，前端弹冲突清单）。
    """
    identified, rejected, contents = await _identify_uploads(files)
    pairs, unpairable = pair_identified_files(identified)
    _report_unpairable(unpairable, rejected)

    inputs: list[DualBatchPairInput] = []
    skipped: list[DualSkippedPair] = []
    for pair in pairs:
        if pair.invoice is None:
            skipped.append(
                DualSkippedPair(
                    key=pair.key,
                    status="customs_only",
                    reason="只有报关单、没有对应的 Export Invoice，凭它开不出税票",
                )
            )
            continue
        if pair.status == "conflict":
            skipped.append(
                DualSkippedPair(
                    key=pair.key,
                    status="conflict",
                    reason="；".join(pair.conflicts)
                    or "同一 C/I No. 配到多份不同报关单，请人工确认后再导",
                )
            )
            continue
        invoice_name = pair.invoice.file_name
        customs_name = pair.customs.file_name if pair.customs else None
        inputs.append(
            DualBatchPairInput(
                key=pair.key,
                invoice_data=pair.invoice.data,
                customs_data=pair.customs.data if pair.customs else {},
                invoice_file_name=invoice_name,
                invoice_content=contents[invoice_name],
                customs_file_name=customs_name,
                customs_content=contents.get(customs_name) if customs_name else None,
            )
        )

    if not inputs:
        # 全批只有孤立关单 / 冲突 / 读不了的文件：没有事务、没有批次。
        return DualBatchImportResponse(
            batch_id=None,
            invoice_count=0,
            item_count=0,
            needs_review_count=0,
            results=[],
            rejected=rejected,
            skipped=skipped,
        )

    result = await service.import_dual_batch(inputs=inputs, currency=currency.upper())
    return DualBatchImportResponse(
        batch_id=result.batch_id,
        invoice_count=result.invoice_count,
        item_count=result.item_count,
        needs_review_count=result.needs_review_count,
        results=[
            DualBatchPairResult(
                key=outcome.key,
                invoice_file_name=outcome.invoice_file_name,
                customs_file_name=outcome.customs_file_name,
                invoice_id=outcome.invoice_id,
                item_count=outcome.item_count,
                needs_review=outcome.needs_review,
            )
            for outcome in result.pairs
        ],
        rejected=rejected,
        skipped=skipped,
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


@router.get("/exchange-rates", response_model=list[ExchangeRateResponse])
async def list_exchange_rates(
    service: ServiceDependency,
    currency: str = Query(default="USD", min_length=3, max_length=3),
    start_date: Annotated[date | None, Query(alias="startDate")] = None,
    end_date: Annotated[date | None, Query(alias="endDate")] = None,
    month: str | None = Query(default=None, pattern=MONTH_PATTERN),
    deleted: bool = Query(default=False, description="true 返回回收站列表"),
) -> list[ExchangeRateResponse]:
    rows = await service.list_exchange_rates(
        currency=currency,
        start_date=start_date,
        end_date=end_date,
        month=month,
        deleted=deleted,
    )
    return [ExchangeRateResponse.model_validate(row) for row in rows]


# 字面量路径统一排在 /exchange-rates/{rate_id} 这类参数路径之前。这里目前不会
# 真的撞上（months 是 GET，带 rate_id 的只有 PATCH/DELETE），但一旦以后有人加
# 一个 GET /exchange-rates/{rate_id}，"months" 就会被当成整数 rate_id 解析成
# 422 —— 本仓已经在 /tasks/batch-template 上踩过一次同样的坑。
@router.get("/exchange-rates/months", response_model=list[ExchangeRateMonth])
async def list_exchange_rate_months(
    service: ServiceDependency,
    currency: str = Query(default="USD", min_length=3, max_length=3),
) -> list[ExchangeRateMonth]:
    """按月汇总。汇率维护以月为单位，列表先出月份，点进去再看每日明细。"""
    return await service.list_exchange_rate_months(currency=currency)


@router.post(
    "/exchange-rates",
    response_model=ExchangeRateResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def upsert_exchange_rate(
    payload: ExchangeRateUpsert,
    service: ServiceDependency,
) -> ExchangeRateResponse:
    """手工录入某一天的汇率；该币种该日期已有在用记录时覆盖它。"""
    return ExchangeRateResponse.model_validate(await service.upsert_exchange_rate(payload))


@router.patch(
    "/exchange-rates/{rate_id}",
    response_model=ExchangeRateResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def update_exchange_rate(
    rate_id: int,
    payload: ExchangeRateUpdate,
    service: ServiceDependency,
) -> ExchangeRateResponse:
    """行内编辑，含停用/启用（is_active）。停用的汇率不再参与税票计价。"""
    return ExchangeRateResponse.model_validate(
        await service.update_exchange_rate(rate_id, payload)
    )


@router.delete(
    "/exchange-rates/{rate_id}",
    response_model=ExchangeRateResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def delete_exchange_rate(
    rate_id: int,
    service: ServiceDependency,
) -> ExchangeRateResponse:
    return ExchangeRateResponse.model_validate(await service.delete_exchange_rate(rate_id))


@router.post(
    "/exchange-rates/{rate_id}/restore",
    response_model=ExchangeRateResponse,
    dependencies=[Depends(require_permission("invoice:write"))],
)
async def restore_exchange_rate(
    rate_id: int,
    service: ServiceDependency,
) -> ExchangeRateResponse:
    """从回收站恢复。同币种同日期已有在用汇率时返回 409。"""
    return ExchangeRateResponse.model_validate(await service.restore_exchange_rate(rate_id))


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
