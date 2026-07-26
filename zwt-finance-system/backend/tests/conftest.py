"""测试共用夹具。

业务路由现在都要求已登录，单元测试不连数据库，所以用 FastAPI 的
dependency_overrides 直接注入一个假的 Principal。这样测的仍然是真实的
路由与权限装配，只是跳过会话查库那一步。

整个测试会话只建一个 TestClient。starlette 的 TestClient 在 __enter__/__exit__
里创建和销毁 anyio 的 blocking portal（一个后台线程）；在 Python 3.14 +
starlette 1.3 上反复创建销毁 portal 会让某次 teardown 抛
"Windows fatal exception: access violation"（原生崩溃，不影响断言结果，
但会污染输出并有真实的不确定性）。共用一个客户端把 portal 数量降到 1，
顺带也让测试更快。切换身份只改 dependency_overrides，不新建客户端。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.authz import permissions_for
from app.core.dependencies import get_principal
from app.main import app
from app.modules.auth.service import Principal

ClientFactory = Callable[..., TestClient]


def build_principal(
    *,
    role: str = "admin",
    permissions: frozenset[str] | None = None,
    actor_name: str = "测试审批人",
) -> Principal:
    return Principal(
        user_id=uuid.uuid4(),
        username="tester",
        actor_name=actor_name,
        role=role,
        permissions=permissions if permissions is not None else permissions_for(role),
        session_id=uuid.uuid4(),
    )


@pytest.fixture(scope="session")
def _shared_client() -> Iterator[TestClient]:
    with TestClient(app) as client:
        yield client


@pytest.fixture
def anonymous_client(_shared_client: TestClient) -> Iterator[TestClient]:
    """未登录客户端。显式清掉 override，确保拿到的是真正的匿名状态。"""
    app.dependency_overrides.pop(get_principal, None)
    yield _shared_client


@pytest.fixture
def client_as(_shared_client: TestClient) -> Iterator[ClientFactory]:
    """工厂夹具：`client_as(role="operator")` 得到以该角色登录的客户端。"""

    def factory(
        *,
        role: str = "admin",
        permissions: frozenset[str] | None = None,
    ) -> TestClient:
        principal = build_principal(role=role, permissions=permissions)
        app.dependency_overrides[get_principal] = lambda: principal
        return _shared_client

    yield factory
    # 必须清掉，否则后续 anonymous_client 会拿到一个"已登录"的客户端。
    app.dependency_overrides.pop(get_principal, None)


@pytest.fixture
def admin_client(client_as: ClientFactory) -> TestClient:
    return client_as(role="admin")
