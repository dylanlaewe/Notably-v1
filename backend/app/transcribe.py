# backend/app/transcribe.py
from __future__ import annotations
import os, tempfile, json
from typing import List, Dict, Tuple
from sqlalchemy.orm import Session

from .models import Upload, UploadObject, Transcript, TranscriptSegment

# Optional OpenAI import (only used when WHISPER_ENABLE=true)
try:
    from openai import OpenAI  # pip install openai>=1.52.0
except Exception:
    OpenAI = None  # typed: ignore

def whisper_enabled() -> bool:
    return os.getenv("WHISPER_ENABLE", "false").lower() in {"1", "true", "yes", "y"}

def _find_audio_object(db: Session, upload_id: str) -> UploadObject | None:
    """Prefer audio-16k.wav; otherwise fall back to the latest object for this upload."""
    q = db.query(UploadObject).filter(UploadObject.upload_id == upload_id)
    cand = q.filter(UploadObject.object_key.like("%/audio-16k.wav")).order_by(UploadObject.id.desc()).first()
    if cand:
        return cand
    return q.order_by(UploadObject.id.desc()).first()

def _download_to_tmp(minio_client, bucket: str, key: str, suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix or ".wav")
    os.close(fd)
    minio_client.fget_object(bucket, key, path)
    return path

def _openai_segments_from_file(path: str) -> Tuple[str, List[Dict]]:
    """
    Calls OpenAI Whisper and returns (language, segments).
    Segments are dicts: {"t_start": float, "t_end": float, "text": str}
    Falls back to a single segment if verbose JSON isn't available.
    """
    if OpenAI is None:
        raise RuntimeError("openai package not installed")

    client = OpenAI()  # uses OPENAI_API_KEY from env
    # Prefer verbose JSON to get per-segment timestamps; graceful fallback to plain text
    try:
        with open(path, "rb") as f:
            res = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
                temperature=0,
            )
        language = getattr(res, "language", "en")
        raw_segments = getattr(res, "segments", None)
        if raw_segments:
            segs = [
                {"t_start": float(s.get("start", 0.0)),
                 "t_end": float(s.get("end", 0.0)),
                 "text": s.get("text", "")}
                for s in raw_segments
            ]
            return language, segs
        # No segments → use full text
        text = getattr(res, "text", "") or ""
        return language, [{"t_start": 0.0, "t_end": 0.0, "text": text}]
    except Exception:
        # Fallback: plain text response
        with open(path, "rb") as f:
            res2 = client.audio.transcriptions.create(model="whisper-1", file=f, temperature=0)
        text = getattr(res2, "text", "") or ""
        language = getattr(res2, "language", "en") if hasattr(res2, "language") else "en"
        return language, [{"t_start": 0.0, "t_end": 0.0, "text": text}]

def maybe_transcribe_from_minio(db: Session, upload: Upload, obj: UploadObject) -> bool:
    """
    If WHISPER_ENABLE=true and OPENAI_API_KEY is set, download audio (prefer audio-16k.wav),
    run Whisper, and write Transcript + TranscriptSegment rows. Returns True if it wrote.
    """
    if not whisper_enabled():
        print("[WHISPER] disabled; skipping", flush=True)
        return False
    if OpenAI is None:
        print("[WHISPER] openai package missing; skipping", flush=True)
        return False
    if not os.getenv("OPENAI_API_KEY"):
        print("[WHISPER] OPENAI_API_KEY not set; skipping", flush=True)
        return False

    try:
        from .storage import get_minio_client
    except Exception as e:
        print(f"[WHISPER] storage unavailable ({e}); skipping", flush=True)
        return False

    # pick audio object and download
    audio_obj = _find_audio_object(db, upload.id)
    if not audio_obj:
        print("[WHISPER] no object to transcribe; skipping", flush=True)
        return False

    path = None
    try:
        client = get_minio_client()
        suffix = os.path.splitext(audio_obj.object_key)[1] or ".wav"
        path = _download_to_tmp(client, audio_obj.bucket, audio_obj.object_key, suffix)
        print(f"[WHISPER] downloading {audio_obj.object_key} -> {path}", flush=True)

        language, segs = _openai_segments_from_file(path)

        # Write transcript + segments
        t = Transcript(upload_id=upload.id, language=language or "en")
        db.add(t); db.flush()
        for s in segs:
            db.add(TranscriptSegment(
                transcript_id=t.id,
                t_start=float(s.get("t_start", 0.0)),
                t_end=float(s.get("t_end", 0.0)),
                text=str(s.get("text", "")),
            ))
        db.commit()
        print(f"[WHISPER] wrote transcript with {len(segs)} segments", flush=True)
        return True
    except Exception as e:
        # Don't fail pipeline; just log
        print(f"[WHISPER] error ({e}); skipping", flush=True)
        db.rollback()
        return False
    finally:
        if path:
            try: os.remove(path)
            except Exception: pass

