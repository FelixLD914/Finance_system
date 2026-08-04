"""自动生成；源文件：Salary-Advance-Template.xlsx。请勿手工改坐标。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TextAnchor:
    x: float
    y: float
    size: float
    max_width: float
    align: str = "left"


SOURCE_XLSX_SHA256 = "c657a2f58c4418cca0198d2c55896085707d8127e0e3d04464530649eb83d418"
PDF_UNDERLAY_SHA256 = "fbad9a5fe4b2dc7653c5e39e4f2946cae8580e7354b845d9e78995dfbf47d22e"
LAYOUT_VERSION = "2d08caf8b2858d0c"
PAGE_COUNT = 1
PAGE_SIZE = (595.25, 841.85)

TEXT_ANCHORS = {
    "first_name": TextAnchor(140.14, 633.11, 12.93, 105.00, "center"),
    "surname": TextAnchor(286.90, 633.11, 12.93, 105.00, "center"),
    "position": TextAnchor(467.83, 612.61, 11.04, 136.00, "center"),
    "department": TextAnchor(341.63, 597.73, 12.93, 300.00, "center"),
    "start_date": TextAnchor(380.64, 577.08, 12.93, 150.00, "center"),
    "reason": TextAnchor(51.94, 540.62, 12.93, 500.00, "left"),
    "advance_amount": TextAnchor(252.50, 510.26, 12.93, 120.00, "center"),
    "advance_amount_words_th": TextAnchor(434.63, 510.26, 12.93, 230.00, "center"),
    "advance_amount_repeat": TextAnchor(213.48, 444.83, 12.93, 120.00, "center"),
    "advance_words_repeat": TextAnchor(414.97, 444.83, 12.93, 230.00, "center"),
    "monthly_deduction": TextAnchor(213.48, 425.63, 12.93, 120.00, "center"),
    "monthly_deduction_words_th": TextAnchor(414.97, 425.63, 12.93, 230.00, "center"),
    "applicant_display_name": TextAnchor(288.11, 367.69, 12.93, 220.00, "left"),
    "request_date": TextAnchor(454.31, 353.65, 12.93, 100.00, "center"),
    "finance_comment": TextAnchor(361.31, 335.88, 12.93, 320.00, "center"),
    "finance_display_name": TextAnchor(414.97, 284.04, 12.93, 220.00, "center"),
    "finance_date": TextAnchor(454.31, 269.99, 12.93, 100.00, "center"),
    "md_display_name": TextAnchor(414.97, 181.32, 12.93, 220.00, "center"),
    "md_date": TextAnchor(454.31, 167.27, 12.93, 100.00, "center"),
}

CHECKBOX_ANCHORS = {
    "approve": (123.36, 231.53, 8.50),
    "not_approved": (346.56, 231.53, 8.50),
}

SIGNATURE_BOXES = {
    "finance": (294.88, 295.19, 90.00, 28.00),
    "md": (294.82, 192.24, 90.00, 28.00),
}
