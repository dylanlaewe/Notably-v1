// web/src/pages/DashboardPage.jsx
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/apiClient";
import { clearAccessToken } from "../lib/authToken";

export default function DashboardPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);


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
  const [isDragOver, setIsDragOver] = useState(false);

  // Latest upload status (for polling)
  const [lastUploadId, setLastUploadId] = useState(null);
  const [lastUploadStatus, setLastUploadStatus] = useState(null); // queued | processing | done | failed
  const [lastUploadDetail, setLastUploadDetail] = useState(null);
  const [lastUploadPollError, setLastUploadPollError] = useState("");

  // Meeting deletion
  const [deleteError, setDeleteError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Meeting renaming
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameError, setRenameError] = useState("");
  const [hoveredMeetingId, setHoveredMeetingId] = useState(null);




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

          // Try to enrich each meeting with its latest upload filename via /v1/uploads
          let enrichedItems = items;
          try {
            const uRes = await apiFetch("/v1/uploads?limit=500");
            if (uRes.ok) {
              const uploadBody = await uRes.json();
              const uploads = Array.isArray(uploadBody) ? uploadBody : [];

              // /v1/uploads is ordered by Upload.created_at DESC → first per meeting is latest
              const latestByMeeting = new Map();
              for (const u of uploads) {
                const mid =
                  u.meeting_id ||
                  u.meetingId ||
                  u.meeting ||
                  null;
                if (!mid) continue;
                const key = String(mid);
                if (!latestByMeeting.has(key)) {
                  latestByMeeting.set(key, u);
                }
              }

              enrichedItems = items.map((m) => {
                const mid =
                  m.id ||
                  m.meeting_id ||
                  m.meetingId ||
                  m.uuid ||
                  null;
                if (!mid) return m;

                const u = latestByMeeting.get(String(mid));
                if (!u) return m;

                return {
                  ...m,
                  latest_upload_filename:
                    u.filename || m.latest_upload_filename,
                  created_at:
                    m.created_at ||
                    m.createdAt ||
                    u.created_at ||
                    null,
                };
              });
            }
          } catch (e) {
            console.warn("optional /v1/uploads enrich failed:", e);
          }

          setMeetings(enrichedItems);
          setMeetingsStatus("ok");

          // Default the uploadMeetingId to first meeting (use enrichedItems)

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

  const handleGoToSettings = () => {
    navigate("/settings");
  };


const handleDrop = (e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragOver(false);

  const dt = e.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) return;

  const file = dt.files[0];
  if (!file) return;

  setUploadFile(file);
  setUploadStatus("idle");
  setUploadError("");
};

const handleDragOver = (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!isDragOver) {
    setIsDragOver(true);
  }
};

const handleDragLeave = (e) => {
  e.preventDefault();
  e.stopPropagation();
  setIsDragOver(false);
};

const handleFileChange = (e) => {
  const files = e.target?.files;
  const file = files && files.length > 0 ? files[0] : null;

  if (file) {
    setUploadFile(file);
    setUploadStatus("idle");
    setUploadError("");
  } else {
    setUploadFile(null);
  }
};

const handleOpenMeeting = (id) => {
    if (!id) return;
    navigate(`/meetings/${id}`);
  };


