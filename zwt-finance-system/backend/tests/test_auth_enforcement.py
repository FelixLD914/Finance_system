"""端到端确认路由真的挂上了鉴权与权限点。

authz 的单元测试只证明"映射表是对的"；这些测试证明"端点确实用了它"。
两者缺一不可 —— 映射再正确，装饰器忘了挂就等于没有。
"""

import re
import uuid
from io import BytesIO

import pytest
from openpyxl import Workbook

from app.main import app

FAKE_ID = uuid.uuid4()

# (method, path) -> 应当要求的权限点
MUTATING_ENDPOINTS = [
    ("patch", f"/api/v1/tax-invoice/invoices/{FAKE_ID}", "invoice:write"),
    ("post", f"/api/v1/tax-invoice/invoices/{FAKE_ID}/approve", "invoice:approve"),
    ("post", f"/api/v1/tax-invoice/invoices/{FAKE_ID}/void", "invoice:void"),
    ("post", f"/api/v1/tax-invoice/invoices/{FAKE_ID}/corrections", "invoice:correct"),
    (
        "post",
        f"/api/v1/tax-invoice/invoices/{FAKE_ID}/generate-documents",
        "invoice:generate",
    ),
    ("post", "/api/v1/tax-invoice/exchange-rates", "invoice:write"),
    ("patch", "/api/v1/tax-invoice/exchange-rates/1", "invoice:write"),
    ("delete", "/api/v1/tax-invoice/exchange-rates/1", "invoice:write"),
    ("post", "/api/v1/tax-invoice/exchange-rates/1/restore", "invoice:write"),
    ("post", "/api/v1/tax-invoice/exchange-rates/fetch", "invoice:write"),
    ("post", f"/api/v1/wht/tasks/{FAKE_ID}/approve", "wht:approve"),
    ("post", f"/api/v1/wht/tasks/{FAKE_ID}/return-to-draft", "wht:approve"),
    ("post", f"/api/v1/wht/tasks/{FAKE_ID}/generate-documents", "wht:generate"),
    ("patch", f"/api/v1/wht/tasks/{FAKE_ID}", "wht:write"),
    # 分步开票：核对预览虽然只读，但会把主数据里的收款方资料读出来回给调用方，
    # 所以与落库同一档权限，不降到 wht:read。
    ("post", "/api/v1/wht/tasks/batch-preview", "wht:write"),
    ("post", "/api/v1/wht/tasks/batch-commit", "wht:write"),
    ("post", f"/api/v1/wht/tasks/{FAKE_ID}/revise", "wht:write"),
    ("get", f"/api/v1/wht/payees/{FAKE_ID}/delete-preview", "wht:write"),
    ("delete", f"/api/v1/wht/payees/{FAKE_ID}", "wht:write"),
    ("post", f"/api/v1/wht/payees/{FAKE_ID}/restore", "wht:write"),
    ("patch", f"/api/v1/wht/signatures/{FAKE_ID}", "signature:manage"),
    ("delete", f"/api/v1/wht/signatures/{FAKE_ID}", "signature:manage"),
    (
        "post",
        f"/api/v1/wht/signatures/{FAKE_ID}/restore",
        "signature:manage",
    ),
    (
        "post",
        f"/api/v1/salary-advance/batches/{FAKE_ID}/revalidate",
        "salary_advance:write",
    ),
    (
        "patch",
        f"/api/v1/salary-advance/records/{FAKE_ID}",
        "salary_advance:write",
    ),
    (
        "post",
        f"/api/v1/salary-advance/batches/{FAKE_ID}/lock",
        "salary_advance:generate",
    ),
    (
        "post",
        f"/api/v1/salary-advance/batches/{FAKE_ID}/generation-jobs",
        "salary_advance:generate",
    ),
    (
        "post",
        f"/api/v1/salary-advance/records/{FAKE_ID}/preview",
        "salary_advance:generate",
    ),
    (
        "delete",
        f"/api/v1/salary-advance/batches/{FAKE_ID}",
        "salary_advance:write",
    ),
]

READ_ENDPOINTS = [
    "/api/v1/tax-invoice/invoices",
    "/api/v1/tax-invoice/exchange-rates",
    "/api/v1/wht/tasks",
    "/api/v1/wht/payees",
    "/api/v1/wht/signatures",
    "/api/v1/wht/number-preview?period=2026-06",
    "/api/v1/salary-advance/batches",
    "/api/v1/salary-advance/templates",
]


@pytest.mark.parametrize("path", READ_ENDPOINTS)
def test_read_endpoints_reject_anonymous(anonymous_client, path: str) -> None:  # noqa: ANN001
    assert anonymous_client.get(path).status_code == 401


@pytest.mark.parametrize(("method", "path", "_permission"), MUTATING_ENDPOINTS)
def test_mutating_endpoints_reject_anonymous(
    anonymous_client, method: str, path: str, _permission: str
) -> None:  # noqa: ANN001
    # 统一走 request()：httpx 的 delete() 不接受 json 参数。
    response = anonymous_client.request(method.upper(), path, json={})

    assert response.status_code == 401


