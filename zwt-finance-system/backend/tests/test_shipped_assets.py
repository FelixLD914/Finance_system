"""随应用发布的资源必须真的在仓库里，且彼此自洽。

出票要用四份模板和一个泰文字体。它们以前放在 D:\\ZWTFinance\\data\\templates
下、不进版本控制，于是"clone 下来能不能跑"取决于那台机器上有没有人手工放过
文件——放错版本还不会报错，只会印出错的单据。现在都随应用发布，这个模块把
"发布了"和"是对的"两件事钉死。
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

from app.core.config import Settings
from app.modules.tax_invoice import pdf_layout

# 出票必需、且应当随仓库发布的路径型配置。attachment_root 不在此列：
# 那是运行期数据目录，由 Initialize-ZwtDev.ps1 创建，本来就该按机器配置。
SHIPPED_PATH_FIELDS = (
    "wht_template_path",
    "wht_pdf_template_path",
    "tax_invoice_template_path",
    "tax_invoice_pdf_template_path",
    "thai_font_path",
)


def _default_of(field_name: str) -> Path:
    """取字段的默认值，而不是 get_settings() 解析后的值。

    本机 .env 可能把路径覆盖到别处，那样测出来的就是这台机器的配置，
    而不是"clone 下来的人拿到什么"。
    """
    return Path(Settings.model_fields[field_name].default)


@pytest.mark.parametrize("field_name", SHIPPED_PATH_FIELDS)
def test_default_paths_point_at_files_that_ship_with_the_repo(field_name: str) -> None:
    path = _default_of(field_name)
    assert path.is_file(), (
        f"{field_name} 的默认值指向了仓库里不存在的文件：{path}\n"
        f"这会让新 clone 的人一出票就失败。"
    )
    assert path.stat().st_size > 0, f"{field_name} 指向了空文件：{path}"


def test_shipped_tax_inv_template_matches_the_pdf_plate() -> None:
    """随应用发布的 xlsx 必须就是制版时量坐标用的那一份。

    PDF 底版的叠加坐标是从某一份 xlsx 上量出来的，pdf_layout.py 头部记着那份
    模板的 sha256。两者一旦脱节，同一张单子的 xlsx 与 PDF 会印出不同的数字，
    而且两条链路各自都不报错——只有把校验和钉在这里才拦得住。
    """
    recorded = re.search(r"sha256:\s*([0-9a-f]{64})", pdf_layout.__doc__ or "")
    assert recorded, "pdf_layout.py 的 docstring 里找不到源模板 sha256"

    template = _default_of("tax_invoice_template_path")
    actual = hashlib.sha256(template.read_bytes()).hexdigest()
    assert actual == recorded.group(1), (
        "随应用发布的 TAX INV 模板与 PDF 底版对不上。\n"
        f"  模板 {actual}\n"
        f"  底版 {recorded.group(1)}\n"
        "改过模板就必须重新制版：scripts/build_tax_inv_underlay.py"
    )


def test_tax_inv_plate_has_one_page_per_copy() -> None:
    """底版页数要和三联对得上，否则叠加时会漏印或越界。"""
    from pypdf import PdfReader

    from app.modules.tax_invoice.document_generator import COPY_COUNT

    reader = PdfReader(str(_default_of("tax_invoice_pdf_template_path")))
    assert len(reader.pages) == COPY_COUNT == pdf_layout.PAGE_COUNT
