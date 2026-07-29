"""税率偏离目录法定值时必须留理由 —— 业务口径锁定测试。

判定放在服务端而不是只靠前端警示：直接打 API 的调用方也绕不过去。
"""

from decimal import Decimal

import pytest

from app.modules.wht.service import WhtService, WhtStateError

# ค่าขนส่ง（运输费）在 PND53 下的法定税率是 1%。
TRANSPORT = "ค่าขนส่ง"
STATUTORY = Decimal("0.01")


def note_for(rate: Decimal, supplied: str | None, income_type: str = TRANSPORT):
    return WhtService._rate_override_note(income_type, "PND53", rate, supplied)


def test_statutory_rate_needs_no_note() -> None:
    assert note_for(STATUTORY, None) is None


def test_deviating_rate_without_note_is_rejected() -> None:
    with pytest.raises(WhtStateError, match="rateOverrideNote is required"):
        note_for(Decimal("0.05"), None)


def test_blank_note_does_not_count_as_a_reason() -> None:
    with pytest.raises(WhtStateError, match="rateOverrideNote is required"):
        note_for(Decimal("0.05"), "   ")


def test_deviating_rate_records_both_rates_and_the_reason() -> None:
    note = note_for(Decimal("0.05"), "合同约定 5%，见 2026-06 补充协议")
    # 事后审计只看事件 note，所以实际税率和法定税率都要写进去，
    # 不能只留一句自由文本。
    assert "5.00%" in note
    assert "1.00%" in note
    assert "合同约定 5%，见 2026-06 补充协议" in note


def test_free_text_income_type_is_not_checked() -> None:
    # 目录里查不到的收入类型无从比对法定税率，不强制填理由。
    assert note_for(Decimal("0.07"), None, income_type="ค่าอื่น ๆ") is None


def test_free_text_income_type_still_keeps_a_supplied_note() -> None:
    assert note_for(Decimal("0.07"), "客户要求", income_type="ค่าอื่น ๆ") == "客户要求"


def test_statutory_rate_keeps_a_supplied_note_verbatim() -> None:
    # 没偏离就没有「法定 vs 实际」的对照要记，理由原样留存。
    assert note_for(STATUTORY, "按目录") == "按目录"