const handleUpload = async (e) => {
    e.preventDefault();

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

    try {
      // 🔹 ALWAYS create a fresh meeting for this upload
      const createResp = await apiFetch("/v1/meetings", {
        method: "POST",
      });

      if (createResp.status === 401) {
        clearAccessToken();
        navigate("/login", { replace: true });
        return;
      }

      if (!createResp.ok) {
        const text = await createResp.text();
        throw new Error(
          `Create meeting failed: ${createResp.status} ${text}`
        );
      }

      const data = await createResp.json();
      const newId =
        data.id || data.meeting_id || data.meetingId || data.uuid;

      if (!newId) {
        throw new Error("Server did not return a meeting id");
      }

      const newMeetingId = String(newId);

      // 🔹 Optimistically add the new meeting at the TOP of the list
      setMeetings((prev) => {
        const prevList = prev || [];
        const exists = prevList.some((m) => {
          const mid =
            m.id || m.meeting_id || m.meetingId || m.uuid || "";
          return String(mid) === newMeetingId;
        });
        if (exists) return prevList;

        return [
          {
            ...(data || {}),
            id: newId,
          },
          ...prevList,
        ];
      });

      // 🔹 Now upload the file and attach it to this new meeting
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("meeting_id", newMeetingId);

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

      // 🔹 Update the filename shown on that new meeting row
      if (body.filename) {
        const key = newMeetingId;
        setMeetings((prev) =>
          (prev || []).map((m) => {
            const mid =
              m.id || m.meeting_id || m.meetingId || m.uuid || "";
            if (String(mid) !== key) return m;
            return {
              ...m,
              latest_upload_filename:
                body.filename || m.latest_upload_filename,
            };
          })
        );
      }
    } catch (err) {
      console.error("upload failed:", err);
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload file"
      );
      setUploadStatus("error");
    }
};



  async function handleDeleteMeeting(id, label) {
  if (!id) return;

  const ok = window.confirm(
    `Delete this meeting?\n\n${label || id}\n\nThis cannot be undone.`
  );
  if (!ok) return;

  try {
    setDeleteError(null);
    setDeletingId(id);

    const resp = await apiFetch(`/v1/meetings/${id}`, {
      method: "DELETE",
    });

    if (!resp.ok && resp.status !== 204) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status} ${text}`);
    }

    // Optimistically remove from list
    setMeetings((prev) => (prev || []).filter((m) => {
      const mid = m.id || m.meeting_id || m.meetingId || m.uuid;
      return String(mid) !== String(id);
    }));
  } catch (err) {
    console.error("Failed to delete meeting", err);
    setDeleteError(
      err?.message || "Failed to delete meeting. Please try again."
    );
  } finally {
    setDeletingId(null);
  }
}

  async function handleRenameMeeting(id, currentLabel) {
    if (!id) return;

    const initial = currentLabel || "";
    const next = window.prompt("Rename meeting", initial);

    // User hit cancel
    if (next === null) return;

    const trimmed = next.trim();

    // Allow clearing the name (falls back to filename in UI)
    // If you want to forbid empty, uncomment this:
    // if (!trimmed) return;

    try {
      setRenameError("");
      setRenamingId(id);

      const res = await apiFetch(`/v1/meetings/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmed || null }),
      });

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

      // Optimistically update in local state
      setMeetings((prev) =>
        (prev || []).map((m) => {
          const mid =
            m.id || m.meeting_id || m.meetingId || m.uuid || "";
          if (String(mid) !== String(id)) return m;
          return {
            ...m,
            name: trimmed || null,
          };
        })
      );
    } catch (err) {
      console.error("Failed to rename meeting", err);
      setRenameError(
        err?.message || "Failed to rename meeting. Please try again."
      );
    } finally {
      setRenamingId(null);
      setMenuOpenId(null);
    }
  }


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
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <main
        style={{
          flex: 1,
          padding: "0",
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
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
                  "radial-gradient(circle at top left, rgba(34,197,94,0.2) 0, #020617 55%, #020617 100%)",
                border: "1px solid rgba(34,197,94,0.35)",
              }}
            >


              <div
                style={{
                  fontSize: "0.8rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#bbf7d0", // was #bfdbfe
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
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "#9ca3af",
                  marginTop: "0.25rem",
                }}
              >
                Drop a recording and we&apos;ll process it. If you don&apos;t
                pick a meeting, we&apos;ll make a new one for you.
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
                  You don&apos;t have any meetings yet. Upload a recording and
                  we&apos;ll create your first meeting automatically.
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

              {/* Simple file input */}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                }}
              >
                <span style={{ color: "#e5e7eb" }}>Recording</span>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  onChange={handleFileChange}
                  style={{
                    fontSize: "0.85rem",
                    color: "#e5e7eb",
                  }}
                />
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "#9ca3af",
                  }}
                >
                  {uploadFile ? (
                    <>
                      Selected: <code>{uploadFile.name}</code>
                    </>
                  ) : (
                    "Max 60 minutes, up to 1 GB. Audio or video is fine."
                  )}
                </div>
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
                      uploadStatus === "uploading"
                        ? "#4b5563"
                        : "linear-gradient(135deg, #22c55e, #16a34a)",

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
                  border:
                    createStatus === "creating"
                      ? "1px solid #4b5563"
                      : "1px solid #22c55e",
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

              {deleteError && (
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
                  {deleteError}
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

                    const created =
                      m.created_at || m.createdAt || m.created || null;

                    // Prefer the latest upload filename as the base label
                    const rawFilename =
                      m.latest_upload_filename ||
                      m.filename ||
                      m.file_name ||
                      m.fileName ||
                      null;

                    const filenameLabel = rawFilename
                      ? rawFilename.replace(/\.[^/.]+$/, "") // strip extension
                      : null;

                    // Final title:
                    // 1) explicit meeting name (renamed)
                    // 2) base filename
                    // 3) other text fallbacks
                    const displayTitle =
                      (m.name && m.name.trim()) ||
                      filenameLabel ||
                      m.title ||
                      m.topic ||
                      `Meeting ${id.slice(0, 8)}…`;

                    const isHovered = hoveredMeetingId === id;

                    return (
                      <li
                        key={id}
                        onClick={() => handleOpenMeeting(id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleOpenMeeting(id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        onMouseEnter={() => setHoveredMeetingId(id)}
                        onMouseLeave={() => setHoveredMeetingId(null)}
                        style={{
                          listStyle: "none",
                          background: isHovered ? "#064e3b" : "#020617",
                          border: `1px solid ${isHovered ? "#10b981" : "#1f2937"}`,
                          borderRadius: "0.75rem",
                          padding: "0.75rem 0.85rem",
                          marginBottom: "0.75rem",
                          cursor: "pointer",
                          boxShadow: isHovered
                            ? "0 0 0 1px rgba(16, 185, 129, 0.35)"
                            : "none",
                          transform: isHovered ? "translateY(-1px)" : "none",
                          transition:
                            "background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, transform 0.06s ease",
                        }}
                      >
                        {/* Header row: title + 3-dot menu */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "0.5rem",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.95rem",
                              fontWeight: 500,
                              color: "#e5e7eb",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={displayTitle}
                          >
                            {displayTitle}
                          </div>

                          {/* 3-dot menu */}
                          <div style={{ position: "relative" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation(); // don't trigger card click
                                setMenuOpenId((prev) => (prev === id ? null : id));
                              }}
                              aria-label="Meeting options"
                              style={{
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                margin: 0,
                                cursor: "pointer",
                                color: "#9ca3af",
                                fontSize: "1.05rem",
                                lineHeight: 1,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "#e5e7eb";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = "#9ca3af";
                              }}
                            >
                              <span style={{ transform: "translateY(-1px)" }}>⋮</span>
                            </button>

                            {menuOpenId === id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  top: "120%",
                                  background: "#020617",
                                  border: "1px solid #1f2937",
                                  borderRadius: "0.5rem",
                                  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
                                  padding: "0.25rem 0",
                                  zIndex: 20,
                                  display: "inline-block",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRenameMeeting(id, displayTitle)
                                  }
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "0.35rem 0.85rem",
                                    border: "none",
                                    background: "transparent",
                                    color: "#e5e7eb",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                    transition:
                                      "background 0.08s ease, transform 0.06s ease",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "#111827";
                                    e.currentTarget.style.transform =
                                      "translateY(-0.5px)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "transparent";
                                    e.currentTarget.style.transform =
                                      "translateY(0)";
                                  }}
                                >
                                  {renamingId === id ? "Renaming…" : "Rename"}
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteMeeting(id, displayTitle)
                                  }
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "0.35rem 0.85rem",
                                    border: "none",
                                    background: "transparent",
                                    color: "#f97373",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                    transition:
                                      "background 0.08s ease, transform 0.06s ease",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "#111827";
                                    e.currentTarget.style.transform =
                                      "translateY(-0.5px)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "transparent";
                                    e.currentTarget.style.transform =
                                      "translateY(0)";
                                  }}
                                >
                                  {deletingId === id ? "Deleting…" : "Delete"}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Metadata row */}
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: "#9ca3af",
                            display: "flex",
                            gap: "0.5rem",
                            flexWrap: "wrap",
                            marginTop: "0.35rem",
                          }}
                        >
                          {rawFilename && (
                            <span>
                              file: <code>{rawFilename}</code>
                            </span>
                          )}
                          <span>
                            id: <code>{id}</code>
                          </span>
                          {created && (
                            <span>
                              created:{" "}
                              <code>
                                {String(created)
                                  .replace("T", " ")
                                  .slice(0, 19)}
                              </code>
                            </span>
                          )}
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
              
