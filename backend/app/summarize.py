# backend/app/summarize.py
from __future__ import annotations
import os, json
from typing import List, Dict
from sqlalchemy.orm import Session

from .models import (
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
)

# Optional OpenAI import; gated by env and presence of package
try:
    from openai import OpenAI  # pip install openai>=1.52.0
except Exception:
    OpenAI = None  # type: ignore


def gpt_enabled() -> bool:
    return os.getenv("GPT_ENABLE", "false").lower() in {"1", "true", "yes", "y"}


def _get_client():
    if OpenAI is None:
        return None
    if not os.getenv("OPENAI_API_KEY"):
        return None
    return OpenAI()


def _segments_payload(db: Session, transcript: Transcript) -> List[Dict]:
    segs = (
        db.query(TranscriptSegment)
        .filter(TranscriptSegment.transcript_id == transcript.id)
        .order_by(TranscriptSegment.id.asc())
        .all()
    )
    max_segs = int(os.getenv("SUMMARY_MAX_SEGS", "40"))
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


def _model_name() -> str:
    return os.getenv("GPT_MODEL", "gpt-4o-mini")


def _call_openai_for_bullets(segments: List[Dict]) -> Dict:
    """
    Expect pure JSON:
      {"bullets":[{"text":str,"citations":[{"segment_id":int}]}],
       "action_items":[{"text":str,"citations":[{"segment_id":int}]}]}
    """
    client = _get_client()
    if client is None:
        raise RuntimeError("OpenAI client not available")

    sys = (
        "You produce concise meeting bullets with citations to transcript segment IDs.\n"
        "Output ONLY JSON with keys `bullets` and `action_items`. No prose outside JSON."
    )
    usr = json.dumps({"segments": segments}, ensure_ascii=False)

    resp = client.chat.completions.create(
        model=_model_name(),
        messages=[{"role": "system", "content": sys}, {"role": "user", "content": usr}],
        temperature=0,
        max_tokens=500,
    )
    content = resp.choices[0].message.content or "{}"
    try:
        return json.loads(content)
    except Exception:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            return json.loads(content[start : end + 1])
        raise


def maybe_generate_summary(db: Session, meeting_id: str, transcript: Transcript) -> bool:
    """
    If GPT is enabled (env + key) and there are segments, write a Summary with
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
