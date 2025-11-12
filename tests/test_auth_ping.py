# tests/test_auth_ping.py
def test_auth_ping_dev_key(client):
    r = client.get("/v1/auth/ping", headers={"X-Api-Key": "test-api"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["dev"] is True

def test_auth_ping_missing_token(client):
    r = client.get("/v1/auth/ping", headers={})  # pass an empty dict
    assert r.status_code == 401

