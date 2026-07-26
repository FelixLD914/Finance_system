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


def test_principal_require_raises_for_missing_permission() -> None:
    operator = build_principal(role="operator")

    operator.require("invoice:write")
    with pytest.raises(PermissionDeniedError, match="invoice:approve"):
        operator.require("invoice:approve")
