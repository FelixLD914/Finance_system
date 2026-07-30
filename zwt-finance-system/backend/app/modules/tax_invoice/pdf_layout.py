"""TAX INV 底版的叠加坐标（自动生成，不要手改）。

由 scripts/build_tax_inv_underlay.py 从 TAX-INV-Template.pdf 的制版过程中量出，
和同目录下的底版一一对应。模板 xlsx 一旦改动，底版和这张表必须一起重新生成。

源模板 sha256: a0646b43dc338ff5397919fbccf4baf41c109931e7f179c22722e3b2030f75c0

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


PAGE_SIZE = (595.25, 841.85)
PAGE_COUNT = 3

HEADER_ANCHORS: dict[str, tuple[TextAnchor, ...]] = {
    'customer_name': (
        TextAnchor(118.43, 'left', 6.34, 315.70),
        TextAnchor(120.74, 'left', 6.34, 329.59),
        TextAnchor(119.52, 'left', 6.34, 321.69),
    ),
    'customer_address': (
        TextAnchor(118.43, 'left', 6.34, 315.70),
        TextAnchor(120.74, 'left', 6.34, 356.34),
        TextAnchor(119.52, 'left', 6.34, 353.02),
    ),
    'tax_id': (
        TextAnchor(118.43, 'left', 6.34, 267.32),
        TextAnchor(120.74, 'left', 6.34, 259.99),
        TextAnchor(119.52, 'left', 6.34, 260.47),
    ),
    'po_no': (
        TextAnchor(118.43, 'left', 6.34, 267.32),
        TextAnchor(120.74, 'left', 6.34, 259.99),
        TextAnchor(119.52, 'left', 6.34, 260.47),
    ),
    'payment_term': (
        TextAnchor(118.43, 'left', 6.34, 267.32),
        TextAnchor(120.74, 'left', 6.34, 259.99),
        TextAnchor(119.52, 'left', 6.34, 260.47),
    ),
    'document_no': (
        TextAnchor(577.05, 'right', 6.34, None),
        TextAnchor(571.17, 'right', 6.34, None),
        TextAnchor(577.41, 'right', 6.34, None),
    ),
    'invoice_date': (
        TextAnchor(576.99, 'right', 6.34, None),
        TextAnchor(571.23, 'right', 6.34, None),
        TextAnchor(577.34, 'right', 6.34, None),
    ),
}

HEADER_BASELINES: dict[str, float] = {
    'customer_name': 671.77,
    'customer_address': 658.81,
    'tax_id': 644.19,
    'po_no': 633.63,
    'payment_term': 612.51,
    'document_no': 671.64,
    'invoice_date': 658.68,
}

ITEM_ANCHORS: dict[str, tuple[TextAnchor, ...]] = {
    'line_number': (
        TextAnchor(32.71, 'center', 7.07, None),
        TextAnchor(33.85, 'center', 7.07, None),
        TextAnchor(32.30, 'center', 7.07, None),
    ),
    'product_name': (
        TextAnchor(51.97, 'left', 7.07, 119.71),
        TextAnchor(54.24, 'left', 7.07, 111.68),
        TextAnchor(51.14, 'left', 7.07, 111.66),
    ),
    'product_code': (
        TextAnchor(174.50, 'left', 7.07, 87.42),
        TextAnchor(168.74, 'left', 7.07, 80.82),
        TextAnchor(165.60, 'left', 7.07, 77.36),
    ),
    'unit': (
        TextAnchor(278.92, 'center', 7.07, 28.72),
        TextAnchor(266.92, 'center', 7.07, 29.44),
        TextAnchor(261.90, 'center', 7.07, 32.56),
    ),
    'quantity': (
        TextAnchor(335.66, 'right', 7.07, None),
        TextAnchor(325.81, 'right', 7.07, None),
        TextAnchor(325.58, 'right', 7.07, None),
    ),
    'fob_unit_price_usd': (
        TextAnchor(377.90, 'right', 7.07, None),
        TextAnchor(372.37, 'right', 7.07, None),
        TextAnchor(370.58, 'right', 7.07, None),
    ),
    'fob_revenue_usd': (
        TextAnchor(430.74, 'right', 7.07, None),
        TextAnchor(421.14, 'right', 7.07, None),
        TextAnchor(423.41, 'right', 7.07, None),
    ),
    'fx_date': (
        TextAnchor(456.01, 'center', 7.07, None),
        TextAnchor(447.46, 'center', 7.07, None),
        TextAnchor(448.33, 'center', 7.07, None),
    ),
    'exchange_rate': (
        TextAnchor(510.22, 'right', 7.07, None),
        TextAnchor(499.54, 'right', 7.07, None),
        TextAnchor(500.62, 'right', 7.07, None),
    ),
    'fob_revenue_thb': (
        TextAnchor(577.01, 'right', 7.07, None),
        TextAnchor(571.25, 'right', 7.07, None),
        TextAnchor(577.39, 'right', 7.07, None),
    ),
}

ITEM_BASELINES: dict[str, tuple[float, ...]] = {
    'line_number': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        340.83,
        327.48,
        314.17,
    ),
    'product_name': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        340.83,
        327.48,
        314.17,
    ),
    'product_code': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        338.52,
        325.21,
        311.90,
    ),
    'unit': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        338.52,
        325.21,
        311.90,
    ),
    'quantity': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        338.52,
        325.21,
        311.90,
    ),
    'fob_unit_price_usd': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        338.52,
        325.21,
        311.90,
    ),
    'fob_revenue_usd': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        340.83,
        327.48,
        314.17,
    ),
    'fx_date': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        340.83,
        327.48,
        314.17,
    ),
    'exchange_rate': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        340.83,
        327.48,
        314.17,
    ),
    'fob_revenue_thb': (
        555.61,
        541.47,
        527.07,
        512.67,
        498.27,
        483.87,
        469.47,
        455.07,
        440.89,
        426.75,
        412.35,
        397.95,
        383.55,
        369.15,
        354.75,
        340.83,
        327.48,
        314.17,
    ),
}

TOTAL_ANCHORS: dict[str, tuple[TextAnchor, ...]] = {
    'amount_text_thai': (
        TextAnchor(60.35, 'left', 7.07, 390.68),
        TextAnchor(62.66, 'left', 7.07, 380.95),
        TextAnchor(59.52, 'left', 7.07, 383.61),
    ),
    'total_thb': (
        TextAnchor(575.34, 'right', 7.07, None),
        TextAnchor(569.58, 'right', 7.07, None),
        TextAnchor(575.70, 'right', 7.07, None),
    ),
    'after_discount_thb': (
        TextAnchor(575.34, 'right', 7.07, None),
        TextAnchor(569.81, 'right', 7.07, None),
        TextAnchor(576.43, 'right', 7.07, None),
    ),
    'grand_total_thb': (
        TextAnchor(575.34, 'right', 7.07, None),
        TextAnchor(569.81, 'right', 7.07, None),
        TextAnchor(576.43, 'right', 7.07, None),
    ),
}

TOTAL_BASELINES: dict[str, float] = {
    'amount_text_thai': 294.36,
    'total_thb': 294.49,
    'after_discount_thb': 256.70,
    'grand_total_thb': 203.42,
}
