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
    "signature:manage",
    "user:manage",
]

ALL_PERMISSIONS: frozenset[str] = frozenset(get_args(Permission))

_READ_ONLY: frozenset[str] = frozenset({"invoice:read", "wht:read"})

_PREPARE: frozenset[str] = _READ_ONLY | {"invoice:write", "wht:write"}

_APPROVE: frozenset[str] = frozenset(
    {
        "invoice:approve",
        "invoice:void",
        "invoice:correct",
        "invoice:generate",
        "wht:approve",
        "wht:generate",
    }
)

# TODO(策略确认)：下面是一个可用的默认职责分离方案，请按 ZWT 财务部的实际
# 授权制度调整。目前的假设是：
#
#   viewer    只读，不能改动任何数据
#   operator  录入/导入/编辑未批准记录，但**不能批准或作废** —— 这是职责分离的
#             关键一刀。默认新建用户就是这个角色（User.role 默认 operator）。
#   approver  operator 的全部权限，外加批准、作废、更正、生成正式文件
#   admin     全部权限，含签名图片库与用户管理
#
# 需要你确认的点：
#   1. approver 是否应该同时拥有 operator 的录入权限？如果制度要求"录入人不得
#      是批准人"，那 approver 就不该包含 _PREPARE，需要改成 _READ_ONLY | _APPROVE。
#   2. 作废（void）和更正（correct）是否要比批准更高一级？有些制度里作废一张
#      已签发税票需要更高审批。
#   3. WHT 和 TAX INV 是否共用同一批批准人？现在是共用；要分开的话把 _APPROVE
#      拆成 _APPROVE_INVOICE / _APPROVE_WHT 两组，再配 approver:invoice 之类的角色。
#   4. signature:manage 现在只给 admin。签名图片决定正式 PDF 上盖谁的名字，
#      是否要独立成一个角色？
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
