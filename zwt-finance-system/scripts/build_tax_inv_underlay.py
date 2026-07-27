"""一次性制版：生成 TAX INV 的 PDF 底版和叠加坐标表。

只在装了 Excel 的开发机上跑；生产运行期完全不碰 Office/COM。

    cd zwt-finance-system\\backend
    .\\.venv\\Scripts\\python.exe ..\\scripts\\build_tax_inv_underlay.py

流程：
1. render_clean_template_workbook 清掉三联里所有数据格，Excel 导出成底版 PDF；
2. 再导出两份"探针" PDF——同一张模板填入长度不同的假数据；
3. 用 pdfplumber 读回每个字段真正的落笔位置，靠"换一组长度后哪个边不动"
   反推对齐方式（左/中/右），两份探针必须给出同样的结论、同样的基线；
4. 坐标写进 app/modules/tax_invoice/pdf_layout.py。

坐标全部量出来，不靠目测。探针值刻意做成每格互不相同，
定位不到或对不上就直接报错，不会悄悄写出一张错位的坐标表。
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.modules.tax_invoice.document_generator import (  # noqa: E402
    COPY_COUNT,
    HEADER_CELLS,
    ITEM_COLUMN_FIELDS,
    MAX_ITEMS,
    TOTAL_CELLS,
    format_amount,
    format_quantity,
    format_rate,
    render_clean_template_workbook,
    render_tax_invoice_workbook,
)
from app.modules.tax_invoice.models import TaxInvoice, TaxInvoiceItem  # noqa: E402

DEFAULT_TEMPLATE = Path(r"D:\ZWTFinance\data\templates\TAX-INV-Template.xlsx")
DEFAULT_UNDERLAY = BACKEND_ROOT / "app" / "assets" / "templates" / "TAX-INV-Template.pdf"
DEFAULT_LAYOUT = BACKEND_ROOT / "app" / "modules" / "tax_invoice" / "pdf_layout.py"

PROBE_DATE = date(2026, 6, 8)
PROBE_RATE = Decimal("32.4567")
# 表头在第 13~19 行（基线 612~672），明细区最高的一行是 555，互不重叠。
# 发票日期在表头和明细的"汇率日期"列是同一个字符串，靠这个带子分开。
HEADER_BAND = (600.0, 700.0)
# 合计区在页面下半部分；明细最后一行基线约 314，取 150..310 不会误伤明细。
TOTALS_BAND = (150.0, 310.0)
# 取"同一行"的容差。除了泰文字形本身会差零点几个点，合计区的标签还是
# 两行居中排的（"รวมเงิน (THB)" / "Total Amount" 分别在 ±4.2），要一起罩住。
# 上限受表头行距约束：13~14 点，所以不能超过 6。
ROW_TOLERANCE = 5.0
# 两份探针之间，锚点允许的最大偏差；超过说明对齐方式判错了。
ANCHOR_EPSILON = 0.4
# 被选中的对齐方式必须比另外两个候选"稳"这么多，否则判为无法区分。
ANCHOR_MARGIN = 1.0

# 模板里声明的对齐方式，仅用于和量出来的结果对照。会计格式会覆盖单元格
# 的水平对齐（R45/R51 声明 center、实际靠右），所以最终以量出来的为准。
DECLARED_ALIGNMENT = {
    "customer_name": "left",
    "customer_address": "left",
    "tax_id": "left",
    "po_no": "left",
    "payment_term": "left",
    "document_no": "right",
    "invoice_date": "right",
    "line_number": "center",
    "product_name": "left",
    "product_code": "left",
    "unit": "center",
    "quantity": "right",
    "fob_unit_price_usd": "right",
    "fob_revenue_usd": "right",
    "fx_date": "center",
    "exchange_rate": "right",
    "fob_revenue_thb": "right",
    "amount_text_thai": "left",
    "total_thb": "right",
    "after_discount_thb": "right",
    "grand_total_thb": "right",
}
# 整列重复同一个值的字段（发票级的日期/汇率），无法靠文本区分行，
# 只能按基线从上到下配 18 行。
REPEATED_ITEM_FIELDS = ("fx_date", "exchange_rate")
# 明细里需要限宽的文字列：左对齐的可以溢出到右边的空列，居中的只能待在本格。
ITEM_WIDTH_RULES = {
    "product_name": "overflow",
    "product_code": "overflow",
    "unit": "cell",
}


class PlateError(RuntimeError):
    pass


@dataclass(frozen=True)
class Box:
    text: str
    x0: float
    x1: float
    baseline: float
    size: float

    def anchor(self, alignment: str) -> float:
        if alignment == "left":
            return self.x0
        if alignment == "right":
            return self.x1
        return (self.x0 + self.x1) / 2


# --------------------------------------------------------------------------- probes


def _probe_invoice(variant: int) -> TaxInvoice:
    # 探针值必须短：单据号是右对齐的，太长会一直顶到左边的标签上，
    # pdfplumber 就把标签和值当成同一个"词"了，定位不到。
    suffix = "A" if variant == 0 else "ABC"
    return TaxInvoice(
        document_no=f"ZDN{suffix}",
        status="approved",
        ci_no="CI-PROBE",
        invoice_date=PROBE_DATE,
        exchange_target_date=PROBE_DATE,
        exchange_rate_date=PROBE_DATE,
        currency="USD",
        exchange_rate=PROBE_RATE,
        customer_name=f"ZCN{suffix}",
        customer_address=f"ZCA{suffix}",
        tax_id=f"ZTX{suffix}",
        po_no=f"ZPO{suffix}",
        payment_term=f"ZPT{suffix}",
        fob_revenue_usd_total=Decimal("0"),
        fob_revenue_thb_total=Decimal("0"),
        created_by_name="probe",
        updated_by_name="probe",
    )


def _probe_amount(base: int, line: int, variant: int) -> Decimal:
    """每格数字互不相同，两份探针的整数位数差一位——判对齐就靠这个长度差。

    位数不能再往上加：第三联的列比第一联窄，单价列到 11 个字符 Excel 就印成
    ####，量出来的就不是数字的边了。
    """
    integer_part = base // 10 + line if variant == 0 else base + line
    return Decimal(integer_part) + Decimal("0.25") * (line % 3)


def _probe_items(variant: int) -> list[TaxInvoiceItem]:
    pad = variant + 1
    return [
        TaxInvoiceItem(
            line_number=line,
            product_name=f"PN{line}" + "X" * (line % 4 + pad),
            product_code=f"PC{line}" + "Y" * ((line + 1) % 4 + pad),
            unit=f"U{line}" + "Z" * ((line + 2) % 3),
            quantity=_probe_amount(1000, line, variant),
            fob_unit_price_usd=_probe_amount(2000, line, variant),
            fob_revenue_usd=_probe_amount(3000, line, variant),
            fob_revenue_thb=_probe_amount(4000, line, variant),
        )
        for line in range(1, MAX_ITEMS + 1)
    ]


def _expected_texts(variant: int) -> tuple[dict[str, str], dict[str, list[str]], dict[str, str]]:
    """探针值在 Excel 里应当渲染成的字符串。

    数字用的是 document_generator 里那套格式化函数——也就是 PDF 叠加层用的
    同一套。要是它和 Excel 的数字格式对不上，这里就会找不到文本直接失败，
    等于顺带验了一遍格式化逻辑。
    """
    invoice = _probe_invoice(variant)
    items = _probe_items(variant)
    header = {
        "customer_name": invoice.customer_name,
        "customer_address": invoice.customer_address,
        "tax_id": invoice.tax_id or "",
        "po_no": invoice.po_no or "",
        "payment_term": invoice.payment_term or "",
        "document_no": invoice.document_no or "",
        "invoice_date": PROBE_DATE.strftime("%d/%m/%Y"),
    }
    item_texts: dict[str, list[str]] = {
        "line_number": [str(item.line_number) for item in items],
        "product_name": [item.product_name or "" for item in items],
        "product_code": [item.product_code or "" for item in items],
        "unit": [item.unit or "" for item in items],
        "quantity": [format_quantity(item.quantity) for item in items],
        "fob_unit_price_usd": [format_rate(item.fob_unit_price_usd) for item in items],
        "fob_revenue_usd": [format_amount(item.fob_revenue_usd) for item in items],
        "fx_date": [PROBE_DATE.strftime("%d/%m/%Y")] * MAX_ITEMS,
        "exchange_rate": [format_rate(PROBE_RATE)] * MAX_ITEMS,
        "fob_revenue_thb": [format_amount(item.fob_revenue_thb) for item in items],
    }
    total = sum((item.fob_revenue_thb or Decimal("0") for item in items), Decimal("0"))
    totals = {
        # R42 / R45 / R51 三个格在没有折扣和 VAT 时是同一个数，
        # 靠基线从上到下区分，见 _locate_totals。
        "total_thb": format_amount(total),
        "after_discount_thb": format_amount(total),
        "grand_total_thb": format_amount(total),
    }
    return header, item_texts, totals


# ------------------------------------------------------------------------ pdf plumbing


def export_pdf(xlsx_path: Path, pdf_path: Path) -> None:
    import win32com.client

    excel = win32com.client.DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    try:
        workbook = excel.Workbooks.Open(str(xlsx_path), UpdateLinks=0, ReadOnly=True)
        try:
            workbook.ExportAsFixedFormat(0, str(pdf_path))
        finally:
            workbook.Close(False)
    finally:
        excel.Quit()
    if not pdf_path.is_file():
        raise PlateError(f"Excel did not produce {pdf_path}")


def page_boxes(page) -> list[Box]:
    """把一页拆成"词 + 基线"。基线取字符文本矩阵的 f 分量，正好是

    ReportLab drawString 要的那个 y，不用去猜字体的下伸部有多高。
    """
    boxes: list[Box] = []
    chars = page.chars
    for word in page.extract_words(keep_blank_chars=False):
        # 用竖直方向"有重叠"来归属字符，不能用 top 相等：泰文一个词里
        # 抬高的符号 top 和正文差好几个点，按 top 筛会只剩那个符号。
        inside = [
            char
            for char in chars
            if char["x0"] >= word["x0"] - 0.1
            and char["x1"] <= word["x1"] + 0.1
            and char["bottom"] > word["top"] - 0.5
            and char["top"] < word["bottom"] + 0.5
        ]
        if not inside:
            continue
        # 取众数而不是第一个字符：泰文的上下标符号是抬高一截画的，
        # 一个词里各字符的基线并不相同，正文那条才是要的。
        tally = Counter(round(char["matrix"][5], 3) for char in inside)
        boxes.append(
            Box(
                text=word["text"],
                x0=word["x0"],
                x1=word["x1"],
                baseline=tally.most_common(1)[0][0],
                size=inside[0]["size"],
            )
        )
    return boxes


def _unique(
    boxes: list[Box],
    text: str,
    where: str,
    band: tuple[float, float] | None = None,
) -> Box:
    found = [
        box
        for box in boxes
        if box.text == text and (band is None or band[0] <= box.baseline <= band[1])
    ]
    if len(found) != 1:
        raise PlateError(f"{where}: expected exactly one {text!r}, found {len(found)}")
    return found[0]


def _locate_items_by_geometry(
    boxes: list[Box],
    baselines: dict[str, list[float]],
) -> dict[str, list[Box]]:
    """副联按几何认列，不按文本。

    renderer 只覆盖了第一联的数字格式，两联 COPY 用的还是模板自带的会计格式，
    同一个数在副联上可能少几位小数（数量列尤其明显）。副联每行恰好 10 个非空格，
    所以用"基线对得上 + 从左往右第几个"来认列，比预测副联的格式串靠谱得多。
    """
    fields = [field for field, _ in ITEM_COLUMN_FIELDS]
    located: dict[str, list[Box]] = {field: [] for field in fields}
    for line in range(MAX_ITEMS):
        wanted = {baselines[field][line] for field in fields}
        row = sorted(
            (box for box in boxes if any(abs(box.baseline - value) <= 0.05 for value in wanted)),
            key=lambda box: box.x0,
        )
        if len(row) != len(fields):
            raise PlateError(
                f"copy item line {line + 1}: expected {len(fields)} cells, found {len(row)}: "
                f"{[box.text for box in row]}"
            )
        for field, box in zip(fields, row, strict=True):
            located[field].append(box)
    return located


def _locate_items(boxes: list[Box], texts: dict[str, list[str]]) -> dict[str, list[Box]]:
    located: dict[str, list[Box]] = {}
    for field, expected in texts.items():
        if field in REPEATED_ITEM_FIELDS:
            continue
        located[field] = [
            _unique(boxes, value, f"item {field} line {index + 1}")
            for index, value in enumerate(expected)
        ]
    # 明细区的纵向范围由能唯一定位的列决定，再用它去框重复值的列。
    baselines = [box.baseline for column in located.values() for box in column]
    low, high = min(baselines) - 2.0, max(baselines) + 2.0
    for field in REPEATED_ITEM_FIELDS:
        value = texts[field][0]
        found = sorted(
            (box for box in boxes if box.text == value and low <= box.baseline <= high),
            key=lambda box: box.baseline,
            reverse=True,
        )
        if len(found) != MAX_ITEMS:
            raise PlateError(
                f"item {field}: expected {MAX_ITEMS} occurrences of {value!r}, found {len(found)}"
            )
        located[field] = found
    return located


def _locate_totals(boxes: list[Box], texts: dict[str, str]) -> dict[str, Box]:
    low, high = TOTALS_BAND
    value = texts["total_thb"]
    found = sorted(
        (box for box in boxes if box.text == value and low <= box.baseline <= high),
        key=lambda box: box.baseline,
        reverse=True,
    )
    if len(found) != 3:
        raise PlateError(
            f"totals: expected 3 occurrences of {value!r} between {low} and {high}, "
            f"found {len(found)}"
        )
    located = dict(zip(("total_thb", "after_discount_thb", "grand_total_thb"), found, strict=True))
    thai = [
        box
        for box in boxes
        if box.text.startswith("(") and low <= box.baseline <= high and box.x0 < 300
    ]
    if not thai:
        raise PlateError("totals: BAHTTEXT cell was not found")
    located["amount_text_thai"] = min(thai, key=lambda box: box.x0)
    return located


def detect_alignment(samples: list[tuple[Box, Box]], field: str) -> str:
    """两组样本里哪条边不动，就是哪种对齐。

    样本是 (探针A 的框, 探针B 的框)；文字长度不同的样本才有区分度。
    """
    usable = [(a, b) for a, b in samples if len(a.text) != len(b.text)]
    if not usable:
        # 定长字段（日期、汇率）：三种锚点算出来的位置一模一样，随便用哪个都对。
        declared = DECLARED_ALIGNMENT[field]
        for box_a, box_b in samples:
            if abs(box_a.anchor(declared) - box_b.anchor(declared)) > ANCHOR_EPSILON:
                raise PlateError(f"{field}: fixed-width samples disagree on {declared} anchor")
        return declared
    drift = {
        alignment: max(abs(a.anchor(alignment) - b.anchor(alignment)) for a, b in usable)
        for alignment in ("left", "center", "right")
    }
    best = min(drift, key=lambda key: drift[key])
    others = min(value for key, value in drift.items() if key != best)
    if drift[best] > ANCHOR_EPSILON or others - drift[best] < ANCHOR_MARGIN:
        raise PlateError(f"{field}: alignment is ambiguous, drift={drift}")
    return best


def _cell_edges(page, baseline: float) -> list[float]:
    """明细行的单元格竖边（Excel 把边框画成了细长方形）。"""
    row_top = float(page.height) - baseline
    edges: list[float] = []
    for rect in page.rects:
        if rect["top"] <= row_top - 1.0 and rect["bottom"] >= row_top + 1.0:
            edges.extend((float(rect["x0"]), float(rect["x1"])))
    merged: list[float] = []
    for edge in sorted(edges):
        if not merged or edge - merged[-1] > 0.8:
            merged.append(edge)
    return merged


def _item_widths(
    page,
    located: dict[str, list[Box]],
    alignments: dict[str, str],
) -> dict[str, float]:
    """文字列能占多宽：左对齐的可以像 Excel 那样溢出到右边的空列。"""
    reference = located["product_name"][1]
    edges = _cell_edges(page, reference.baseline)
    order = [field for field, _ in ITEM_COLUMN_FIELDS]
    cell_left: dict[str, float] = {}
    cell_right: dict[str, float] = {}
    for field in order:
        anchor = located[field][1].anchor(alignments[field])
        left = [edge for edge in edges if edge <= anchor + 0.4]
        right = [edge for edge in edges if edge >= anchor - 0.4]
        if left:
            cell_left[field] = max(left)
        if right:
            cell_right[field] = min(right)

    widths: dict[str, float] = {}
    for field, rule in ITEM_WIDTH_RULES.items():
        anchor = located[field][1].anchor(alignments[field])
        if rule == "cell":
            if field in cell_left and field in cell_right:
                widths[field] = cell_right[field] - cell_left[field] - 2.0
            continue
        following = order[order.index(field) + 1 :]
        bound = next(
            (cell_left[name] for name in following if name in cell_left),
            cell_right.get(field),
        )
        if bound is not None:
            widths[field] = bound - anchor - 1.0
    return {field: round(width, 2) for field, width in widths.items() if width > 0}


def _static_bound(page, baseline: float, after_x: float) -> float | None:
    """底版上同一行里下一段固定文字的左边——文字最多能画到那儿。"""
    candidates = [
        float(char["x0"])
        for char in page.chars
        if abs(char["matrix"][5] - baseline) <= ROW_TOLERANCE and char["x0"] > after_x + 1.0
    ]
    return min(candidates) if candidates else None


# ------------------------------------------------------------------------- emit layout


def _fmt(value: float) -> str:
    return f"{value:.2f}"


def _anchor_row(name: str, anchors: list[dict[str, float | str | None]]) -> str:
    parts = []
    for anchor in anchors:
        width = anchor["max_width"]
        width_text = "None" if width is None else _fmt(float(width))
        parts.append(
            f"        TextAnchor({_fmt(float(anchor['x']))}, "
            f"{anchor['align']!r}, {_fmt(float(anchor['size']))}, {width_text}),"
        )
    body = "\n".join(parts)
    return f"    {name!r}: (\n{body}\n    ),"


def render_layout_module(
    template_sha256: str,
    page_size: tuple[float, float],
    header: dict[str, list[dict]],
    header_baselines: dict[str, float],
    items: dict[str, list[dict]],
    item_baselines: dict[str, list[float]],
    totals: dict[str, list[dict]],
    total_baselines: dict[str, float],
) -> str:
    def block(title: str, anchors: dict[str, list[dict]]) -> str:
        rows = "\n".join(_anchor_row(name, value) for name, value in anchors.items())
        return f"{title}: dict[str, tuple[TextAnchor, ...]] = {{\n{rows}\n}}"

    def baselines(title: str, values: dict[str, float]) -> str:
        rows = "\n".join(f"    {name!r}: {_fmt(value)}," for name, value in values.items())
        return f"{title}: dict[str, float] = {{\n{rows}\n}}"

    item_rows = "\n".join(
        "    {!r}: (\n{}\n    ),".format(
            name,
            "\n".join(f"        {_fmt(value)}," for value in values),
        )
        for name, values in item_baselines.items()
    )
    return f'''"""TAX INV 底版的叠加坐标（自动生成，不要手改）。

