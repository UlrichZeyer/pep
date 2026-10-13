"""Test-Setup: eigene temporäre Datenbank, fester Stichtag 13.10.2026."""
import os
import tempfile
from datetime import date

_tmp = tempfile.mkdtemp(prefix="pep-test-")
os.environ["PEP_DB"] = os.path.join(_tmp, "test.db")
os.environ["PEP_HEUTE"] = "2026-10-13"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.db import engine, init_db  # noqa: E402

STICHTAG = date(2026, 10, 13)


@pytest.fixture(scope="session")
def _db():
    init_db()
    from app import seed

    with Session(engine) as s:
        seed.generate(s, STICHTAG)
    yield


@pytest.fixture()
def session(_db):
    with Session(engine) as s:
        yield s


@pytest.fixture(scope="session")
def client(_db):
    from app.main import app

    with TestClient(app) as c:
        yield c
