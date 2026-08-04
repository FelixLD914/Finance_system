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
    """Append the official Thai office label with parentheses according to original design."""
    clean_name = (name or "").strip()
    if not clean_name:
        return ""

    # 清理末尾可能粘连的未加括号或已加括号的总部/分支文案
    clean_base = re.sub(r"[\s\(（]*(สำนักงานใหญ่|สาขาที่?\s*\d+|\(สำนักงานใหญ่\)|（สำนักงานใหญ่）)[\s\)）]*$", "", clean_name).strip()

    if branch_type == "head_office":
        label = "สำนักงานใหญ่"
    elif branch_type == "branch" and branch_number:
        num_str = str(branch_number).strip().zfill(5)
        label = f"สาขา {num_str}"
    else:
        match = re.search(r"(สำนักงานใหญ่|สาขาที่?\s*\d+)", name)
        if match:
            label = match.group(1)
        else:
            return clean_base

    return f"{clean_base}({label})"
