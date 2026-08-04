"""自动生成；源文件：Salary-Advance-Template.xlsx。请勿手工改坐标。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TextAnchor:
    x: float
    y: float
    size: float
    max_width: float
    align: str = "left"


SOURCE_XLSX_SHA256 = "9b646c6184a4edbd231188e10f9c92fb79cb46b4da6101feb729861e6c1246dd"
PDF_UNDERLAY_SHA256 = "7137cb8d9e494317cc4bfaf094601ee97698c295a4af20dbed65929fc4f3e765"
LAYOUT_VERSION = "797251f436c7ebcd"
PAGE_COUNT = 1
PAGE_SIZE = (595.25, 841.85)

TEXT_ANCHORS = {
    "first_name": TextAnchor(140.14, 642.60, 12.93, 105.00, "center"),
    "surname": TextAnchor(286.90, 642.60, 12.93, 105.00, "center"),
    "position": TextAnchor(467.83, 622.32, 11.04, 136.00, "center"),
    "department": TextAnchor(341.63, 607.44, 12.93, 300.00, "center"),
    "start_date": TextAnchor(380.64, 586.80, 12.93, 150.00, "center"),
    "reason": TextAnchor(51.94, 550.34, 12.93, 500.00, "left"),
    "advance_amount": TextAnchor(252.50, 519.98, 12.93, 120.00, "center"),
    "advance_amount_words_th": TextAnchor(434.63, 519.98, 12.93, 230.00, "center"),
    "advance_amount_repeat": TextAnchor(213.48, 454.55, 12.93, 120.00, "center"),
    "advance_words_repeat": TextAnchor(414.97, 454.55, 12.93, 230.00, "center"),
    "monthly_deduction": TextAnchor(213.48, 435.35, 12.93, 120.00, "center"),
    "monthly_deduction_words_th": TextAnchor(414.97, 435.35, 12.93, 230.00, "center"),
    "applicant_display_name": TextAnchor(288.11, 377.41, 12.93, 220.00, "left"),
    "request_date": TextAnchor(454.31, 363.37, 12.93, 100.00, "center"),
    "finance_comment": TextAnchor(361.31, 345.60, 12.93, 320.00, "center"),
    "finance_display_name": TextAnchor(414.97, 293.75, 12.93, 220.00, "center"),
    "finance_date": TextAnchor(454.31, 279.71, 12.93, 100.00, "center"),
    "md_display_name": TextAnchor(414.97, 191.04, 12.93, 220.00, "center"),
    "md_date": TextAnchor(454.31, 176.99, 12.93, 100.00, "center"),
}

CHECKBOX_ANCHORS = {
    "approve": (123.36, 241.24, 8.50),
    "not_approved": (346.56, 241.24, 8.50),
}

SIGNATURE_BOXES = {
    "finance": (294.88, 304.91, 90.00, 28.00),
    "md": (294.82, 201.96, 90.00, 28.00),
}
