from __future__ import annotations

import os
import json
from typing import Optional, List, Dict, Any, Tuple

from sqlalchemy.orm import Session

from .models import (
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
    Transcript,
    TranscriptSegment,
)

# OpenAI SDK (pip install --upgrade openai>=1.0.0)
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
    line = f"[summarize] {msg}"
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


def _gpt_json(client: Any, model: str, system: str, user: str) -> Dict[str, Any]:
    """
    Call GPT and request strict JSON. Returns parsed dict (empty dict on failure).
    """
    try:
        # chat.completions API (OpenAI >=1.0)
        resp = client.chat.completions.create(  # type: ignore
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
        )
        content = resp.choices[0].message.content  # type: ignore
        return json.loads(content or "{}")
    except Exception as e:
        _log(f"GPT call failed ({e})")
        return {}


def _build_segment_index(db: Session, transcript_id: str, max_segments: int = 200) -> Tuple[List[Dict[str, Any]], Dict[int, int]]:
    """
    Return:
      - a list of segment dicts for prompting: [{'i':1,'t_start':..,'t_end':..,'text':..}, ...]
      - a mapping i -> segment_id for attaching citations
    Caps to the first 'max_segments' to keep prompt bounded.
    """
    segs: List[TranscriptSegment] = (
        db.query(TranscriptSegment)
        .filter(TranscriptSegment.transcript_id == transcript_id)
        .order_by(TranscriptSegment.id.asc())
        .limit(max_segments)
        .all()
    )
    prompt_segs: List[Dict[str, Any]] = []
    i2segid: Dict[int, int] = {}
    for i, s in enumerate(segs, start=1):
        prompt_segs.append({
            "i": i,
            "t_start": float(s.t_start or 0.0),
            "t_end": float(s.t_end or 0.0),
            "text": s.text or "",
        })
        i2segid[i] = s.id
    return prompt_segs, i2segid


# ---------------------------
# Main API
# ---------------------------
def maybe_generate_summary(db: Session, meeting_id: str, transcript: Transcript) -> bool:
    """
    Generate a summary with citations if OPENAI_API_KEY is present.
    Writes:
      - Summary(meeting_id=..)
      - SummaryBullet rows
      - BulletCitation rows (>=1 per bullet, enforced)
    Returns True iff rows were written.
    """
    try:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key or OpenAI is None:
            _log("OpenAI not available; skipping summarize")
            return False

        model = os.getenv("SUMMARY_MODEL", "gpt-4o-mini")

        # Gather segments (bounded)
        prompt_segs, i2segid = _build_segment_index(db, transcript.id, max_segments=int(os.getenv("SUMMARY_MAX_SEGMENTS", "200")))
        if not prompt_segs:
            _log("no segments to summarize; skipping")
            return False

        # Build prompt
        system = (
            "You are a careful meeting summarizer. "
            "Output STRICT JSON with two arrays: 'bullets' and 'actions'. "
            "Each item must include a 'text' string and a 'citations' array of segment indices. "
            "Every bullet MUST cite at least one segment index."
        )
        user = json.dumps({
            "instructions": {
                "style": "concise bullets for an executive reader",
                "max_bullets": 5,
                "max_actions": 3,
                "must_cite": True
            },
            "segments": prompt_segs
        })

        client = OpenAI(api_key=api_key)  # type: ignore
        _log(f"Calling {model} for summary over {len(prompt_segs)} segments")
        out = _gpt_json(client, model, system, user) or {}

        bullets = out.get("bullets") or []
        actions = out.get("actions") or []

        # Sanity: ensure lists
        if not isinstance(bullets, list): bullets = []
        if not isinstance(actions, list): actions = []

        if not bullets and not actions:
            _log("model returned no bullets/actions; skipping")
            return False

        # Create Summary
        summary = Summary(meeting_id=meeting_id)
        db.add(summary); db.flush()

        def _normalize_items(items: List[Dict[str, Any]], is_action: bool) -> List[Tuple[str, List[int]]]:
            normalized: List[Tuple[str, List[int]]] = []
            for it in items:
                try:
                    text = (it.get("text") or "").strip()
                    cites_raw = it.get("citations") or []
                    if not isinstance(cites_raw, list):
                        cites_raw = []
                    cites = []
                    for c in cites_raw:
                        try:
                            iv = int(c)
                            if iv >= 1:
                                cites.append(iv)
                        except Exception:
                            continue
                    if not text:
                        continue
                    if is_action:
                        text = f"Action: {text}"
                    normalized.append((text, cites))
                except Exception as e:
                    _log(f"skip malformed item ({e})")
            return normalized

        norm_bullets = _normalize_items(bullets, is_action=False)
        norm_actions = _normalize_items(actions, is_action=True)
        wrote = False

        def _attach_bullet(text: str, cite_indices: List[int]) -> None:
            nonlocal wrote
            b = ORMSummaryBullet(summary_id=summary.id, text=text)
            db.add(b); db.flush()
            # enforce >=1 citation
            attached = 0
            for idx in cite_indices:
                seg_id = i2segid.get(idx)
                if seg_id:
                    db.add(ORMBulletCitation(summary_bullet_id=b.id, segment_id=seg_id))
                    attached += 1
            if attached == 0:
                # fallback: cite the first available segment
                first_idx = 1 if 1 in i2segid else (min(i2segid.keys()) if i2segid else None)
                if first_idx is not None:
                    db.add(ORMBulletCitation(summary_bullet_id=b.id, segment_id=i2segid[first_idx]))
                    attached = 1
            wrote = True

        for text, cites in norm_bullets:
            _attach_bullet(text, cites)
        for text, cites in norm_actions:
            _attach_bullet(text, cites)

        db.commit()
        _log(f"Summary written meeting_id={meeting_id} bullets={len(norm_bullets)} actions={len(norm_actions)}")
        return wrote

    except Exception as e:
        _log(f"summarize failed ({e})")
        try:
            db.rollback()
        except Exception:
            pass
        return False
