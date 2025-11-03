from __future__ import annotations

from time import sleep
import json
import subprocess
import tempfile
import os
import hashlib
from io import BytesIO

# MinIO client (support old name get_client)
try:
    from .storage import get_minio_client  # preferred
except ImportError:
    from .storage import get_client as get_minio_client  # back-compat

from .db import SessionLocal
from .models import (
    Upload,
    UploadObject,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
)
from .stubs import _make_stub_result
from .transcribe import maybe_transcribe_from_minio
from .summarize import maybe_generate_summary



# ---------------------------
# Helpers
# ---------------------------
def _env_true(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "y"}


def _probe_duration_sec(path: str) -> float | None:
    """Return duration (s) via ffprobe, or None. Timeout to avoid hangs."""
    try:
        p = subprocess.run(
            ["ffprobe", "-v", "error", "-hide_banner",
             "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True, text=True, timeout=5
        )
        if p.returncode != 0:
            return None
        data = json.loads(p.stdout or "{}")
        dur = data.get("format", {}).get("duration")
        return float(dur) if dur is not None else None
    except Exception:
        return None


def _ffmpeg_to_wav(src_path: str, dst_path: str) -> None:
    """Transcode to 16 kHz mono WAV. Non-interactive + timeout."""
    try:
        p = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
             "-y", "-i", src_path, "-ac", "1", "-ar", "16000", "-f", "wav", dst_path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10
        )
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip() or "ffmpeg failed")
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffmpeg timeout")


def _sha256_bytes(b: bytes) -> str:
    h = hashlib.sha256()
    h.update(b)
    return h.hexdigest()


