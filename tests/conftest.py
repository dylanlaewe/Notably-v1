# Ensure repo root is on sys.path so `import backend...` works
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import os
import io
import uuid
import math
import struct
import contextlib

import pytest
from starlette.testclient import TestClient

# Test-friendly env BEFORE importing the app
os.environ.setdefault("MINIO_ENABLE", "0")          # skip MinIO
os.environ.setdefault("RQ_ENABLE", "0")             # use FastAPI BackgroundTasks
os.environ.setdefault("WHISPER_ENABLE", "0")        # don't call Whisper
os.environ.setdefault("GPT_ENABLE", "0")            # don't call GPT
os.environ.setdefault("NOTABLY_ADMIN_TOKEN", "test-admin")
# Intentionally DO NOT set NOTABLY_API_KEY (keeps auth-lite off)

from backend.app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def _wav_sine_1s(f_hz=1000, rate=44100, amp=0.25):
    """Return a 1s mono WAV bytes with a simple sine tone (no numpy required)."""
    n = rate
    frames = []
    for i in range(n):
        sample = int(max(-1.0, min(1.0, amp * math.sin(2 * math.pi * f_hz * (i / rate)))) * 32767)
        frames.append(struct.pack("<h", sample))

    buf = io.BytesIO()
    import wave
    with contextlib.closing(wave.open(buf, "wb")) as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(rate
        )
        w.writeframes(b"".join(frames))
    return buf.getvalue()


@pytest.fixture()
def fresh_meeting_id():
    return str(uuid.uuid4())


@pytest.fixture()
def sample_wav_bytes():
    return _wav_sine_1s()
