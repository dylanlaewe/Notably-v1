import time


def _poll_upload_done(client, upload_id, timeout_s=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        r = client.get(f"/v1/uploads/{upload_id}")
        assert r.status_code == 200
        data = r.json()
        if data.get("status") == "done":
            return data
        time.sleep(0.15)
    raise AssertionError("upload did not reach status=done in time")


def test_end_to_end_flow(client, fresh_meeting_id, sample_wav_bytes):
    # 1) Upload (API may return 200 or 202 depending on implementation)
    files = {"file": ("test.wav", sample_wav_bytes, "audio/wav")}
    data = {"meeting_id": fresh_meeting_id}
    r = client.post("/v1/uploads", files=files, data=data)
    assert r.status_code in (200, 202)
    up = r.json()
    assert up["status"] in {"queued", "processing", "done"}
    upload_id = up.get("upload_id") or up.get("id")  # accept either shape

    # 2) Poll until done
    done = _poll_upload_done(client, upload_id)
    assert done["status"] == "done"
    assert done["meeting_id"] == fresh_meeting_id

    # 3) Transcript
    r = client.get(f"/v1/meetings/{fresh_meeting_id}/transcript?limit=10")
    assert r.status_code == 200
    tr = r.json()
    assert tr["meeting_id"] == fresh_meeting_id
    assert tr["total"] >= 1
    segs = tr["items"]
    assert len(segs) >= 1
    seg_ids = [s["id"] for s in segs]

    # 4) Summary
    r = client.get(f"/v1/meetings/{fresh_meeting_id}/summary")
    assert r.status_code == 200
    summ = r.json()
    assert summ["meeting_id"] == fresh_meeting_id
    assert summ["bullet_count"] >= 1

    # 5) Create an Action citing first segment
    r = client.post(
        f"/v1/meetings/{fresh_meeting_id}/actions",
        json={"text": "Send summary to team", "priority": 2, "citations": [seg_ids[0]]},
    )
    assert r.status_code == 200
    action = r.json()
    aid = action["id"]
    assert action["citations"] and action["citations"][0]["segment_id"] == seg_ids[0]

    # 6) Mark done
    r = client.patch(f"/v1/actions/{aid}", json={"is_done": True})
    assert r.status_code == 200
    assert r.json()["is_done"] is True

    # 7) Search
    r = client.get("/v1/search", params={"q": "upload", "mode": "any", "meeting_id": fresh_meeting_id})
    assert r.status_code == 200
    srch = r.json()
    assert srch["total"] >= 1
    assert all("kind" in it and "text" in it for it in srch["items"])

    # 8) Export MD + PDF
    r = client.get(f"/v1/meetings/{fresh_meeting_id}/export.md")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")

    r = client.get(f"/v1/meetings/{fresh_meeting_id}/export.pdf?filename=meeting.pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].endswith('filename="meeting.pdf"')