由 scripts/build_tax_inv_underlay.py 从 TAX-INV-Template.pdf 的制版过程中量出，
和同目录下的底版一一对应。模板 xlsx 一旦改动，底版和这张表必须一起重新生成。

源模板 sha256: {template_sha256}

坐标单位是 PDF 点，原点在页面左下角——正好是 ReportLab 的坐标系。
baseline 是文字基线的 y，直接喂给 drawString 即可。三联在同一张工作表的
同样几行上，所以三页的 y 完全相同，只有 x 分页存放。
"""

from __future__ import annotations

from typing import Literal, NamedTuple

Alignment = Literal["left", "center", "right"]


class TextAnchor(NamedTuple):
    x: float
    align: Alignment
    size: float
    max_width: float | None = None


PAGE_SIZE = ({_fmt(page_size[0])}, {_fmt(page_size[1])})
PAGE_COUNT = {COPY_COUNT}

{block("HEADER_ANCHORS", header)}

{baselines("HEADER_BASELINES", header_baselines)}

{block("ITEM_ANCHORS", items)}

ITEM_BASELINES: dict[str, tuple[float, ...]] = {{
{item_rows}
}}

{block("TOTAL_ANCHORS", totals)}

{baselines("TOTAL_BASELINES", total_baselines)}
'''


# ------------------------------------------------------------------------------- main


def build(template: Path, underlay: Path, layout: Path, workdir: Path) -> None:
    import pdfplumber

    if not template.is_file():
        raise PlateError(f"template was not found: {template}")

    clean_xlsx = workdir / "underlay.xlsx"
    clean_xlsx.write_bytes(render_clean_template_workbook(template))
    clean_pdf = workdir / "underlay.pdf"
    export_pdf(clean_xlsx, clean_pdf)
    print(f"[1/4] underlay exported: {clean_pdf}")

    probes: list[list[list[Box]]] = []
    for variant in (0, 1):
        probe_xlsx = workdir / f"probe{variant}.xlsx"
        probe_xlsx.write_bytes(
            render_tax_invoice_workbook(template, _probe_invoice(variant), _probe_items(variant))
        )
        probe_pdf = workdir / f"probe{variant}.pdf"
        export_pdf(probe_xlsx, probe_pdf)
        with pdfplumber.open(probe_pdf) as pdf:
            probes.append([page_boxes(page) for page in pdf.pages])
        print(f"[2/4] probe {variant} exported and read: {probe_pdf}")

    for variant, pages in enumerate(probes):
        if len(pages) != COPY_COUNT:
            raise PlateError(f"probe {variant}: expected {COPY_COUNT} pages, got {len(pages)}")

    header_boxes: list[list[dict[str, Box]]] = []
    item_boxes: list[list[dict[str, list[Box]]]] = []
    total_boxes: list[list[dict[str, Box]]] = []
    for variant, pages in enumerate(probes):
        expected_header, expected_items, expected_totals = _expected_texts(variant)
        header_boxes.append(
            [
                {
                    field: _unique(boxes, text, f"header {field} page {index}", HEADER_BAND)
                    for field, text in expected_header.items()
                }
                for index, boxes in enumerate(pages)
            ]
        )
        # 第一联用文本定位：找得到就等于证明了 format_* 和 Excel 的数字格式一致。
        original = _locate_items(pages[0], expected_items)
        baselines = {
            field: [box.baseline for box in column] for field, column in original.items()
        }
        item_boxes.append(
            [original, *(_locate_items_by_geometry(boxes, baselines) for boxes in pages[1:])]
        )
        total_boxes.append([_locate_totals(boxes, expected_totals) for boxes in pages])
    print("[3/4] every probe value located on all three pages")

    alignments: dict[str, str] = {}
    for field in HEADER_CELLS:
        samples = [
            (header_boxes[0][page][field], header_boxes[1][page][field])
            for page in range(COPY_COUNT)
        ]
        alignments[field] = detect_alignment(samples, field)
    for field, _ in ITEM_COLUMN_FIELDS:
        samples = [
            (item_boxes[0][page][field][line], item_boxes[1][page][field][line])
            for page in range(COPY_COUNT)
            for line in range(MAX_ITEMS)
        ]
        alignments[field] = detect_alignment(samples, field)
    for field in TOTAL_CELLS:
        samples = [
            (total_boxes[0][page][field], total_boxes[1][page][field])
            for page in range(COPY_COUNT)
        ]
        alignments[field] = detect_alignment(samples, field)
    for field, detected in sorted(alignments.items()):
        declared = DECLARED_ALIGNMENT[field]
        note = "" if detected == declared else f"  (xlsx says {declared}; number format wins)"
        print(f"      align {field:22s} -> {detected}{note}")

    # 每个字段的锚点/基线：两份探针必须一致，取探针 0 的值。
    def _agree(field: str, a: Box, b: Box, where: str) -> None:
        alignment = alignments[field]
        if abs(a.anchor(alignment) - b.anchor(alignment)) > ANCHOR_EPSILON:
            raise PlateError(f"{where}: anchors disagree between probes")
        if abs(a.baseline - b.baseline) > 0.05:
            raise PlateError(f"{where}: baselines disagree between probes")

    with pdfplumber.open(clean_pdf) as pdf:
        clean_pages = list(pdf.pages)
        page_size = (float(clean_pages[0].width), float(clean_pages[0].height))

        header: dict[str, list[dict]] = {}
        header_baselines: dict[str, float] = {}
        for field in HEADER_CELLS:
            anchors = []
            for page in range(COPY_COUNT):
                box_a = header_boxes[0][page][field]
                box_b = header_boxes[1][page][field]
                _agree(field, box_a, box_b, f"header {field} page {page}")
                anchor = box_a.anchor(alignments[field])
                bound = (
                    _static_bound(clean_pages[page], box_a.baseline, anchor)
                    if alignments[field] == "left"
                    else None
                )
                anchors.append(
                    {
                        "x": anchor,
                        "align": alignments[field],
                        "size": box_a.size,
                        "max_width": None if bound is None else bound - anchor - 1.0,
                    }
                )
            header[field] = anchors
            header_baselines[field] = header_boxes[0][0][field].baseline

        items: dict[str, list[dict]] = {}
        item_baselines: dict[str, list[float]] = {}
        widths = [
            _item_widths(clean_pages[page], item_boxes[0][page], alignments)
            for page in range(COPY_COUNT)
        ]
        for field, _ in ITEM_COLUMN_FIELDS:
            anchors = []
            for page in range(COPY_COUNT):
                column_a = item_boxes[0][page][field]
                column_b = item_boxes[1][page][field]
                for line in range(MAX_ITEMS):
                    _agree(field, column_a[line], column_b[line], f"item {field} line {line + 1}")
                column_anchors = [box.anchor(alignments[field]) for box in column_a]
                spread = max(column_anchors) - min(column_anchors)
                if spread > ANCHOR_EPSILON:
                    raise PlateError(f"item {field} page {page}: column anchor drifts by {spread}")
                anchors.append(
                    {
                        "x": sum(column_anchors) / len(column_anchors),
                        "align": alignments[field],
                        "size": column_a[0].size,
                        "max_width": widths[page].get(field),
                    }
                )
            items[field] = anchors
            baseline_column = item_boxes[0][0][field]
            for page in range(1, COPY_COUNT):
                for line in range(MAX_ITEMS):
                    if abs(item_boxes[0][page][field][line].baseline
                           - baseline_column[line].baseline) > 0.05:
                        raise PlateError(f"item {field}: page {page} baselines differ from page 0")
            item_baselines[field] = [box.baseline for box in baseline_column]

        totals: dict[str, list[dict]] = {}
        total_baselines: dict[str, float] = {}
        for field in TOTAL_CELLS:
            anchors = []
            for page in range(COPY_COUNT):
                box_a = total_boxes[0][page][field]
                box_b = total_boxes[1][page][field]
                _agree(field, box_a, box_b, f"total {field} page {page}")
                anchor = box_a.anchor(alignments[field])
                bound = (
                    _static_bound(clean_pages[page], box_a.baseline, anchor)
                    if alignments[field] == "left"
                    else None
                )
                anchors.append(
                    {
                        "x": anchor,
                        "align": alignments[field],
                        "size": box_a.size,
                        "max_width": None if bound is None else bound - anchor - 1.0,
                    }
                )
            totals[field] = anchors
            total_baselines[field] = total_boxes[0][0][field].baseline

    underlay.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(clean_pdf, underlay)
    layout.write_text(
        render_layout_module(
            hashlib.sha256(template.read_bytes()).hexdigest(),
            page_size,
            header,
            header_baselines,
            items,
            item_baselines,
            totals,
            total_baselines,
        ),
        encoding="utf-8",
    )
    print(f"[4/4] wrote {underlay}\n      wrote {layout}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--underlay", type=Path, default=DEFAULT_UNDERLAY)
    parser.add_argument("--layout", type=Path, default=DEFAULT_LAYOUT)
    parser.add_argument(
        "--workdir",
        type=Path,
        default=None,
        help="保留中间产物的目录；不给就用临时目录并在结束后删掉",
    )
    args = parser.parse_args()
    try:
        if args.workdir:
            args.workdir.mkdir(parents=True, exist_ok=True)
            build(args.template, args.underlay, args.layout, args.workdir)
        else:
            with tempfile.TemporaryDirectory(prefix="zwt-taxinv-plate-") as temporary:
                build(args.template, args.underlay, args.layout, Path(temporary))
    except PlateError as error:
        print(f"制版失败: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