# ---------------------------
# Task
# ---------------------------
def process_stub(upload_id: str, meeting_id: str) -> None:
    """
    Background job:
      - status: queued -> processing -> done
      - If MINIO_ENABLE: probe duration, write audio-16k.wav
      - If WHISPER_ENABLE (+ key): transcribe via Whisper
      - Always write a Summary (stub bullets; cite available segments)
    """
    db = SessionLocal()
    u = None
    try:
        # mark processing
        u = db.get(Upload, upload_id)
        if not u:
            db.close()
            return
        u.status = "processing"
        db.add(u)
        db.commit()

        # small delay so you can observe the transition
        sleep(1.0)

        # --- MinIO best-effort: find object, probe, and write 16k WAV ---
        obj: UploadObject | None = None
        try:
            if _env_true("MINIO_ENABLE"):
                # latest object for this upload
                obj = (
                    db.query(UploadObject)
                    .filter(UploadObject.upload_id == upload_id)
                    .order_by(UploadObject.id.desc())
                    .first()
                )
                if obj:
                    client = get_minio_client()

                    # download original to a temp path
                    fd, tmp_path = tempfile.mkstemp(
                        suffix=os.path.splitext(obj.object_key)[1] or ".bin"
                    )
                    os.close(fd)
                    try:
                        client.fget_object(obj.bucket, obj.object_key, tmp_path)

                        # duration (non-fatal)
                        print(f"[PROBE] ffprobe {tmp_path}", flush=True)
                        dur = _probe_duration_sec(tmp_path)
                        if dur is not None:
                            u.duration_sec = float(dur)
                            db.add(u)
                            db.commit()
                            print(f"[PROBE] duration={u.duration_sec:.3f}s", flush=True)

                        # transcode -> 16kHz mono WAV (non-fatal)
                        wav_fd, wav_path = tempfile.mkstemp(suffix=".wav")
                        os.close(wav_fd)
                        try:
                            print(f"[FFMPEG] -> {wav_path}", flush=True)
                            _ffmpeg_to_wav(tmp_path, wav_path)
                            with open(wav_path, "rb") as f:
                                data = f.read()
                            if data:
                                wav_key = obj.object_key.rsplit("/", 1)[0] + "/audio-16k.wav"
                                print(f"[AUDIO16K] uploading {wav_key} (bytes={len(data)})", flush=True)
                                client.put_object(
                                    obj.bucket,
                                    wav_key,
                                    data=BytesIO(data),
                                    length=len(data),
                                    content_type="audio/wav",
                                )
                                db.add(
                                    UploadObject(
                                        upload_id=upload_id,
                                        bucket=obj.bucket,
                                        object_key=wav_key,
                                        content_type="audio/wav",
                                        byte_size=len(data),
                                        sha256=_sha256_bytes(data),
                                    )
                                )
                                db.commit()
                        except Exception as e:
                            print(f"[FFMPEG] skip ({e})", flush=True)
                        finally:
                            try:
                                os.remove(wav_path)
                            except Exception:
                                pass
                    finally:
                        try:
                            os.remove(tmp_path)
                        except Exception:
                            pass
        except Exception as e:
            print(f"[MINIO] skip ({e})", flush=True)

        # --- Optional: Whisper transcription (writes Transcript+Segments on success) ---
        wrote = False
        try:
            if obj is not None:  # only attempt if we had an object
                wrote = maybe_transcribe_from_minio(db, u, obj)
        except Exception as e:
            print(f"[WHISPER] skip ({e})", flush=True)
            wrote = False

        # --- If Whisper didn't write a transcript, fabricate stub transcript ---
        t: Transcript | None = None
        seg_id_by_index: dict[int, int] = {}

        if not wrote:
            segs, bullets, actions = _make_stub_result()

            # transcript (stub)
            t = Transcript(upload_id=upload_id, language="en")
            db.add(t)
            db.flush()  # t.id

            for i, s in enumerate(segs, start=1):
                seg = TranscriptSegment(
                    transcript_id=t.id,
                    t_start=s["t_start"],
                    t_end=s["t_end"],
                    text=s["text"],
                )
                db.add(seg)
                db.flush()
                seg_id_by_index[i] = seg.id
        else:
            # Fetch the transcript created by Whisper (latest for this upload)
            t = (
                db.query(Transcript)
                .filter(Transcript.upload_id == upload_id)
                .order_by(Transcript.id.desc())
                .first()
            )
            # Build a minimal index over the first two segments so our stub bullets can cite something real
            if t:
                segs = (
                    db.query(TranscriptSegment)
                    .filter(TranscriptSegment.transcript_id == t.id)
                    .order_by(TranscriptSegment.id.asc())
                    .all()
                )
                for i, seg in enumerate(segs, start=1):
                    seg_id_by_index[i] = seg.id

        # --- Try GPT summary; fall back to simple stub summary with citations ---
        wrote_summary = False
        if t is not None:
            wrote_summary = maybe_generate_summary(db, meeting_id, t)

        if not wrote_summary:
            summary = Summary(meeting_id=meeting_id)
            db.add(summary); db.flush()

            b1 = ORMSummaryBullet(summary_id=summary.id, text="Transcript captured.")
            b2 = ORMSummaryBullet(summary_id=summary.id, text="Upload pipeline OK; next: summarize with GPT and cite segments.")
            db.add(b1); db.flush()
            db.add(b2); db.flush()

            if 1 in seg_id_by_index:
                db.add(ORMBulletCitation(summary_bullet_id=b1.id, segment_id=seg_id_by_index[1]))
            if 2 in seg_id_by_index:
                db.add(ORMBulletCitation(summary_bullet_id=b2.id, segment_id=seg_id_by_index[2]))

            db.commit()


        # Two generic bullets that cite segment 1 and 2 when available
        b1_text = "Transcript captured."
        b2_text = "Upload pipeline OK; next: summarize with GPT and cite segments."
        b1 = ORMSummaryBullet(summary_id=summary.id, text=b1_text)
        b2 = ORMSummaryBullet(summary_id=summary.id, text=b2_text)
        db.add(b1); db.flush()
        db.add(b2); db.flush()

        if 1 in seg_id_by_index:
            db.add(ORMBulletCitation(summary_bullet_id=b1.id, segment_id=seg_id_by_index[1]))
        if 2 in seg_id_by_index:
            db.add(ORMBulletCitation(summary_bullet_id=b2.id, segment_id=seg_id_by_index[2]))

        db.commit()

        # done
        u.status = "done"
        db.add(u)
        db.commit()
    except Exception as e:
        if u:
            u.status = "failed"
            u.error = str(e)
            db.add(u)
            db.commit()
        raise
    finally:
        db.close()
