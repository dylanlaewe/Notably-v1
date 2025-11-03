# backend/app/summarize.py
from __future__ import annotations
import os, json, time
from typing import List, Dict, Optional
from sqlalchemy.orm import Session

from .models import (
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
)

# Optional OpenAI import; everything is gated so the app still runs without it
try:
    from openai import OpenAI  # pip install "openai>=1.52.0"
except Exception:
    OpenAI = None  # type: ignore


# ---------------------------
# Helpers / env knobs
# ---------------------------
def _env_true(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes", "y"}

def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default

def _now_ms() -> int:
    return int(time.time() * 1000)

def gpt_enabled() -> bool:
    return _env_true("GPT_ENABLE", "false")

def _model_name() -> str:
    return os.getenv("GPT_MODEL", "gpt-4o-mini")

def _get_client():
    if OpenAI is None:
        return None
    if not os.getenv("OPENAI_API_KEY"):
        return None
    return OpenAI()


# ---------------------------
# Data shaping
# ---------------------------
def _segments_payload(db: Session, transcript: Transcript) -> List[Dict]:
    segs = (
        db.query(TranscriptSegment)
        .filter(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.id.asc())
        .all()
    )
    max_segs = _int_env("SUMMARY_MAX_SEGS", 40)
    out: List[Dict] = []
    for s in segs[:max_segs]:
        out.append(
            {
                "id": int(s.id),
                "t_start": float(s.t_start or 0.0),
                "t_end": float(s.t_end or 0.0),
                "text": s.text or "",
            }
        )
    return out


# ---------------------------
# OpenAI call (retry + timeout + eval logging)
# ---------------------------
def _call_openai_for_bullets(segments: List[Dict]) -> Dict:
    """
    Robust wrapper for the OpenAI chat call.
    Returns strict JSON:
      {"bullets":[{"text":str,"citations":[{"segment_id":int}]}],
       "action_items":[{"text":str,"citations":[{"segment_id":int}]}]}
    """
    client = _get_client()
    if client is None:
        raise RuntimeError("OpenAI client not available")

    # Tunables
    max_retries = _int_env("GPT_MAX_RETRY", 2)
    req_timeout = _int_env("GPT_REQUEST_TIMEOUT_SECONDS", 15)  # seconds
    max_tokens  = _int_env("GPT_MAX_TOKENS", 500)
    eval_mode   = _env_true("EVAL_MODE", "false")

    sys = (
        "You produce concise meeting bullets with citations to transcript segment IDs. "
        "Output ONLY JSON with keys `bullets` and `action_items`. "
        "Each citation must be an object {{\"segment_id\": <int>}} referencing a provided segment id. "
        "No prose outside JSON."
    )
    usr = json.dumps({"segments": segments}, ensure_ascii=False)

    last_err: Optional[Exception] = None
    t0 = _now_ms()
    for attempt in range(max_retries + 1):
        try:
            resp = client.chat.completions.create(
                model=_model_name(),
                messages=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": usr},
                ],
                temperature=0,
                max_tokens=max_tokens,
                timeout=req_timeout,  # supported by openai>=1.0 client
            )
            latency_ms = _now_ms() - t0

            content = resp.choices[0].message.content or "{}"
            try:
                data = json.loads(content)
            except Exception:
                # permissive recovery: take the largest JSON-looking block
                start = content.find("{")
                end = content.rfind("}")
                if start >= 0 and end > start:
                    data = json.loads(content[start : end + 1])
                else:
                    raise

            if eval_mode:
                usage = getattr(resp, "usage", None) or {}
                eval_blob = {
                    "evt": "gpt_summary",
                    "model": _model_name(),
                    "attempt": attempt,
                    "latency_ms": latency_ms,
                    "segments_in": len(segments),
                    "prompt_tokens": getattr(usage, "prompt_tokens", None)
                        if hasattr(usage, "prompt_tokens") else (usage.get("prompt_tokens") if isinstance(usage, dict) else None),
                    "completion_tokens": getattr(usage, "completion_tokens", None)
                        if hasattr(usage, "completion_tokens") else (usage.get("completion_tokens") if isinstance(usage, dict) else None),
                    "total_tokens": getattr(usage, "total_tokens", None)
                        if hasattr(usage, "total_tokens") else (usage.get("total_tokens") if isinstance(usage, dict) else None),
                }
                print("[EVAL]", json.dumps(eval_blob), flush=True)
            return data
        except Exception as e:
            last_err = e
            if attempt < max_retries:
                time.sleep(0.5 * (attempt + 1))
            else:
                break

    # Exhausted retries
    assert last_err is not None
    raise last_err


# ---------------------------
# Public entrypoint
# ---------------------------
def maybe_generate_summary(db: Session, meeting_id: str, transcript: Transcript) -> bool:
    """
    If GPT is enabled (env + key) and segments exist, write a Summary with
    bullets + citations. Returns True if written, else False.
    """
    if not gpt_enabled():
        print("[GPT] disabled; skipping", flush=True)
        return False
    if _get_client() is None:
        print("[GPT] client missing (package or key); skipping", flush=True)
        return False

    segments = _segments_payload(db, transcript)
    if not segments:
        print("[GPT] no segments available; skipping", flush=True)
        return False

    try:
        valid_ids = {int(s["id"]) for s in segments}
        data = _call_openai_for_bullets(segments)
        bullets = list(data.get("bullets", []))
        actions = list(data.get("action_items", []))

        summary = Summary(meeting_id=meeting_id)
        db.add(summary)
        db.flush()

        def _write_one(bobj: Dict):
            text = str(bobj.get("text", "")).strip()
            if not text:
                return
            row = ORMSummaryBullet(summary_id=summary.id, text=text)
            db.add(row)
            db.flush()
            for c in bobj.get("citations", []):
                try:
                    sid = int(c.get("segment_id"))
                except Exception:
                    continue
                if sid in valid_ids:
                    db.add(ORMBulletCitation(summary_bullet_id=row.id, segment_id=sid))

        for b in bullets:
            _write_one(b)
        for a in actions:
            _write_one(a)

        db.commit()
        print(f"[GPT] wrote summary: {len(bullets)} bullets, {len(actions)} action_items", flush=True)
        return True
    except Exception as e:
        db.rollback()
        print(f"[GPT] error ({e}); skipping", flush=True)
        return False
