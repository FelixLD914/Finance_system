"""批量开具的「先核对、后落库」中间层。

原来的一步式 `/tasks/batch-create` 是上传即落库：解析通过就直接建草稿，收款方查不到
就整表退回。分步流程把它拆成两段：

    batch-preview   解析 + 逐行配收款方、算税率，**只读**，把结果交给前端核对
    batch-commit    用户核对（并补全缺失的收款方）后回传，服务端重新校验再落库

两段之间刻意不留服务端状态：预览不写库、不发 token，落库以回传的内容为准，服务端把
每一行都当成新数据重新校验一遍。于是刷新页面、换个人接着做、隔一天再提交都不会踩到
过期的服务端草稿——代价只是回传时多传一遍行数据（500 行上限，量很小）。

本模块只放**纯函数**：给定一行解析结果和查到的收款方（或 None），算出核对表要显示的
一行。查库留在 service 层，这样这里的口径判定可以直接用普通对象测，不必起数据库。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from app.modules.wht.income_types import default_rate

MONEY_QUANTUM = Decimal("0.01")

# 核对表的行状态。只有 ready 能落库，另外两个都要人先动手。
#   ready          齐了，可以建草稿
#   payee_missing  税号在主数据里查不到，等人手工补录收款方资料
#   needs_input    行本身还缺东西（税率带不出来 / 偏离法定税率却没写理由 /
#                  收款方被停用），errors 里逐条说明缺什么
RowStatus = Literal["ready", "payee_missing", "needs_input"]


@dataclass
class PayeeSnapshot:
    """核对表里那一列收款方。payee_id 为 None 即「库里没有，等人填」。"""

    tax_id: str
    payee_id: Any = None
    name_th: str | None = None
    name_en: str | None = None
    address_th: str | None = None
    wht_type: str | None = None
    is_active: bool = True


@dataclass
class ReviewedRow:
    row_number: int
    status: RowStatus
    period: str
    issuance_type: str
    supplement_run: int
    income_type: str
    payment_date: Any
    total_amount: Decimal
    payee: PayeeSnapshot
    wht_rate: Decimal | None = None
    statutory_rate: Decimal | None = None
    wht_amount: Decimal | None = None
    rate_reason: str | None = None
    errors: list[str] = field(default_factory=list)

    @property
    def rate_deviates(self) -> bool:
        """税率偏离目录法定值。目录里查不到该收入类型时无从比对，一律算不偏离。"""
        return (
            self.wht_rate is not None
            and self.statutory_rate is not None
            and self.wht_rate != self.statutory_rate
        )


def withheld_amount(total_amount: Decimal, wht_rate: Decimal | None) -> Decimal | None:
    """与 WhtService._calculated_wht_amount 同一口径：ROUND_HALF_UP 保留两位。

    预览要把代扣金额显示出来给人核对，而金额必须和最终落库的一分不差，否则核对
    就白核了。这里刻意只做一件事，让服务端建单时算出来的结果与它逐字相同。
    """
    if wht_rate is None:
        return None
    return (total_amount * wht_rate).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def review_row(row: dict[str, Any], payee: PayeeSnapshot | None) -> ReviewedRow:
    """把一条解析好的行 + 查到的收款方整理成核对表的一行。

    收款方缺失时**不再往下判税率**：法定税率要看收款方走 PND3 还是 PND53，人没填完
    之前算出来的任何值都是猜的。前端在用户选完申报表类型后自己按同一份目录带出税率，
    最终仍以 batch-commit 的服务端判定为准。
    """
    reviewed = ReviewedRow(
        row_number=row["row_number"],
        status="ready",
        period=row["period"],
        issuance_type=row["issuance_type"],
        supplement_run=row["supplement_run"],
        income_type=row["income_type"],
        payment_date=row["payment_date"],
        total_amount=row["total_amount"],
        payee=payee or PayeeSnapshot(tax_id=row["payee_tax_id"]),
        wht_rate=row.get("wht_rate"),
        rate_reason=(row.get("rate_reason") or "").strip() or None,
    )

    if payee is None or payee.payee_id is None:
        reviewed.status = "payee_missing"
        # 表里明确填了税率就留着——它与收款方无关，人补完档案不必再敲一遍。
        reviewed.wht_amount = withheld_amount(reviewed.total_amount, reviewed.wht_rate)
        return reviewed

    if not payee.is_active:
        reviewed.status = "needs_input"
        reviewed.errors.append(
            f"收款方「{payee.name_th}」已停用，请先在收款方主数据里启用后再导入"
        )
        return reviewed

    reviewed.statutory_rate = default_rate(reviewed.income_type, payee.wht_type)
    if reviewed.wht_rate is None:
        reviewed.wht_rate = reviewed.statutory_rate
    reviewed.wht_amount = withheld_amount(reviewed.total_amount, reviewed.wht_rate)

    if reviewed.wht_rate is None:
        reviewed.status = "needs_input"
        reviewed.errors.append(
            f"收入类型「{reviewed.income_type}」不在 {payee.wht_type} 的目录里，"
            f"请直接填写税率"
        )
        return reviewed

    if reviewed.rate_deviates and reviewed.rate_reason is None:
        reviewed.status = "needs_input"
        reviewed.errors.append(
            f"税率 {reviewed.wht_rate * 100:.2f}% 偏离法定 "
            f"{(reviewed.statutory_rate or 0) * 100:.2f}%，必须填写理由"
        )
    return reviewed
