def test_auth_ping_dev_key(client):
    r = client.get("/v1/auth/ping", headers={"X-Api-Key": "dev-api"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["dev"] is True
    assert body["user_id"]  # should be the NOTABLY_DEV_USER_ID

def test_auth_ping_missing_token(client):
    r = client.get("/v1/auth/ping")
    # dev key not provided → we expect 401 because JWT missing
    assert r.status_code == 401
