from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook

from app.modules.tax_invoice.models import TaxInvoice, TaxInvoiceItem

DATA_START_ROW = 23
MAX_ITEMS = 18
DATA_COLUMNS = (2, 3, 5, 8, 9, 11, 13, 15, 16, 18)


class TaxInvoiceDocumentGenerationError(RuntimeError):
    pass


def _display_date(value: date | None) -> str:
    return value.strftime("%d/%m/%Y") if value else ""


def render_tax_invoice_workbook(
    template_path: Path,
    invoice: TaxInvoice,
    items: list[TaxInvoiceItem],
) -> bytes:
    if not template_path.is_file():
        raise TaxInvoiceDocumentGenerationError(
            f"TAX INV template was not found: {template_path}"
        )
    if not invoice.document_no or not invoice.invoice_date:
        raise TaxInvoiceDocumentGenerationError(
            "approved document number and invoice date are required"
        )
    if len(items) > MAX_ITEMS:
        raise TaxInvoiceDocumentGenerationError(
            f"TAX INV template supports at most {MAX_ITEMS} product lines"
        )

    workbook = load_workbook(template_path)
    worksheet = workbook.active
    worksheet["D13"] = invoice.customer_name
    worksheet["D14"] = invoice.customer_address
    worksheet["D16"] = invoice.tax_id or ""
    worksheet["D17"] = invoice.po_no or ""
    worksheet["D19"] = invoice.payment_term or ""
    worksheet["Q13"] = invoice.document_no
    # Business rule: TAX invoice date follows the customs submission date.
    worksheet["Q14"] = _display_date(invoice.invoice_date)

    for offset in range(MAX_ITEMS):
        row_number = DATA_START_ROW + offset
        for column in DATA_COLUMNS:
            worksheet.cell(row=row_number, column=column).value = ""
        if offset >= len(items):
            continue
        item = items[offset]
        values = {
            2: item.line_number,
            3: item.product_name or "",
            5: item.product_code or "",
            8: item.unit or "",
            9: item.quantity,
            11: item.fob_unit_price_usd,
            13: item.fob_revenue_usd,
            # FX target date keeps the original exchange-rate display rule.
            15: _display_date(invoice.exchange_target_date),
            16: invoice.exchange_rate,
            18: item.fob_revenue_thb,
        }
        for column, value in values.items():
            worksheet.cell(row=row_number, column=column).value = value
        worksheet.cell(row=row_number, column=2).number_format = "0"
        worksheet.cell(row=row_number, column=9).number_format = "#,##0.####"
        worksheet.cell(row=row_number, column=11).number_format = "#,##0.0000"
        worksheet.cell(row=row_number, column=13).number_format = "#,##0.00"
        worksheet.cell(row=row_number, column=15).number_format = "@"
        worksheet.cell(row=row_number, column=16).number_format = "#,##0.0000"
        worksheet.cell(row=row_number, column=18).number_format = "#,##0.00"

    try:
        workbook.calculation.fullCalcOnLoad = True
        workbook.calculation.forceFullCalc = True
        workbook.calculation.calcMode = "auto"
    except AttributeError:
        pass
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def tax_invoice_file_stem(invoice: TaxInvoice) -> str:
    if not invoice.document_no or not invoice.invoice_date:
        raise TaxInvoiceDocumentGenerationError(
            "approved document number and invoice date are required"
        )
    amount = f"{Decimal(invoice.fob_revenue_thb_total):,.2f}"
    raw = (
        f"{invoice.invoice_date:%Y%m%d}-TAX INV"
        f"({invoice.document_no})-THB{amount}"
    )
    return re.sub(r'[\\/:*?"<>|,]', "", raw)
