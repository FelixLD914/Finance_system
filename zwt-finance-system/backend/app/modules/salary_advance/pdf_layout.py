"""自动生成；源文件：Salary-Advance-Template.xlsx。请勿手工改坐标。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TextAnchor:
    x: float
    y: float
    size: float
    max_width: float
    align: str = "left"


SOURCE_XLSX_SHA256 = "55484fa5b492883d99a64114e0c6a34627a624c622ebd86c05a071d6f8e2887a"
PDF_UNDERLAY_SHA256 = "1dd05ed26abc8891637f069125ca407eef9c1ca45fca10da6aae0b11c046a015"
LAYOUT_VERSION = "28984c26c91c6b24"
PAGE_COUNT = 1
PAGE_SIZE = (595.25, 841.85)

TEXT_ANCHORS = {
    "first_name": TextAnchor(140.62, 633.11, 12.93, 105.00, "center"),
    "surname": TextAnchor(319.78, 633.11, 12.93, 105.00, "center"),
    "position": TextAnchor(487.26, 603.86, 11.04, 110.00, "center"),
    "department": TextAnchor(342.00, 588.98, 12.93, 300.00, "center"),
    "start_date": TextAnchor(392.41, 568.34, 12.93, 150.00, "center"),
    "reason": TextAnchor(51.94, 531.83, 12.93, 500.00, "left"),
    "advance_amount": TextAnchor(280.53, 501.47, 12.93, 120.00, "center"),
    "advance_amount_words_th": TextAnchor(451.19, 501.47, 12.93, 230.00, "center"),
    "advance_amount_repeat": TextAnchor(230.18, 436.09, 12.93, 120.00, "center"),
    "advance_words_repeat": TextAnchor(431.61, 436.09, 12.93, 230.00, "center"),
    "monthly_deduction": TextAnchor(230.18, 416.89, 12.93, 120.00, "center"),
    "monthly_deduction_words_th": TextAnchor(431.61, 416.89, 12.93, 230.00, "center"),
    "applicant_display_name": TextAnchor(320.99, 359.04, 12.93, 220.00, "left"),
    "request_date": TextAnchor(470.86, 345.00, 12.93, 100.00, "center"),
    "finance_comment": TextAnchor(361.68, 327.14, 12.93, 320.00, "center"),
    "finance_display_name": TextAnchor(431.61, 275.29, 12.93, 220.00, "center"),
    "finance_date": TextAnchor(470.86, 261.25, 12.93, 100.00, "center"),
    "md_display_name": TextAnchor(431.61, 172.44, 12.93, 220.00, "center"),
    "md_date": TextAnchor(470.86, 158.39, 12.93, 100.00, "center"),
}

CHECKBOX_ANCHORS = {
    "approve": (123.83, 222.78, 8.50),
    "not_approved": (379.44, 222.78, 8.50),
}

SIGNATURE_BOXES = {
    "finance": (330.50, 286.31, 90.00, 28.00),
    "md": (330.49, 183.59, 90.00, 28.00),
}
