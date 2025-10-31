from __future__ import annotations

def _make_stub_result():
    segs = [
        {"id": 1, "t_start": 0.0, "t_end": 5.4, "text": "Welcome; today we review the MVP slice."},
        {"id": 2, "t_start": 5.4, "t_end": 12.3, "text": "Next steps: wire upload -> background job."},
    ]
    bullets = [
        {"id": "stub-1", "text": "MVP scope confirmed.", "citations": [{"segment_id": 1}]},
        {"id": "stub-2", "text": "Upload enqueues processing job.", "citations": [{"segment_id": 2}]},
    ]
    actions = []
    return segs, bullets, actions
