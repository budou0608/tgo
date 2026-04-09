"""Shared test fixtures for API endpoint coverage."""

from __future__ import annotations

import os
from collections.abc import Generator, Iterator
from dataclasses import dataclass
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault(
    "SECRET_KEY",
    "test-secret-key-for-pytest-only-1234567890",
)
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/tgo_api_test",
)

from app.core.database import get_db
from app.core.security import get_authenticated_project
from app.main import app
from app.models.project import Project


class _UnsetDBSession:
    """Raise a clear error when a test forgets to provide a DB session."""

    def __getattr__(self, name: str) -> object:
        raise AssertionError(
            f"db_override.session must be configured before accessing '{name}'"
        )


@dataclass
class DBOverride:
    """Mutable holder for per-test DB session overrides."""

    session: object | None = None


@pytest.fixture
def authenticated_project() -> Project:
    """Return a lightweight authenticated project for dependency overrides."""

    return Project(
        id=uuid4(),
        name="Test Project",
        api_key="ak_test_downstream_api_key",
    )


@pytest.fixture
def db_override() -> DBOverride:
    """Expose a mutable DB session hook for endpoint tests."""

    return DBOverride()


@pytest.fixture
def client(
    authenticated_project: Project,
    db_override: DBOverride,
) -> Iterator[TestClient]:
    """Build a test client with auth and DB dependencies overridden."""

    async def override_authenticated_project() -> tuple[Project, str]:
        return authenticated_project, authenticated_project.api_key

    def override_get_db() -> Generator[object, None, None]:
        session = db_override.session
        yield session if session is not None else _UnsetDBSession()

    app.dependency_overrides[get_authenticated_project] = (
        override_authenticated_project
    )
    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
