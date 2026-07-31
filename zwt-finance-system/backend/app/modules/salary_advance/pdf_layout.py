"""自动生成；源文件：Salary-Advance-Template.xlsx。请勿手工改坐标。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TextAnchor:
    x: float
    y: float
    size: float
    max_width: float
    align: str = "left"


SOURCE_XLSX_SHA256 = "326425a5f14d0133bb8f0cbd926222ccd86dc4279704ba4cc471ca01df943a62"
PDF_UNDERLAY_SHA256 = "dc90c69b2b9b4a66288b16e11b3d9cf0e456c85fd9d27be7febd5a9661b7b359"
LAYOUT_VERSION = "5f035000d89d5fdd"
PAGE_COUNT = 1
PAGE_SIZE = (595.25, 841.85)

TEXT_ANCHORS = {
    "first_name": TextAnchor(161.17, 633.11, 12.93, 105.00, "center"),
    "surname": TextAnchor(317.64, 633.11, 12.93, 105.00, "center"),
    "position": TextAnchor(486.20, 603.86, 11.04, 110.00, "center"),
    "department": TextAnchor(352.32, 588.98, 12.93, 300.00, "center"),
    "start_date": TextAnchor(391.30, 568.34, 12.93, 150.00, "center"),
    "reason": TextAnchor(51.94, 531.83, 12.93, 500.00, "left"),
    "advance_amount": TextAnchor(278.39, 501.47, 12.93, 120.00, "center"),
    "advance_amount_words_th": TextAnchor(450.12, 501.47, 12.93, 230.00, "center"),
    "advance_amount_repeat": TextAnchor(239.38, 436.09, 12.93, 120.00, "center"),
    "advance_words_repeat": TextAnchor(430.54, 436.09, 12.93, 230.00, "center"),
    "monthly_deduction": TextAnchor(239.38, 416.89, 12.93, 120.00, "center"),
    "monthly_deduction_words_th": TextAnchor(430.54, 416.89, 12.93, 230.00, "center"),
    "applicant_display_name": TextAnchor(318.85, 359.04, 12.93, 220.00, "left"),
    "request_date": TextAnchor(469.78, 345.00, 12.93, 100.00, "center"),
    "finance_comment": TextAnchor(371.86, 327.14, 12.93, 320.00, "center"),
    "finance_display_name": TextAnchor(430.54, 275.29, 12.93, 220.00, "center"),
    "finance_date": TextAnchor(469.78, 261.25, 12.93, 100.00, "center"),
    "md_display_name": TextAnchor(430.54, 172.44, 12.93, 220.00, "center"),
    "md_date": TextAnchor(469.78, 158.39, 12.93, 100.00, "center"),
}

CHECKBOX_ANCHORS = {
    "approve": (144.38, 222.78, 8.50),
    "not_approved": (377.30, 222.78, 8.50),
}

SIGNATURE_BOXES = {
    "finance": (328.37, 286.31, 90.00, 28.00),
    "md": (328.30, 183.59, 90.00, 28.00),
}
