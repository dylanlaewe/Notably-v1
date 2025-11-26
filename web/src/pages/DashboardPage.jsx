// web/src/pages/DashboardPage.jsx
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/apiClient";
import { clearAccessToken } from "../lib/authToken";
import { useTheme } from "../contexts/ThemeContext";
import "./AppPage.css";

export default function DashboardPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { theme } = useTheme();

  const isLight = theme === "light";

  const colors = {
    // containers
    cardBg: isLight ? "#f3f4f6" : "#020617", // light grey in light mode
    cardBorder: isLight ? "#e5e7eb" : "#111827",

    // hero "signed in" card
    heroBg: isLight
      ? "radial-gradient(circle at top left, rgba(34,197,94,0.08) 0, #f9fafb 55%, #f9fafb 100%)"
      : "radial-gradient(circle at top left, rgba(34,197,94,0.2) 0, #020617 55%, #020617 100%)",
    heroBorder: isLight
      ? "1px solid rgba(148,163,184,0.6)"
      : "1px solid rgba(34,197,94,0.35)",
    heroLabel: isLight ? "#166534" : "#bbf7d0",
    heroSub: isLight ? "#4b5563" : "#cbd5f5",

    // text
    text: isLight ? "#0f172a" : "#e5e7eb",
    muted: isLight ? "#6b7280" : "#9ca3af",

    // alerts / status
    dangerBg: isLight ? "#fee2e2" : "#450a0a",
    dangerText: isLight ? "#991b1b" : "#fecaca",
    okBg: isLight ? "#dcfce7" : "#064e3b",
    okText: isLight ? "#166534" : "#bbf7d0",

    // inputs
    inputText: isLight ? "#111827" : "#e5e7eb",

    // primary button (upload)
    primaryButtonBg: "linear-gradient(135deg, #22c55e, #16a34a)",
    primaryButtonText: "#e5e7eb",
    primaryButtonDisabledBg: isLight ? "#9ca3af" : "#4b5563",

    // pill buttons (New meeting, small buttons)
    pillBorder: isLight ? "#d1d5db" : "#374151",
    pillText: isLight ? "#111827" : "#e5e7eb",
    pillDisabledBg: isLight ? "#e5e7eb" : "#4b5563",

    // meeting list rows
    meetingRowBg: isLight ? "#ffffff" : "#020617",
    meetingRowHoverBg: isLight ? "#dcfce7" : "#064e3b",
    meetingRowBorder: isLight ? "#e5e7eb" : "#1f2937",
    meetingRowHoverBorder: "#10b981",

    // menu
    menuBg: isLight ? "#ffffff" : "#020617",
    menuBorder: isLight ? "#e5e7eb" : "#1f2937",
    menuItemHoverBg: isLight ? "#f3f4f6" : "#111827",
    menuDeleteText: isLight ? "#b91c1c" : "#f97373",

    // Drop zone
    dropBg: isLight ? "#ecfdf5" : "#022c22",
    dropBorder: isLight ? "#16a34a" : "#4ade80",
    dropActiveBg: isLight ? "#bbf7d0" : "#065f46",
    dropIcon: isLight ? "#16a34a" : "#4ade80",
    dropText: isLight ? "#065f46" : "#bbf7d0",
  };

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

  // Meeting deletion / renaming
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameError, setRenameError] = useState("");
  const [hoveredMeetingId, setHoveredMeetingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState("");

  // Modals
  const [renameModal, setRenameModal] = useState(null); // { id, currentName } or null
  const [renameModalValue, setRenameModalValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const [deleteModal, setDeleteModal] = useState(null); // { id, name } or null
  const [deleteSaving, setDeleteSaving] = useState(false);

  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const menuRef = useRef(null);

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
                const mid = u.meeting_id || u.meetingId || u.meeting || null;
                if (!mid) continue;
                const key = String(mid);
                if (!latestByMeeting.has(key)) {
                  latestByMeeting.set(key, u);
                }
              }

              enrichedItems = items.map((m) => {
                const mid =
                  m.id || m.meeting_id || m.meetingId || m.uuid || null;
                if (!mid) return m;

                const u = latestByMeeting.get(String(mid));
                if (!u) return m;

                return {
                  ...m,
                  latest_upload_filename:
                    u.filename || m.latest_upload_filename,
                  created_at:
                    m.created_at || m.createdAt || u.created_at || null,
                };
              });
            }
          } catch (e) {
            console.warn("optional /v1/uploads enrich failed:", e);
          }

          setMeetings(enrichedItems);
          setMeetingsStatus("ok");
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
            err instanceof Error
              ? err.message
              : "Failed to poll upload status"
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
  // Click outside 3-dot menu to close
  // ------------------------
  useEffect(() => {
    if (menuOpenId === null) return;

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpenId(null);
        setRenamingId(null);
        setRenameError("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpenId]);

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

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleStartRecording = async () => {
    setRecordingError("");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecordingError(
        "Recording is not supported in this browser. Try Chrome or Edge."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Stop mic
        stream.getTracks().forEach((track) => track.stop());
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setIsRecording(false);

        if (!recordingChunksRef.current.length) {
          setRecordingError("No audio captured. Try recording again.");
          return;
        }

        const blob = new Blob(recordingChunksRef.current, {
          type: "audio/webm",
        });

        const fileName = `notably-recording-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.webm`;

        const file = new File([blob], fileName, { type: "audio/webm" });

        // Reuse existing upload flow
        setUploadFile(file);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();

      setIsRecording(true);
      setRecordingSeconds(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error starting recording:", err);
      setRecordingError(
        "Unable to access microphone. Check permissions and try again."
      );
    }
  };

  const handleStopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  // ---------------
  // Modal actions
  // ---------------

  const handleConfirmRename = async () => {
    if (!renameModal) return;
    const trimmed = renameModalValue.trim();

    if (!trimmed) {
      setRenameError("Please enter a name.");
      return;
    }

    try {
      setRenameSaving(true);
      setRenameError("");

      const res = await apiFetch(`/v1/meetings/${renameModal.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmed }),
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
          if (String(mid) !== String(renameModal.id)) return m;
          return {
            ...m,
            name: trimmed,
          };
        })
      );

      setRenameModal(null);
    } catch (err) {
      console.error("Failed to rename meeting", err);
      setRenameError(
        err?.message || "Failed to rename meeting. Please try again."
      );
    } finally {
      setRenameSaving(false);
      setRenamingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal) return;

    try {
      setDeleteSaving(true);
      setDeleteError("");

      const resp = await apiFetch(`/v1/meetings/${deleteModal.id}`, {
        method: "DELETE",
      });

      if (!resp.ok && resp.status !== 204) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status} ${text}`);
      }

      // Optimistically remove from list
      setMeetings((prev) =>
        (prev || []).filter((m) => {
          const mid = m.id || m.meeting_id || m.meetingId || m.uuid;
          return String(mid) !== String(deleteModal.id);
        })
      );

      setDeleteModal(null);
    } catch (err) {
      console.error("Failed to delete meeting", err);
      setDeleteError(
        err?.message || "Failed to delete meeting. Please try again."
      );
    } finally {
      setDeleteSaving(false);
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
      setCreateError(err?.message || "Failed to create meeting");
      setCreateStatus("error");
    }
  }

  // ------------------------
  // Render
  // ------------------------
  return (
    <div className="app-page" data-theme={theme}>
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
          <p style={{ color: colors.muted }}>Checking your session…</p>
        )}

        {status === "error" && (
          <div
            style={{
              padding: "1rem",
              borderRadius: "0.75rem",
              background: colors.dangerBg,
              color: colors.dangerText,
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
                background: colors.heroBg,
                border: colors.heroBorder,
              }}
            >
              <div
                style={{
                  fontSize: "0.8rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: colors.heroLabel,
                  marginBottom: "0.25rem",
                }}
              >
                Signed in as
              </div>

              <div
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 500,
                  color: colors.text,
                }}
              >
                {user.email || "unknown"}
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: colors.heroSub,
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
                border: `1px solid ${colors.cardBorder}`,
                background: colors.cardBg,
              }}
            >
              <h2
                style={{
                  fontSize: "1rem",
                  marginBottom: "0.5rem",
                  fontWeight: 500,
                  color: "var(--section-heading, #16a34a)",
                }}
              >
                Uploads
              </h2>

              <p
                style={{
                  fontSize: "0.85rem",
                  color: colors.muted,
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
                    color: colors.dangerText,
                    background: colors.dangerBg,
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
                    color: colors.muted,
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
                {/* Drag-and-drop dropzone */}
                <label
                  onDragEnter={handleDragOver}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    gap: "0.5rem",
                    padding: "1.5rem 1.25rem",
                    borderRadius: "0.9rem",
                    border: `1px dashed ${
                      isDragOver
                        ? colors.meetingRowHoverBorder || colors.dropBorder
                        : colors.dropBorder
                    }`,
                    background: isDragOver
                      ? colors.dropActiveBg
                      : colors.dropBg,
                    boxShadow: isDragOver
                      ? "0 0 0 2px rgba(34,197,94,0.35), 0 10px 25px rgba(15,23,42,0.18)"
                      : "0 8px 20px rgba(15,23,42,0.06)",
                    cursor: "pointer",
                    transition:
                      "background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease",
                    transform: isDragOver ? "translateY(-1px)" : "translateY(0)",
                  }}
                >
                  {/* Hide the native file input but keep it clickable via the label */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,video/*"
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                  />

                  {/* Upload icon */}
                  <div
                    style={{
                      width: "2.5rem",
                      height: "2.5rem",
                      borderRadius: "999px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isLight ? "#dcfce7" : "#052e16",
                      color: colors.dropIcon,
                      marginBottom: "0.25rem",
                    }}
                  >
                    {/* Simple inline upload icon */}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 3L7 8H10V14H14V8H17L12 3Z"
                        fill="currentColor"
                      />
                      <path
                        d="M5 15C4.44772 15 4 15.4477 4 16V19C4 19.5523 4.44772 20 5 20H19C19.5523 20 20 19.5523 20 19V16C20 15.4477 19.5523 15 19 15H17V17H7V15H5Z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>

                  {/* Title */}
                  <div
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      color: colors.dropText,
                    }}
                  >
                    Drag &amp; drop a recording
                  </div>

                  {/* Subtitle / helper text */}
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: colors.muted,
                      maxWidth: "22rem",
                    }}
                  >
                    {uploadFile ? (
                      <>
                        Selected: <code>{uploadFile.name}</code>
                      </>
                    ) : (
                      <>
                        or click anywhere in this box to choose a file.
                        <br />
                        Max 60 minutes, up to 1&nbsp;GB. Audio or video (MP3,
                        MP4, MOV, WAV, etc.).
                      </>
                    )}
                  </div>
                </label>

                {/* Recording block */}
                <div
                  style={{
                    marginTop: "0.75rem",
                    padding: "0.75rem 1rem",
                    borderRadius: "0.75rem",
                    border: `1px solid ${colors.cardBorder}`,
                    background: isLight ? "#ffffff" : colors.cardBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.15rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 500,
                        color: colors.text,
                      }}
                    >
                      Or record directly in Notably
                    </span>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: colors.muted,
                      }}
                    >
                      {isRecording
                        ? `Recording… ${formatDuration(recordingSeconds)}`
                        : uploadFile &&
                          uploadFile.name &&
                          uploadFile.name.endsWith(".webm")
                        ? `Last recording: ${uploadFile.name}`
                        : "Use your microphone to capture a quick meeting or call."}
                    </span>
                    {recordingError && (
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: "#b91c1c",
                        }}
                      >
                        {recordingError}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={
                      isRecording ? handleStopRecording : handleStartRecording
                    }
                    style={{
                      border: "none",
                      outline: "none",
                      cursor: "pointer",
                      borderRadius: "999px",
                      padding: "0.4rem 0.9rem",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      backgroundColor: isRecording ? "#fee2e2" : "#16a34a",
                      color: isRecording ? "#b91c1c" : "#ecfdf3",
                      boxShadow: isRecording
                        ? "0 0 0 1px rgba(248,113,113,0.5)"
                        : "0 4px 10px rgba(22,163,74,0.35)",
                      transition:
                        "background-color 0.12s ease, box-shadow 0.12s ease, transform 0.08s ease",
                      transform: isRecording ? "translateY(0)" : "translateY(0)",
                    }}
                  >
                    <span
                      style={{
                        width: "0.6rem",
                        height: "0.6rem",
                        borderRadius: isRecording ? "0.2rem" : "999px",
                        backgroundColor: isRecording ? "#b91c1c" : "#bbf7d0",
                      }}
                    />
                    {isRecording ? "Stop recording" : "Record meeting"}
                  </button>
                </div>

                {uploadStatus === "error" && uploadError && (
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: colors.dangerText,
                      background: colors.dangerBg,
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
                      color: colors.okText,
                      background: colors.okBg,
                      padding: "0.4rem 0.6rem",
                      borderRadius: "0.5rem",
                    }}
                  >
                    Upload queued! id:{" "}
                    <code>{uploadInfo.upload_id || uploadInfo.id}</code>,
                    status: <code>{uploadInfo.status}</code>
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
                        ? colors.primaryButtonDisabledBg
                        : colors.primaryButtonBg,
                    color: colors.primaryButtonText,
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
                  border: `1px solid ${colors.cardBorder}`,
                  background: colors.cardBg,
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
                    color: colors.muted,
                    marginBottom: "0.25rem",
                  }}
                >
                  upload_id: <code>{lastUploadId}</code>
                </p>
                <p
                  style={{
                    fontSize: "0.9rem",
                    marginBottom: "0.25rem",
                    color: colors.text,
                  }}
                >
                  Status: <code>{lastUploadStatus || "(checking…)"}</code>
                </p>

                {lastUploadPollError && (
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: colors.dangerText,
                      background: colors.dangerBg,
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
                      color: colors.okText,
                      marginTop: "0.25rem",
                    }}
                  >
                    Background processing finished. Transcript & summary should
                    now exist for this meeting.
                  </p>
                )}

                {lastUploadStatus === "failed" && lastUploadDetail?.error && (
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: colors.dangerText,
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
                border: `1px solid ${colors.cardBorder}`,
                background: colors.cardBg,
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
                    color: "var(--section-heading, #16a34a)",
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
                        ? `1px solid ${colors.muted}`
                        : "1px solid #22c55e",
                    background:
                      createStatus === "creating"
                        ? colors.pillDisabledBg
                        : "transparent",
                    color: colors.pillText,
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
                    color: colors.dangerText,
                    background: colors.dangerBg,
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
                    color: colors.dangerText,
                    background: colors.dangerBg,
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.5rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  {deleteError}
                </p>
              )}

              {meetingsStatus === "loading" && (
                <p style={{ fontSize: "0.9rem", color: colors.muted }}>
                  Loading meetings…
                </p>
              )}

              {meetingsStatus === "error" && (
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: colors.dangerText,
                    background: colors.dangerBg,
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                  }}
                >
                  Failed to load meetings: {meetingsError}
                </p>
              )}

              {meetingsStatus === "ok" && meetings.length === 0 && (
                <p style={{ fontSize: "0.9rem", color: colors.muted }}>
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

                    const rawFilename =
                      m.latest_upload_filename ||
                      m.filename ||
                      m.file_name ||
                      m.fileName ||
                      null;

                    const filenameLabel = rawFilename
                      ? rawFilename.replace(/\.[^/.]+$/, "")
                      : null;

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
                          background: isHovered
                            ? colors.meetingRowHoverBg
                            : colors.meetingRowBg,
                          border: `1px solid ${
                            isHovered
                              ? colors.meetingRowHoverBorder
                              : colors.meetingRowBorder
                          }`,
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
                              color: colors.text,
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
                                e.stopPropagation(); // don’t trigger row click / navigation
                                setMenuOpenId((current) =>
                                  current === id ? null : id
                                );
                                setRenamingId(null);
                                setRenameError("");
                              }}
                              aria-label="Meeting options"
                              style={{
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                margin: 0,
                                cursor: "pointer",
                                color: colors.muted,
                                fontSize: "1.05rem",
                                lineHeight: 1,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = colors.text;
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = colors.muted;
                              }}
                            >
                              <span style={{ transform: "translateY(-1px)" }}>
                                ⋮
                              </span>
                            </button>

                            {menuOpenId === id && (
                              <div
                                ref={menuRef}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  top: "120%",
                                  background: colors.menuBg,
                                  border: `1px solid ${colors.menuBorder}`,
                                  borderRadius: "0.5rem",
                                  boxShadow:
                                    "0 10px 30px rgba(0,0,0,0.4)",
                                  padding: "0.25rem 0",
                                  zIndex: 50,
                                  display: "inline-block",
                                  minWidth: "160px",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpenId(null);
                                    setRenameError("");
                                    setDeleteError("");
                                    setRenameModal({
                                      id,
                                      currentName:
                                        m.name ||
                                        m.title ||
                                        "Untitled meeting",
                                    });
                                    setRenameModalValue(
                                      m.name || m.title || ""
                                    );
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "0.45rem 0.9rem",
                                    textAlign: "left",
                                    fontSize: "0.85rem",
                                    background: "transparent",
                                    border: "none",
                                    color: colors.text,
                                    cursor: "pointer",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = colors.menuItemHoverBg;
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "transparent";
                                  }}
                                >
                                  Rename meeting
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpenId(null);
                                    setRenameError("");
                                    setDeleteError("");
                                    setDeleteModal({
                                      id,
                                      name:
                                        m.name ||
                                        m.title ||
                                        "this meeting",
                                    });
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "0.45rem 0.9rem",
                                    textAlign: "left",
                                    fontSize: "0.85rem",
                                    background: "transparent",
                                    border: "none",
                                    color: colors.menuDeleteText,
                                    cursor: "pointer",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = colors.menuItemHoverBg;
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "transparent";
                                  }}
                                >
                                  Delete meeting
                                </button>

                              </div>
                            )}
                          </div>
                        </div>

                        {/* Metadata row */}
                        <div
                          style={{
                            fontSize: "0.8rem",
                            color: colors.muted,
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

            {/* Rename modal */}
            {renameModal && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(15,23,42,0.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 100,
                }}
                onClick={() => {
                  if (!renameSaving) {
                    setRenameModal(null);
                    setRenameError("");
                  }
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "100%",
                    maxWidth: "420px",
                    background: colors.cardBg,
                    borderRadius: "0.9rem",
                    border: `1px solid ${colors.cardBorder}`,
                    boxShadow: "0 24px 60px rgba(15,23,42,0.45)",
                    padding: "1.25rem 1.5rem",
                  }}
                >
                  <h2
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      marginBottom: "0.75rem",
                      color: colors.text,
                    }}
                  >
                    Rename meeting
                  </h2>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: colors.muted,
                      marginBottom: "0.75rem",
                    }}
                  >
                    Update the title for{" "}
                    <strong>
                      {renameModal.currentName || "this meeting"}
                    </strong>
                    .
                  </p>

                  <input
                    autoFocus
                    value={renameModalValue}
                    onChange={(e) => {
                      setRenameModalValue(e.target.value);
                      setRenameError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleConfirmRename();
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "0.45rem 0.6rem",
                      borderRadius: "0.5rem",
                      border: `1px solid ${
                        renameError ? "#fca5a5" : colors.cardBorder
                      }`,
                      fontSize: "0.9rem",
                      marginBottom: "0.5rem",
                      background: isLight ? "#ffffff" : "#020617",
                      color: colors.text,
                    }}
                  />

                  {renameError && (
                    <div
                      style={{
                        fontSize: "0.78rem",
                        color: "#f97373",
                        marginBottom: "0.5rem",
                      }}
                    >
                      {renameError}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "0.5rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!renameSaving) {
                          setRenameModal(null);
                          setRenameError("");
                        }
                      }}
                      style={{
                        padding: "0.4rem 0.85rem",
                        fontSize: "0.85rem",
                        borderRadius: "999px",
                        border: `1px solid ${colors.cardBorder}`,
                        background: "transparent",
                        color: colors.text,
                        cursor: renameSaving ? "default" : "pointer",
                      }}
                      disabled={renameSaving}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmRename}
                      style={{
                        padding: "0.4rem 0.95rem",
                        fontSize: "0.85rem",
                        borderRadius: "999px",
                        border: "none",
                        backgroundColor: "#16a34a",
                        color: "#ecfdf5",
                        cursor: renameSaving ? "default" : "pointer",
                        opacity: renameSaving ? 0.8 : 1,
                      }}
                      disabled={renameSaving}
                    >
                      {renameSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Delete modal */}
            {deleteModal && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(15,23,42,0.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 100,
                }}
                onClick={() => {
                  if (!deleteSaving) {
                    setDeleteModal(null);
                  }
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "100%",
                    maxWidth: "420px",
                    background: colors.cardBg,
                    borderRadius: "0.9rem",
                    border: `1px solid ${colors.cardBorder}`,
                    boxShadow: "0 24px 60px rgba(15,23,42,0.45)",
                    padding: "1.25rem 1.5rem",
                  }}
                >
                  <h2
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      marginBottom: "0.75rem",
                      color: colors.text,
                    }}
                  >
                    Delete meeting
                  </h2>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: colors.muted,
                      marginBottom: "0.75rem",
                    }}
                  >
                    Are you sure you want to delete{" "}
                    <strong>{deleteModal.name || "this meeting"}</strong>? This
                    will permanently remove its transcript, summary, and action
                    items.
                  </p>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "0.5rem",
                      marginTop: "0.25rem",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!deleteSaving) {
                          setDeleteModal(null);
                        }
                      }}
                      style={{
                        padding: "0.4rem 0.85rem",
                        fontSize: "0.85rem",
                        borderRadius: "999px",
                        border: `1px solid ${colors.cardBorder}`,
                        background: "transparent",
                        color: colors.text,
                        cursor: deleteSaving ? "default" : "pointer",
                      }}
                      disabled={deleteSaving}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDelete}
                      style={{
                        padding: "0.4rem 0.95rem",
                        fontSize: "0.85rem",
                        borderRadius: "999px",
                        border: "none",
                        backgroundColor: "#dc2626",
                        color: "#fef2f2",
                        cursor: deleteSaving ? "default" : "pointer",
                        opacity: deleteSaving ? 0.85 : 1,
                      }}
                      disabled={deleteSaving}
                    >
                      {deleteSaving ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

