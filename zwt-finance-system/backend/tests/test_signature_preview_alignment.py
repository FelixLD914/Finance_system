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
# 样式分三层（styles/tokens, styles/global, ui/finance-ui），层叠里最后加载的赢，
# 所以守卫要扫全部而不是只扫 global.css。
CSS_ROOT = FRONTEND_ROOT / "src"
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


def _css_rules(selector: str) -> list[tuple[str, str]]:
    """在**全部**前端样式表里找这个选择器的声明块，返回 (文件名, 声明块)。

    不能只看 global.css：样式分三层（tokens / global / ui/finance-ui），
    finance-ui.css 最后加载、层叠里赢。只盯着 global.css 的守卫，会被另一个
    文件里的一句覆盖悄悄绕过去——那正是这条测试要拦的那类事故。
    """
    found: list[tuple[str, str]] = []
    for path in sorted(CSS_ROOT.rglob("*.css")):
        for match in re.finditer(
            rf"(?<![\w.-]){re.escape(selector)}\s*\{{(?P<body>[^}}]*)\}}",
            path.read_text(encoding="utf-8"),
        ):
            found.append((str(path.relative_to(FRONTEND_ROOT)), match.group("body")))
    assert found, f"前端样式表里找不到 {selector} 的规则（搜了 {CSS_ROOT}）"
    return found


def test_stamp_layer_is_not_displaced_by_a_transform() -> None:
    """签名图层的 left/bottom 是签名框左下角，任何 transform 都会让它整体漂走。

    这正是 2026-08-05 那次的成因：坐标表是对的，`translate(-50%, 50%)` 把
    WHT 的签名左移 47.5pt、下移 21pt，而且位移随缩放比变化——用户越照着预览调，
    离实际出票越远。同一个块里 `.pdf-field` 用 translate(-50%,-50%) 是对的
    （那些样例文字按中心定位），两者贴得很近，很容易抄串。
    """
    offenders = [
        (name, body.strip())
        for name, body in _css_rules(".exact-signature-overlay-box")
        if "transform" in body
    ]
    assert not offenders, (
        ".exact-signature-overlay-box 上又出现了 transform：\n"
        + "\n".join(f"  {name}: {body}" for name, body in offenders)
        + "\n这个盒子的 left/bottom 直接就是后端 drawImage 的 x/y（签名框左下角），"
        "不需要也不能有任何位移；要做居中缩放请改 SignaturePreviewModal.tsx 的 "
        "stampRectPt（围绕框中心算），别用 transform 兜。"
    )


def test_preview_page_container_uses_the_real_mediabox_ratio() -> None:
    """容器就是"整页"：叠加坐标全按它的百分比算，长宽比错了整层就跟着斜。"""
    ratios = [
        (name, re.search(r"aspect-ratio:\s*([\d.]+)\s*/\s*([\d.]+)", body))
        for name, body in _css_rules(".pdf-page-container")
    ]
    declared = [(name, m) for name, m in ratios if m]
    assert declared, ".pdf-page-container 没有任何一处声明 aspect-ratio"
    for name, match in declared:
        assert match is not None
        width, height = float(match.group(1)), float(match.group(2))
        assert (width, height) == (PAGE_WIDTH, PAGE_HEIGHT), (
            f"{name} 里 .pdf-page-container 的 aspect-ratio 写的是 {width} / {height}，"
            f"三份底版的 mediabox 是 {PAGE_WIDTH} x {PAGE_HEIGHT}。"
            "用 A4 的名义值（595.28 / 841.89）会让整层叠加有微小系统性偏移。"
        )


# 每张底图的内容由哪些文件决定：底版 + 把数据画上去的那套坐标。
# 与 scripts/build_signature_preview_backgrounds.py 的 LAYOUT_SOURCES 一一对应。
BACKGROUND_LAYOUT_SOURCES: dict[str, tuple[str, ...]] = {
    "wht-template-bg.webp": ("app/modules/wht/document_generator.py",),
    "tax-inv-template-bg.webp": (
        "app/modules/tax_invoice/document_generator.py",
        "app/modules/tax_invoice/pdf_layout.py",
    ),
    "salary-advance-template-bg.webp": (
        "app/modules/salary_advance/document_generator.py",
        "app/modules/salary_advance/pdf_layout.py",
    ),
}


def test_preview_backgrounds_are_rendered_from_the_current_plates_and_layout() -> None:
    """底图现在是"后端真出的那一页"的照片，底版**或坐标**一变就会静默过期。

    照片没法自证新旧（WebP 编码不保证可复现），所以记两个 sha：源底版的，
    以及决定字段落在哪儿的那几个模块文件的。只记底版是不够的——底版没动、
    TextAnchor 改了，底图照样是旧的，而预览的全部意义就是"所见即所出"。

    误报（改了 document_generator 的无关代码也会红）是故意选的方向：
    重出底图只要跑一条命令，而漏报要等用户拿着错位的预览调完比例才发现。
    """
    assert BACKGROUND_MANIFEST.is_file(), (
        f"缺 {BACKGROUND_MANIFEST.name}；"
        "跑 scripts/build_signature_preview_backgrounds.py 生成。"
    )
    manifest = json.loads(BACKGROUND_MANIFEST.read_text(encoding="utf-8"))
    assert set(manifest["backgrounds"]) == set(BACKGROUND_LAYOUT_SOURCES), (
        "清单里的底图与本测试记的布局来源对不上，"
        "改了 build_signature_preview_backgrounds.py 的 LAYOUT_SOURCES 要同步这里。"
    )
    stale: list[str] = []
    for image_name, entry in manifest["backgrounds"].items():
        assert (PUBLIC_DIR / image_name).is_file(), f"底图 {image_name} 不存在"
        plate = TEMPLATE_DIR / entry["source"]
        if hashlib.sha256(plate.read_bytes()).hexdigest() != entry["sourceSha256"]:
            stale.append(f"{image_name}（源底版 {entry['source']} 已变）")
            continue
        digest = hashlib.sha256()
        for relative in BACKGROUND_LAYOUT_SOURCES[image_name]:
            digest.update((BACKEND_ROOT / relative).read_bytes())
        if digest.hexdigest() != entry.get("layoutSha256"):
            stale.append(f"{image_name}（出票坐标/生成代码已变）")
    assert not stale, (
        "这些签名预览底图已经不是当前出票效果了：" + "、".join(stale) + "\n"
        "重出底图：python ..\\scripts\\build_signature_preview_backgrounds.py"
    )


def test_preview_no_longer_hand_places_sample_text() -> None:
    """样例文字必须来自底图（后端真出的那一页），不能再在前端按百分比手摆。

    手摆那套字体、断词、列宽全靠猜，与底版必然对不上，而且对错了没有任何东西
    会报警——2026-08-05 用户实拍：TAX INV 的品名被裁掉半个字（EXPORT→XPORT）、
    报关单号压在泰文标签上、工资预支的金额盖住表单印刷字。
    """
    source = PREVIEW_TSX.read_text(encoding="utf-8")
    for marker in ("overlay-sample-layer", "pdf-field"):
        assert marker not in source, (
            f"{PREVIEW_TSX.name} 里又出现了 {marker}：手工摆的样例文字层已经删掉，"
            "不要加回来。要改样例数据请改 "
            "scripts/build_signature_preview_backgrounds.py 里的样例并重出底图。"
        )
