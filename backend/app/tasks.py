from __future__ import annotations

from time import sleep

from .db import SessionLocal
from .models import (
    Upload,
    Transcript,
    TranscriptSegment,
    Summary,
    SummaryBullet as ORMSummaryBullet,
    BulletCitation as ORMBulletCitation,
)

from .stubs import _make_stub_result



def process_stub(upload_id: str, meeting_id: str) -> None:
    """
    RQ-friendly task:
    Simulate background processing for an upload:
      queued -> processing -> done
    Persists transcript segments + summary + citations to the DB.
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

        # small delay so status transition is observable
        sleep(1.0)

        # fabricate result
        segs, bullets, actions = _make_stub_result()

        # transcript
        t = Transcript(upload_id=upload_id, language="en")
        db.add(t)
        db.flush()  # t.id

        seg_id_by_index = {}
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
                    db.add(ORMBulletCitation(summary_bullet_id=b_row.id, segment_id=real_seg_id))

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