def test_health_endpoints_stay_open_for_winsw_probes(anonymous_client) -> None:  # noqa: ANN001
    # 存活探针必须不需要凭证，否则 WinSW 和发布验收无法探活。
    assert anonymous_client.get("/api/health/live").status_code == 200


# 刻意不需要会话的端点：探活供 WinSW 和发布验收使用，登录是取得会话的入口。
# 其余任何端点都必须拒绝匿名访问。
INTENTIONALLY_OPEN = {
    ("GET", "/api/health/live"),
    ("GET", "/api/health/ready"),
    ("POST", "/api/v1/auth/login"),
}


def _all_operations() -> list[tuple[str, str]]:
    """从 OpenAPI 取全量操作。

    比手写清单可靠：以后新增端点如果忘了挂鉴权，这里会自动发现，
    不需要有人记得同步测试列表。
    """
    spec = app.openapi()
    return sorted(
        (method.upper(), path)
        for path, operations in spec["paths"].items()
        for method in operations
        if method.upper() in {"GET", "POST", "PATCH", "PUT", "DELETE"}
    )


def test_openapi_exposes_the_expected_number_of_operations() -> None:
    # 守住下面那条全量测试的前提：如果 OpenAPI 变空或急剧缩水，
    # 全量测试会"全部通过"却什么都没测到。
    assert len(_all_operations()) >= 35


def test_every_endpoint_except_health_and_login_rejects_anonymous(anonymous_client) -> None:  # noqa: ANN001
    """全量扫描：除刻意开放的三个之外，匿名访问一律 401。

    鉴权在依赖阶段就拒掉，请求根本进不到处理函数，所以这条测试不碰数据库。
    反过来说，任何真的去连库的端点就证明它没被保护住。
    """
    unprotected: list[str] = []
    for method, path in _all_operations():
        if (method, path) in INTENTIONALLY_OPEN:
            continue
        # 用假 UUID 填充路径参数，避免 422 掩盖 401。
        concrete = re.sub(r"\{[^}]+\}", str(FAKE_ID), path)
        response = anonymous_client.request(method, concrete, json={})
        if response.status_code != 401:
            unprotected.append(f"{method} {path} -> {response.status_code}")

    assert not unprotected, "以下端点未拒绝匿名访问:\n" + "\n".join(unprotected)


@pytest.mark.parametrize(("method", "path", "permission"), MUTATING_ENDPOINTS)
def test_mutating_endpoints_reject_role_without_permission(
    client_as, method: str, path: str, permission: str
) -> None:  # noqa: ANN001
    """已登录但缺少该权限点时必须 403，而不是放行。

    权限集合刻意只给 read，确保被拦下的原因是权限而不是别的。
    """
    client = client_as(
        permissions=frozenset(
            {"invoice:read", "wht:read", "salary_advance:read"}
        )
    )

    # 统一走 request()：httpx 的 delete() 不接受 json 参数。
    response = client.request(method.upper(), path, json={})

    assert response.status_code == 403, f"{method.upper()} {path} 未强制 {permission}"


@pytest.mark.parametrize("path", READ_ENDPOINTS)
def test_read_endpoints_reject_role_without_read_permission(
    client_as, path: str
) -> None:  # noqa: ANN001
    client = client_as(permissions=frozenset())

    assert client.get(path).status_code == 403


def test_migration_import_route_is_gone(client_as) -> None:  # noqa: ANN001
    """一次性历史迁移通道已摘除，这条路由必须不存在。

    这里刻意用 admin（权限全集）：如果端点还挂着，请求会成功或者以 422 收场，
    而不是 404。用满权限断言 404，证明拦下它的是"路由没了"，不是"权限不够"
    ——后者随时可能被一次授权变更悄悄放开。
    """
    client = client_as(role="admin")

    response = client.post(
        "/api/v1/tax-invoice/import/migration",
        files={"file": ("legacy.xlsx", b"not-a-real-workbook", "application/vnd.ms-excel")},
    )

    assert response.status_code == 404, response.text


def _empty_workbook() -> bytes:
    """一份结构合法但没有数据行的 xlsx。

    用真工作簿而不是随便几个字节：非 zip 的内容会在 openpyxl 里抛
    BadZipFile，那是另一条错误路径，会把这条测试想验证的东西盖掉。
    """
    workbook = Workbook()
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def test_plain_batch_import_still_works_with_only_write(client_as) -> None:  # noqa: ANN001
    """反过来确认没有误伤：常规批量开具仍然只要 invoice:write。

    不能因为收紧迁移权，把日常导入也一起锁死了。这里只验证「没有被权限层
    拦下」——请求会继续走到解析那一步并因为表里没有数据行而 422，
    但那已经越过了鉴权。
    """
    client = client_as(permissions=frozenset({"invoice:read", "invoice:write"}))

    response = client.post(
        "/api/v1/tax-invoice/import/sample",
        files={
            "file": (
                "batch.xlsx",
                _empty_workbook(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 422, response.text
