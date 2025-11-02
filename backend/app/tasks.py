from __future__ import annotations

from time import sleep
import json
import subprocess
import tempfile
import os
import hashlib
from io import BytesIO

# Robust import in case storage exposes get_client instead
try:
    from .storage import get_minio_client  # preferred
except ImportError:  # back-compat
    from .storage import get_client as get_minio_client

from .db import SessionLocal
from .models import Upload, UploadObject, Transcript, TranscriptSegment, Summary
from .models import SummaryBullet as ORMSummaryBullet, BulletCitation as ORMBulletCitation
from .stubs import _make_stub_result


# ---------------------------
# Helpers
# ---------------------------
def _env_true(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "y"}


def _probe_duration_sec(path: str) -> float | None:
    """
    Return duration (seconds) using ffprobe, or None on failure.
    Short timeout & non-interactive to avoid worker hangs.
    """
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
    """
    Convert input media to 16 kHz mono WAV.
    Short timeout & -nostdin so we never block.
    Raises RuntimeError on failure/timeout.
    """
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
    Simulate background processing for an upload:
      queued -> processing -> done
    Persists stub transcript segments + summary + citations to the DB.
    Best-effort: probe duration via ffprobe and write 16kHz mono WAV to MinIO.
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

        # small delay so you can see the transition when polling status
        sleep(1.0)

        # --- MinIO best-effort: probe + transcode to audio-16k.wav ---
        try:
            if _env_true("MINIO_ENABLE"):
                obj = (
                    db.query(UploadObject)
                    .filter(UploadObject.upload_id == upload_id)
                    .order_by(UploadObject.id.desc())
                    .first()
                )
                if obj:
                    client = get_minio_client()

                    # 1) download original to a real path (safer than in-memory stream)
                    fd, tmp_path = tempfile.mkstemp(
                        suffix=os.path.splitext(obj.object_key)[1] or ".bin"
                    )
                    os.close(fd)
                    try:
                        client.fget_object(obj.bucket, obj.object_key, tmp_path)

                        # 2) duration (non-fatal)
                        print(f"[PROBE] ffprobe {tmp_path}", flush=True)
                        dur = _probe_duration_sec(tmp_path)
                        if dur is not None:
                            u.duration_sec = float(dur)
                            db.add(u)
                            db.commit()
                            print(f"[PROBE] duration={u.duration_sec:.3f}s", flush=True)

                        # 3) transcode -> 16kHz mono WAV (non-fatal)
                        wav_fd, wav_path = tempfile.mkstemp(suffix=".wav")
                        os.close(wav_fd)
                        try:
                            print(f"[FFMPEG] -> {wav_path}", flush=True)
                            _ffmpeg_to_wav(tmp_path, wav_path)
                            with open(wav_path, "rb") as f:
                                data = f.read()
                            if data:
                                wav_key = obj.object_key.rsplit("/", 1)[0] + "/audio-16k.wav"
                                print(
                                    f"[AUDIO16K] uploading {wav_key} (bytes={len(data)})",
                                    flush=True,
                                )
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
            # best-effort: never fail the pipeline on storage/probe issues
            print(f"[MINIO] skip ({e})", flush=True)

        # --- fabricate stub result (transcript + bullets + citations) ---
        segs, bullets, actions = _make_stub_result()

        # transcript
        t = Transcript(upload_id=upload_id, language="en")
        db.add(t)
        db.flush()  # t.id

        seg_id_by_index: dict[int, int] = {}
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

        # summary + bullets + citations
        summary = Summary(meeting_id=meeting_id)
        db.add(summary)
        db.flush()

        for b in bullets:
            b_row = ORMSummaryBullet(summary_id=summary.id, text=b["text"])
            db.add(b_row)
            db.flush()
            for c in b.get("citations", []):
                idx = c["segment_id"]
                real_seg_id = seg_id_by_index.get(idx)
                if real_seg_id is not None:
                    db.add(
                        ORMBulletCitation(
                            summary_bullet_id=b_row.id, segment_id=real_seg_id
                        )
                    )

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
