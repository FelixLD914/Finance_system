"""扩展名对、内容不对的上传必须是 4xx，不是 500。

`_read_upload` 只看扩展名，所以"改名的 PDF""下载了一半的文件""真 zip 但不是
xlsx"都能走到解析器。这些是用户传错文件，属于 4xx；以前它们会让 openpyxl /
pdfminer 的原始异常一路冒到 FastAPI，变成 500 加一份栈。
"""

from __future__ import annotations

import zipfile
from io import BytesIO

import pytest

from app.modules.tax_invoice.recognition import (
    TaxInvoiceRecognitionError,
    parse_bot_fx_workbook,
    parse_customs_pdf,
    parse_invoice_workbook,
    parse_sample_workbook,
)

NOT_A_WORKBOOK = b"this is plainly not a spreadsheet"


def _zip_without_workbook_xml() -> bytes:
    """一个结构合法的 zip，但缺少 xlsx 必需的部件。

    与随便几个字节不是同一条失败路径：zip 能打开，openpyxl 是在找
    workbook.xml 时才炸的。真实场景是有人把 .zip 改名成 .xlsx。
    """
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("readme.txt", "not an xlsx")
    return buffer.getvalue()


@pytest.mark.parametrize(
    "parse",
    [parse_invoice_workbook, parse_sample_workbook, parse_bot_fx_workbook],
)
@pytest.mark.parametrize(
    ("label", "content"),
    [("garbage", NOT_A_WORKBOOK), ("zip-without-workbook", _zip_without_workbook_xml())],
)
def test_unreadable_xlsx_raises_recognition_error(parse, label: str, content: bytes) -> None:  # noqa: ANN001
    # 三个解析器都走同一个 _grid，所以一起测，防止以后有人绕开它另开一条路。
    with pytest.raises(TaxInvoiceRecognitionError):
        parse(content, "upload.xlsx")


@pytest.mark.parametrize(
    "parse",
    [parse_invoice_workbook, parse_sample_workbook, parse_bot_fx_workbook],
)
def test_unreadable_xls_raises_recognition_error(parse) -> None:  # noqa: ANN001
    with pytest.raises(TaxInvoiceRecognitionError):
        parse(NOT_A_WORKBOOK, "upload.xls")


def test_unreadable_pdf_raises_recognition_error() -> None:
    with pytest.raises(TaxInvoiceRecognitionError):
        parse_customs_pdf(b"%PDF-1.4 truncated and corrupt")


def test_unsupported_extension_still_rejected() -> None:
    with pytest.raises(TaxInvoiceRecognitionError):
        parse_invoice_workbook(NOT_A_WORKBOOK, "upload.csv")


@pytest.mark.parametrize(
    "path",
    ["/api/v1/tax-invoice/import/sample", "/api/v1/tax-invoice/import/migration"],
)
def test_import_endpoints_answer_422_not_500(admin_client, path: str) -> None:  # noqa: ANN001
    """端到端确认用户看到的是 422。

    上面那些是解析器层面的断言；这条盯的是真正的契约——传错文件不该让接口
    以 500 加一份栈收场。两个导入端点都测，它们各自 catch 一次。
    """
    response = admin_client.post(
        path,
        files={
            "file": (
                "upload.xlsx",
                NOT_A_WORKBOOK,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 422, response.text


def test_dual_import_answers_422_for_a_corrupt_pdf(admin_client) -> None:  # noqa: ANN001
    """双文件识别的 PDF 那一半同样不能 500。"""
    workbook = BytesIO()
    with zipfile.ZipFile(workbook, "w") as archive:
        archive.writestr("readme.txt", "not an xlsx")

    response = admin_client.post(
        "/api/v1/tax-invoice/import/dual",
        files={
            "invoiceFile": ("ci.xlsx", workbook.getvalue(), "application/vnd.ms-excel"),
            "customsFile": ("decl.pdf", b"%PDF-1.4 corrupt", "application/pdf"),
        },
    )

    assert response.status_code == 422, response.text
