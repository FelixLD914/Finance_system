import pytest

from app.core.authz import (
    ALL_PERMISSIONS,
    DEFAULT_ROLE,
    ROLE_PERMISSIONS,
    permissions_for,
    role_has,
)
from app.modules.auth.service import PermissionDeniedError
from tests.conftest import build_principal


def test_unknown_role_gets_no_permissions() -> None:
    # 拼错的角色名必须变成"什么都不能做"，绝不能回落到有权限的默认值。
    assert permissions_for("Approver") == frozenset()
    assert permissions_for("") == frozenset()
    assert permissions_for("root") == frozenset()


def test_default_role_cannot_approve_or_void() -> None:
    # 职责分离的核心：新建用户默认只能录入，不能自己批准自己录的单。
    assert role_has(DEFAULT_ROLE, "invoice:write")
    assert not role_has(DEFAULT_ROLE, "invoice:approve")
    assert not role_has(DEFAULT_ROLE, "invoice:void")
    assert not role_has(DEFAULT_ROLE, "invoice:correct")
    assert not role_has(DEFAULT_ROLE, "wht:approve")


def test_viewer_has_no_write_permission_at_all() -> None:
    viewer = permissions_for("viewer")

    assert viewer
    assert not any(perm for perm in viewer if not perm.endswith(":read"))


def test_only_admin_manages_signatures_and_users() -> None:
    # 签名图片决定正式 PDF 上盖谁的名字，不能让普通操作员换。
    for role in ("viewer", "operator", "approver"):
        assert not role_has(role, "signature:manage"), role
        assert not role_has(role, "user:manage"), role
    assert role_has("admin", "signature:manage")
    assert role_has("admin", "user:manage")


def test_every_declared_role_uses_only_known_permissions() -> None:
    # 防止改策略时打错权限点名字 —— 打错的名字永远不会匹配任何端点，
    # 表面看是"配了权限"，实际是静默失效。
    for role, granted in ROLE_PERMISSIONS.items():
        unknown = granted - ALL_PERMISSIONS
        assert not unknown, f"角色 {role} 引用了未定义的权限点: {sorted(unknown)}"


# --- 策略锁定 -----------------------------------------------------------------
#
# 以下三条对应 2026-07-26 业务方确认的职责分离决定。它们不是实现细节，
# 改动前需要重新走业务确认 —— 所以用测试钉住，而不是只写在注释里。


def _roles_with(permission: str) -> set[str]:
    return {role for role in ROLE_PERMISSIONS if role_has(role, permission)}


def test_confirmed_approver_also_has_preparation_rights() -> None:
    """已确认：approver 包含录入权限，可以自己录、自己批。

    职责分离靠的是 operator 拿不到批准权，而不是反过来限制 approver。
    """
    assert role_has("approver", "invoice:write")
    assert role_has("approver", "wht:write")
    assert role_has("approver", "invoice:approve")


def test_confirmed_void_is_same_level_as_approve() -> None:
    """已确认：作废与批准同级，不需要更高授权。

    断言"能批准的角色集合"与"能作废的角色集合"完全一致；任何一方被单独
    收紧或放宽都会让这条失败。
    """
    assert _roles_with("invoice:void") == _roles_with("invoice:approve")
    assert _roles_with("invoice:correct") == _roles_with("invoice:approve")


def test_confirmed_wht_and_tax_invoice_share_approvers() -> None:
    """已确认：WHT 与 TAX INV 共用同一批批准人。

    若日后要拆开，_APPROVE 需拆成两组并新增角色，这条会失败以提示决策变更。
    """
    assert _roles_with("wht:approve") == _roles_with("invoice:approve")
    assert _roles_with("wht:generate") == _roles_with("invoice:generate")


def test_confirmed_signature_management_is_admin_only() -> None:
    """已确认：签名图片库只有 admin 能管，不下放给 approver 或 operator。

    签名决定正式 PDF 上盖谁的名字，因此与批准权分离：能批准一张税票，
    不等于能改上面盖谁的章。
    """
    assert _roles_with("signature:manage") == {"admin"}
    assert not role_has("approver", "signature:manage")


def test_principal_require_raises_for_missing_permission() -> None:
    operator = build_principal(role="operator")

    operator.require("invoice:write")
    with pytest.raises(PermissionDeniedError, match="invoice:approve"):
        operator.require("invoice:approve")
