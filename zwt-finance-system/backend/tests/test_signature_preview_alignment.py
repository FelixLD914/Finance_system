"""签名维护页的预览，必须和真正出票时的盖章位置一致。

预览是用户唯一能"看见"签名会盖在哪儿的地方。它一旦和后端 ReportLab 的坐标脱节，
用户按预览调好的缩放比，出票时盖出来是另一个位置——而且两边各自都不报错。

2026-08-04 就这么出过一次：工资预支底版当天重制四轮，前端把 leftPercent 更新到了
新坐标，bottomPercent 忘了改，预览里的签名比实际出票低约 12.9pt（4.5mm）。

前端写的是百分比（相对底图），后端写的是 PDF 点。同一份坐标存在两个地方、
两种单位，就一定会漂——所以在这里把它们钉在一起。
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import pytest

from app.modules.salary_advance import pdf_layout as salary_layout
from app.modules.tax_invoice.document_generator import SIGNATURE_BOX as TAX_INV_BOX
from app.modules.wht.document_generator import PDF_SIGNATURE_BOX as WHT_BOX

BACKEND_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = BACKEND_ROOT.parent / "frontend"
PREVIEW_TSX = (
    FRONTEND_ROOT / "src" / "modules" / "administration" / "SignaturePreviewModal.tsx"
)
PUBLIC_DIR = FRONTEND_ROOT / "public"
BACKGROUND_MANIFEST = PUBLIC_DIR / "signature-preview-backgrounds.json"
TEMPLATE_DIR = BACKEND_ROOT / "app" / "assets" / "templates"

# 三份底版都是 A4，前端按同一个页面尺寸换算百分比。
PAGE_WIDTH, PAGE_HEIGHT = 595.25, 841.85

# 允许的偏差。前端只写两位小数，0.01pp 本身就值 0.06pt/0.08pt；
# 0.5pt(0.18mm) 以内属于写法精度，超过就是真的对不上了。
TOLERANCE_PT = 0.5

# 前端的 usage 名 -> 后端那个签名框 (x, y, 宽, 高)，单位 PDF 点。
EXPECTED_BOXES: dict[str, tuple[float, float, float, float]] = {
    "wht": WHT_BOX,
    "tax_inv": TAX_INV_BOX,
    # 通用 salary_advance 预览的是财务位（与 SignaturePreviewModal 的标题一致）。
    "salary_advance": salary_layout.SIGNATURE_BOXES["finance"],
    "salary_advance_finance": salary_layout.SIGNATURE_BOXES["finance"],
    "salary_advance_md": salary_layout.SIGNATURE_BOXES["md"],
}

_ENTRY = re.compile(
    r"(?P<usage>\w+):\s*\{\s*"
    r"bgImage:.*?"
    r"sigBox:\s*\{\s*"
    r"leftPercent:\s*(?P<left>[\d.]+),\s*"
    r"bottomPercent:\s*(?P<bottom>[\d.]+),\s*"
    r"widthPercent:\s*(?P<width>[\d.]+),\s*"
    r"heightPercent:\s*(?P<height>[\d.]+),?\s*\}",
    re.DOTALL,
)


def _frontend_boxes() -> dict[str, dict[str, float]]:
    source = PREVIEW_TSX.read_text(encoding="utf-8")
    found = {
        match.group("usage"): {
            key: float(match.group(key))
            for key in ("left", "bottom", "width", "height")
        }
        for match in _ENTRY.finditer(source)
    }
    assert found, (
        f"没能从 {PREVIEW_TSX.name} 里解析出任何 sigBox。"
        "改了 TEMPLATE_CONFIGS 的写法就要同步改这里的正则——"
        "解析不到会让这条测试静默失效。"
    )
    return found


def test_preview_covers_every_signature_usage() -> None:
    """前端少配一个 usage，那个单据的预览就会退化成默认模板，必须拦住。"""
    missing = sorted(set(EXPECTED_BOXES) - set(_frontend_boxes()))
    assert not missing, f"SignaturePreviewModal 缺这些 usage 的预览配置：{missing}"


@pytest.mark.parametrize("usage", sorted(EXPECTED_BOXES))
def test_preview_box_matches_backend_stamp_box(usage: str) -> None:
    box = _frontend_boxes()[usage]
    x, y, width, height = EXPECTED_BOXES[usage]
    for label, actual_pt, expected_pt in (
        ("left", box["left"] / 100 * PAGE_WIDTH, x),
        ("bottom", box["bottom"] / 100 * PAGE_HEIGHT, y),
        ("width", box["width"] / 100 * PAGE_WIDTH, width),
        ("height", box["height"] / 100 * PAGE_HEIGHT, height),
    ):
        drift = actual_pt - expected_pt
        assert abs(drift) <= TOLERANCE_PT, (
            f"{usage} 的预览 {label} 与后端盖章框差 {drift:+.2f}pt "
            f"({drift * 25.4 / 72:+.2f}mm)：\n"
            f"  预览 {actual_pt:.2f}pt / 后端 {expected_pt:.2f}pt\n"
            f"  应写 {expected_pt / (PAGE_WIDTH if label in ('left', 'width') else PAGE_HEIGHT) * 100:.2f}"
        )


def test_preview_backgrounds_are_rendered_from_the_current_plates() -> None:
    """底图是底版的一张照片，底版重制后不重出就会静默过期。

    底图本身没法自证新旧（PNG 编码不保证可复现），所以记的是源底版的 sha256。
    """
    assert BACKGROUND_MANIFEST.is_file(), (
        f"缺 {BACKGROUND_MANIFEST.name}；"
        "跑 scripts/build_signature_preview_backgrounds.py 生成。"
    )
    manifest = json.loads(BACKGROUND_MANIFEST.read_text(encoding="utf-8"))
    stale: list[str] = []
    for png_name, entry in manifest["backgrounds"].items():
        assert (PUBLIC_DIR / png_name).is_file(), f"底图 {png_name} 不存在"
        plate = TEMPLATE_DIR / entry["source"]
        actual = hashlib.sha256(plate.read_bytes()).hexdigest()
        if actual != entry["sourceSha256"]:
            stale.append(f"{png_name}（源 {entry['source']} 已变）")
    assert not stale, (
        "这些签名预览底图是用旧底版渲染的：" + "、".join(stale) + "\n"
        "重制过底版就要重出底图："
        "python ..\\scripts\\build_signature_preview_backgrounds.py"
    )
