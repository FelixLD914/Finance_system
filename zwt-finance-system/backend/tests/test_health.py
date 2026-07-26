from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

import app.api.router as api_router_module
from app.main import app


def test_liveness() -> None:
    with TestClient(app) as client:
        response = client.get("/api/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "zwt-finance-api"}


class _ReadyConnection:
    async def execute(self, statement: object) -> None:
        assert str(statement) == "SELECT 1"


class _ConnectionContext:
    def __init__(self, error: SQLAlchemyError | None = None) -> None:
        self.error = error

    async def __aenter__(self) -> _ReadyConnection:
        if self.error:
            raise self.error
        return _ReadyConnection()

    async def __aexit__(self, *_: object) -> None:
        return None


class _FakeEngine:
    def __init__(self, error: SQLAlchemyError | None = None) -> None:
        self.error = error

    def connect(self) -> _ConnectionContext:
        return _ConnectionContext(self.error)


def test_readiness_checks_database(monkeypatch: object) -> None:
    monkeypatch.setattr(api_router_module, "engine", _FakeEngine())  # type: ignore[attr-defined]

    with TestClient(app) as client:
        response = client.get("/api/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "zwt-finance-api",
        "database": "ok",
    }


def test_readiness_returns_503_when_database_is_unavailable(monkeypatch: object) -> None:
    monkeypatch.setattr(  # type: ignore[attr-defined]
        api_router_module,
        "engine",
        _FakeEngine(SQLAlchemyError("offline")),
    )

    with TestClient(app) as client:
        response = client.get("/api/health/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "database is unavailable"}
