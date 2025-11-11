# tests/conftest.py
import os
import io
import wave
import struct
import pytest

# --- Ensure dev API key for tests before importing the app ---
os.environ.setdefault("NOTABLY_DEV_API_KEY", "test-api")
os.environ.setdefault("NOTABLY_DEV_USER_ID", "11111111-1111-1111-1111-111111111111")
os.environ.setdefault("MINIO_ENABLE", "false")   # tests avoid external IO by default
os.environ.setdefault("RQ_ENABLE", "false")      # keep uploads synchronous in tests

from starlette.testclient import TestClient
from backend.app.main import app  # noqa: E402

# Optional: if your models/engine are available, ensure tables exist for CI
try:
    from backend.app.db import engine
    from backend.app.models import Base
    Base.metadata.create_all(bind=engine)
except Exception:
    # If your app already creates tables at import, it's fine to ignore.
    pass


@pytest.fixture(scope="session")
def auth_headers():
    return {"X-Api-Key": os.environ["NOTABLY_DEV_API_KEY"]}


@pytest.fixture
def client(auth_headers):
    """
    TestClient with a request wrapper that automatically attaches auth headers.
    """
    c = TestClient(app)

    # Patch .request to always include our auth header unless overridden.
    _orig_request = c.request

    def _wrapped_request(method, url, **kwargs):
        headers = kwargs.pop("headers", {})
        # Don't stomp on explicit caller headers; merge ours in if missing
        merged = {**auth_headers, **headers}
        return _orig_request(method, url, headers=merged, **kwargs)

    c.request = _wrapped_request  # type: ignore[attr-defined]
    return c


@pytest.fixture
def fresh_meeting_id():
    # Tests pass a random meeting id from the client side; server will create on upload.
    import uuid
    return str(uuid.uuid4())


@pytest.fixture
def sample_wav_bytes():
    """
    Generate a tiny 1s mono PCM WAV in-memory for upload tests.
    """
    rate = 44100
    duration = 1.0
    freq = 440.0
    n = int(rate * duration)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(rate)
        for i in range(n):
            v = int(32767 * 0.25 * (2 * __import__("math").sin(2 * __import__("math").pi * freq * (i / rate))))
            wf.writeframes(struct.pack("<h", v))
    return buf.getvalue()
