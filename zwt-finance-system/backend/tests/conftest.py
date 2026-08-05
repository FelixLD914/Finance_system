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

import os
import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.authz import permissions_for
from app.core.dependencies import get_principal
from app.main import app
from app.modules.auth.service import Principal

ClientFactory = Callable[..., TestClient]


def pytest_configure(config: pytest.Config) -> None:
    r"""把测试临时数据默认落到项目专属短目录（离开 C 盘、自动轮换）。

    与 BOI 同源治本：pytest 的 tmp_path 等临时数据默认跟 --basetemp 走，而显式
    --basetemp 会关掉 pytest 自带的 keep=3 轮换，导致每次换名字的全量跑都永久堆
    一份副本（实测把 C:\ 的 Temp 堆到数 GB）。改为默认 PYTEST_DEBUG_TEMPROOT →
    pytest 仍走 pytest-of-<user>/pytest-N 自动保留最近 3 次，数据落 D 盘短路径、
    离开 C 盘、自清理。

    非 Windows / 已给 --basetemp / 已设 PYTEST_DEBUG_TEMPROOT / 建目录失败
    → 一律回退 pytest 默认，绝不因临时目录问题挡测试。
    """
    if os.name != "nt":
        return
    if getattr(config.option, "basetemp", None):
        return
    if os.environ.get("PYTEST_DEBUG_TEMPROOT", "").strip():
        return
    project_temproot = r"D:\pytest-tmp\finance"
    try:
        os.makedirs(project_temproot, exist_ok=True)
    except OSError:
        return
    os.environ["PYTEST_DEBUG_TEMPROOT"] = project_temproot


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
