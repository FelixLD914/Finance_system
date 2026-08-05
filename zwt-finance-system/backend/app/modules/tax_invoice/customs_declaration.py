"""泰国出口报关单（กศก. 101/1）识别。

为什么单独一个模块：`recognition.py` 里原来那版 `parse_customs_pdf` 是把桌面版
`main.py` 的正则整段搬过来的，只认"文本层干净"的报关单。真实样本里有四种模板，
其中 D&M 那家是用「Microsoft Print To PDF」打出来的，泰文字形被重排、还夹着
`(cid:NNNN)`——`วันที่ยื่น` 变成 `วนั ทยี น ื`、`STATUS = 02` 被泰文逐字穿插成
`STAภTาUษSีอ…`。实测 22 份真单：旧逻辑在这家上 1 份漏读、1 份读错一天。

识别口径参考 BOI 那套进口报关单核对（boi_system_web/_boi_mdm/customs_check.py）。
能直接搬的不是它的 bbox/表格几何——进口单 99/1 是真表格，出口单 101/1 是文本流——
而是它的**证据纪律**：

1. 每个从 PDF 读出来的字段都带 `raw_text` 与可信度分级，凡是经过"修复"才得到的值
   （重排折叠、兜底规则、关键词推断），即使数值看着对也一律标 needs_review。
   静默给一个看起来对的数，是这类核对里最贵的错误。
2. 无文字层（扫描件、打印成 PDF 把字变矢量）在入口就拦死，不产出"空表头 + 0 行"
   的假成功——那种结果前端只能显示满屏"需复核"，用户无从判断是文件不对还是系统坏。
3. 同一个数字有两个来源时（行级 vs 报关单自印合计）都读出来做交叉核对，不一致就标
   出来给人看，不替业务二选一。

字段口径（业务已确认，2026-07-30）：净重与 HS 不纳入核对；在原桌面版基础上增加
海关汇率、货代名称（泰文/英文）、出口泰铢金额（行级 + 底部合计并互相核对）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from io import BytesIO
from typing import Any

MONEY = Decimal("0.01")
RATE = Decimal("0.000001")

# ── 可信度分级（与 BOI docs/customs_import_recognition_spec.md 对齐）────────────
CONFIDENCE_TRUSTED_EXACT = "trusted_exact"
CONFIDENCE_NEEDS_REVIEW_PDF = "needs_review_pdf"
CONFIDENCE_NEEDS_REVIEW_REPAIRED = "needs_review_repaired"
CONFIDENCE_NEEDS_REVIEW_INFERRED = "needs_review_inferred"
CONFIDENCE_NEEDS_REVIEW_FALLBACK = "needs_review_fallback"
CONFIDENCE_MISSING = "missing"

REVIEW_REQUIRED_LEVELS = frozenset(
    {
        CONFIDENCE_NEEDS_REVIEW_PDF,
        CONFIDENCE_NEEDS_REVIEW_REPAIRED,
        CONFIDENCE_NEEDS_REVIEW_INFERRED,
        CONFIDENCE_NEEDS_REVIEW_FALLBACK,
        CONFIDENCE_MISSING,
    }
)

THAI_CALENDAR_OFFSET = 543

# 出口报关单没有文字层时的补救说明。和 BOI 那边同一口径：告诉用户去哪拿原始文件，
# 而不是只说"解析失败"。不带文件名——落盘用的是 UUID 名，写进提示只会让人困惑。
_TEXT_LAYER_PROBE_PAGES = 3
_TEXT_LAYER_MIN_CHARS = 20
_TEXT_LAYER_REMEDY = (
    "请从海关 e-Export / 报关行系统直接下载原始报关单 PDF 后重新上传"
    "（不要用浏览器或 Word 的「打印成 PDF」）；若手头只有扫描件，"
    "请对照原件人工录入提交日期后再确认。"
)


class CustomsDeclarationError(ValueError):
    """出口报关单读不了：文件坏、不是 PDF、或没有可提取的文字层。"""


# ── 货代（报关行）名称 ────────────────────────────────────────────────────────
# 业务口径（2026-07-30）：**报关单上印英文就写英文，只印泰文就写泰文。**
# 所以这里不设泰文→英文的对照表，也不做任何翻译或补全——写进去的一定是单子上
# 那几个字。读不到英文名不是缺陷，泰文名就是正确答案。
#
# 出口商自己（ZWT）与 BOI 机关号，认货代时必须排除：它们同样是 13 位税号，
# 且在文本流里排得比货代税号更靠前。
EXPORTER_TAX_NO = "0105566051021"
_AUTHORITY_TAX_PREFIX = "0994"


@dataclass
class Field:
    """一个从 PDF 读出来的字段：值 + 原文 + 可信度。

    `raw_text` 一定要留。核对不一致时人要看的是"报关单上到底印的什么"，
    只给一个规范化后的值，人没法判断是识别错了还是单子本身写错了。
    """

    value: Any = None
    raw_text: str = ""
    confidence: str = CONFIDENCE_MISSING
    source: str = ""

    @property
    def review_required(self) -> bool:
        return self.confidence in REVIEW_REQUIRED_LEVELS

    def as_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "raw_text": self.raw_text,
            "confidence": self.confidence,
            "source": self.source,
            "review_required": self.review_required,
        }


@dataclass
class DeclarationItem:
    """报关单上的一个申报行。只留业务要核对的字段（净重/HS 已确认不核对）。"""

    line_number: int
    fob_usd: Decimal | None = None
    fob_thb: Decimal | None = None
    raw_usd_text: str = ""
    raw_thb_text: str = ""


@dataclass
class ParsedDeclaration:
    """一份出口报关单的识别结果。"""

    fields: dict[str, Field] = field(default_factory=dict)
    items: list[DeclarationItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def value(self, name: str) -> Any:
        got = self.fields.get(name)
        return got.value if got else None


# ══════════════════════════════════════════════════════════════════════════════
#  文本层清理
# ══════════════════════════════════════════════════════════════════════════════

def clean_text(text: str) -> str:
    """去掉 (cid:N) 噪声与不换行空格，压掉连续空格但保留换行。

    换行必须留：报关单大量字段靠"标签行 + 下一行取值"定位，摊平成一行就分不清
    是哪一栏的数字了。
    """
    without_cid = re.sub(r"\(cid:\d+\)", "", (text or "").replace(" ", " "))
    return re.sub(r"[ \t]+", " ", without_cid)


def thai_skeleton(text: str) -> str:
    """取泰文骨架：丢掉声调/元音符号与空白，只留辅音、字母、数字与分隔符。

    print-to-PDF 那家把 'วันที่ยื่น'（ว ◌ั น ท ◌ี ◌่ ย ◌ื ◌่ น）重排成 'วนั ทยี น ื'——
    元音符号跑到了辅音后面、还插了空格。按原样做子串匹配必然落空，但**辅音顺序
    ว-น-ท-ย-น 是稳定的**，所以匹配骨架而不是匹配原文。

    这是"修复"，不是"读准"：命中骨架的字段一律记 needs_review_repaired。
    """
    stripped = re.sub(r"[ัิ-ฺ็-๎]", "", text or "")
    return re.sub(r"[^ก-ฮฯ-ะA-Za-z0-9/:.-]", "", stripped)


def _decimal(raw: object, *, quantum: Decimal | None = MONEY) -> Decimal | None:
    text = str(raw if raw is not None else "").replace(",", "").strip()
    if not text:
        return None
    try:
        parsed = Decimal(text)
        # quantize 留在 try 里：超出 Decimal 上下文精度的值（如 1e100）同样抛
        # InvalidOperation。读不出来一律 None，由可信度标 missing 交人工。
        return parsed.quantize(quantum, rounding=ROUND_HALF_UP) if quantum else parsed
    except (InvalidOperation, ValueError, TypeError):
        return None


def parse_thai_date(raw: str) -> date | None:
    """'d/m/yyyy'（公历或佛历）或 'yyyy-mm-dd' → date。年份 >= 2400 视为佛历。

    出口报关单同一页上公历佛历混排：提交日期是佛历（23/01/2569），打印日期是公历
    （26/01/2026）。不按年份判历法会把两者当成同一种，整批取错汇率。
    """
    text = (raw or "").strip()
    if not text:
        return None
    iso = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if iso:
        try:
            return date(*(int(part) for part in iso.groups()))
        except ValueError:
            return None
    dmy = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", text)
    if not dmy:
        return None
    day, month, year = (int(part) for part in dmy.groups())
    if year >= 2400:
        year -= THAI_CALENDAR_OFFSET
    try:
        return date(year, month, day)
    except ValueError:
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  PDF 读取
# ══════════════════════════════════════════════════════════════════════════════

def extract_pages(content: bytes) -> tuple[list[str], dict[str, Any]]:
    """读出每页文本；无文字层直接抛错（BOI 同口径，见模块 docstring 第 2 条）。"""
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - 部署缺依赖
        raise CustomsDeclarationError("出口报关单识别需要 pdfplumber") from exc

    try:
        document = pdfplumber.open(BytesIO(content))
    except Exception as exc:
        # pdfplumber 底下是 pdfminer，坏文件抛的异常类型不稳定（PSException /
        # PDFSyntaxError / struct.error 都见过），只能按"打不开就是文件不对"处理。
        raise CustomsDeclarationError(
            "这个文件不是可读的 PDF，请确认报关单是否完整下载。"
        ) from exc

    with document as pdf:
        metadata = dict(pdf.metadata or {})
        char_count = sum(len(page.chars) for page in pdf.pages[:_TEXT_LAYER_PROBE_PAGES])
        if char_count < _TEXT_LAYER_MIN_CHARS:
            # 前几页可能是纯图章/封面，全量复核一次再判死，避免误杀。
            char_count = sum(len(page.chars) for page in pdf.pages)
        if char_count < _TEXT_LAYER_MIN_CHARS:
            producer = str(metadata.get("Producer") or "").strip()
            origin = ""
            if "print to pdf" in producer.lower():
                origin = f"，生成方式「{producer}」会把文字转成矢量图形"
            elif producer:
                origin = f"，生成方式「{producer}」"
            raise CustomsDeclarationError(
                f"PDF 无可提取文字层（{len(pdf.pages)} 页共 {char_count} 个字符"
                f"{origin}）。{_TEXT_LAYER_REMEDY}"
            )
        pages = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            if not text:
                words = page.extract_words(
                    x_tolerance=2,
                    y_tolerance=2,
                    keep_blank_chars=False,
                )
                text = "\n".join(word.get("text", "") for word in words)
            pages.append(clean_text(text))
    return pages, metadata


# ══════════════════════════════════════════════════════════════════════════════
#  单证编号 / 发票号
# ══════════════════════════════════════════════════════════════════════════════

def read_declaration_numbers(flat: str) -> dict[str, Field]:
    """报关单号（CDN）与报关行流水号（Ref.No.）。

    CDN 三种写法都见过：`*A0231690118554*`（条码星号包裹）、裸 `A0301690110291`、
    以及 print-to-PDF 那家的带横杠 `A023-16901-17512`。星号那条放在最前——条码里
    的号是印刷体，最不可能被文本层弄坏。
    """
    fields: dict[str, Field] = {}
    for pattern, source in (
        (r"\*(A\d{10,})\*", "barcode"),
        (r"\b(A\d{3,4}(?:-\d+){1,3})\b", "dashed"),
        (r"\b(A\d{10,})\b", "plain"),
    ):
        match = re.search(pattern, flat)
        if match:
            fields["cdn"] = Field(
                value=match.group(1),
                raw_text=match.group(0),
                confidence=CONFIDENCE_TRUSTED_EXACT,
                source=f"cdn_{source}",
            )
            break
    else:
        fields["cdn"] = Field(confidence=CONFIDENCE_MISSING, source="cdn_not_found")

    # 报关行流水号：Q+3字母+9位（K+N/DHL）、DJCG…/PYXG…（D&M/YoungFun）。
    # 它不是税务单证号，只用来在追单时对得上报关行的系统，读不到不影响开票。
    ref = re.search(r"\b(Q[A-Z]{3}\d{9})\b", flat) or re.search(
        r"\b([A-Z]{4}\d{9})\b", flat
    )
    fields["declaration_ref_no"] = (
        Field(
            value=ref.group(1),
            raw_text=ref.group(0),
            confidence=CONFIDENCE_TRUSTED_EXACT,
            source="ref_no",
        )
        if ref
        else Field(confidence=CONFIDENCE_MISSING, source="ref_no_not_found")
    )
    return fields


def read_invoice_reference(flat: str) -> dict[str, Field]:
    """发票号（C/I No.）与发票日期——这是和 Export Invoice Excel 配对的唯一可靠键。

    四种模板的标签各不相同：`INV# ZWT-… :23/01/2026`（DHL）、
    `INV. NO. ZWT-… 23/01/2569`（D&M，佛历、没有冒号）、
    `บัญชีราคาสินค้า : ZWT-… : 22/01/2026`（YoungFun）、
    K+N 那家干脆把发票号夹在乱码里 `…09940000 I 4 n 9 v 4 . 4 Z 7 WT-NSB26012302`。
    所以不锚标签，直接找 `ZWT-` 开头的票号——全文里只有它是这个形态。
    """
    fields: dict[str, Field] = {}
    match = re.search(
        r"(ZWT-[A-Z0-9]+(?:-[A-Z0-9]+)*)\s*[:：]?\s*"
        r"(\d{1,2}[./-]\d{1,2}[./-]\d{4})?",
        flat,
        re.IGNORECASE,
    )
    if not match:
        fields["ci_no"] = Field(confidence=CONFIDENCE_MISSING, source="ci_no_not_found")
        fields["ci_date"] = Field(confidence=CONFIDENCE_MISSING, source="ci_date_not_found")
        return fields

    fields["ci_no"] = Field(
        value=match.group(1).upper().rstrip("."),
        raw_text=match.group(0).strip(),
        confidence=CONFIDENCE_TRUSTED_EXACT,
        source="ci_no_pattern",
    )
    ci_date = parse_thai_date(match.group(2) or "")
    fields["ci_date"] = (
        Field(
            value=ci_date,
            raw_text=match.group(2) or "",
            confidence=CONFIDENCE_TRUSTED_EXACT,
            source="ci_date_beside_ci_no",
        )
        if ci_date
        else Field(confidence=CONFIDENCE_MISSING, source="ci_date_not_found")
    )
    return fields


# ══════════════════════════════════════════════════════════════════════════════
#  提交日期（决定取哪天的 BOT 汇率，全链路最贵的一个字段）
# ══════════════════════════════════════════════════════════════════════════════

# 'วันที่ยื่น' 的辅音骨架，print-to-PDF 重排后仍然稳定（见 thai_skeleton）。
# 允许的间隔卡得很紧（每对辅音之间最多 1 个字符）：真标签去掉符号后是紧挨着的
# 'วนทยน'。放宽到 3~4 会被出口商自己的名字 'เวสเทิร์น เทคโนโลยี (ไทยแลนด์)' 命中
# （骨架 'วสทรนทคนลยทยลน' 里也能凑出 ว…น…ท…ย…น），把发票日期当成提交日期——
# 实测在 MegaTower 那份 DRAFT ENTRY 上就是这么误判的。
_SUBMIT_SKELETON = re.compile(r"ว\S{0,1}น\S{0,1}ท\S{0,2}ย\S{0,2}น")
_DMY = re.compile(r"(\d{1,2}[./-]\d{1,2}[./-]\d{4})")
_ISO = re.compile(r"(\d{4}-\d{2}-\d{2})")
# 页脚打印信息里的 'วันที่ยื่น' 是噪声，不是提交日期。
_SUBMIT_NOISE = ("VGM", "PRINT DATE", "AUTHORIZER")


def _submit_label_match(line: str) -> tuple[bool, bool]:
    """(是不是提交日期标签行, 是否靠骨架才认出来)。

    骨架命中意味着这行的泰文被重排过 → 这一整条候选都要降级成
    needs_review_repaired，即使日期本身读得对。
    """
    compact = re.sub(r"\s+", "", line)
    if "วันที่ยื่น" in compact or "วันทียื่น" in compact or "ันที่ยื่น" in compact:
        return True, False
    if "ยื่น" in compact and any(
        hint in compact for hint in ("วันที่", "วันที", "วนัทย")
    ):
        return True, False
    if _SUBMIT_SKELETON.search(thai_skeleton(line)):
        return True, True
    return False, False


def read_submission_date(pages: list[str]) -> Field:
    """读 `วันที่ยื่น`（提交日期）。打分挑最可信的一条候选。

    决定性的位置规则（实测 22 份真单得出）：标签**前面**那个公历 dd/mm/yyyy 是
    **打印日期**（后面还跟一串点做填空线），标签**后面**那个佛历日期才是提交日期。
    例：`26/01/2026 วันที่ยื่น........` 与 `… วันที่ยื่น 23/01/2569` 同时出现在一份单上，
    真值是后者。搞反会让整批取错汇率，而且金额看着都"像对的"，很难在事后发现。

    分数带佛历加成：出口单的提交日期一定写佛历，公历值几乎都是打印日期。
    """
    candidates: list[tuple[int, int, date, str, str, bool]] = []

    def add(score: int, order: int, raw: str, source: str, repaired: bool) -> None:
        parsed = parse_thai_date(raw)
        if parsed:
            candidates.append((score, order, parsed, raw, source, repaired))

    for page_index, text in enumerate(pages):
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for index, line in enumerate(lines):
            is_label, repaired = _submit_label_match(line)
            if not is_label:
                continue
            if any(noise in line.upper() for noise in _SUBMIT_NOISE):
                continue

            anchor = line.find("ยื่น")
            if anchor < 0:
                # 重排模板里 'ยื่น' 拼不出来，退回到第一个 'ย' 当锚点。
                anchor = max(line.find("ย"), 0)
            matches = list(_DMY.finditer(line))
            after = [item for item in matches if item.start() >= anchor]
            before = [item for item in matches if item.start() < anchor]
            order = page_index * 1000 + index

            for item in after:
                year = int(item.group(1)[-4:])
                score = 130 if year >= 2400 else 120
                if repaired:
                    score -= 5
                add(score, order, item.group(1), "submit_after_same_line", repaired)
            # 标签后面是填空点线时，前面那个日期是打印日期，绝不能当提交日期。
            if before and "..." not in line and "…" not in line:
                add(80, order, before[-1].group(1), "submit_before_same_line", repaired)
            for step in (1, 2):
                if index + step < len(lines):
                    next_match = _DMY.search(lines[index + step])
                    if next_match:
                        year = int(next_match.group(1)[-4:])
                        score = (115 - step) if year >= 2400 else (100 - step)
                        add(
                            score,
                            order * 10 + step,
                            next_match.group(1),
                            f"submit_next_line_{step}",
                            repaired,
                        )

    # 兜底：STATUS 02 = 报关单已受理。日期不等于提交日（受理可能晚于提交），
    # 所以分数压低，命中就是 needs_review——D&M 那家实测会差一天。
    for page_index, text in enumerate(pages):
        for index, line in enumerate(text.splitlines()):
            upper = line.upper()
            if "STATUS = 02" not in upper and "DECLARATION ACCEPTED" not in upper:
                continue
            order = 9000 + page_index * 100 + index
            for item in _DMY.finditer(line):
                add(70, order, item.group(1), "status_dmy", True)
            iso_match = re.search(r"0?2\s*[:：]\s*(\d{4}-\d{2}-\d{2})", line)
            if iso_match:
                add(65, order, iso_match.group(1), "status_iso", True)
            elif (iso_any := _ISO.search(line)) is not None:
                add(55, order, iso_any.group(1), "status_iso_any", True)

    flat = re.sub(r"\s+", " ", "\n".join(pages))
    # 折行把标签和日期分到两行之外时的整篇兜底。'อิเล็กทรอนิกส์แล้ว' 是电子报关
    # 完成语，紧跟着的就是提交日期，比裸 'วันที่ยื่น' 更确定，给最高分。
    electronic = re.search(
        r"อิเล็กทรอนิกส์แล้ว[^0-9]{0,40}วันที่\s*ยื่น[^0-9]{0,30}"
        r"(\d{1,2}[./-]\d{1,2}[./-]\d{4})",
        flat,
    )
    if electronic:
        add(132, 11900, electronic.group(1), "flat_electronic_submit_after", False)
    flat_submit = re.search(
        r"วันที่\s*ยื่น[^0-9]{0,30}(\d{1,2}[./-]\d{1,2}[./-]\d{4})", flat
    )
    if flat_submit:
        add(118, 12000, flat_submit.group(1), "flat_submit_after", False)

    if not candidates:
        return Field(confidence=CONFIDENCE_MISSING, source="submit_not_found")

    score, _, submission_date, raw, source, repaired = sorted(
        candidates, key=lambda item: (-item[0], item[1])
    )[0]
    if repaired:
        confidence = CONFIDENCE_NEEDS_REVIEW_REPAIRED
    elif score >= 110:
        confidence = CONFIDENCE_TRUSTED_EXACT
    elif score >= 95:
        confidence = CONFIDENCE_NEEDS_REVIEW_PDF
    else:
        confidence = CONFIDENCE_NEEDS_REVIEW_FALLBACK
    return Field(
        value=submission_date,
        raw_text=raw,
        confidence=confidence,
        source=source,
    )


# ══════════════════════════════════════════════════════════════════════════════
#  海关汇率（业务新增要求 1）
# ══════════════════════════════════════════════════════════════════════════════

def read_customs_exchange_rate(flat: str) -> Field:
    """报关单自印的汇率。三种写法实测都出现过：

    - `อัตราแลกเปลี่ยน 1.00 USD = 31.062700 THB`（K+N / DHL）
    - `USD 1 : 31.06270 BAHT`（D&M print-to-PDF）
    - `อัตราแลกเปลี่ยน 1 USD=30.9979 THB`（YoungFun）

    这个值本身不参与计价——计价用 BOT 汇率表，口径不能变。它的作用是核对：
    海关按哪个汇率折的泰铢，和我们算出来的 THB 能不能对上。
    """
    for pattern, source in (
        (r"1(?:\.00)?\s*USD\s*[=:]\s*([\d,]+\.\d+)\s*(?:THB|BAHT)", "rate_usd_first"),
        (r"USD\s*1\s*[:=]\s*([\d,]+\.\d+)\s*(?:THB|BAHT)", "rate_usd_colon"),
        (r"อัตราแลกเปลี่ยน[^0-9]{0,20}([\d,]+\.\d{4,})", "rate_thai_label"),
    ):
        match = re.search(pattern, flat, re.IGNORECASE)
        if match:
            rate = _decimal(match.group(1), quantum=RATE)
            if rate is not None and rate > 0:
                return Field(
                    value=rate,
                    raw_text=match.group(0).strip(),
                    confidence=CONFIDENCE_TRUSTED_EXACT,
                    source=source,
                )
    return Field(confidence=CONFIDENCE_MISSING, source="rate_not_found")


# ══════════════════════════════════════════════════════════════════════════════
#  货代 / 报关行（业务新增要求 2）
# ══════════════════════════════════════════════════════════════════════════════

_TH_ORG = re.compile(
    r"(?:บริษัท|บรษิ ัท|ห้างหุ้นส่วนจำกัด|หา้งหนุ้ สว่ นจํากดั)[^\n]{0,60}"
)
# 公司名到此为止：D&M 那家的抬头把公司名、许可证号、税号印在同一行
# （`ห้างหุ้นส่วนจำกัด ดีแอนด์เอ็ม เคานต์เตอร์ ใบอนุญาตที่๓/๒๕๖๒ เลขประจำตัวผู้เสียภาษี 0903…`），
# 不截断就会把整条抬头当成货代名字存进去。
_TH_ORG_TAIL = re.compile(
    r"\s*(?:ใบอนุญาต|ใบอนญุ าต|เลขประจำตัว|เลขประจําตวั|AEO|BOI|\d{6,}).*$"
)


def _trim_org_name(raw: str) -> str:
    trimmed = _TH_ORG_TAIL.sub("", raw or "").strip()
    return re.sub(r"\s+", " ", trimmed).strip(" .,-")
_EN_ORG = re.compile(
    r"[A-Z][A-Z&.,'()\-/ ]{5,60}?"
    r"(?:LIMITED|PUBLIC COMPANY LIMITED|LTD\.?|CO\.,? ?LTD\.?)",
)


def read_forwarder(pages: list[str], flat: str) -> dict[str, Field]:
    """货代（报关行）泰文名 + 英文名 + 税号。

    认人靠税号，不靠名字：同一家的泰文名在不同模板里断字位置不同
    （`บริษัท` 会被打成 `บรษิ ัท`），泰文名做键不稳；13 位税号是纯数字，四种模板都读得准。
    报关单上出现的 13 位税号里排掉出口商自己（ZWT）和 `0994*` 的 BOI 机关号，
    剩下第一个就是货代——实测 22 份单全部命中（K+N / DHL / D&M / YoungFun）。

    英文名三级取值：先用报关单自己印的英文行（最可信，它就是原文），
    再查 tax-no 映射表，最后查泰文名映射表。三条都没有就留空并标 needs_review，
    输出泰文原文让人自己判断——不替业务编英文名。
    """
    fields: dict[str, Field] = {}

    tax_numbers = [
        number
        for number in re.findall(r"\b(0\d{12})\b", flat)
        if number != EXPORTER_TAX_NO and not number.startswith(_AUTHORITY_TAX_PREFIX)
    ]
    forwarder_tax_no = tax_numbers[0] if tax_numbers else None
    fields["forwarder_tax_no"] = (
        Field(
            value=forwarder_tax_no,
            raw_text=forwarder_tax_no or "",
            confidence=CONFIDENCE_TRUSTED_EXACT,
            source="forwarder_tax_no_excluded_known",
        )
        if forwarder_tax_no
        else Field(confidence=CONFIDENCE_MISSING, source="forwarder_tax_no_not_found")
    )

    forwarder_th, th_source = _forwarder_thai_name(pages, forwarder_tax_no)
    fields["forwarder_name_th"] = (
        Field(
            value=forwarder_th,
            raw_text=forwarder_th or "",
            # 位置/关键词推断出来的，不是标签锚点直读 → BOI 口径要求标 needs_review。
            confidence=CONFIDENCE_NEEDS_REVIEW_INFERRED,
            source=th_source,
        )
        if forwarder_th
        else Field(confidence=CONFIDENCE_MISSING, source="forwarder_th_not_found")
    )

    english = _forwarder_english(pages)
    fields["forwarder_name_en"] = english
    # 业务口径：报关单印英文就写英文，只印泰文就写泰文。落库与导出用的是这一个值，
    # 上面两个原文字段留着做取值依据（人核对时要知道这个名字是从哪一栏抄来的）。
    resolved = english.value or forwarder_th
    fields["forwarder_name"] = (
        Field(
            value=resolved,
            raw_text=english.raw_text or forwarder_th or "",
            confidence=(
                english.confidence
                if english.value
                else fields["forwarder_name_th"].confidence
            ),
            source="forwarder_en_printed_on_pdf" if english.value else "forwarder_th",
        )
        if resolved
        else Field(confidence=CONFIDENCE_MISSING, source="forwarder_not_found")
    )
    return fields


def _forwarder_thai_name(
    pages: list[str],
    tax_no: str | None,
) -> tuple[str | None, str]:
    """货代泰文名：锚在货代税号附近取，取不到才退回"第一个不是出口商的机构名"。

    为什么要锚税号：出口商自己（ZWT）的泰文名在阅读序里排在货代**前面**，"第一个
    机构名"永远命中出口商。原本靠"骨架里含 เจนเวสเทรน 就跳过"来排除，但 Dimerco
    那份把泰文掉成了 `บริษัท เ ินเ สเทิร์น เทคโนโ ยี`（จ/ว/ล 都丢了），骨架凑不出
    เจนเวสเทรน，排除失效，结果把出口商名当成了货代名。

    税号是纯数字，四种模板都读得准。实测四家报关行的泰文名都落在其税号的前后 4 行内
    （D&M 甚至同一行）。
    """
    lines: list[str] = []
    for page_text in pages:
        lines.extend(page_text.splitlines())

    if tax_no:
        anchors = [index for index, line in enumerate(lines) if tax_no in line]
        for anchor in anchors:
            window = range(max(0, anchor - 4), min(len(lines), anchor + 5))
            # 由近及远找：同一行优先，再往上/往下扩。
            for index in sorted(window, key=lambda position: abs(position - anchor)):
                match = _TH_ORG.search(lines[index])
                if match:
                    return _trim_org_name(match.group(0)), "forwarder_th_near_tax_no"

    exporter_skeleton = "เจนเวสเทรน"
    for line in lines:
        match = _TH_ORG.search(line)
        if match:
            candidate = _trim_org_name(match.group(0))
            if exporter_skeleton in thai_skeleton(candidate):
                continue
            return candidate, "forwarder_th_first_non_exporter_org"
    return None, "forwarder_th_not_found"


def _forwarder_english(pages: list[str]) -> Field:
    """货代英文名：只认报关单自己印的那一行，印了就取、没印就留空。

    不做翻译、不查对照表、不按税号反查。业务口径是"有英文写英文，只有泰文写泰文"，
    所以"读不到英文名"不是缺陷——泰文名就是正确答案，由 read_forwarder 里的
    forwarder_name 兜底。这里返回 missing 只表示"这份单子上没印英文名"。
    """
    for page_text in pages:
        for match in _EN_ORG.finditer(page_text):
            candidate = re.sub(r"\s+", " ", match.group(0)).strip(" .,")
            # 出口商自己的英文名（ZHENWESTERN…）也符合公司名形态，要排掉。
            if "ZHENWESTERN" in candidate.upper():
                continue
            return Field(
                value=candidate,
                raw_text=match.group(0).strip(),
                confidence=CONFIDENCE_TRUSTED_EXACT,
                source="forwarder_en_printed_on_pdf",
            )
    return Field(confidence=CONFIDENCE_MISSING, source="forwarder_en_not_printed")


# ══════════════════════════════════════════════════════════════════════════════
#  FOB 金额：行级 + 报关单自印合计（业务新增要求 3）
# ══════════════════════════════════════════════════════════════════════════════

# 金额 token：`USD 199,712.88` 与 `199,712.88 USD` 两种写向都有（D&M 是后者）。
_USD_TOKEN = re.compile(r"USD\s*([\d,]+\.\d{2})\b|\b([\d,]+\.\d{2})\s*USD\b")
# `รวม/ยกไป <金额>`（合计/结转）永远是泰铢，且这一行常同时带数量，所以必须当成
# 独立 token 收，不能靠"整行是个裸数字"那条路——D&M 的合计就写在数量后面。
_THB_TOKEN = re.compile(
    r"THB\s*([\d,]+\.\d{2})\b"
    r"|\b([\d,]+\.\d{2})\s*(?:THB|BAHT)\b"
    r"|รวม/ยกไป\s*([\d,]+\.\d{2})\b"
)
# 运保费 / EXW 行：`F/W.= USD 5,816.88 = THB 180,688.00`、`EXW=43,733.81 USD =…`。
# 长得跟行级 FOB 一模一样，必须先排掉——FCA/EXW→FOB 换算时这些钱是要加减的，
# 混进 FOB 会整单算错。
_FREIGHT_LINE = re.compile(r"F\s*/\s*W|\bEXW\s*=", re.IGNORECASE)
# 汇率行 `1.00 USD = 31.062700 THB` 里的 '1.00 USD' 也是两位小数，要排掉。
_RATE_LINE = re.compile(r"อัตราแลกเปลี่ยน|อัตราแ กเ ี่ยน|USD\s*[=:]\s*[\d,]+\.\d{3,}")
_BARE_MONEY = re.compile(r"^\s*([\d,]+\.\d{2})\s*$")
# 'ราคาของ FOB (บาท)' 泰铢列标签（含 print-to-PDF 掉字后的形态）。裸数字只有在见过
# 这个列标签之后才当泰铢金额收——否则页脚的杂散数字会混进来。
_THB_COLUMN_LABEL = re.compile(r"FOB\s*\(?\s*(?:บาท|บ าท)")
# 金额下限：BOI 出口件的关税/增值税栏恒为 0.00。
_MIN_AMOUNT = Decimal("1")
# 裸数字形态的泰铢下限。为什么要单独抬高：K+N 模板的页脚印着打印时刻 `14.01`、
# `10.57`，形态和裸金额一模一样，会被当成一笔行级泰铢混进合计（实测让 4 份单的
# 泰铢行级合计翻倍）。真实出口 FOB 泰铢最小的一份也有 1,800+（USD 58.68 × 31），
# 100 这条线离两边都很远。带 THB/รวม 标签的金额不受这条限制。
_MIN_BARE_THB = Decimal("100")


# 一处金额出现：(金额, 所在行原文, 行序号)。行序号必须显式带着——把两种来源的
# 泰铢金额（带 THB 前缀的、裸数字的）合并后要按文档顺序重排，靠字符串对象是排不了的。
Occurrence = tuple[Decimal, str, int]


def _collect_amounts(lines: list[str], token: re.Pattern[str]) -> list[Occurrence]:
    """按文档顺序收集一种币别的金额 token（已排掉汇率行与运保费行）。"""
    found: list[Occurrence] = []
    for index, line in enumerate(lines):
        if _FREIGHT_LINE.search(line) or _RATE_LINE.search(line):
            continue
        for match in token.finditer(line):
            amount = _decimal(next((group for group in match.groups() if group), None))
            if amount is not None and amount >= _MIN_AMOUNT:
                found.append((amount, line.strip(), index))
    return found


def _collect_bare_thb(lines: list[str]) -> list[Occurrence]:
    """收裸数字形态的行级泰铢金额。

    K+N / D&M 把 `ราคาของ FOB (บาท)` 当**列标签**只印一次，各行的泰铢值是紧随其后
    单独一行的裸数字（`6,203,621.28`）。所以只在见过列标签之后才收裸数字。
    """
    found: list[Occurrence] = []
    seen_label = False
    for index, line in enumerate(lines):
        if _THB_COLUMN_LABEL.search(line):
            seen_label = True
        if not seen_label:
            continue
        if _FREIGHT_LINE.search(line) or _RATE_LINE.search(line):
            continue
        bare = _BARE_MONEY.match(line)
        if bare:
            amount = _decimal(bare.group(1))
            if amount is not None and amount >= _MIN_BARE_THB:
                found.append((amount, line.strip(), index))
    return found


def _split_items_and_total(
    amounts: list[Occurrence],
) -> tuple[list[Occurrence], Occurrence | None, str]:
    """把一串金额拆成"行级金额 + 报关单自印合计"，用算术自证。

    不按模板写死"合计在第几行"——四种模板的合计块长得都不一样（`---- USD …`、
    `==== Qty = …`、`รวม/ยกไป …`、`-------- N/W = … KGM USD …`），再加一家就要再改一次。
    改用一条与排版无关、而且能自己验证的规则：

    - 最后一个金额恰好等于前面各金额之和 → 它就是自印合计，前面的是行级金额。
    - 所有金额都相等 → 单行申报，行级值 = 合计（合计只是把同一个数再印一遍）。
    - 都不成立 → 不猜。返回 ambiguous，让调用方标 needs_review 交人工看图。

    返回 (行级金额, 自印合计, 判定依据)。
    """
    if not amounts:
        return [], None, "none"
    if len(amounts) == 1:
        # 只印了一次：既是行级也是合计，但"自印合计"这一栏没有独立来源。
        return list(amounts), None, "single_occurrence"

    values = [amount for amount, _, _ in amounts]
    if all(value == values[0] for value in values):
        return [amounts[0]], amounts[-1], "all_equal_single_item"

    def sum_of(group: list[Occurrence]) -> Decimal:
        return sum((amount for amount, _, _ in group), start=Decimal("0")).quantize(MONEY)

    head, last = amounts[:-1], amounts[-1]
    if sum_of(head) == last[0]:
        return head, last, "last_equals_sum_of_head"

    # 常见变体：行级金额印了两遍（明细区一次、合计区又重复一次）再跟合计。
    # 去重后再试一次，能救回 DHL 那种"明细 + 重复明细 + 合计"的排版。
    deduped: list[Occurrence] = []
    for occurrence in amounts:
        if not any(occurrence[0] == seen for seen, _, _ in deduped):
            deduped.append(occurrence)
    if len(deduped) >= 2:
        head, last = deduped[:-1], deduped[-1]
        if sum_of(head) == last[0]:
            return head, last, "deduped_last_equals_sum"

    return list(amounts), max(amounts, key=lambda item: item[0]), "ambiguous"


def read_fob_amounts(
    pages: list[str],
) -> tuple[list[DeclarationItem], dict[str, Field], list[str]]:
    """行级 FOB（USD/THB）+ 报关单自印合计，两者交叉核对。

    两个合计都留着——行级加总（我们算的）和报关单自印的。不一致就标出来给人看，
    不替业务二选一：识别阶段擅自挑一个"看起来对的"，就等于把这道核对做没了。
    """
    lines: list[str] = []
    for text in pages:
        lines.extend(line.rstrip() for line in text.splitlines())

    usd_amounts = _collect_amounts(lines, _USD_TOKEN)
    # 泰铢两种来源（带 THB 前缀的、裸数字的）合并后按行序号重排回文档顺序；
    # 同一行同时命中两种时去重，只留先出现的那个。
    thb_amounts = sorted(
        _collect_amounts(lines, _THB_TOKEN) + _collect_bare_thb(lines),
        key=lambda item: item[2],
    )
    seen_positions: set[tuple[int, Decimal]] = set()
    thb_amounts = [
        occurrence
        for occurrence in thb_amounts
        if (occurrence[2], occurrence[0]) not in seen_positions
        and not seen_positions.add((occurrence[2], occurrence[0]))
    ]

    usd_items, usd_total, usd_basis = _split_items_and_total(usd_amounts)
    thb_items, thb_total, thb_basis = _split_items_and_total(thb_amounts)

    items: list[DeclarationItem] = []
    for index in range(max(len(usd_items), len(thb_items))):
        usd = usd_items[index] if index < len(usd_items) else None
        thb = thb_items[index] if index < len(thb_items) else None
        items.append(
            DeclarationItem(
                line_number=index + 1,
                fob_usd=usd[0] if usd else None,
                fob_thb=thb[0] if thb else None,
                raw_usd_text=usd[1] if usd else "",
                raw_thb_text=thb[1] if thb else "",
            )
        )

    warnings: list[str] = []
    if usd_basis == "ambiguous":
        warnings.append(
            "报关单 FOB USD 金额无法自动区分行级与合计"
            f"（读到 {[str(amount) for amount, _, _ in usd_amounts]}），请人工核对"
        )
    if thb_basis == "ambiguous":
        warnings.append(
            "报关单 FOB THB 金额无法自动区分行级与合计"
            f"（读到 {[str(amount) for amount, _, _ in thb_amounts]}），请人工核对"
        )

    fields = {
        "customs_fob_usd_printed_total": _total_field(usd_total, usd_basis, "usd"),
        "customs_fob_thb_printed_total": _total_field(thb_total, thb_basis, "thb"),
        "customs_fob_usd_line_total": _line_total_field(items, "fob_usd", usd_basis),
        "customs_fob_thb_line_total": _line_total_field(items, "fob_thb", thb_basis),
    }
    return items, fields, warnings


def _total_field(
    total: Occurrence | None,
    basis: str,
    currency: str,
) -> Field:
    if total is None:
        return Field(
            confidence=CONFIDENCE_MISSING,
            source=f"printed_total_{currency}_{basis}",
        )
    return Field(
        value=total[0],
        raw_text=total[1],
        confidence=(
            CONFIDENCE_NEEDS_REVIEW_PDF
            if basis == "ambiguous"
            else CONFIDENCE_TRUSTED_EXACT
        ),
        source=f"printed_total_{currency}_{basis}",
    )


def _line_total_field(
    items: list[DeclarationItem],
    attribute: str,
    basis: str,
) -> Field:
    present = [
        getattr(item, attribute)
        for item in items
        if getattr(item, attribute) is not None
    ]
    if not present:
        return Field(confidence=CONFIDENCE_MISSING, source=f"sum_of_item_lines_{basis}")
    return Field(
        value=sum(present, start=Decimal("0")).quantize(MONEY),
        raw_text=" + ".join(str(value) for value in present),
        confidence=(
            CONFIDENCE_NEEDS_REVIEW_PDF
            if basis == "ambiguous"
            else CONFIDENCE_TRUSTED_EXACT
        ),
        source=f"sum_of_item_lines_{basis}",
    )


# ══════════════════════════════════════════════════════════════════════════════
#  入口
# ══════════════════════════════════════════════════════════════════════════════

# 出口报关单的身份证据：表格编号 กศก. 101/1，或一个报关单号（A+12~13 位 /
# 带横杠的 A###-#####-#####）。四种模板至少命中一条，实测 22/22。
_FORM_CODE = re.compile(r"101\s*/\s*1")
_DECLARATION_NO = re.compile(r"\bA\d{12,13}\b|\bA\d{3,4}(?:-\d+){1,3}\b")


def looks_like_export_declaration(flat: str) -> bool:
    """这份 PDF 是不是出口报关单？

    非要判一下不可：同一个货运文件夹里，发票自己的打印件
    （`3.ZWT：…IV&PL(ZWT-NSB26012304).pdf`）也是 PDF、也印着同一个 C/I No.，
    按内容配对时会跟着撞进同一组。不识别就可能把发票打印件当报关单用——
    读出来 CDN 空、提交日期空，却一路静默生成税票，正是要修掉的那个毛病。
    """
    return bool(_FORM_CODE.search(flat) or _DECLARATION_NO.search(flat))


def parse_export_declaration(content: bytes) -> ParsedDeclaration:
    """识别一份出口报关单，返回带可信度与原文的结构化结果。"""
    pages, _metadata = extract_pages(content)
    flat = re.sub(r"\s+", " ", "\n".join(pages)).strip()
    if not flat:
        raise CustomsDeclarationError(
            f"报关单 PDF 读不出任何文字。{_TEXT_LAYER_REMEDY}"
        )
    if not looks_like_export_declaration(flat):
        raise CustomsDeclarationError(
            "这份 PDF 不像出口报关单（既没有表格编号 กศก. 101/1，也没有报关单号 A…）。"
            "常见误传：把 Export Invoice 的 PDF 打印件当成了报关单。"
        )

    parsed = ParsedDeclaration()
    parsed.fields.update(read_declaration_numbers(flat))
    parsed.fields.update(read_invoice_reference(flat))
    parsed.fields["submission_date"] = read_submission_date(pages)
    parsed.fields["customs_exchange_rate"] = read_customs_exchange_rate(flat)
    parsed.fields.update(read_forwarder(pages, flat))

    # 业务口径（2026-07-30）：报关单号与提交日期**都**读不到，就是草稿件
    # （DRAFT ENTRY——还没递交，海关自然没给单号、也没有受理日期），
    # 草稿件不用于出口开票，在识别入口直接拒掉。
    #
    # 用"两个都缺"而不是"任一缺"作判据：真单子偶尔会因为文本层坏掉丢掉其中一个，
    # 那属于识别问题，应该收下来标 needs_review 让人看图核对，而不是当草稿退掉。
    if parsed.value("cdn") is None and parsed.value("submission_date") is None:
        raise CustomsDeclarationError(
            "这份报关单既没有报关单号，也没有提交日期，判定为草稿件（DRAFT）。"
            "草稿件不用于出口开票，请上传海关受理后的正式报关单。"
        )

    items, amount_fields, amount_warnings = read_fob_amounts(pages)
    parsed.items = items
    parsed.fields.update(amount_fields)
    parsed.warnings.extend(amount_warnings)

    parsed.warnings.extend(_cross_check(parsed))
    return parsed


def _cross_check(parsed: ParsedDeclaration) -> list[str]:
    """行级 vs 自印合计、以及泰铢 vs 汇率×美元 的一致性检查。

    只报差异，不改值。识别阶段擅自"修正"成看起来对的那个数，就等于把核对做没了。
    """
    warnings: list[str] = []

    def compare(line_key: str, printed_key: str, label: str) -> None:
        line_total = parsed.value(line_key)
        printed = parsed.value(printed_key)
        if line_total is None or printed is None:
            return
        if line_total != printed:
            warnings.append(
                f"{label}：行级合计 {line_total} 与报关单自印合计 {printed} 不一致"
            )

    compare(
        "customs_fob_usd_line_total",
        "customs_fob_usd_printed_total",
        "报关单 FOB USD",
    )
    compare(
        "customs_fob_thb_line_total",
        "customs_fob_thb_printed_total",
        "报关单 FOB THB",
    )

    # 泰铢 = 美元 × 海关汇率。**零容差**（业务口径 2026-08-05：1 泰铢都不许差）。
    #
    # 原实现留了 1 泰铢容差，理由是"海关按行折算再加总，我们按合计折算，末位进位
    # 方向可能不同"。这个理由本身成立，但放宽阈值是错的解法——放宽之后，真的差
    # 了 1 泰铢的单子也一起被放过了，而那才是要人看的。
    #
    # 正确的解法是按海关的算法算：有完整行级美元时逐行折算再加总（进位方向与
    # 报关单一致，压根不会产生那个差），没有行级数据才退回按合计折算。两条路都
    # 精确比对，不设阈值。
    rate = parsed.value("customs_exchange_rate")
    thb = parsed.value("customs_fob_thb_printed_total") or parsed.value(
        "customs_fob_thb_line_total"
    )
    if not rate or thb is None:
        return warnings

    line_usd = [item.fob_usd for item in parsed.items if item.fob_usd is not None]
    if parsed.items and len(line_usd) == len(parsed.items):
        expected = sum(
            ((amount * rate).quantize(MONEY, rounding=ROUND_HALF_UP) for amount in line_usd),
            start=Decimal("0"),
        )
        basis = f"逐行按海关汇率 {rate} 折算后加总"
    else:
        usd = parsed.value("customs_fob_usd_printed_total") or parsed.value(
            "customs_fob_usd_line_total"
        )
        if usd is None:
            return warnings
        expected = (usd * rate).quantize(MONEY, rounding=ROUND_HALF_UP)
        basis = f"合计 USD {usd} × 海关汇率 {rate}"

    if expected != thb:
        warnings.append(
            f"报关单泰铢金额 {thb} 与{basis}得到的 {expected} 不一致"
            f"（相差 {thb - expected}）"
        )
    return warnings
