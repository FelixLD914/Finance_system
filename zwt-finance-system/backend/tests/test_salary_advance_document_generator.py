from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from PIL import Image, ImageDraw
from pypdf import PdfReader

from app.core.config import get_settings
from app.modules.salary_advance import pdf_layout
from app.modules.salary_advance.document_generator import (
    FORM_FONT_NAME,
    WRAPPED_FIELDS,
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


def _snapshot(tmp_path: Path, position: str = "Accountant") -> GenerationSnapshot:
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
        "position": position,
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


def test_overlay_font_ships_with_repo() -> None:
    """叠加层字体必须随仓库发布，不能依赖机器上装没装。

    底版是 Excel 从模板导出的，表里的标签用的是 TH SarabunPSK；叠加层若换了
    别的字体，同字号下填入的字会和表格明显不是一套。这里钉住两件事：配置指向的
    字体文件确实签入在 assets/fonts 下，且 reportlab 能按 FORM_FONT_NAME 注册它。
    """
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_path = get_settings().salary_advance_font_path
    assert font_path.is_file(), font_path
    fonts_dir = Path(__file__).parents[1] / "app" / "assets" / "fonts"
    assert font_path.resolve().parent == fonts_dir.resolve()

    # 换了文件却复用旧注册名，reportlab 会继续吐旧字体——这里真注册一次兜底。
    if FORM_FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(FORM_FONT_NAME, str(font_path)))
    assert FORM_FONT_NAME in pdfmetrics.getRegisteredFontNames()


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
        get_settings().salary_advance_font_path,
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


def _position_lines(pdf: Path) -> list[tuple[float, float, float, str]]:
    """把职位区（第 8-9 行右侧）的文字按行取出来：(基线, 左, 右, 文字)。

    左边界卡在数据区左沿，否则会把底版上 "ตำแหน่ง Position" 标签一起框进来；
    右边不设界，这样文字真溢出格子还测得出来（居中排版右溢即左溢）。
    """
    import pdfplumber

    anchor = pdf_layout.TEXT_ANCHORS["position"]
    left = anchor.x - anchor.max_width / 2
    with pdfplumber.open(pdf) as document:
        page = document.pages[0]
        height = float(page.height)
        rows: dict[float, list] = {}
        for word in page.extract_words():
            baseline = round(height - float(word["bottom"]), 1)
            if float(word["x0"]) >= left and 600.0 <= baseline <= 650.0:
                rows.setdefault(baseline, []).append(word)
    lines = []
    for baseline in sorted(rows, reverse=True):
        words = sorted(rows[baseline], key=lambda item: float(item["x0"]))
        lines.append(
            (
                baseline,
                float(words[0]["x0"]),
                float(words[-1]["x1"]),
                " ".join(word["text"] for word in words),
            )
        )
    return lines


@pytest.mark.parametrize(
    "position",
    [
        "MANUFACTURING TECHNOLOGY SUPERVISOR 2",
        # 导入数据里真实存在的漏空格写法，没有可用断点，只能按字符硬断
        "MANUFACTURING TECHNOLOGYSUPERVISOR 1",
    ],
)
def test_long_position_is_printed_in_full(tmp_path: Path, position: str) -> None:
    """长职位以前会被压到 7pt 再逐字符砍掉，现在必须折行印全。"""
    assets = Path(__file__).parents[1] / "app" / "assets"
    output = tmp_path / "long-position.pdf"

    export_pdf_from_template(
        assets / "templates" / "Salary-Advance-Template.pdf",
        output,
        _snapshot(tmp_path, position=position),
        get_settings().salary_advance_font_path,
        xlsx_template_path=assets / "templates" / "Salary-Advance-Template.xlsx",
    )

    lines = _position_lines(output)
    assert "".join(text for _, _, _, text in lines).replace(" ", "") == (
        position.replace(" ", "")
    )
    assert len(lines) <= WRAPPED_FIELDS["position"]


def test_position_block_stays_inside_its_box(tmp_path: Path) -> None:
    """折行数和模板里 K8:L9 的高度必须对得上。

    行高够不够放不下没人会报错，只会静静印到格子外面去。这里钉住两条边界：
    横向不越出制版量到的可绘宽度，纵向不高过同一行 Name/Surname 的基线——
    再往上就是第 7 行的留白，说明第 9 行行高和 WRAPPED_FIELDS 脱节了。
    """
    assets = Path(__file__).parents[1] / "app" / "assets"
    output = tmp_path / "boxed-position.pdf"

    export_pdf_from_template(
        assets / "templates" / "Salary-Advance-Template.pdf",
        output,
        _snapshot(tmp_path, position="MANUFACTURING TECHNOLOGY SUPERVISOR 2"),
        get_settings().salary_advance_font_path,
        xlsx_template_path=assets / "templates" / "Salary-Advance-Template.xlsx",
    )

    anchor = pdf_layout.TEXT_ANCHORS["position"]
    lines = _position_lines(output)
    assert len(lines) > 1, "样例职位应当折行，否则这个测试测不到东西"
    for baseline, left, right, text in lines:
        assert right - left <= anchor.max_width, text
        assert right <= anchor.x + anchor.max_width / 2 + 1, text
        assert baseline <= pdf_layout.TEXT_ANCHORS["first_name"].y, text
