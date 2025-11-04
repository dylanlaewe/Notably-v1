from __future__ import annotations

import os
import tempfile
from datetime import timedelta
from typing import Optional, List

from sqlalchemy.orm import Session

# Models
from .models import Upload, UploadObject, Transcript, TranscriptSegment

# MinIO client (support old name get_client for back-compat)
try:
    from .storage import get_minio_client
except ImportError:
    from .storage import get_client as get_minio_client  # back-compat

# OpenAI Whisper (install: pip install openai>=1.0.0)
try:
    from openai import OpenAI  # type: ignore
except Exception:
    OpenAI = None  # type: ignore


# ---------------------------
# Logging (tee to same file as tasks.py)
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


# ---------------------------
# Helpers
# ---------------------------
def _env_true(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "y"}


def _find_audio16k_obj(db: Session, upload_id: str) -> Optional[UploadObject]:
    """Prefer the /audio-16k.wav object; otherwise return latest object for the upload."""
    objs: List[UploadObject] = (
        db.query(UploadObject)
        .filter(UploadObject.upload_id == upload_id)
        .order_by(UploadObject.id.desc())
        .all()
    )
    if not objs:
        return None
    for o in objs:
        if o.object_key.endswith("/audio-16k.wav"):
            return o
    return objs[0]


# ---------------------------
# Main API
# ---------------------------
def maybe_transcribe_from_minio(db: Session, upload: Upload, orig_obj: UploadObject) -> bool:
    """
    If WHISPER_ENABLE and OPENAI_API_KEY are present, attempt to:
      - download audio (audio-16k.wav preferred) from MinIO
      - call OpenAI Whisper with segment timestamps
      - write Transcript + TranscriptSegment rows
    Returns True on success (rows written), False otherwise.
    """
    try:
        if not _env_true("WHISPER_ENABLE", "false"):
            _log("WHISPER_ENABLE is false; skipping transcription")
            return False

        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key or OpenAI is None:
            _log("OpenAI client not available (missing package or OPENAI_API_KEY); skipping")
            return False

        # Choose which object to transcribe
        target = _find_audio16k_obj(db, upload.id) or orig_obj
        client = get_minio_client()

        # Download to temp path
        fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            _log(f"Downloading for Whisper: bucket={target.bucket} key={target.object_key}")
            client.fget_object(target.bucket, target.object_key, tmp_path)

            # Guard: optional duration limit (<= 60 min) and size limit (<= 1 GB)
            max_secs = int(os.getenv("UPLOAD_MAX_SECONDS", "3600"))
            max_bytes = int(os.getenv("UPLOAD_MAX_BYTES", str(1024 * 1024 * 1024)))
            if getattr(upload, "duration_sec", None) and upload.duration_sec > max_secs:
                _log(f"duration {upload.duration_sec}s exceeds cap {max_secs}s; skipping Whisper")
                return False
            if target.byte_size and target.byte_size > max_bytes:
                _log(f"byte_size {target.byte_size} exceeds cap {max_bytes}; skipping Whisper")
                return False

            # Call Whisper (verbose with segments)
            _log("Calling OpenAI Whisper (verbose_json + segment timestamps)")
            client_oa = OpenAI(api_key=api_key)  # type: ignore
            with open(tmp_path, "rb") as f:
                # Newer SDKs support granularities; fall back to text-only if needed
                try:
                    resp = client_oa.audio.transcriptions.create(  # type: ignore
                        model=os.getenv("WHISPER_MODEL", "whisper-1"),
                        file=f,
                        response_format="verbose_json",
                        temperature=0,
                        # some SDKs: timestamp_granularities=["segment"]  # word timestamps optional
                    )
                    # resp expected fields: text, segments (with start, end, text)
                    segments = getattr(resp, "segments", None)
                    full_text = getattr(resp, "text", "") or ""
                except Exception as e:
                    _log(f"Whisper verbose_json failed ({e}); retrying plain text")
                    f.seek(0)
                    resp = client_oa.audio.transcriptions.create(  # type: ignore
                        model=os.getenv("WHISPER_MODEL", "whisper-1"),
                        file=f,
                        temperature=0,
                    )
                    segments = None
                    full_text = getattr(resp, "text", "") or ""

            # Write Transcript + Segments
            t = Transcript(upload_id=upload.id, language="en")
            db.add(t); db.flush()  # t.id

            wrote_any = False
            if segments:
                # Segmented result
                for seg in segments:
                    try:
                        t_start = float(getattr(seg, "start", 0.0))
                        t_end = float(getattr(seg, "end", t_start))
                        text = str(getattr(seg, "text", "")).strip()
                        if not text:
                            continue
                        db.add(TranscriptSegment(transcript_id=t.id, t_start=t_start, t_end=t_end, text=text))
                        wrote_any = True
                    except Exception as e:
                        _log(f"segment write skipped ({e})")
                db.commit()
            else:
                # Fallback: one big segment covering the clip duration (if we know it)
                text = full_text.strip() or "(no transcript text)"
                t_start = 0.0
                t_end = float(getattr(upload, "duration_sec", 0.0) or 0.0)
                db.add(TranscriptSegment(transcript_id=t.id, t_start=t_start, t_end=t_end, text=text))
                db.commit()
                wrote_any = True

            _log(f"Transcript written upload_id={upload.id} segments={'yes' if segments else 'no'}")
            return wrote_any

        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    except Exception as e:
        _log(f"Whisper path failed ({e})")
        return False
