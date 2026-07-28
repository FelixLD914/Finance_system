"""自动生成；源文件：Salary-Advance-Template.xlsx。请勿手工改坐标。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TextAnchor:
    x: float
    y: float
    size: float
    max_width: float
    align: str = "left"


SOURCE_XLSX_SHA256 = "50a432832e3dd93b85aab783b9aac2d130460ee1c844a05aa4af2fec82284a9a"
PDF_UNDERLAY_SHA256 = "2c9f148e3575ad16b234fdc4c360a075df3e5cd551d42afac265b5670c25b77c"
LAYOUT_VERSION = "0656fa1a3cc6b8ec"
PAGE_COUNT = 1
PAGE_SIZE = (595.25, 841.85)

TEXT_ANCHORS = {
    "first_name": TextAnchor(161.17, 633.11, 12.93, 105.00, "center"),
    "surname": TextAnchor(340.33, 633.11, 12.93, 105.00, "center"),
    "position": TextAnchor(500.61, 633.72, 11.04, 95.00, "center"),
    "department": TextAnchor(352.19, 605.63, 12.93, 300.00, "center"),
    "start_date": TextAnchor(402.60, 584.98, 12.93, 150.00, "center"),
    "reason": TextAnchor(51.94, 548.53, 12.93, 500.00, "left"),
    "advance_amount": TextAnchor(301.08, 518.16, 12.93, 120.00, "center"),
    "advance_amount_words_th": TextAnchor(461.37, 518.16, 12.93, 230.00, "center"),
    "advance_amount_repeat": TextAnchor(250.68, 452.79, 12.93, 120.00, "center"),
    "advance_words_repeat": TextAnchor(441.84, 452.79, 12.93, 230.00, "center"),
    "monthly_deduction": TextAnchor(250.68, 433.58, 12.93, 120.00, "center"),
    "monthly_deduction_words_th": TextAnchor(441.84, 433.58, 12.93, 230.00, "center"),
    "applicant_display_name": TextAnchor(341.54, 375.60, 12.93, 220.00, "left"),
    "request_date": TextAnchor(481.08, 361.55, 12.93, 100.00, "center"),
    "finance_comment": TextAnchor(371.76, 343.79, 12.93, 320.00, "center"),
    "finance_display_name": TextAnchor(441.84, 292.08, 12.93, 220.00, "center"),
    "finance_date": TextAnchor(481.08, 278.04, 12.93, 100.00, "center"),
    "md_display_name": TextAnchor(441.84, 189.13, 12.93, 220.00, "center"),
    "md_date": TextAnchor(481.08, 175.09, 12.93, 100.00, "center"),
}

CHECKBOX_ANCHORS = {
    "approve": (144.38, 239.48, 8.50),
    "not_approved": (399.95, 239.48, 8.50),
}

SIGNATURE_BOXES = {
    "finance": (354.18, 303.00, 90.00, 28.00),
    "md": (354.11, 200.15, 90.00, 28.00),
}
