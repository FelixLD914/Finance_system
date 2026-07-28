from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook
from PIL import Image, ImageDraw
from pypdf import PdfReader

from app.modules.salary_advance import pdf_layout
from app.modules.salary_advance.document_generator import (
    GenerationSnapshot,
    export_pdf_from_template,
    render_salary_advance_workbook,
    sha256_path,
)


def _signature(path: Path, color: tuple[int, int, int, int]) -> None:
    image = Image.new("RGBA", (220, 70), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.line((10, 55, 70, 12, 125, 48, 210, 14), fill=color, width=5)
    image.save(path)


def _snapshot(tmp_path: Path) -> GenerationSnapshot:
    finance = tmp_path / "finance.png"
    managing_director = tmp_path / "md.png"
    _signature(finance, (20, 35, 120, 255))
    _signature(managing_director, (120, 25, 25, 255))
    normalized = {
        "period": "202607",
        "emp_id": "E001",
        "en_name": "SOMCHAI TEST",
        "first_name": "SOMCHAI",
        "surname": "TEST",
        "chinese_name": "",
        "applicant_display_name": "SOMCHAI TEST",
        "department": "Finance",
        "position": "Accountant",
        "start_date": "2024-01-15",
        "reason": "Living expenses",
        "advance_amount": "12500.50",
        "advance_amount_words_th": "หนึ่งหมื่นสองพันห้าร้อยบาทห้าสิบสตางค์",
        "monthly_deduction": "2500.10",
        "monthly_deduction_words_th": "สองพันห้าร้อยบาทสิบสตางค์",
        "request_date": "2026-07-20",
        "finance_comment": "Verified",
        "finance_display_name": "FINANCE TEST",
        "finance_date": "2026-07-20",
        "approval_status": "Approve",
        "md_display_name": "MD TEST",
        "md_date": "2026-07-20",
        "applicant_signature_mode": "Handwritten",
        "finance_signature_code": "FIN_TEST",
        "md_signature_code": "MD_TEST",
        "output_filename": "salary-advance-test",
    }
    return GenerationSnapshot(
        normalized_data=normalized,
        finance_signature_path=finance,
        md_signature_path=managing_director,
        finance_signature_version={"assetVersion": 1},
        md_signature_version={"assetVersion": 1},
    )


def test_template_triple_hashes_match_checked_in_assets() -> None:
    assets = Path(__file__).parents[1] / "app" / "assets" / "templates"

    assert sha256_path(assets / "Salary-Advance-Template.xlsx") == (
        pdf_layout.SOURCE_XLSX_SHA256
    )
    assert sha256_path(assets / "Salary-Advance-Template.pdf") == (
        pdf_layout.PDF_UNDERLAY_SHA256
    )
    assert pdf_layout.PAGE_COUNT == 1


def test_renders_approved_xlsx_without_applicant_signature(tmp_path: Path) -> None:
    template = (
        Path(__file__).parents[1]
        / "app"
        / "assets"
        / "templates"
        / "Salary-Advance-Template.xlsx"
    )
    rendered = load_workbook(
        BytesIO(render_salary_advance_workbook(template, _snapshot(tmp_path)))
    )

    assert rendered.sheetnames == ["表单模板", "当前记录"]
    assert rendered["当前记录"].sheet_state == "hidden"
    assert rendered["当前记录"]["B2"].value == "202607"
    assert rendered["当前记录"]["B3"].value == "E001"
    assert rendered["当前记录"]["B13"].value == 12500.5
    for row in range(26, 29):
        for column in range(8, 11):
            assert rendered["表单模板"].cell(row=row, column=column).value is None
    assert len(rendered["表单模板"]._images) >= 3
    rendered.close()


def test_generates_single_page_pdf_without_office(tmp_path: Path) -> None:
    assets = Path(__file__).parents[1] / "app" / "assets"
    output = tmp_path / "salary-advance.pdf"

    export_pdf_from_template(
        assets / "templates" / "Salary-Advance-Template.pdf",
        output,
        _snapshot(tmp_path),
        assets / "fonts" / "Sarabun-Regular.ttf",
        xlsx_template_path=assets
        / "templates"
        / "Salary-Advance-Template.xlsx",
    )

    reader = PdfReader(output)
    assert len(reader.pages) == 1
    text = reader.pages[0].extract_text() or ""
    assert "SOMCHAI" in text
    assert "12,500.50" in text
    assert "{{finance_signature}}" not in text
    assert "{{md_signature}}" not in text
    assert output.stat().st_size > 100_000
