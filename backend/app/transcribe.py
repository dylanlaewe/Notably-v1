from __future__ import annotations

import os
import json
import tempfile
from typing import Any

from sqlalchemy.orm import Session

from .models import Upload, UploadObject, Transcript, TranscriptSegment

# MinIO client (same pattern as tasks.py)
try:
    from .storage import get_minio_client  # preferred
except ImportError:
    from .storage import get_client as get_minio_client  # back-compat

# OpenAI SDK (pip install --upgrade openai>=1.0.0)
try:
    from openai import OpenAI  # type: ignore
except Exception:
    OpenAI = None  # type: ignore


# ---------------------------
# Logging (share same log file as tasks.py)
# ---------------------------
_LOG_PATH = os.getenv("NOTABLY_LOG_FILE", "/tmp/notably_worker.log")
_LOG_FH = None
try:
    _LOG_FH = open(_LOG_PATH, "a", buffering=1, encoding="utf-8")
except Exception:
    _LOG_FH = None


def _log(msg: str) -> None:
    line = f"[transcribe] {msg}"
    print(line, flush=True)
    if _LOG_FH:
        try:
            _LOG_FH.write(line + "\n")
        except Exception:
            pass


def _env_true(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "y"}


# ---------------------------
# Main API used by tasks.py
# ---------------------------
def maybe_transcribe_from_minio(
    db: Session,
    upload: Upload,
    obj: UploadObject,
) -> bool:
    """
    Try to create a real transcript using OpenAI if enabled.

    Returns:
      True  -> transcript rows were written (or already existed).
      False -> do nothing; caller should fall back to stub transcript.
    """

    # 1) Check feature flags / config
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or OpenAI is None:
        _log("OpenAI not available (no OPENAI_API_KEY or SDK); skipping.")
        return False

    if not _env_true("WHISPER_ENABLE", "false"):
        _log("WHISPER_ENABLE is not true; skipping real transcription.")
        return False

    model = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")

    # If a transcript already exists for this upload, don't duplicate – just reuse it.
    existing = (
        db.query(Transcript)
        .filter(Transcript.upload_id == upload.id)
        .first()
    )
    if existing:
        _log(f"Transcript already exists for upload_id={upload.id}; skipping re-transcribe.")
        return True
    
    # Prefer the 16kHz WAV variant if tasks.py wrote one (ffmpeg output).
    # This lets us support .mov/.mp4/etc. even if the raw container isn't supported.
    wav_obj = (
        db.query(UploadObject)
        .filter(
            UploadObject.upload_id == upload.id,
            UploadObject.object_key.like("%/audio-16k.wav"),
        )
        .order_by(UploadObject.id.desc())
        .first()
    )
    if wav_obj is not None and wav_obj.id != obj.id:
        _log(
            f"Using 16kHz WAV object instead of original: "
            f"{obj.object_key} -> {wav_obj.object_key}"
        )
        obj = wav_obj

    # 2) Download the audio from MinIO to a temp file
    client = get_minio_client()
    fd, tmp_path = tempfile.mkstemp(suffix=os.path.splitext(obj.object_key)[1] or ".bin")
    os.close(fd)

    try:
        _log(f"Downloading object for transcription: bucket={obj.bucket}, key={obj.object_key}")
        client.fget_object(obj.bucket, obj.object_key, tmp_path)

        # 3) Call OpenAI transcription (simple mode: one big chunk of text)
        oai = OpenAI(api_key=api_key)  # type: ignore

        _log(f"Calling {model} for upload_id={upload.id}")
        with open(tmp_path, "rb") as f:
            resp = oai.audio.transcriptions.create(
                model=model,
                file=f,
                # We use the default format; resp.text is the full transcript.
            )

        # Try to extract transcript text robustly
        text = getattr(resp, "text", None)
        if not text:
            # fallback: try common dict-ish patterns
            try:
                if hasattr(resp, "model_dump"):
                    data = resp.model_dump()
                elif hasattr(resp, "to_dict"):
                    data = resp.to_dict()
                else:
                    data = json.loads(str(resp))
                text = data.get("text", "")
            except Exception:
                text = ""

        text = (text or "").strip()
        if not text:
            _log("Transcribe returned empty text; skipping and letting stub handle it.")
            return False

        # 4) Write Transcript + a single TranscriptSegment covering the whole file
        t = Transcript(
            upload_id=upload.id,
            # If the API exposes language we could use it; for now default to "en".
            language="en",
        )
        db.add(t)
        db.flush()  # t.id

        duration = float(upload.duration_sec) if upload.duration_sec is not None else 0.0

        seg = TranscriptSegment(
            transcript_id=t.id,
            t_start=0.0,
            t_end=duration,
            text=text,
        )
        db.add(seg)
        db.commit()

        _log(
            f"Transcribe OK: meeting_id={upload.meeting_id}, "
            f"upload_id={upload.id}, transcript_id={t.id}, duration={duration:.3f}s"
        )
        return True

    except Exception as e:
        _log(f"Transcribe failed ({e}); will fall back to stub transcript.")
        try:
            db.rollback()
        except Exception:
            pass
        return False

    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass
