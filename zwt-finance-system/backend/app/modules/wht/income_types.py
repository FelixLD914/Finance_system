"""泰国预扣税收入类型目录。

前端的「收入类型」不再是自由文本框，可选项由本表提供，选中后带出法定默认税率。
落库的 income_type 仍是泰文原文（label_th），因为 WHT 正式文件按泰文打印，
换成 code 会改变已生成文件的内容与历史台账的可比性。

`in_use=True` 的三条来自本公司 2026-03 ~ 2026-06 历史台账（Sample_previous_code/
WHT/data历史/Data*.xlsx 共 234 条记录）实际用过的组合，税率与历史数据完全一致：

    ค่าบริการ  PND53 3% ×156 / PND3 3% ×13
    ค่าขนส่ง   PND53 1% ×50
    ค่าเช่า    PND53 5% ×9  / PND3 5% ×6

其余条目是泰国税法常见类别，作为备选放出，**业务上线前需财务复核税率**。
表外的类型仍可手工输入，Select 允许自由文本。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

WhtTypeCode = Literal["PND3", "PND53"]


@dataclass(frozen=True)
class IncomeTypeOption:
    """一条收入类型。rates 缺少某个 PND 表示该表不适用这个类型。"""

    code: str
    label_th: str
    label_en: str
    label_zh: str
    section: str
    rates: dict[WhtTypeCode, Decimal] = field(default_factory=dict)
    in_use: bool = False


def _rate(percent: str) -> Decimal:
    return Decimal(percent) / Decimal("100")


INCOME_TYPES: tuple[IncomeTypeOption, ...] = (
    IncomeTypeOption(
        code="service_fee",
        label_th="ค่าบริการ",
        label_en="Service fee",
        label_zh="服务费",
        section="มาตรา 40(8)",
        rates={"PND3": _rate("3"), "PND53": _rate("3")},
        in_use=True,
    ),
    IncomeTypeOption(
        code="transport_fee",
        label_th="ค่าขนส่ง",
        label_en="Transportation",
        label_zh="运输费",
        section="มาตรา 40(8)",
        rates={"PND3": _rate("1"), "PND53": _rate("1")},
        in_use=True,
    ),
    IncomeTypeOption(
        code="rental_fee",
        label_th="ค่าเช่า",
        label_en="Rental",
        label_zh="租金",
        section="มาตรา 40(5)",
        rates={"PND3": _rate("5"), "PND53": _rate("5")},
        in_use=True,
    ),
    IncomeTypeOption(
        code="hire_of_work",
        label_th="ค่าจ้างทำของ",
        label_en="Hire of work",
        label_zh="加工承揽费",
        section="มาตรา 40(7)(8)",
        rates={"PND3": _rate("3"), "PND53": _rate("3")},
    ),
    IncomeTypeOption(
        code="professional_fee",
        label_th="ค่าวิชาชีพอิสระ",
        label_en="Professional fee",
        label_zh="自由职业报酬",
        section="มาตรา 40(6)",
        rates={"PND3": _rate("3"), "PND53": _rate("3")},
    ),
    IncomeTypeOption(
        code="commission",
        label_th="ค่านายหน้า",
        label_en="Commission / brokerage",
        label_zh="佣金 / 中介费",
        section="มาตรา 40(2)",
        rates={"PND3": _rate("3"), "PND53": _rate("3")},
    ),
    IncomeTypeOption(
        code="advertising_fee",
        label_th="ค่าโฆษณา",
        label_en="Advertising fee",
        label_zh="广告费",
        section="มาตรา 40(8)",
        rates={"PND3": _rate("2"), "PND53": _rate("2")},
    ),
    IncomeTypeOption(
        code="non_life_insurance_premium",
        label_th="ค่าเบี้ยประกันวินาศภัย",
        label_en="Non-life insurance premium",
        label_zh="财产保险费",
        section="มาตรา 40(8)",
        rates={"PND53": _rate("1")},
    ),
    IncomeTypeOption(
        code="interest",
        label_th="ดอกเบี้ย",
        label_en="Interest",
        label_zh="利息",
        section="มาตรา 40(4)(ก)",
        # 付给个人按 15% 终局扣缴，付给法人 1%——两张表税率不同，
        # 这正是税率必须跟着 PND 类型走、不能只跟收入类型的原因。
        rates={"PND3": _rate("15"), "PND53": _rate("1")},
    ),
    IncomeTypeOption(
        code="dividend",
        label_th="เงินปันผล",
        label_en="Dividend",
        label_zh="股息",
        section="มาตรา 40(4)(ข)",
        rates={"PND3": _rate("10"), "PND53": _rate("10")},
    ),
    IncomeTypeOption(
        code="prize_discount",
        label_th="รางวัล ส่วนลด จากการส่งเสริมการขาย",
        label_en="Prize / sales-promotion discount",
        label_zh="促销奖励 / 折让",
        section="มาตรา 40(8)",
        rates={"PND3": _rate("3"), "PND53": _rate("3")},
    ),
)

_BY_CODE = {option.code: option for option in INCOME_TYPES}
_BY_LABEL_TH = {option.label_th: option for option in INCOME_TYPES}


def options_for(wht_type: WhtTypeCode | None) -> tuple[IncomeTypeOption, ...]:
    """列出适用于某张申报表的收入类型；wht_type 为空时给出全部。"""
    if wht_type is None:
        return INCOME_TYPES
    return tuple(option for option in INCOME_TYPES if wht_type in option.rates)


def find(code_or_label: str) -> IncomeTypeOption | None:
    """按 code 或泰文原文查找。历史数据存的是泰文，两种都要能命中。"""
    return _BY_CODE.get(code_or_label) or _BY_LABEL_TH.get(code_or_label.strip())


def default_rate(code_or_label: str, wht_type: WhtTypeCode | None) -> Decimal | None:
    option = find(code_or_label)
    if option is None or wht_type is None:
        return None
    return option.rates.get(wht_type)
