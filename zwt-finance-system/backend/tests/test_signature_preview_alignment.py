"""签名维护页的预览，必须和真正出票时的盖章位置一致。

预览是用户唯一能"看见"签名会盖在哪儿的地方。它一旦和后端 ReportLab 的坐标脱节，
用户按预览调好的缩放比，出票时盖出来是另一个位置——而且两边各自都不报错。

2026-08-04 就这么出过一次：工资预支底版当天重制四轮，前端把 leftPercent 更新到了
新坐标，bottomPercent 忘了改，预览里的签名比实际出票低约 12.9pt（4.5mm）。

2026-08-05 又发现一次，而且当时这个文件是绿的：四个百分比确实与后端对得上，
偏移全在它们底下的那层 CSS 里——`.exact-signature-overlay-box` 上挂着一句
`transform: translate(-50%, 50%)`，把签名整体左移半个框宽、下移半个框高
（WHT 47.5pt/21pt，TAX INV 75pt/23pt），位移量还随缩放比变。教训是：
**光钉数字不够，把数字画到屏幕上的那几行也要钉。**

所以这个文件现在钉三样东西：
1. 坐标表（前端改用 PDF 点，与后端同单位，逐字比对，不再"换算完再比"）；
2. 渲染这些坐标的 CSS 不得再引入位移；
3. 预览底图必须是用当前底版渲染的。
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
GLOBAL_CSS = FRONTEND_ROOT / "src" / "styles" / "global.css"
PUBLIC_DIR = FRONTEND_ROOT / "public"
BACKGROUND_MANIFEST = PUBLIC_DIR / "signature-preview-backgrounds.json"
TEMPLATE_DIR = BACKEND_ROOT / "app" / "assets" / "templates"

# 三份底版的 mediabox 都是它，原点 (0,0)、无 CropBox 偏移、无 /Rotate。
PAGE_WIDTH, PAGE_HEIGHT = 595.25, 841.85

# 前端现在直接写 PDF 点，抄错一位就是一位；留 0.01pt 只为浮点表示误差。
TOLERANCE_PT = 0.01

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
    r"x:\s*(?P<x>[\d.]+),\s*"
    r"y:\s*(?P<y>[\d.]+),\s*"
    r"width:\s*(?P<width>[\d.]+),\s*"
    r"height:\s*(?P<height>[\d.]+),?\s*\}"
)


def _frontend_boxes() -> dict[str, dict[str, float]]:
    source = PREVIEW_TSX.read_text(encoding="utf-8")
    found = {
        match.group("usage"): {
            key: float(match.group(key)) for key in ("x", "y", "width", "height")
        }
        for match in _ENTRY.finditer(source)
    }
    assert found, (
        f"没能从 {PREVIEW_TSX.name} 里解析出任何签名框。"
        "改了 SIGNATURE_BOXES_PT 的写法就要同步改这里的正则——"
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
    expected = dict(zip(("x", "y", "width", "height"), EXPECTED_BOXES[usage], strict=True))
    for label, expected_pt in expected.items():
        drift = box[label] - expected_pt
        assert abs(drift) <= TOLERANCE_PT, (
            f"{usage} 的预览 {label} 与后端盖章框差 {drift:+.2f}pt "
            f"({drift * 25.4 / 72:+.2f}mm)：\n"
            f"  预览 {box[label]:.2f}pt / 后端 {expected_pt:.2f}pt\n"
            f"  SignaturePreviewModal.tsx 的 SIGNATURE_BOXES_PT 里应写 {expected_pt}"
        )


def _css_rule(selector: str) -> str:
    """取 global.css 里某个选择器的声明块（本文件只需要精确匹配的单选择器规则）。"""
    source = GLOBAL_CSS.read_text(encoding="utf-8")
    match = re.search(
        rf"(?<![\w.-]){re.escape(selector)}\s*\{{(?P<body>[^}}]*)\}}", source
    )
    assert match, f"{GLOBAL_CSS.name} 里找不到 {selector} 的样式规则"
    return match.group("body")


def test_stamp_layer_is_not_displaced_by_a_transform() -> None:
    """签名图层的 left/bottom 是签名框左下角，任何 transform 都会让它整体漂走。

    这正是 2026-08-05 那次的成因：坐标表是对的，`translate(-50%, 50%)` 把
    WHT 的签名左移 47.5pt、下移 21pt，而且位移随缩放比变化——用户越照着预览调，
    离实际出票越远。同一个块里 `.pdf-field` 用 translate(-50%,-50%) 是对的
    （那些样例文字按中心定位），两者贴得很近，很容易抄串。
    """
    body = _css_rule(".exact-signature-overlay-box")
    assert "transform" not in body, (
        ".exact-signature-overlay-box 上又出现了 transform。\n"
        "这个盒子的 left/bottom 直接就是后端 drawImage 的 x/y（签名框左下角），"
        "不需要也不能有任何位移；要做居中缩放请改 SignaturePreviewModal.tsx 的 "
        "stampRectPt（围绕框中心算），别用 transform 兜。\n"
        f"当前声明块：{body.strip()}"
    )


def test_preview_page_container_uses_the_real_mediabox_ratio() -> None:
    """容器就是"整页"：叠加坐标全按它的百分比算，长宽比错了整层就跟着斜。"""
    body = _css_rule(".pdf-page-container")
    match = re.search(r"aspect-ratio:\s*([\d.]+)\s*/\s*([\d.]+)", body)
    assert match, f".pdf-page-container 缺 aspect-ratio：{body.strip()}"
    width, height = float(match.group(1)), float(match.group(2))
    assert (width, height) == (PAGE_WIDTH, PAGE_HEIGHT), (
        f".pdf-page-container 的 aspect-ratio 写的是 {width} / {height}，"
        f"三份底版的 mediabox 是 {PAGE_WIDTH} x {PAGE_HEIGHT}。"
        "用 A4 的名义值（595.28 / 841.89）会让整层叠加有微小系统性偏移。"
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
