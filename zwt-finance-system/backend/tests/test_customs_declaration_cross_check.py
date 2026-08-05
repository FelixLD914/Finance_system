"""报关单自洽核对：零容差（业务口径 2026-08-05）。

原实现在"泰铢 vs 美元 × 海关汇率"上留了 1 泰铢容差。业务明确要求 1 泰铢都不许差，
所以阈值取消了；同时把算法改成与海关一致（有行级数据就逐行折算再加总），
这样当初加容差要挡的那个进位差压根不会出现——而不是靠放宽阈值把它盖住。

这两件事必须一起测：只测"差 0.01 会报警"而不测"合法单子不报警"，
就会把一个把所有票都打成 needs_review 的实现测成绿的。
"""

from __future__ import annotations

from decimal import Decimal

from app.modules.tax_invoice.customs_declaration import (
    CONFIDENCE_TRUSTED_EXACT,
    DeclarationItem,
    Field,
    ParsedDeclaration,
    _cross_check,
)


def build(
    *,
    rate: str | None = "31.0627",
    usd_printed: str | None = None,
    thb_printed: str | None = None,
    usd_line: str | None = None,
    thb_line: str | None = None,
    lines: list[tuple[str, str]] | None = None,
) -> ParsedDeclaration:
    """按需装配一份识别结果；lines 是 [(fob_usd, fob_thb), ...]。"""

    def field(raw: str | None) -> Field | None:
        if raw is None:
            return None
        return Field(
            value=Decimal(raw),
            raw_text=raw,
            confidence=CONFIDENCE_TRUSTED_EXACT,
            source="test",
        )

    fields = {
        "customs_exchange_rate": field(rate),
        "customs_fob_usd_printed_total": field(usd_printed),
        "customs_fob_thb_printed_total": field(thb_printed),
        "customs_fob_usd_line_total": field(usd_line),
        "customs_fob_thb_line_total": field(thb_line),
    }
    return ParsedDeclaration(
        fields={name: value for name, value in fields.items() if value is not None},
        items=[
            DeclarationItem(
                line_number=index,
                fob_usd=Decimal(usd),
                fob_thb=Decimal(thb),
            )
            for index, (usd, thb) in enumerate(lines or [], start=1)
        ],
    )


def rate_warnings(parsed: ParsedDeclaration) -> list[str]:
    return [w for w in _cross_check(parsed) if "海关汇率" in w]


def test_consistent_declaration_reports_nothing() -> None:
    # 1000 * 31.0627 = 31062.70；2000 * 31.0627 = 62125.40；合计 93188.10
    parsed = build(
        thb_printed="93188.10",
        usd_printed="3000.00",
        lines=[("1000.00", "31062.70"), ("2000.00", "62125.40")],
    )
    assert _cross_check(parsed) == []


def test_one_satang_off_is_reported() -> None:
    """零容差：差 0.01 泰铢也要报。"""
    parsed = build(
        thb_printed="93188.11",
        usd_printed="3000.00",
        lines=[("1000.00", "31062.70"), ("2000.00", "62125.40")],
    )
    warnings = rate_warnings(parsed)
    assert len(warnings) == 1
    assert "0.01" in warnings[0]


def test_difference_under_the_old_one_baht_threshold_is_now_reported() -> None:
    """这正是口径变更要抓的：旧实现 <=1.00 泰铢一律放过。"""
    parsed = build(
        thb_printed="93187.11",
        usd_printed="3000.00",
        lines=[("1000.00", "31062.70"), ("2000.00", "62125.40")],
    )
    assert rate_warnings(parsed), "差 0.99 泰铢在旧的 1 泰铢容差下会被静默放过"


def test_per_line_rounding_does_not_create_a_false_warning() -> None:
    """当初加容差要挡的就是这个场景，现在靠算法一致来消除，而不是靠阈值。

    汇率 3.005 下：
      逐行折算 round(1.111*3.005)=3.34, round(2.222*3.005)=6.68 -> 合计 10.02
      按合计折算 round(3.333*3.005)=10.01                        -> 差 0.01
    报关单印的是 10.02（它自己就是逐行加总的），所以不该报警。
    """
    parsed = build(
        rate="3.005",
        usd_printed="3.333",
        thb_printed="10.02",
        lines=[("1.111", "3.34"), ("2.222", "6.68")],
    )
    assert rate_warnings(parsed) == []


def test_falls_back_to_totals_when_line_amounts_are_missing() -> None:
    """老模板/文本层坏时读不到行级明细，仍要用合计做一次精确比对。"""
    ok = build(rate="2.00", usd_printed="10.00", thb_printed="20.00")
    assert rate_warnings(ok) == []

    bad = build(rate="2.00", usd_printed="10.00", thb_printed="20.01")
    assert rate_warnings(bad)


def test_partial_line_amounts_do_not_use_the_per_line_basis() -> None:
    """只读出一部分行的美元时，逐行加总会漏掉没读到的那些行，必须退回合计口径。"""
    parsed = ParsedDeclaration(
        fields=build(rate="2.00", usd_printed="10.00", thb_printed="20.00").fields,
        items=[
            DeclarationItem(line_number=1, fob_usd=Decimal("4.00"), fob_thb=Decimal("8.00")),
            DeclarationItem(line_number=2, fob_usd=None, fob_thb=Decimal("12.00")),
        ],
    )
    # 用合计口径：10.00 * 2 = 20.00，与自印 20.00 一致，不报警。
    # 若错误地按已读到的行加总（4.00*2=8.00），就会报一条假告警。
    assert rate_warnings(parsed) == []


def test_missing_rate_or_amount_reports_nothing() -> None:
    """读不到就是"没得核对"，不是"核对不过"——不能拿缺失当不一致报。"""
    assert rate_warnings(build(rate=None, thb_printed="100.00")) == []
    assert rate_warnings(build(rate="2.00")) == []


def test_line_total_versus_printed_total_stays_exact() -> None:
    """行级合计 vs 自印合计这两条本来就没有容差，回归保护一下。"""
    parsed = build(
        usd_line="3000.00",
        usd_printed="3000.01",
        thb_line="93188.10",
        thb_printed="93188.10",
        lines=[("1000.00", "31062.70"), ("2000.00", "62125.40")],
    )
    assert any("FOB USD" in w for w in _cross_check(parsed))
