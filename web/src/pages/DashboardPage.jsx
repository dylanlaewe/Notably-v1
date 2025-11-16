// web/src/pages/DashboardPage.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/apiClient";
import { clearAccessToken } from "../lib/authToken";

export default function DashboardPage() {
  const navigate = useNavigate();

  // Auth ping
  const [status, setStatus] = useState("loading"); // "loading" | "ok" | "error"
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [createStatus, setCreateStatus] = useState("idle");
  const [createError, setCreateError] = useState(null);

  // Meetings list
  const [meetingsStatus, setMeetingsStatus] = useState("idle"); // "idle" | "loading" | "ok" | "error"
  const [meetings, setMeetings] = useState([]);
  const [meetingsError, setMeetingsError] = useState("");

  // Upload form
  const [uploadMeetingId, setUploadMeetingId] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("idle"); // "idle" | "uploading" | "queued" | "error"
  const [uploadError, setUploadError] = useState("");
  const [uploadInfo, setUploadInfo] = useState(null); // last response from POST /v1/uploads

  // Latest upload status (for polling)
  const [lastUploadId, setLastUploadId] = useState(null);
  const [lastUploadStatus, setLastUploadStatus] = useState(null); // queued | processing | done | failed
  const [lastUploadDetail, setLastUploadDetail] = useState(null);
  const [lastUploadPollError, setLastUploadPollError] = useState("");


  // ------------------------
  // Initial load: auth ping + meetings
  // ------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setStatus("loading");
      setError("");

      // 1) Auth ping
      try {
        const res = await apiFetch("/v1/auth/ping");

        if (res.status === 401) {
          clearAccessToken();
          if (!cancelled) {
            navigate("/login", { replace: true });
          }
          return;
        }

        if (!res.ok) {
          let detail = "";
          try {
            const body = await res.json();
            detail = body.detail || JSON.stringify(body);
          } catch {
            // ignore parse error
          }
          const msg = detail || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        const data = await res.json();
        if (cancelled) return;
        setUser(data);
      } catch (err) {
        console.error("auth ping failed:", err);
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load auth ping"
          );
          setStatus("error");
        }
        return;
      }

      // 2) Meetings list
      setMeetingsStatus("loading");
      setMeetingsError("");

      try {
        const mRes = await apiFetch("/v1/my/meetings?limit=50");

        if (mRes.status === 401) {
          clearAccessToken();
          if (!cancelled) {
            navigate("/login", { replace: true });
          }
          return;
        }

        if (mRes.status === 404) {
          // No meetings yet
          if (!cancelled) {
            setMeetings([]);
            setMeetingsStatus("ok");
          }
        } else if (!mRes.ok) {
          let detail = "";
          try {
            const body = await mRes.json();
            detail = body.detail || JSON.stringify(body);
          } catch {
            // ignore
          }
          const msg = detail || `HTTP ${mRes.status}`;
          throw new Error(msg);
        } else {
          const body = await mRes.json();
          if (cancelled) return;

          let items = [];
          if (Array.isArray(body)) {
            items = body;
          } else if (Array.isArray(body.items)) {
            items = body.items;
          }

          items = items || [];
          setMeetings(items);
          setMeetingsStatus("ok");

          // Default the uploadMeetingId to first meeting
          if (!uploadMeetingId && items.length > 0) {
            const first = items[0];
            const id =
              first.id ||
              first.meeting_id ||
              first.meetingId ||
              first.uuid ||
              "";
            if (id) {
              setUploadMeetingId(String(id));
            }
          }
        }
      } catch (err) {
        console.error("meetings load failed:", err);
        if (!cancelled) {
          setMeetingsError(
            err instanceof Error ? err.message : "Failed to load meetings"
          );
          setMeetingsStatus("error");
        }
      }

      if (!cancelled) {
        setStatus("ok");
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [navigate, uploadMeetingId]);

  // ------------------------
  // Poll /v1/uploads/{lastUploadId}
  // ------------------------
  useEffect(() => {
    if (!lastUploadId) return;

    let cancelled = false;
    let intervalId = null;

    async function pollOnce() {
      try {
        const res = await apiFetch(`/v1/uploads/${lastUploadId}`);

        if (res.status === 401) {
          clearAccessToken();
          if (!cancelled) {
            navigate("/login", { replace: true });
          }
          return;
        }

        if (!res.ok) {
          let detail = "";
          try {
            const body = await res.json();
            detail = body.detail || JSON.stringify(body);
          } catch {
            // ignore
          }
          const msg = detail || `HTTP ${res.status}`;
          throw new Error(msg);
        }

        const body = await res.json();
        if (cancelled) return;

        const st = body.status || null;
        setLastUploadStatus(st);
        setLastUploadDetail(body);
        setLastUploadPollError("");

        // Update the user-facing uploadInfo box too
        setUploadInfo((prev) => ({
          ...(prev || {}),
          ...body,
          upload_id: body.id || lastUploadId,
        }));

        // Stop polling when terminal
        if (st === "done" || st === "failed") {
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (err) {
        console.error("upload status poll failed:", err);
        if (!cancelled) {
          setLastUploadPollError(
            err instanceof Error ? err.message : "Failed to poll upload status"
          );
        }
      }
    }

    // Fire once immediately, then every 2s
    pollOnce();
    intervalId = setInterval(pollOnce, 2000);

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [lastUploadId, navigate]);

  // ------------------------
  // Handlers
  // ------------------------
  const handleLogout = () => {
    clearAccessToken();
    navigate("/login", { replace: true });
  };

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    setUploadFile(file);
    setUploadStatus("idle");
    setUploadError("");
    // keep uploadInfo/lastUploadId separate; they describe last completed upload
  };

  const handleUpload = async (e) => {
    e.preventDefault();

    const trimmedMeetingId = (uploadMeetingId || "").trim();

    if (!trimmedMeetingId) {
      setUploadError("Please select or enter a meeting ID first.");
      setUploadStatus("error");
      return;
    }

    if (!uploadFile) {
      setUploadError("Please choose a file to upload.");
      setUploadStatus("error");
      return;
    }

    setUploadStatus("uploading");
    setUploadError("");
    setUploadInfo(null);
    setLastUploadPollError("");
    setLastUploadStatus(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("meeting_id", trimmedMeetingId);

    try {
      const res = await apiFetch("/v1/uploads", {
        method: "POST",
        body: formData,
      });

      if (res.status === 401) {
        clearAccessToken();
        navigate("/login", { replace: true });
        return;
      }

      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          detail = body.detail || JSON.stringify(body);
        } catch {
          // ignore
        }
        const msg = detail || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const body = await res.json();
      const id = body.upload_id || body.id;

      setUploadInfo(body);
      setUploadStatus("queued");
      if (id) {
        setLastUploadId(id);
        setLastUploadStatus(body.status || "queued");
      }
    } catch (err) {
      console.error("upload failed:", err);
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload file"
      );
      setUploadStatus("error");
    }
  };

  async function handleCreateMeeting() {
  if (createStatus === "creating") return;

  setCreateStatus("creating");
  setCreateError(null);

  try {
    const resp = await apiFetch("/v1/meetings", {
      method: "POST",
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Create failed: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    const newId = data.id;

    // Use this for uploads
    setUploadMeetingId(newId);

    // Optimistically add to meetings list if it's not already there
    setMeetings((prev) => {
      const exists = prev.some((m) => {
        const mid =
          m.id || m.meeting_id || m.meetingId || m.uuid || "";
        return String(mid) === String(newId);
      });
      if (exists) return prev;

      return [
        {
          id: newId,
          title: `New meeting ${String(newId).slice(0, 8)}…`,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ];
    });

    setCreateStatus("ok");
  } catch (err) {
    console.error(err);
    setCreateError(
      err?.message || "Failed to create meeting"
    );
    setCreateStatus("error");
  }
}

  // ------------------------
  // Render
  // ------------------------
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#020617",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <header
        style={{
          padding: "1rem 1.5rem",
          borderBottom: "1px solid #111827",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#020617",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div>
          <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>Notably</div>
          <div style={{ fontSize: "0.85rem", color: "#9ca3af" }}>
            Dashboard
          </div>
        </div>

        <button
          onClick={handleLogout}
          style={{
            padding: "0.4rem 0.8rem",
            borderRadius: "999px",
            border: "1px solid #4b5563",
            background: "transparent",
            color: "#e5e7eb",
            fontSize: "0.85rem",
            cursor: "pointer",
          }}
        >
          Log out
        </button>
      </header>

      <main
        style={{
          flex: 1,
          padding: "1.5rem",
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
          display: "grid",
          gap: "1rem",
        }}
      >
        {/* Auth status */}
        {status === "loading" && (
          <p style={{ color: "#9ca3af" }}>Checking your session…</p>
        )}

        {status === "error" && (
          <div
            style={{
              padding: "1rem",
              borderRadius: "0.75rem",
              background: "#450a0a",
              color: "#fecaca",
              fontSize: "0.9rem",
            }}
          >
            <strong>Something went wrong.</strong>
            <div style={{ marginTop: "0.25rem" }}>{error}</div>
          </div>
        )}

        {status === "ok" && user && (
          <>
            {/* Signed in box */}
            <section
              style={{
                padding: "1rem 1.25rem",
                borderRadius: "0.75rem",
                background:
                  "radial-gradient(circle at top left, #1d4ed8 0, #020617 50%, #020617 100%)",
                border: "1px solid #1f2937",
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#bfdbfe",
                  marginBottom: "0.25rem",
                }}
              >
                Signed in as
              </div>
              <div style={{ fontSize: "1.1rem", fontWeight: 500 }}>
                {user.email || "unknown"}
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#cbd5f5",
                  marginTop: "0.35rem",
                }}
              >
                user_id: <code>{user.user_id}</code>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                dev: <code>{String(user.dev)}</code>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                sub: <code>{user.sub}</code>
              </div>
            </section>

            {/* Uploads */}
            <section
              style={{
                padding: "1rem 1.25rem",
                borderRadius: "0.75rem",
                border: "1px solid #111827",
                background: "#020617",
              }}
            >
              <h2
                style={{
                  fontSize: "1rem",
                  marginBottom: "0.5rem",
                  fontWeight: 500,
                }}
              >
                Uploads
              </h2>

              {/* Debug line so we can see what's going on */}
              <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                meetingsStatus: <code>{meetingsStatus}</code>, count:{" "}
                <code>{meetings.length}</code>, selectedMeetingId:{" "}
                <code>{uploadMeetingId || "(empty)"}</code>
              </p>

              {meetingsStatus === "error" && (
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#fecaca",
                    background: "#450a0a",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.5rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Failed to load meetings: {meetingsError}
                </p>
              )}

              {meetingsStatus === "ok" && meetings.length === 0 && (
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#9ca3af",
                    marginBottom: "0.5rem",
                  }}
                >
                  You don’t have any meetings yet. You can still manually type a
                  meeting ID below (we’ll wire up “New meeting” later).
                </p>
              )}

              <form
                onSubmit={handleUpload}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  marginTop: "0.5rem",
                  fontSize: "0.9rem",
                }}
              >
                {/* Meeting dropdown */}
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <span style={{ color: "#e5e7eb" }}>Meeting (from list)</span>
                  <select
                    value={
                      meetings.length === 0
                        ? ""
                        : uploadMeetingId &&
                          meetings.some((m) => {
                            const id =
                              m.id ||
                              m.meeting_id ||
                              m.meetingId ||
                              m.uuid;
                            return String(id) === String(uploadMeetingId);
                          })
                        ? uploadMeetingId
                        : ""
                    }
                    onChange={(e) => setUploadMeetingId(e.target.value)}
                    disabled={meetings.length === 0}
                    style={{
                      background: "#020617",
                      color: "#e5e7eb",
                      borderRadius: "0.5rem",
                      border: "1px solid #374151",
                      padding: "0.4rem 0.5rem",
                    }}
                  >
                    {meetings.length === 0 && (
                      <option value="">No meetings available</option>
                    )}
                    {meetings.length > 0 && (
                      <option value="">– Select a meeting –</option>
                    )}
                    {meetings.map((m) => {
                      const id =
                        m.id ||
                        m.meeting_id ||
                        m.meetingId ||
                        m.uuid ||
                        "";
                      const name =
                        m.title ||
                        m.name ||
                        m.topic ||
                        (id
                          ? `Meeting ${String(id).slice(0, 8)}…`
                          : "Meeting");
                      return (
                        <option key={id || name} value={id}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </label>

                {/* Explicit meeting ID text box */}
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <span style={{ color: "#e5e7eb" }}>
                    Meeting ID (used for upload)
                  </span>
                  <input
                    type="text"
                    value={uploadMeetingId}
                    onChange={(e) => setUploadMeetingId(e.target.value)}
                    placeholder="Paste or type a meeting ID"
                    style={{
                      background: "#020617",
                      color: "#e5e7eb",
                      borderRadius: "0.5rem",
                      border: "1px solid #374151",
                      padding: "0.4rem 0.5rem",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                      fontSize: "0.85rem",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "#9ca3af",
                    }}
                  >
                    Tip: copy the ID from “My meetings” below and paste it here.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    const mid = (uploadMeetingId || "").trim();
                    if (!mid) return; // no-op if empty; could also show a small message
                    navigate(`/meetings/${mid}`);
                  }}
                  style={{
                    alignSelf: "flex-start",
                    padding: "0.3rem 0.8rem",
                    borderRadius: "999px",
                    border: "1px solid #374151",
                    background: "transparent",
                    color: "#e5e7eb",
                    fontSize: "0.8rem",
                    cursor: uploadMeetingId ? "pointer" : "default",
                    marginBottom: "0.25rem",
                  }}
                >
                  View meeting by ID →
                </button>



                {/* File input */}
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <span style={{ color: "#e5e7eb" }}>Audio file</span>
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    onChange={handleFileChange}
                    style={{
                      color: "#e5e7eb",
                      fontSize: "0.9rem",
                    }}
                  />
                </label>

                {uploadStatus === "error" && uploadError && (
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "#fecaca",
                      background: "#450a0a",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "0.5rem",
                    }}
                  >
                    {uploadError}
                  </div>
                )}

                {uploadStatus === "queued" && uploadInfo && (
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "#bbf7d0",
                      background: "#064e3b",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "0.5rem",
                    }}
                  >
                    Upload queued! id:{" "}
                    <code>{uploadInfo.upload_id || uploadInfo.id}</code>, status:{" "}
                    <code>{uploadInfo.status}</code>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={uploadStatus === "uploading"}
                  style={{
                    marginTop: "0.25rem",
                    alignSelf: "flex-start",
                    padding: "0.4rem 0.9rem",
                    borderRadius: "999px",
                    border: "none",
                    background:
                      uploadStatus === "uploading" ? "#4b5563" : "#2563eb",
                    color: "#e5e7eb",
                    fontSize: "0.9rem",
                    fontWeight: 500,
                    cursor:
                      uploadStatus === "uploading" ? "default" : "pointer",
                  }}
                >
                  {uploadStatus === "uploading"
                    ? "Uploading…"
                    : "Upload recording"}
                </button>
              </form>
            </section>

            {/* Latest upload status */}
            {lastUploadId && (
              <section
                style={{
                  padding: "1rem 1.25rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #111827",
                  background: "#020617",
                }}
              >
                <h2
                  style={{
                    fontSize: "1rem",
                    marginBottom: "0.5rem",
                    fontWeight: 500,
                  }}
                >
                  Latest upload status
                </h2>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#9ca3af",
                    marginBottom: "0.25rem",
                  }}
                >
                  upload_id: <code>{lastUploadId}</code>
                </p>
                <p
                  style={{
                    fontSize: "0.9rem",
                    marginBottom: "0.25rem",
                  }}
                >
                  Status:{" "}
                  <code>{lastUploadStatus || "(checking…)"}</code>
                </p>

                {lastUploadPollError && (
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "#fecaca",
                      background: "#450a0a",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "0.5rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    Error polling upload: {lastUploadPollError}
                  </p>
                )}

                {lastUploadStatus === "done" && (
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "#bbf7d0",
                      marginTop: "0.25rem",
                    }}
                  >
                    Background processing finished. Stub transcript & summary
                    should now exist for this meeting. We’ll wire up the
                    transcript view next.
                  </p>
                )}

                {lastUploadStatus === "failed" && lastUploadDetail?.error && (
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "#fecaca",
                      marginTop: "0.25rem",
                    }}
                  >
                    Worker reported an error:{" "}
                    <code>{String(lastUploadDetail.error)}</code>
                  </p>
                )}
              </section>
            )}

            {/* Meetings list */}
            <section
              style={{
                padding: "1rem 1.25rem",
                borderRadius: "0.75rem",
                border: "1px solid #111827",
                background: "#020617",
              }}
            >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <h2
                style={{
                  fontSize: "1rem",
                  fontWeight: 500,
                }}
              >
                My meetings
              </h2>

              <button
                type="button"
                onClick={handleCreateMeeting}
                disabled={createStatus === "creating"}
                style={{
                  padding: "0.25rem 0.7rem",
                  borderRadius: "999px",
                  border: "1px solid #374151",
                  background:
                    createStatus === "creating" ? "#4b5563" : "transparent",
                  color: "#e5e7eb",
                  fontSize: "0.8rem",
                  cursor:
                    createStatus === "creating" ? "default" : "pointer",
                }}
              >
                {createStatus === "creating" ? "Creating…" : "New meeting"}
              </button>
            </div>

              {createError && (
                <p
                  style={{
                    fontSize: "0.8rem",
                    color: "#fecaca",
                    background: "#450a0a",
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.5rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  Failed to create meeting: {createError}
                </p>
              )}


              {meetingsStatus === "loading" && (
                <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
                  Loading meetings…
                </p>
              )}

              {meetingsStatus === "error" && (
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#fecaca",
                    background: "#450a0a",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                  }}
                >
                  Failed to load meetings: {meetingsError}
                </p>
              )}

              {meetingsStatus === "ok" && meetings.length === 0 && (
                <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
                  You don’t have any meetings yet.
                </p>
              )}

              {meetingsStatus === "ok" && meetings.length > 0 && (
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: "0.5rem",
                  }}
                >
                  {meetings.map((m) => {
                    const id =
                      m.id ||
                      m.meeting_id ||
                      m.meetingId ||
                      m.uuid ||
                      "unknown-id";
                    const name =
                      m.title ||
                      m.name ||
                      m.topic ||
                      `Meeting ${id.slice(0, 8)}…`;
                    const created =
                      m.created_at || m.createdAt || m.created || null;

                    return (
                      <li
                        key={id}
                        style={{
                          padding: "0.6rem 0.75rem",
                          borderRadius: "0.5rem",
                          border: "1px solid #111827",
                          background: "#020617",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.25rem",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.95rem",
                            fontWeight: 500,
                            color: "#e5e7eb",
                          }}
                        >
                          {name}
                        </div>

                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#9ca3af",
                            display: "flex",
                            gap: "0.5rem",
                            flexWrap: "wrap",
                          }}
                        >
                          <span>
                            id: <code>{id}</code>
                          </span>
                          {created && (
                            <span>
                              created:{" "}
                              <code>
                                {String(created).replace("T", " ").slice(0, 19)}
                              </code>
                            </span>
                          )}
                        </div>

                        <div>
                          <button
                            type="button"
                            onClick={() => navigate(`/meetings/${id}`)}
                            style={{
                              marginTop: "0.15rem",
                              padding: "0.25rem 0.7rem",
                              borderRadius: "999px",
                              border: "1px solid #374151",
                              background: "transparent",
                              color: "#e5e7eb",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                            }}
                          >
                            View meeting →
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}


