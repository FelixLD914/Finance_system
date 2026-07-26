from datetime import date
from decimal import Decimal
from io import BytesIO

from openpyxl import Workbook, load_workbook

from app.modules.tax_invoice.document_generator import (
    TaxInvoiceDocumentGenerationError,
    render_tax_invoice_workbook,
    tax_invoice_file_stem,
)
from app.modules.tax_invoice.models import TaxInvoice, TaxInvoiceItem


def _invoice() -> TaxInvoice:
    return TaxInvoice(
        document_no="ZWT-IV20260608-01",
        status="approved",
        ci_no="CI-001",
        cdn="CDN-001",
        invoice_date=date(2026, 6, 8),
        exchange_target_date=date(2026, 6, 8),
        exchange_rate_date=date(2026, 6, 5),
        currency="USD",
        exchange_rate=Decimal("32.4567"),
        customer_name="บริษัท ทดสอบ จำกัด",
        customer_address="กรุงเทพมหานคร",
        tax_id="0105558004821",
        po_no="PO-001",
        payment_term="30 DAYS",
        fob_revenue_usd_total=Decimal("100.00"),
        fob_revenue_thb_total=Decimal("3245.67"),
        created_by_name="Tester",
        updated_by_name="Tester",
    )


def _item(line_number: int = 1) -> TaxInvoiceItem:
    return TaxInvoiceItem(
        line_number=line_number,
        product_name="Product",
        product_code="P-001",
        unit="PCS",
        quantity=Decimal("2"),
        fob_unit_price_usd=Decimal("50"),
        fob_revenue_usd=Decimal("100"),
        fob_revenue_thb=Decimal("3245.67"),
    )


def _template(tmp_path):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Invoice"
    for coordinate in ("D13", "D14", "D16", "D17", "D19", "Q13", "Q14"):
        worksheet[coordinate] = coordinate
    path = tmp_path / "template.xlsx"
    workbook.save(path)
    return path


def test_workbook_uses_customs_submission_date_for_invoice_date(tmp_path):
    content = render_tax_invoice_workbook(_template(tmp_path), _invoice(), [_item()])
    worksheet = load_workbook(BytesIO(content), data_only=False).active

    assert worksheet["Q13"].value == "ZWT-IV20260608-01"
    assert worksheet["Q14"].value == "08/06/2026"
    assert worksheet["O23"].value == "08/06/2026"
    assert Decimal(str(worksheet["P23"].value)) == Decimal("32.4567")
    assert worksheet["B23"].value == 1
    assert Decimal(str(worksheet["R23"].value)) == Decimal("3245.67")
    assert worksheet["B24"].value in (None, "")


def test_workbook_rejects_more_than_eighteen_items(tmp_path):
    items = [_item(index) for index in range(1, 20)]
    try:
        render_tax_invoice_workbook(_template(tmp_path), _invoice(), items)
    except TaxInvoiceDocumentGenerationError as exc:
        assert "18" in str(exc)
    else:
        raise AssertionError("expected the 18-line template limit")


def test_file_stem_uses_invoice_date_and_document_number():
    assert (
        tax_invoice_file_stem(_invoice())
        == "20260608-TAX INV(ZWT-IV20260608-01)-THB3245.67"
    )
