"""签名适用范围的作用域规则。

WHT 用「签名图-Yao」、TAX INV 用「Sign_zhao」、工资预支用财务与总经理本人的
签名——各模块的签字人不同，所以"设为默认"绝不能是全表操作。

适用范围原本是单值枚举（wht / tax_inv / both），加入工资预支后 both（"两者"）
不再成立，改成模块集合。
"""

import uuid
from datetime import UTC, datetime
from typing import get_args

import pytest

from app.core.signature_usage import (
    SIGNATURE_MODULES,
    format_signature_usage,
    parse_signature_usage,
    requires_signer_name,
    signature_allows,
    signature_usages_overlap,
)
from app.modules.tax_invoice.document_generator import SIGNATURE_BOX
from app.modules.wht.schemas import (
    SignatureAssetResponse,
    SignatureAssetUpdate,
    SignatureUsage,
)


def test_only_salary_advance_needs_a_signer_name() -> None:
    """工资预支单在签名下方印 "( 姓名 )"；WHT / TAX INV 的单据上只有签名图。

    所以姓名不是"所有签名都要填"——那会逼着只用于 WHT 的签名去编一个没人看的名字。
    """
    assert requires_signer_name(format_signature_usage(["salary_advance"]))
    assert requires_signer_name(format_signature_usage(["salary_advance_finance"]))
    assert requires_signer_name(format_signature_usage(["salary_advance_md"]))
    # 一张兼用的签名，只要沾了工资预支就要有姓名。
    assert requires_signer_name(format_signature_usage(["wht", "salary_advance_md"]))

    assert not requires_signer_name(format_signature_usage(["wht"]))
    assert not requires_signer_name(format_signature_usage(["tax_inv"]))
    assert not requires_signer_name(format_signature_usage(["wht", "tax_inv"]))
    assert not requires_signer_name("both")  # 迁移前的旧值 = wht + tax_inv
    assert not requires_signer_name(None)


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


@pytest.mark.parametrize("module", ["wht", "tax_inv"])
def test_single_module_signature_only_allows_that_module(module: str) -> None:
    stored = format_signature_usage([module])
    for other in SIGNATURE_MODULES:
        assert signature_allows(stored, other) is (other == module)


def test_salary_advance_signature_roles() -> None:
    # 纯 salary_advance 通用签名：同时支持财务负责人与董事
    general = format_signature_usage(["salary_advance"])
    assert signature_allows(general, "salary_advance")
    assert signature_allows(general, "salary_advance_finance")
    assert signature_allows(general, "salary_advance_md")
    assert not signature_allows(general, "wht")
    assert not signature_allows(general, "tax_inv")

    # 专门设立的财务负责人签名
    fin = format_signature_usage(["salary_advance_finance"])
    assert signature_allows(fin, "salary_advance_finance")
    assert signature_allows(fin, "salary_advance")
    assert not signature_allows(fin, "salary_advance_md")
    assert not signature_allows(fin, "wht")

    # 专门设立的董事签名
    md = format_signature_usage(["salary_advance_md"])
    assert signature_allows(md, "salary_advance_md")
    assert signature_allows(md, "salary_advance")
    assert not signature_allows(md, "salary_advance_finance")
    assert not signature_allows(md, "wht")


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


def test_api_usage_enum_covers_every_module() -> None:
    """对外的 usage 枚举必须就是 SIGNATURE_MODULES，不能是另抄的一份。

    这两处曾经分家：core 加了 salary_advance_finance / _md，
    wht.schemas 里那个手写的 Literal 停在三个旧值上。后果是工资预支签名
    **完全不可用**，而且两端都不报编译期错：
      - 写：勾「预支单-财务负责人」保存 → 422（用户 2026-08-05 实拍三连报错）；
      - 读：SignatureAssetResponse.split_usage 把库里的 salary_advance 展开成
        三个角色名，同样过不了 Literal，响应校验 500——存量签名连列表都拉不出来。
    """
    assert set(get_args(SignatureUsage)) == set(SIGNATURE_MODULES)


@pytest.mark.parametrize("module", SIGNATURE_MODULES)
def test_every_module_can_be_saved_through_the_update_schema(module: str) -> None:
    """逐个走一遍真实的保存载荷；漏一个就是那个角色位在维护页存不进去。"""
    payload = SignatureAssetUpdate(usage=[module], signer_name="XING LANHUI")
    assert payload.usage == [module]


def test_signature_response_serialises_a_salary_advance_asset() -> None:
    """库里存 salary_advance 的签名要能读出来——展开后的角色名也得在枚举里。"""
    response = SignatureAssetResponse.model_validate(
        {
            "id": uuid.uuid4(),
            "name": "FIN_XING_LANHUI",
            "original_file_name": "x.png",
            "mime_type": "image/png",
            "sha256": "0" * 64,
            "version": 1,
            "status": "active",
            # ORM 里就是这个逗号串，split_usage 会把它展开
            "usage": "salary_advance",
            "signer_name": "XING LANHUI",
            "is_default": False,
            "created_by_name": "t",
            "updated_by_name": "t",
            "created_at": datetime(2026, 8, 5, tzinfo=UTC),
            "updated_at": datetime(2026, 8, 5, tzinfo=UTC),
        }
    )
    assert set(response.usage) == {
        "salary_advance",
        "salary_advance_finance",
        "salary_advance_md",
    }
