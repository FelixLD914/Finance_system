"""签名适用范围的作用域规则。

WHT 用「签名图-Yao」、TAX INV 用「Sign_zhao」、工资预支用财务与总经理本人的
签名——各模块的签字人不同，所以"设为默认"绝不能是全表操作。

适用范围原本是单值枚举（wht / tax_inv / both），加入工资预支后 both（"两者"）
不再成立，改成模块集合。
"""

import pytest

from app.core.signature_usage import (
    SIGNATURE_MODULES,
    format_signature_usage,
    parse_signature_usage,
    signature_allows,
    signature_usages_overlap,
)
from app.modules.tax_invoice.document_generator import SIGNATURE_BOX


def test_legacy_both_still_reads_as_wht_plus_tax_inv() -> None:
    """迁移漏网或回退过的行不能把签名解析成"谁都不能用"。"""
    assert parse_signature_usage("both") == {"wht", "tax_inv"}
    assert signature_allows("both", "wht")
    assert signature_allows("both", "tax_inv")
    assert not signature_allows("both", "salary_advance")


def test_serialisation_is_stable_regardless_of_input_order() -> None:
    # 同一集合必须得到同一个字符串，否则同一张签名会因为写入顺序不同而产生
    # 两种存储形态，查询和比对都会漏。
    assert format_signature_usage(["tax_inv", "wht"]) == format_signature_usage(
        ["wht", "tax_inv"]
    )
    assert parse_signature_usage(format_signature_usage(SIGNATURE_MODULES)) == set(
        SIGNATURE_MODULES
    )


def test_unknown_module_names_are_dropped_not_trusted() -> None:
    assert parse_signature_usage("wht,typo_module") == {"wht"}
    with pytest.raises(ValueError, match="at least one module"):
        format_signature_usage(["typo_module"])


def test_multi_module_signature_usage_formatting() -> None:
    formatted = format_signature_usage(["wht", "tax_inv"])
    assert formatted == "wht,tax_inv"
    assert parse_signature_usage(formatted) == {"wht", "tax_inv"}
    assert signature_allows(formatted, "wht")
    assert signature_allows(formatted, "tax_inv")
    assert not signature_allows(formatted, "salary_advance")


@pytest.mark.parametrize("module", SIGNATURE_MODULES)
def test_single_module_signature_only_allows_that_module(module: str) -> None:
    stored = format_signature_usage([module])
    for other in SIGNATURE_MODULES:
        assert signature_allows(stored, other) is (other == module)


def test_defaults_only_clear_each_other_when_scopes_overlap() -> None:
    # 这条是整个设计的要点：给 TAX INV 设默认签名，不能顺手把 WHT 的默认废掉。
    assert not signature_usages_overlap("wht", "tax_inv")
    assert not signature_usages_overlap("salary_advance", "tax_inv")
    assert not signature_usages_overlap("salary_advance", "wht")
    # 覆盖多个模块的签名与其中任一模块都冲突。
    assert signature_usages_overlap("wht,tax_inv", "tax_inv")
    assert signature_usages_overlap("wht,salary_advance", "wht")


def test_tax_invoice_signature_box_sits_inside_the_page() -> None:
    x, y, width, height = SIGNATURE_BOX
    # A4 竖版 595.28 x 841.89 pt。签名框量自底版右下角的「Authorized Signature」。
    assert 0 < x < x + width < 595.28
    assert 0 < y < y + height < 841.89
    # 落在页面下半部分的右侧——放错象限的话渲染出来会盖在商品明细上。
    assert y + height < 400
    assert x > 300
