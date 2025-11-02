# backend/app/transcribe.py
from __future__ import annotations
import os
from sqlalchemy.orm import Session
from .models import Upload, UploadObject

def whisper_enabled() -> bool:
    return os.getenv("WHISPER_ENABLE", "false").lower() in {"1", "true", "yes", "y"}

def maybe_transcribe_from_minio(db: Session, upload: Upload, obj: UploadObject) -> bool:
    """
    Placeholder hook. When WHISPER_ENABLE=true, we'll download audio-16k.wav and
    send it to a provider (OpenAI, etc.) then write real Transcript/Segments.
    For now it just logs and returns False so the pipeline keeps using stubs.
    """
    if not whisper_enabled():
        print("[WHISPER] disabled; skipping", flush=True)
        return False

    # Next steps will:
    # - ensure audio-16k.wav exists (fallback to original if needed)
    # - download to temp file
    # - call provider (e.g., OpenAI Whisper) with timeouts
    # - write Transcript + TranscriptSegment rows
    print("[WHISPER] enabled, but not implemented yet (scaffold only)", flush=True)
    return False
