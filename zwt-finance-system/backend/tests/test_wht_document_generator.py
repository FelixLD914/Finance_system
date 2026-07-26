from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook
from PIL import Image
from pypdf import PdfReader

from app.modules.wht.document_generator import (
    DocumentGenerationError,
    export_pdf_from_template,
    render_wht_workbook,
    thai_baht_text,
    thai_date_text,
    validate_signature_image,
)
from app.modules.wht.models import WhtTask


@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        ("0", "ศูนย์บาทถ้วน"),
        ("1", "หนึ่งบาทถ้วน"),
        ("11", "สิบเอ็ดบาทถ้วน"),
        ("21.25", "ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์"),
        ("1000001", "หนึ่งล้านเอ็ดบาทถ้วน"),
    ],
)
def test_thai_baht_text(amount: str, expected: str) -> None:
    assert thai_baht_text(Decimal(amount)) == expected


def test_thai_date_uses_buddhist_year() -> None:
    assert thai_date_text(date(2026, 6, 10)) == "10 มิถุนายน 2569"


def test_renders_old_template_placeholders(tmp_path) -> None:
    template_path = tmp_path / "Template.xlsx"
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["RefNo", "BookNo", "PayeeNameTH", "PaymentDate"])
    worksheet.append(["Amount", "TaxRate", "TaxAmount", "AmountTextThai"])
    worksheet.append(["WHT Type3", "WHT Type53", "DateTextThai", "IncomeType"])
    workbook.save(template_path)
    workbook.close()

    task = WhtTask(
        task_no="ZWT202606001",
        book_no="202606",
        period="2026-06",
        issuance_type="normal",
        supplement_run=0,
        status="approved",
        company_name="บริษัท ตัวอย่าง จำกัด",
        payee_address="กรุงเทพมหานคร",
        tax_id="0105540057561",
        wht_type="PND53",
        income_type="ค่าบริการ",
        payment_date=date(2026, 6, 10),
        wht_rate=Decimal("0.03"),
        total_amount=Decimal("3000.00"),
        wht_amount=Decimal("90.00"),
    )

    rendered = load_workbook(BytesIO(render_wht_workbook(template_path, task)))
    result = rendered.active
    assert result["A1"].value == "ZWT202606001"
    assert result["B1"].value == "202606"
    assert result["C1"].value == "บริษัท ตัวอย่าง จำกัด"
    assert result["A2"].value == Decimal("3000.00")
    assert result["B2"].number_format == "0%"
    assert result["A3"].value is None
    assert result["B3"].value == "√"
    assert result["C3"].value == "10 มิถุนายน 2569"
    rendered.close()


def test_validates_png_signature() -> None:
    output = BytesIO()
    Image.new("RGBA", (20, 10), (255, 255, 255, 0)).save(output, format="PNG")

    assert validate_signature_image(output.getvalue()) == ("image/png", ".png")


def test_rejects_non_image_signature() -> None:
    with pytest.raises(DocumentGenerationError, match="valid image"):
        validate_signature_image(b"not-an-image")


def test_generates_four_copy_pdf_without_office(tmp_path) -> None:
    assets = Path(__file__).parents[1] / "app" / "assets"
    task = WhtTask(
        task_no="ZWT202606001",
        book_no="202606",
        period="2026-06",
        issuance_type="normal",
        supplement_run=0,
        status="approved",
        company_name="บริษัท ตัวอย่าง จำกัด",
        payee_address="กรุงเทพมหานคร",
        tax_id="0105540057561",
        wht_type="PND53",
        income_type="ค่าบริการ",
        payment_date=date(2026, 6, 10),
        wht_rate=Decimal("0.03"),
        total_amount=Decimal("3000.00"),
        wht_amount=Decimal("90.00"),
    )
    output = tmp_path / "wht.pdf"

    export_pdf_from_template(
        assets / "templates" / "WHT-Template.pdf",
        output,
        task,
        assets / "fonts" / "Sarabun-Regular.ttf",
        None,
    )

    reader = PdfReader(output)
    assert len(reader.pages) == 4
    assert "ZWT202606001" in (reader.pages[0].extract_text() or "")
