"""角色与权限映射（职责分离策略）。

税票和 WHT 凭证是对外正式文件，"谁能录入"与"谁能批准"必须可以分开授权，
否则一个人就能独立完成从录入到签发的全过程，审计上没有第二双眼睛。

权限点按"资源:动作"命名。read 是最小可见性，write 覆盖导入与编辑（都只作用于
未批准记录），approve / void / correct 是不可逆的正式动作，generate 触发正式
文件落盘并把记录推进到 issued。
"""

from __future__ import annotations

from typing import Literal, get_args

Permission = Literal[
    "invoice:read",
    "invoice:write",
    "invoice:approve",
    "invoice:void",
    "invoice:correct",
    "invoice:generate",
    "wht:read",
    "wht:write",
    # WHT 目前没有作废动作，退回草稿（return-to-draft）由 wht:approve 覆盖，
    # 所以这里不设 wht:void —— 不留没有端点对应的死权限点。
    "wht:approve",
    "wht:generate",
    # 工资预支签名沿用共享签名库（signature:manage），不设独立维护权限。
    "salary_advance:read",
    "salary_advance:write",
    "salary_advance:generate",
    "signature:manage",
    "user:manage",
]

ALL_PERMISSIONS: frozenset[str] = frozenset(get_args(Permission))

_READ_ONLY: frozenset[str] = frozenset(
    {"invoice:read", "wht:read", "salary_advance:read"}
)

_PREPARE: frozenset[str] = _READ_ONLY | {
    "invoice:write",
    "wht:write",
    "salary_advance:write",
}

_APPROVE: frozenset[str] = frozenset(
    {
        "invoice:approve",
        "invoice:void",
        "invoice:correct",
        "invoice:generate",
        "wht:approve",
        "wht:generate",
        "salary_advance:generate",
    }
)

# 职责分离方案（2026-07-26 经业务方确认，见 test_authz.py 的策略锁定测试）：
#
#   viewer    只读，不能改动任何数据
#   operator  录入/导入/编辑未批准记录，但**不能批准或作废** —— 这是职责分离的
#             关键一刀。新建用户默认就是这个角色（User.role 默认 operator），
#             因此默认情况下录入人无法批准自己录的单。
#   approver  operator 的全部权限，外加批准、作废、更正、生成正式文件
#   admin     全部权限，含签名图片库与用户管理
#
# 四项已确认的决定，改动前需要重新走业务确认：
#   1. approver **包含**录入权限（_PREPARE | _APPROVE）。即制度不要求
#      "录入人不得是批准人"，approver 可以自己录、自己批。职责分离靠的是
#      operator 拿不到批准权，而不是反过来限制 approver。
#   2. 作废与批准**同级**：invoice:void 和 invoice:approve 都在 _APPROVE 里，
#      作废一张已签发税票不需要比批准更高的授权。
#   3. WHT 与 TAX INV **共用同一批批准人**：_APPROVE 是一个整体，不拆成
#      _APPROVE_INVOICE / _APPROVE_WHT。
#
#   4. signature:manage 只给 admin。签名图片决定正式 PDF 上盖谁的名字，
#      不下放给 approver 或 operator。
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "viewer": _READ_ONLY,
    "operator": _PREPARE,
    "approver": _PREPARE | _APPROVE,
    "admin": ALL_PERMISSIONS,
}

DEFAULT_ROLE = "operator"


def permissions_for(role: str) -> frozenset[str]:
    """未知角色一律返回空集合 —— 拼错的角色名必须变成"什么都不能做"，
    而不是回落到某个有权限的默认值。"""
    return ROLE_PERMISSIONS.get(role, frozenset())


def role_has(role: str, permission: str) -> bool:
    return permission in permissions_for(role)
