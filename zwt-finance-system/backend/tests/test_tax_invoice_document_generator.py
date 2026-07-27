from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader

from app.modules.tax_invoice import pdf_layout
from app.modules.tax_invoice.document_generator import (
    MAX_ITEMS,
    TaxInvoiceDocumentGenerationError,
    export_pdf_from_template,
    format_amount,
    format_quantity,
    format_rate,
    pdf_field_values,
    render_clean_template_workbook,
    render_tax_invoice_workbook,
    tax_invoice_file_stem,
)
from app.modules.tax_invoice.models import TaxInvoice, TaxInvoiceItem

ASSETS = Path(__file__).parents[1] / "app" / "assets"


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


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        # Excel 的 "#,##0.####" 会把整数显示成 "1,001."，末尾那个点真的会印出来。
        ("1001", "1,001."),
        ("2.5", "2.5"),
        ("0", "0."),
        ("1234.5678", "1,234.5678"),
    ],
)
def test_quantity_format_matches_excel(value: str, expected: str) -> None:
    assert format_quantity(Decimal(value)) == expected


def test_rate_rounds_half_up_like_excel() -> None:
    # 汇率存的是 Numeric(18,6)，模板只显示 4 位；Python 默认银行家舍入会得到
    # 32.4566，Excel 是 32.4567。
    assert format_rate(Decimal("32.456650")) == "32.4567"
    assert format_amount(Decimal("3245.665")) == "3,245.67"


def test_missing_values_render_as_blank() -> None:
    assert format_amount(None) == ""
    assert format_rate(None) == ""
    assert format_quantity(None) == ""


def test_pdf_totals_repeat_the_line_sum_and_thai_text() -> None:
    items = [_item(1), _item(2)]
    _, lines, totals = pdf_field_values(_invoice(), items)

    assert len(lines) == 2
    assert lines[0]["quantity"] == "2."
    assert lines[0]["exchange_rate"] == "32.4567"
    assert lines[0]["fx_date"] == "08/06/2026"
    # 折扣与 VAT 恒为 0，所以合计/折后/总计三格是同一个数。
    assert totals["total_thb"] == "6,491.34"
    assert totals["after_discount_thb"] == "6,491.34"
    assert totals["grand_total_thb"] == "6,491.34"
    assert totals["amount_text_thai"] == (
        "(หกพันสี่ร้อยเก้าสิบเอ็ดบาทสามสิบสี่สตางค์)"
    )


def test_layout_table_covers_every_page_and_line() -> None:
    assert pdf_layout.PAGE_COUNT == 3
    for anchors in (
        *pdf_layout.HEADER_ANCHORS.values(),
        *pdf_layout.ITEM_ANCHORS.values(),
        *pdf_layout.TOTAL_ANCHORS.values(),
    ):
        assert len(anchors) == pdf_layout.PAGE_COUNT
    for baselines in pdf_layout.ITEM_BASELINES.values():
        assert len(baselines) == MAX_ITEMS


def test_generates_three_copy_pdf_without_office(tmp_path) -> None:
    output = tmp_path / "tax-inv.pdf"

    export_pdf_from_template(
        ASSETS / "templates" / "TAX-INV-Template.pdf",
        output,
        _invoice(),
        [_item()],
        ASSETS / "fonts" / "Sarabun-Regular.ttf",
    )

    reader = PdfReader(output)
    # 一页正本 + 两页副本，与模板的三段 print_area 一一对应。
    assert len(reader.pages) == 3
    for page in reader.pages:
        text = page.extract_text() or ""
        assert "ZWT-IV20260608-01" in text
        assert "3,245.67" in text
        assert "P-001" in text


def test_pdf_rejects_more_than_eighteen_lines(tmp_path) -> None:
    items = [_item(index) for index in range(1, MAX_ITEMS + 2)]

    with pytest.raises(TaxInvoiceDocumentGenerationError, match="18"):
        export_pdf_from_template(
            ASSETS / "templates" / "TAX-INV-Template.pdf",
            tmp_path / "tax-inv.pdf",
            _invoice(),
            items,
            ASSETS / "fonts" / "Sarabun-Regular.ttf",
        )


def test_clean_template_clears_data_without_touching_column_headers(tmp_path) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Invoice"
    # 列名和占位符重名，正是这张模板最容易踩的坑：WHT 那种全表按文本匹配的
    # 清理方式会把三联的表头一起抹掉。
    worksheet["H22"] = "Unit"
    worksheet["O22"] = " FX Date"
    worksheet["P22"] = "FX Rate"
    worksheet["D13"] = "Customer Name"
    worksheet["Q13"] = "DocumentNo"
    worksheet["AN13"] = "=V13"
    worksheet["H23"] = "Unit"
    worksheet["AJ23"] = "=R23"
    worksheet["BB40"] = "=AJ40"
    worksheet["R42"] = "=SUM(R23:R40)"
    worksheet["R43"] = "=IF(Q43=0%,0,ROUND(R42*Q43,2))"
    worksheet["R49"] = 0
    path = tmp_path / "template.xlsx"
    workbook.save(path)
    workbook.close()

    cleaned = load_workbook(BytesIO(render_clean_template_workbook(path)))["Invoice"]

    assert cleaned["H22"].value == "Unit"
    assert cleaned["O22"].value == " FX Date"
    assert cleaned["P22"].value == "FX Rate"
    assert cleaned["D13"].value is None
    assert cleaned["Q13"].value is None
    assert cleaned["AN13"].value is None
    assert cleaned["H23"].value is None
    assert cleaned["AJ23"].value is None
    assert cleaned["BB40"].value is None
    assert cleaned["R42"].value is None
    # 折扣与 WHT 恒为 0，Excel 排好的 "-" 留在底版上，叠加层不再画。
    assert cleaned["R43"].value == "=IF(Q43=0%,0,ROUND(R42*Q43,2))"
    assert cleaned["R49"].value == 0


def test_pdf_reports_a_missing_underlay(tmp_path) -> None:
    with pytest.raises(TaxInvoiceDocumentGenerationError, match="PDF template"):
        export_pdf_from_template(
            tmp_path / "absent.pdf",
            tmp_path / "tax-inv.pdf",
            _invoice(),
            [_item()],
            ASSETS / "fonts" / "Sarabun-Regular.ttf",
        )
