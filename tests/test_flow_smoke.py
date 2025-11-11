# tests/test_flow_smoke.py
import time


def _poll_upload_done(client, upload_id, headers):
    for _ in range(50):
        r = client.get(f"/v1/uploads/{upload_id}", headers=headers)
        if r.status_code == 200:
            j = r.json()
            if j.get("status") == "done":
                return j
        time.sleep(0.1)
    raise AssertionError("upload did not reach status=done in time")


def test_end_to_end_flow(client, fresh_meeting_id, sample_wav_bytes, auth_headers):
    # 1) Upload (API may return 200 or 202 depending on implementation)
    files = {"file": ("test.wav", sample_wav_bytes, "audio/wav")}
    data = {"meeting_id": fresh_meeting_id}
    r = client.post("/v1/uploads", files=files, data=data, headers=auth_headers)
    assert r.status_code in (200, 202)
    up = r.json()
    assert up["status"] in {"queued", "processing", "done"}
    upload_id = up.get("upload_id") or up.get("id")
    assert upload_id

    # 2) Poll until done
    done = _poll_upload_done(client, upload_id, auth_headers)
    assert done["status"] == "done"
    assert done["meeting_id"] == fresh_meeting_id

    # 3) Transcript
    r = client.get(f"/v1/meetings/{fresh_meeting_id}/transcript?limit=10", headers=auth_headers)
    assert r.status_code == 200
    tr = r.json()
    assert tr["meeting_id"] == fresh_meeting_id
    assert tr["total"] >= 1
    segs = tr["items"]
    assert len(segs) >= 1
    seg_ids = [s["id"] for s in segs]

    # 4) Summary
    r = client.get(f"/v1/meetings/{fresh_meeting_id}/summary", headers=auth_headers)
    assert r.status_code == 200
    summ = r.json()
    assert summ["meeting_id"] == fresh_meeting_id
    assert summ["bullet_count"] >= 1

    # 5) Create an Action citing first segment
    r = client.post(
        f"/v1/meetings/{fresh_meeting_id}/actions",
        json={"text": "Send summary to team", "priority": 2, "citations": [seg_ids[0]]},
        headers=auth_headers,
    )
    assert r.status_code == 200
    action = r.json()
    aid = action["id"]
    assert action["citations"] and action["citations"][0]["segment_id"] == seg_ids[0]

    # 6) Mark done
    r = client.patch(f"/v1/actions/{aid}", json={"is_done": True}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["is_done"] is True

    # 7) Search (accept either new object response or legacy [])
    r = client.get("/v1/search", params={"q": "upload", "mode": "any", "meeting_id": fresh_meeting_id}, headers=auth_headers)
    assert r.status_code == 200
    # Shape can be {"total":..., "items":[...]} or [] depending on config.
    try:
        srch = r.json()
    except Exception:
        assert False, "search returned non-JSON"

    if isinstance(srch, dict):
        # New search shape
        assert "total" in srch
    else:
        # Legacy list shape is also acceptable for smoke purposes
        assert isinstance(srch, list)
