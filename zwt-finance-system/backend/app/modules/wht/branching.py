"""WHT 收款方总公司 / 分支规则。

PND53 面向公司，正式凭证必须说明是สำนักงานใหญ่还是具体สาขา；PND3 面向个人，
不显示分支。数据层保存结构化值，只有展示和文档生成时才拼进公司名称，避免搜索、
去重和历史快照都被一段展示文案污染。
"""

from __future__ import annotations

import re
from typing import Literal

BranchType = Literal["none", "head_office", "branch"]

_BRANCH_NUMBER = re.compile(r"^\d{5}$")


def normalize_branch(
    wht_type: str | None,
    branch_type: str | None,
    branch_number: str | None,
) -> tuple[BranchType, str | None]:
    """Return a validated, canonical branch pair for a payee/task snapshot."""

    normalized_number = (branch_number or "").strip() or None
    if wht_type != "PND53":
        if branch_type not in (None, "none") or normalized_number is not None:
            raise ValueError("branch details are only available for PND53 company payees")
        return "none", None

    normalized_type = branch_type or "head_office"
    if normalized_type not in {"head_office", "branch"}:
        raise ValueError("PND53 company payees must be a head office or branch")
    if normalized_type == "head_office":
        if normalized_number is not None:
            raise ValueError("a head office cannot have a branch number")
        return "head_office", None
    if normalized_number is None or _BRANCH_NUMBER.fullmatch(normalized_number) is None:
        raise ValueError("branchNumber must contain exactly 5 digits")
    return "branch", normalized_number


def display_payee_name(
    name: str,
    branch_type: str | None,
    branch_number: str | None,
) -> str:
    """Append the official Thai office label without changing the stored legal name."""

    if branch_type == "head_office":
        label = "สำนักงานใหญ่"
    elif branch_type == "branch" and branch_number:
        label = f"สาขา {branch_number}"
    else:
        return name
    # Legacy data sometimes already carried the office text inside the legal name.
    clean_name = name.rstrip()
    if clean_name.endswith((f"（{label}）", f"({label})")):
        return name
    # WHT 模板使用 Sarabun；该字体没有中文全角括号字形，PDF 会直接丢字。
    return f"{name}({label})"
