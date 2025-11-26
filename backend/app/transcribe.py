# backend/app/transcribe.py
from __future__ import annotations

import os
import json
import tempfile
from typing import Any, Dict, List, Optional

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


def _normalize_transcription_response(resp: Any) -> Dict[str, Any]:
    """
    Try to normalize whatever the OpenAI SDK returns into a plain dict
    with at least `text` and maybe `segments`.
    """
    # Easiest: pydantic-style .model_dump()
    if hasattr(resp, "model_dump"):
        try:
            data = resp.model_dump()  # type: ignore[attr-defined]
            if isinstance(data, dict):
                return data
        except Exception:
            pass

    # If it's already a dict-like
    if isinstance(resp, dict):
        return resp

    # Fallback: try to pull basic attributes
    out: Dict[str, Any] = {}
    if hasattr(resp, "text"):
        try:
            out["text"] = getattr(resp, "text")
        except Exception:
            pass
    if hasattr(resp, "segments"):
        try:
            out["segments"] = getattr(resp, "segments")
        except Exception:
            pass

    return out


# ---------------------------
# Main API used by tasks.py
# ---------------------------
def maybe_transcribe_from_minio(
    db: Session,
    upload: Upload,
    obj: UploadObject,
) -> bool:
    """
    Download this upload's audio from MinIO and call OpenAI to create
    a real transcript. Returns True if we wrote Transcript+TranscriptSegment,
    False if the caller should fall back to a stub transcript.

    Now supports:
    - gpt-4o-transcribe-diarize with response_format='diarized_json'
      and chunking_strategy='auto', producing multiple segments with speakers.
    - Other models with verbose/segment output when available.
    """
    client = get_minio_client()
    if client is None:
        _log("[transcribe] No MinIO client; skipping real transcription.")
        return False

    # Feature flag
    if not _env_true("WHISPER_ENABLE", "false"):
        _log("[transcribe] WHISPER_ENABLE is false; skipping real transcription.")
        return False

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        _log("[transcribe] No OPENAI_API_KEY set; skipping real transcription.")
        return False

    model = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")

    # Temp file where we'll download audio
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    try:
        # -----------------------------
        # 1) Choose the safest object to transcribe
        #    Prefer the ffmpeg-normalized audio-16k.wav if it exists.
        # -----------------------------
        key_for_transcription = obj.object_key

        try:
            if "/" in obj.object_key:
                dir_part, _fname = obj.object_key.rsplit("/", 1)
                audio16_key = f"{dir_part}/audio-16k.wav"

                _log(
                    f"[transcribe] Trying audio16k object first: "
                    f"bucket={obj.bucket}, key={audio16_key}"
                )

                # If this stat works, we know the object exists and can use it
                client.stat_object(obj.bucket, audio16_key)
                key_for_transcription = audio16_key
        except Exception:
            _log(
                "[transcribe] audio-16k.wav not found; "
                "falling back to original upload object for transcription."
            )

        _log(
            f"[transcribe] Downloading for transcription: "
            f"bucket={obj.bucket}, key={key_for_transcription}"
        )
        client.fget_object(obj.bucket, key_for_transcription, tmp_path)

        # -----------------------------
        # 2) Call OpenAI transcription
        # -----------------------------
        if OpenAI is None:  # type: ignore[name-defined]
            _log("[transcribe] OpenAI SDK not available; skipping real transcription.")
            return False

        oai = OpenAI(api_key=api_key)  # type: ignore[operator]

        # Build extra kwargs depending on model.
        # For diarization we must set chunking_strategy and response_format.
        extra_kwargs: Dict[str, Any] = {}
        model_lower = (model or "").lower()

        if "transcribe-diarize" in model_lower:
            extra_kwargs["chunking_strategy"] = "auto"
            extra_kwargs["response_format"] = "diarized_json"
            _log(
                f"[transcribe] Using diarization model={model} "
                "with response_format=diarized_json, chunking_strategy=auto"
            )
        else:
            # For non-diarize models you *can* optionally use verbose_json
            # if you want more detailed segments. We keep default behavior
            # unless you later want to expand this.
            _log(f"[transcribe] Using transcription model={model}")

        with open(tmp_path, "rb") as f:
            try:
                resp = oai.audio.transcriptions.create(
                    model=model,
                    file=f,
                    **extra_kwargs,
                )
            except Exception as e:
                _log(f"[transcribe] OpenAI transcription call failed: {e}")
                return False

        # -----------------------------
        # 3) Normalize response to text + segments
        # -----------------------------
        data = _normalize_transcription_response(resp)
        text: Optional[str] = None
        segments_raw: List[Dict[str, Any]] = []

        # primary text field
        maybe_text = data.get("text")
        if isinstance(maybe_text, str):
            text = maybe_text.strip()

        # segments list if present
        maybe_segments = data.get("segments")
        if isinstance(maybe_segments, list):
            segments_raw = [s for s in maybe_segments if isinstance(s, dict)]

        # Fallback: if no text in dict, try attribute
        if not text and hasattr(resp, "text"):
            try:
                attr_text = getattr(resp, "text")
                if isinstance(attr_text, str):
                    text = attr_text.strip()
            except Exception:
                pass

        if not text:
            _log("[transcribe] OpenAI returned no text; falling back to stub.")
            return False

        if not text.strip():
            _log("[transcribe] OpenAI returned empty text; falling back to stub.")
            return False

        # -----------------------------
        # 4) Write Transcript + segments
        # -----------------------------
        t = Transcript(
            upload_id=upload.id,
            language="en",  # diarized_json currently does not include language
        )
        db.add(t)
        db.flush()  # get t.id

        wrote_segments = 0

        if segments_raw:
            # We have structured segments (diarized_json or verbose_json-style)
            _log(
                f"[transcribe] Writing {len(segments_raw)} segments "
                f"for upload_id={upload.id}, transcript_id={t.id}"
            )
            for seg in segments_raw:
                # For diarized_json: { id: str, start: float, end: float,
                #   speaker: str, text: str, ... }
                start = seg.get("start", 0.0)
                end = seg.get("end", start)
                seg_text = seg.get("text", "") or ""
                speaker = seg.get("speaker")

                try:
                    start_f = float(start)
                except Exception:
                    start_f = 0.0

                try:
                    end_f = float(end)
                except Exception:
                    end_f = start_f

                # Prepend speaker label if available (so UI can display it even
                # though the DB schema doesn't have a dedicated speaker column).
                label = str(speaker).strip() if speaker is not None else ""

                if label:
                    # Avoid double-prefix if OpenAI ever returns "Speaker A"
                    if not label.lower().startswith("speaker"):
                        label = f"Speaker {label}"
                    seg_text_display = f"{label}: {seg_text}".strip()
                else:
                    seg_text_display = str(seg_text).strip()

                if not seg_text_display:
                    continue

                db.add(
                    TranscriptSegment(
                        transcript_id=t.id,
                        t_start=start_f,
                        t_end=end_f,
                        text=seg_text_display,
                    )
                )
                wrote_segments += 1

        if wrote_segments == 0:
            # No segments array; fallback to a single segment for the full audio
            duration = float(upload.duration_sec or 0.0)
            _log(
                "[transcribe] No segments in response; "
                f"writing 1 segment 0.0 → {duration:.2f}s"
            )

            db.add(
                TranscriptSegment(
                    transcript_id=t.id,
                    t_start=0.0,
                    t_end=duration,
                    text=text,
                )
            )
            wrote_segments = 1

        db.commit()

        _log(
            f"[transcribe] Wrote real transcript for upload_id={upload.id}, "
            f"transcript_id={t.id}, segments={wrote_segments}"
        )
        return True

    except Exception as e:
        _log(f"[transcribe] Transcribe failed ({e}); falling back to stub.")
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
