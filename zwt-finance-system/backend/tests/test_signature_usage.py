"""签名适用范围的作用域规则。

WHT 用「签名图-Yao」、TAX INV 用「Sign_zhao」——两种单据的签字人不同，
所以"设为默认"绝不能是全表操作。
"""

import pytest

from app.modules.tax_invoice.document_generator import SIGNATURE_BOX
from app.modules.wht.document_service import _conflicting_usages


@pytest.mark.parametrize(
    ("usage", "expected"),
    [
        ("wht", {"wht", "both"}),
        ("tax_inv", {"tax_inv", "both"}),
        # both 同时覆盖两种单据，把它设成默认要清掉所有人的默认。
        ("both", {"wht", "tax_inv", "both"}),
    ],
)
def test_setting_a_default_only_clears_overlapping_scopes(
    usage: str,
    expected: set[str],
) -> None:
    assert set(_conflicting_usages(usage)) == expected


def test_wht_and_tax_inv_defaults_do_not_clear_each_other() -> None:
    # 这条是整个设计的要点：给 TAX INV 设默认签名，不能顺手把 WHT 的默认废掉。
    assert "wht" not in _conflicting_usages("tax_inv")
    assert "tax_inv" not in _conflicting_usages("wht")


def test_tax_invoice_signature_box_sits_inside_the_page() -> None:
    x, y, width, height = SIGNATURE_BOX
    # A4 竖版 595.28 x 841.89 pt。签名框量自底版右下角的「Authorized Signature」。
    assert 0 < x < x + width < 595.28
    assert 0 < y < y + height < 841.89
    # 落在页面下半部分的右侧——放错象限的话渲染出来会盖在商品明细上。
    assert y + height < 400
    assert x > 300
