# tests/conftest.py
import os
import io
import wave
import struct
import uuid
import pytest

# --- Test env before importing the app ---
os.environ.setdefault("NOTABLY_DEV_API_KEY", "test-api")
os.environ.setdefault("NOTABLY_DEV_USER_ID", "11111111-1111-1111-1111-111111111111")
os.environ.setdefault("MINIO_ENABLE", "false")   # avoid external IO in CI
os.environ.setdefault("RQ_ENABLE", "false")      # keep uploads synchronous in tests

from starlette.testclient import TestClient
from sqlalchemy import text

from backend.app.main import app  # noqa: E402
from backend.app.db import engine  # noqa: E402

# If your models are available, create core tables
try:
    from backend.app.models import Base  # noqa: E402
    Base.metadata.create_all(bind=engine)
except Exception:
    pass


def _ensure_multitenant_tables():
    ddl = """
    create table if not exists team (
      id uuid primary key,
      name text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists team_member (
      team_id uuid not null references team(id) on delete cascade,
      user_id uuid not null,
      role text not null default 'member',
      created_at timestamptz not null default now(),
      primary key (team_id, user_id)
    );
    """
    with engine.begin() as conn:
        for stmt in ddl.split(";"):
            s = stmt.strip()
            if s:
                conn.execute(text(s))


def _ensure_dev_team_membership():
    dev_user = os.environ["NOTABLY_DEV_USER_ID"]
    with engine.begin() as conn:
        row = conn.execute(
            text(
                "select t.id from team t "
                "join team_member tm on tm.team_id = t.id "
                "where tm.user_id = :uid limit 1"
            ),
            {"uid": dev_user},
        ).fetchone()
        if row:
            return

        tid = str(uuid.uuid4())
        conn.execute(
            text("insert into team(id, name) values (:id, :name)"),
            {"id": tid, "name": "Dev Team"},
        )
        conn.execute(
            text(
                "insert into team_member(team_id, user_id, role) "
                "values (:tid, :uid, 'owner')"
            ),
            {"tid": tid, "uid": dev_user},
        )


# Create multitenant tables + ensure dev membership before tests
_ensure_multitenant_tables()
_ensure_dev_team_membership()


@pytest.fixture(scope="session")
def auth_headers():
    return {"X-Api-Key": os.environ["NOTABLY_DEV_API_KEY"]}


@pytest.fixture
def client(auth_headers):
    c = TestClient(app)
    _orig_request = c.request

    def _wrapped_request(method, url, **kwargs):
        headers = kwargs.pop("headers", {})
        merged = {**auth_headers, **headers}
        return _orig_request(method, url, headers=merged, **kwargs)

    c.request = _wrapped_request  # type: ignore[attr-defined]
    return c


@pytest.fixture
def fresh_meeting_id():
    return str(uuid.uuid4())


@pytest.fixture
def sample_wav_bytes():
    """Generate a tiny 1s mono PCM WAV in-memory for upload tests."""
    rate = 44100
    duration = 1.0
    freq = 440.0
    n = int(rate * duration)

    buf = io.BytesIO()
    import math
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(rate)
        for i in range(n):
            v = int(32767 * 0.25 * (2 * math.sin(2 * math.pi * freq * (i / rate))))
            wf.writeframes(struct.pack("<h", v))
    return buf.getvalue()

