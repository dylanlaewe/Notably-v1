// web/src/pages/MeetingDetailPage.jsx
import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch, getApiBaseUrl } from "../lib/apiClient";
import { clearAccessToken } from "../lib/authToken";
import { useTheme } from "../contexts/ThemeContext";
import "./AppPage.css";

export default function MeetingDetailPage() {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const isLight = theme === "light";

  const colors = {
    // card containers
    cardBg: isLight ? "#ffffff" : "#020617",
    cardBorder: isLight ? "#e5e7eb" : "#111827",

    // softer header-ish card
    heroBg: isLight
      ? "radial-gradient(circle at top left, rgba(34,197,94,0.08) 0, #f9fafb 55%, #f9fafb 100%)"
      : "radial-gradient(circle at top left, rgba(34,197,94,0.2) 0, #020617 55%, #020617 100%)",
    heroBorder: isLight
      ? "1px solid rgba(148,163,184,0.6)"
      : "1px solid rgba(34,197,94,0.35)",

    // text
    muted: isLight ? "#6b7280" : "#9ca3af",

    // error/message colors
    errorBg: isLight ? "#fee2e2" : "#450a0a",
    errorText: isLight ? "#b91c1c" : "#fecaca",

    // inputs / borders
    inputBg: isLight ? "#f9fafb" : "#020617",
    inputBorder: isLight ? "#d1d5db" : "#374151",
    inputText: isLight ? "#111827" : "#e5e7eb",

    // small chips / helper text
    chipText: isLight ? "#065f46" : "#a7f3d0",
  };

  // Core state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [transcript, setTranscript] = useState(null); // { items: [...] } or null
  const [summary, setSummary] = useState(null); // { bullets: [...] } or null

  // Audio / meeting name
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioStatus, setAudioStatus] = useState("idle"); // "idle" | "loading" | "ready" | "error"
  const [audioError, setAudioError] = useState("");
  const [audioFilename, setAudioFilename] = useState("");
  const [meetingName, setMeetingName] = useState("");
  const [isVideo, setIsVideo] = useState(false);
  

  // Actions state
  const [actions, setActions] = useState([]);
  const [actionsStatus, setActionsStatus] = useState("idle"); // "idle" | "loading" | "ok" | "error"
  const [actionsError, setActionsError] = useState(null);

  const [newActionText, setNewActionText] = useState("");
  const [newActionStatus, setNewActionStatus] = useState("idle"); // "idle" | "creating"
  const [newActionError, setNewActionError] = useState(null);

  // PDF export state
  const [pdfStatus, setPdfStatus] = useState("idle"); // "idle" | "downloading" | "error"
  const [pdfError, setPdfError] = useState(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("idle"); // "idle" | "loading" | "ok" | "error"
  const [searchError, setSearchError] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [segmentMetaById, setSegmentMetaById] = useState({});
  const [activeSegmentId, setActiveSegmentId] = useState(null);
  const audioRef = useRef(null);

  // Simple “open in new tab” functions (not used in UI anymore but kept just in case)
  function handleDownloadPdfTab() {
    if (!meetingId) return;
    const base = getApiBaseUrl();
    const url = `${base}/v1/exports/pdf?meeting_id=${meetingId}`;
    window.open(url, "_blank");
  }

  function handleDownloadMarkdownTab() {
    if (!meetingId) return;
    const base = getApiBaseUrl();
    const url = `${base}/v1/exports/markdown?meeting_id=${meetingId}`;
    window.open(url, "_blank");
  }

  function highlightText(text, query) {
    if (!text) return "";
    const q = (query || "").trim();
    if (!q) return text;

    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();

    const parts = [];
    let idx = 0;
    let key = 0;

    while (true) {
      const matchIndex = lower.indexOf(qLower, idx);
      if (matchIndex === -1) {
        parts.push(text.slice(idx));
        break;
      }

      if (matchIndex > idx) {
        parts.push(text.slice(idx, matchIndex));
      }

      const matchText = text.slice(matchIndex, matchIndex + q.length);
      parts.push(
        <mark
          key={`h-${key++}`}
          style={{
            backgroundColor: isLight
              ? "rgba(34,197,94,0.2)"
              : "rgba(34,197,94,0.35)",
            color: isLight ? "#065f46" : "#f9fafb",
            padding: "0 0.05em",
            borderRadius: "0.15rem",
          }}
        >
          {matchText}
        </mark>
      );

      idx = matchIndex + q.length;
    }

    return parts;
  }

  function handleJumpToSegment(segmentIdRaw) {
    if (!segmentIdRaw) return;

    const segmentId = String(segmentIdRaw);
    setActiveSegmentId(segmentId);

    // Scroll transcript into view
    const el = document.getElementById(`seg-${segmentId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Nudge audio to that time if we know it
    const meta = segmentMetaById[segmentId];
    if (meta && typeof meta.startSeconds === "number" && audioRef.current) {
      try {
        audioRef.current.currentTime = meta.startSeconds;
        audioRef.current.play().catch(() => {});
      } catch {
        // ignore autoplay errors
      }
    }
  }

  // ---- Actions: create ----
  async function handleCreateAction(e) {
    e.preventDefault();
    if (!newActionText.trim()) return;

    setNewActionStatus("creating");
    setNewActionError(null);

    try {
      const resp = await apiFetch(`/v1/meetings/${meetingId}/actions`, {
        method: "POST",
        body: JSON.stringify({
          text: newActionText.trim(),
          priority: 2,
          citations: [], // can wire real segment IDs later
        }),
      });

      if (resp.status === 401) {
        clearAccessToken();
        navigate("/login", { replace: true });
        return;
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status} ${text}`);
      }

      const created = await resp.json();
      setActions((prev) => [created, ...(prev || [])]);
      setNewActionText("");
      setNewActionStatus("idle");
    } catch (err) {
      console.error("Failed to create action", err);
      setNewActionError(
        err instanceof Error ? err.message : "Failed to create action"
      );
      setNewActionStatus("idle");
    }
  }

  // ---- Actions: toggle done ----
  async function handleToggleActionDone(action) {
    const nextDone = !action.is_done;

    try {
      const resp = await apiFetch(`/v1/actions/${action.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_done: nextDone }),
      });

      if (resp.status === 401) {
        clearAccessToken();
        navigate("/login", { replace: true });
        return;
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status} ${text}`);
      }

      const updated = await resp.json();
      setActions((prev) =>
        (prev || []).map((a) => (a.id === updated.id ? updated : a))
      );
    } catch (err) {
      console.error("Failed to toggle action done", err);
      setActionsError(
        err instanceof Error ? err.message : "Failed to update action"
      );
      setActionsStatus("error");
    }
  }

  // ---- Robust downloads via apiFetch ----
  async function handleDownloadPdf() {
    setPdfStatus("downloading");
    setPdfError(null);

    try {
      const resp = await apiFetch(
        `/v1/exports/pdf?meeting_id=${encodeURIComponent(meetingId)}`
      );

      if (resp.status === 401) {
        clearAccessToken();
        navigate("/login", { replace: true });
        return;
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `meeting-${meetingId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
      setPdfStatus("idle");
    } catch (err) {
      console.error("Failed to download PDF", err);
      setPdfError(
        err instanceof Error ? err.message : "Failed to download PDF"
      );
      setPdfStatus("error");
    }
  }

  async function handleSearchSubmit(e) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setSearchStatus("loading");
    setSearchError(null);
    setSearchResults([]);

    try {
      const url = `/v1/search?mode=any&meeting_id=${encodeURIComponent(
        meetingId
      )}&q=${encodeURIComponent(q)}`;

      const resp = await apiFetch(url);

      if (resp.status === 401) {
        clearAccessToken();
        navigate("/login", { replace: true });
        return;
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const data = await resp.json();

      // Backend can return either:
      //  - list[SearchHit]
      //  - { total, items: [SearchHit] }
      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data && Array.isArray(data.items)) {
        items = data.items;
      }

      setSearchResults(items);
      setSearchStatus("ok");
    } catch (err) {
      console.error("Search failed", err);
      setSearchError(
        err instanceof Error ? err.message : "Failed to search this meeting"
      );
      setSearchStatus("error");
    }
  }

  async function downloadExport(kind) {
    if (!meetingId) return;

    const ext = kind === "pdf" ? "pdf" : "md";
    const path =
      kind === "pdf"
        ? `/v1/exports/pdf?meeting_id=${meetingId}`
        : `/v1/exports/markdown?meeting_id=${meetingId}`;

    try {
      // Use apiFetch so Authorization: Bearer <token> is attached
      const resp = await apiFetch(path, { method: "GET" });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`Failed to download ${ext}:`, resp.status, text);
        alert(`Failed to download ${ext} (HTTP ${resp.status}).`);
        return;
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `meeting-${meetingId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(`Error downloading ${ext}`, err);
      alert(`Error downloading ${ext}: ${err?.message || err}`);
    }
  }

  function handleDownloadMarkdown() {
    downloadExport("md");
  }

  // ---- Initial load: transcript, summary, actions ----
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setTranscript(null);
      setSummary(null);
      setActionsStatus("loading");
      setActionsError(null);

      try {
        const [trRes, sumRes, actRes] = await Promise.all([
          apiFetch(`/v1/meetings/${meetingId}/transcript?limit=500`),
          apiFetch(`/v1/meetings/${meetingId}/summary`),
          apiFetch(`/v1/meetings/${meetingId}/actions`),
        ]);

        // Any 401 → force re-login
        for (const res of [trRes, sumRes, actRes]) {
          if (res.status === 401) {
            clearAccessToken();
            if (!cancelled) {
              navigate("/login", { replace: true });
            }
            return;
          }
        }

        // Transcript
        let trJson = null;
        if (trRes.ok) {
          trJson = await trRes.json();
        } else if (trRes.status !== 404) {
          let detail = "";
          try {
            const body = await trRes.json();
            detail = body.detail || JSON.stringify(body);
          } catch {
            // ignore
          }
          throw new Error(detail || `Transcript HTTP ${trRes.status}`);
        }

        // Summary
        let sumJson = null;
        if (sumRes.ok) {
          sumJson = await sumRes.json();
        } else if (sumRes.status !== 404) {
          let detail = "";
          try {
            const body = await sumRes.json();
            detail = body.detail || JSON.stringify(body);
          } catch {
            // ignore
          }
          throw new Error(detail || `Summary HTTP ${sumRes.status}`);
        }

        // Actions
        let actJson = [];
        if (actRes.ok) {
          actJson = await actRes.json();
        } else if (actRes.status === 404) {
          actJson = [];
        } else {
          const text = await actRes.text();
          throw new Error(text || `Actions HTTP ${actRes.status}`);
        }

        if (cancelled) return;

        const actItems = Array.isArray(actJson)
          ? actJson
          : Array.isArray(actJson.items)
          ? actJson.items
          : [];

        setTranscript(trJson);
        setSummary(sumJson);
        setActions(actItems);
        setActionsStatus("ok");
      } catch (err) {
        console.error("Failed to load meeting detail:", err);
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load meeting transcript/summary"
          );
          setActionsStatus("error");
          setActionsError(
            err instanceof Error ? err.message : "Failed to load actions"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [meetingId, navigate]);

  // ---- Load latest audio for this meeting ----
  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;

    async function loadAudio() {
      setAudioStatus("loading");
      setAudioError("");
      setAudioUrl(null);
      setAudioFilename("");

      try {
        // 1) Get latest upload for this meeting
        const listUrl = `/v1/uploads?meeting_id=${encodeURIComponent(
          meetingId
        )}&limit=1`;

        const listRes = await apiFetch(listUrl);

        if (listRes.status === 401) {
          clearAccessToken();
          if (!cancelled) {
            navigate("/login", { replace: true });
          }
          return;
        }

        if (!listRes.ok) {
          const text = await listRes.text();
          throw new Error(text || `Uploads HTTP ${listRes.status}`);
        }

        const uploadsJson = await listRes.json();
        if (cancelled) return;

        const uploads = Array.isArray(uploadsJson) ? uploadsJson : [];
        if (uploads.length === 0) {
          setAudioStatus("idle");
          return;
        }

        const upload = uploads[0]; // newest-first

        // Decide if this is video or audio based on MIME type
        const mime = upload.mime_type || "";
        const isVideoFile = mime.startsWith("video/");
        setIsVideo(isVideoFile);

        // For video: use original file (e.g. .mov) for <video>
        // For audio: use the 16kHz WAV variant so Safari can play it
        const kind = isVideoFile ? "original" : "audio16k";

        // 2) Get a presigned download URL
        const dlUrl = `/v1/uploads/${encodeURIComponent(
          upload.id
        )}/download?kind=${kind}&ttl=3600&filename=${encodeURIComponent(
          upload.filename || (isVideoFile ? "video" : "audio")
        )}`;


        const dlRes = await apiFetch(dlUrl);

        if (dlRes.status === 401) {
          clearAccessToken();
          if (!cancelled) {
            navigate("/login", { replace: true });
          }
          return;
        }

        if (!dlRes.ok) {
          const text = await dlRes.text();
          throw new Error(text || `Download HTTP ${dlRes.status}`);
        }

        const dlJson = await dlRes.json();
        if (cancelled) return;

        const url = dlJson?.url;
        if (!url) {
          throw new Error("Missing presigned URL");
        }

        const rawFilename = upload.filename || "";
        const baseName = rawFilename
          ? rawFilename.replace(/\.[^/.]+$/, "")
          : "";

        setAudioUrl(url);
        setAudioFilename(rawFilename);
        if (baseName) {
          setMeetingName(baseName);
        }
        setAudioStatus("ready");
      } catch (err) {
        console.error("Failed to load audio URL", err);
        if (cancelled) return;
        setAudioStatus("error");
        setAudioError(
          err instanceof Error ? err.message : "Failed to load audio"
        );
      }
    }

    loadAudio();
    return () => {
      cancelled = true;
    };
  }, [meetingId, navigate]);

  useEffect(() => {
    if (!transcript || !Array.isArray(transcript.items)) {
      setSegmentMetaById({});
      return;
    }

    const meta = {};

    const formatTime = (sec) => {
      if (sec == null || isNaN(sec)) return "0:00";
      const total = Math.max(0, Math.floor(sec));
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      const mm = String(mins).padStart(1, "0");
      const ss = String(secs).padStart(2, "0");
      return `${mm}:${ss}`;
    };

    transcript.items.forEach((seg, index) => {
      const key = String(seg.id);

      const rawStart =
        seg.t_start_seconds ?? seg.t_start ?? seg.start ?? 0;
      const rawEnd =
        seg.t_end_seconds ?? seg.t_end ?? seg.end ?? rawStart;

      const startSeconds =
        typeof rawStart === "number" ? rawStart : parseFloat(rawStart) || 0;

      const endSeconds =
        typeof rawEnd === "number"
          ? rawEnd
          : parseFloat(rawEnd) || startSeconds;

      meta[key] = {
        index,
        startLabel: formatTime(startSeconds),
        endLabel: formatTime(endSeconds),
        startSeconds,
        endSeconds,
      };
    });

    setSegmentMetaById(meta);
  }, [transcript]);

  const idShort = meetingId ? String(meetingId).slice(0, 8) : "";
  const displayMeetingName =
    meetingName || (idShort ? `Meeting ${idShort}` : "Meeting");

  return (
    <div className="app-page" data-theme={theme}>
      {/* Main content */}
      <main
        style={{
          flex: 1,
          padding: "0",
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
          display: "grid",
          gap: "1rem",
        }}
      >
        {/* Heading */}
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
              color: "#bbf7d0",
              marginBottom: "0.25rem",
            }}
          >
            Meeting
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 500 }}>
            {displayMeetingName}
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "0.8rem",
              color: colors.muted,
            }}
          >
            id: <code>{meetingId}</code>
          </div>

          {/* Audio player */}
          {audioStatus === "ready" && audioUrl && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.5rem",
                borderRadius: "0.75rem",
                background: colors.cardBg,
                border: `1px solid ${colors.cardBorder}`,
              }}
            >
              <div
                style={{
                  fontSize: "0.75rem",
                  color: colors.muted,
                  marginBottom: "0.25rem",
                }}
              >
                Recording{audioFilename ? ` · ${audioFilename}` : ""}
              </div>

              {isVideo ? (
                <video
                  controls
                  src={audioUrl}
                  style={{ width: "100%", borderRadius: "0.5rem", maxHeight: "420px" }}
                />
              ) : (
                <audio
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  style={{ width: "100%" }}
                />
              )}
            </div>
          )}

          {audioStatus === "loading" && (
            <div
              style={{
                marginTop: "0.75rem",
                fontSize: "0.8rem",
                color: colors.muted,
              }}
            >
              Loading recording…
            </div>
          )}
          {audioStatus === "error" && audioError && (
            <div
              style={{
                marginTop: "0.75rem",
                fontSize: "0.75rem",
                color: colors.errorText,
              }}
            >
              Couldn&apos;t load recording: {audioError}
            </div>
          )}

          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handleDownloadPdf}
              style={{
                padding: "0.3rem 0.8rem",
                borderRadius: "999px",
                border: `1px solid ${colors.inputBorder}`,
                background: "transparent",
                color: colors.inputText,
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              style={{
                padding: "0.3rem 0.8rem",
                borderRadius: "999px",
                border: `1px solid ${colors.inputBorder}`,
                background: "transparent",
                color: colors.inputText,
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Export .md
            </button>
          </div>
        </section>

        {/* Error */}
        {error && (
          <section
            style={{
              padding: "1rem 1.25rem",
              borderRadius: "0.75rem",
              border: `1px solid ${
                isLight ? "#fecaca" : "rgba(127,29,29,1)"
              }`,
              background: colors.errorBg,
              color: colors.errorText,
              fontSize: "0.9rem",
            }}
          >
            <strong>Something went wrong loading this meeting.</strong>
            <div style={{ marginTop: "0.25rem" }}>{error}</div>
          </section>
        )}

        {/* Loading */}
        {loading && !error && (
          <p style={{ fontSize: "0.9rem", color: colors.muted }}>
            Loading transcript and summary…
          </p>
        )}

        {/* Summary */}
        {!loading && !error && (
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
                Summary
              </h2>

              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={pdfStatus === "downloading"}
                style={{
                  padding: "0.25rem 0.7rem",
                  borderRadius: "999px",
                  border: `1px solid ${colors.inputBorder}`,
                  background:
                    pdfStatus === "downloading"
                      ? isLight
                        ? "#e5e7eb"
                        : "#4b5563"
                      : "transparent",
                  color: colors.inputText,
                  fontSize: "0.8rem",
                  cursor:
                    pdfStatus === "downloading" ? "default" : "pointer",
                }}
              >
                {pdfStatus === "downloading" ? "Downloading…" : "Download PDF"}
              </button>
            </div>

            {pdfError && (
              <p
                style={{
                  fontSize: "0.8rem",
                  color: colors.errorText,
                  background: colors.errorBg,
                  padding: "0.35rem 0.5rem",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                Failed to download PDF: {pdfError}
              </p>
            )}

            {!summary && (
              <p style={{ fontSize: "0.9rem", color: colors.muted }}>
                No summary found for this meeting yet.
              </p>
            )}

            {summary &&
              Array.isArray(summary.bullets) &&
              summary.bullets.length > 0 && (
                <ul
                  style={{
                    listStyle: "disc",
                    paddingLeft: "1.25rem",
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem",
                    fontSize: "0.9rem",
                  }}
                >
                  {summary.bullets.map((b) => {
                    const hasSingleSegment =
                      transcript &&
                      Array.isArray(transcript.items) &&
                      transcript.items.length === 1;

                    const citations = Array.isArray(b.citations)
                      ? b.citations
                      : [];

                    // Pick the first citation that we can map to a segment
                    let primaryMeta = null;
                    let primarySegmentId = null;

                    for (const c of citations) {
                      const key = String(c.segment_id);
                      const meta = segmentMetaById[key];
                      if (meta) {
                        primaryMeta = meta;
                        primarySegmentId = key; // already string
                        break;
                      }
                    }

                    let citationLabel = "";
                    if (primaryMeta) {
                      if (hasSingleSegment) {
                        citationLabel = `full recording (${primaryMeta.startLabel} → ${primaryMeta.endLabel})`;
                      } else {
                        const indexLabel = primaryMeta.index + 1; // human 1-based
                        citationLabel = `Segment ${indexLabel} (${primaryMeta.startLabel} → ${primaryMeta.endLabel})`;
                      }
                    }
                    return (
                      <li key={b.id}>
                        <span>{b.text}</span>
                        {primaryMeta && primarySegmentId && (
                          <button
                            type="button"
                            onClick={() =>
                              handleJumpToSegment(primarySegmentId)
                            }
                            style={{
                              marginLeft: "0.35rem",
                              border: "none",
                              background: "transparent",
                              padding: "0.1rem 0.35rem",
                              borderRadius: "999px",
                              fontSize: "0.75rem",
                              color: colors.chipText,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.15rem",
                            }}
                          >
                            <span
                              style={{
                                width: "0.45rem",
                                height: "0.45rem",
                                borderRadius: "999px",
                                backgroundColor: "#10b981",
                              }}
                            />
                            <span>cites {citationLabel}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

            {summary &&
              (!summary.bullets || summary.bullets.length === 0) && (
                <p style={{ fontSize: "0.9rem", color: colors.muted }}>
                  Summary is present, but contains no bullets.
                </p>
              )}
          </section>
        )}

        {/* Search within this meeting */}
        {!loading && !error && (
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
              Search this meeting
            </h2>

            <form
              onSubmit={handleSearchSubmit}
              style={{
                display: "flex",
                gap: "0.5rem",
                marginBottom: "0.75rem",
                fontSize: "0.9rem",
                flexWrap: "wrap",
              }}
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search transcript (e.g. upload, action, name)…"
                style={{
                  flex: "1 1 220px",
                  minWidth: "0",
                  background: colors.inputBg,
                  color: colors.inputText,
                  borderRadius: "0.5rem",
                  border: `1px solid ${colors.inputBorder}`,
                  padding: "0.4rem 0.5rem",
                }}
              />
              <button
                type="submit"
                disabled={searchStatus === "loading" || !searchQuery.trim()}
                style={{
                  padding: "0.35rem 0.9rem",
                  borderRadius: "999px",
                  border: `1px solid ${colors.inputBorder}`,
                  background:
                    searchStatus === "loading" || !searchQuery.trim()
                      ? isLight
                        ? "#e5e7eb"
                        : "#4b5563"
                      : "transparent",
                  color: colors.inputText,
                  fontSize: "0.85rem",
                  cursor:
                    searchStatus === "loading" || !searchQuery.trim()
                      ? "default"
                      : "pointer",
                }}
              >
                {searchStatus === "loading" ? "Searching…" : "Search"}
              </button>
            </form>

            {searchStatus === "error" && searchError && (
              <p
                style={{
                  fontSize: "0.85rem",
                  color: colors.errorText,
                  background: colors.errorBg,
                  padding: "0.4rem 0.6rem",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                Failed to search: {searchError}
              </p>
            )}

            {searchStatus === "ok" &&
              searchResults.length === 0 &&
              searchQuery.trim() && (
                <p style={{ fontSize: "0.9rem", color: colors.muted }}>
                  No matches for “{searchQuery.trim()}”.
                </p>
              )}

            {searchStatus === "ok" && searchResults.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                  fontSize: "0.9rem",
                  maxHeight: "260px",
                  overflowY: "auto",
                }}
              >
                {searchResults.map((hit) => (
                  <li
                    key={`${hit.transcript_id || "t"}:${
                      hit.segment_id || hit.id || Math.random()
                    }`}
                    style={{
                      padding: "0.45rem 0.55rem",
                      borderRadius: "0.5rem",
                      border: `1px solid ${colors.cardBorder}`,
                      background: colors.cardBg,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.15rem",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: colors.muted,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.5rem",
                      }}
                    >
                      <span>
                        seg #{hit.segment_id ?? "?"} ·{" "}
                        {hit.t_start != null
                          ? `${hit.t_start.toFixed?.(2) ?? hit.t_start}s`
                          : "0s"}{" "}
                        →{" "}
                        {hit.t_end != null
                          ? `${hit.t_end.toFixed?.(2) ?? hit.t_end}s`
                          : "0s"}
                      </span>
                      {hit.filename && (
                        <span>
                          file: <code>{hit.filename}</code>
                        </span>
                      )}
                    </div>
                    <div>
                      {hit.text
                        ? highlightText(hit.text, searchQuery)
                        : "(no text)"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Transcript */}
        {!loading && !error && (
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
              Transcript
            </h2>

            {!transcript && (
              <p style={{ fontSize: "0.9rem", color: colors.muted }}>
                No transcript found for this meeting yet.
              </p>
            )}

            {transcript &&
              Array.isArray(transcript.items) &&
              transcript.items.length > 0 && (
                <div
                  style={{
                    marginTop: "0.75rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.45rem",
                  }}
                >
                  {transcript.items.map((seg) => {
                    const metaKey = String(seg.id);
                    const meta = segmentMetaById[metaKey];
                    const isActive = activeSegmentId === metaKey;

                    const startLabel = meta ? meta.startLabel : "0:00";
                    const endLabel = meta ? meta.endLabel : "0:00";
                    const numberLabel = meta ? meta.index + 1 : seg.id;

                    return (
                      <div
                        key={seg.id}
                        id={`seg-${metaKey}`}
                        style={{
                          padding: "0.45rem 0.55rem",
                          borderRadius: "0.5rem",
                          border: isActive
                            ? "1px solid #10b981"
                            : `1px solid ${colors.cardBorder}`,
                          background: isActive
                            ? isLight
                              ? "rgba(34,197,94,0.12)"
                              : "rgba(16,185,129,0.08)"
                            : colors.cardBg,
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.1rem",
                          boxShadow: isActive
                            ? "0 0 0 1px rgba(16,185,129,0.35)"
                            : "none",
                          transition:
                            "background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: colors.muted,
                            display: "flex",
                            gap: "0.5rem",
                            flexWrap: "wrap",
                          }}
                        >
                          <span>
                            Segment {numberLabel} · {startLabel} → {endLabel}
                          </span>
                        </div>
                        <div>{seg.text}</div>
                      </div>
                    );
                  })}
                </div>
              )}

            {transcript &&
              (!transcript.items || transcript.items.length === 0) && (
                <p style={{ fontSize: "0.9rem", color: colors.muted }}>
                  Transcript exists, but contains no segments.
                </p>
              )}
          </section>
        )}

        {/* Action items */}
        <section
          style={{
            marginTop: "0.5rem",
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
            Action items
          </h2>

          {/* New action form */}
          <form
            onSubmit={handleCreateAction}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
              marginBottom: "0.75rem",
              fontSize: "0.9rem",
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span style={{ color: colors.inputText }}>New action</span>
              <input
                type="text"
                value={newActionText}
                onChange={(e) => setNewActionText(e.target.value)}
                placeholder="e.g. Send recap email to team"
                style={{
                  background: colors.inputBg,
                  color: colors.inputText,
                  borderRadius: "0.5rem",
                  border: `1px solid ${colors.inputBorder}`,
                  padding: "0.4rem 0.5rem",
                }}
              />
            </label>

            {newActionError && (
              <p
                style={{
                  fontSize: "0.8rem",
                  color: colors.errorText,
                  background: colors.errorBg,
                  padding: "0.35rem 0.5rem",
                  borderRadius: "0.5rem",
                }}
              >
                Failed to create action: {newActionError}
              </p>
            )}

            <button
              type="submit"
              disabled={
                newActionStatus === "creating" || !newActionText.trim()
              }
              style={{
                alignSelf: "flex-start",
                padding: "0.3rem 0.8rem",
                borderRadius: "999px",
                border: `1px solid ${colors.inputBorder}`,
                background:
                  newActionStatus === "creating" || !newActionText.trim()
                    ? isLight
                      ? "#e5e7eb"
                      : "#4b5563"
                    : "transparent",
                color: colors.inputText,
                fontSize: "0.8rem",
                cursor:
                  newActionStatus === "creating" || !newActionText.trim()
                    ? "default"
                    : "pointer",
              }}
            >
              {newActionStatus === "creating" ? "Adding…" : "Add action"}
            </button>
          </form>

          {/* Load/error states + list */}
          {actionsStatus === "loading" && (
            <p style={{ fontSize: "0.9rem", color: colors.muted }}>
              Loading actions…
            </p>
          )}

          {actionsStatus === "error" && (
            <p
              style={{
                fontSize: "0.85rem",
                color: colors.errorText,
                background: colors.errorBg,
                padding: "0.4rem 0.6rem",
                borderRadius: "0.5rem",
              }}
            >
              Failed to load actions: {actionsError}
            </p>
          )}

          {actionsStatus === "ok" && actions.length === 0 && (
            <p style={{ fontSize: "0.9rem", color: colors.muted }}>
              No action items yet for this meeting.
            </p>
          )}

          {actionsStatus === "ok" && actions.length > 0 && (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: "0.4rem",
              }}
            >
              {actions.map((a) => (
                <li
                  key={a.id}
                  style={{
                    padding: "0.4rem 0.6rem",
                    borderRadius: "0.5rem",
                    border: `1px solid ${colors.cardBorder}`,
                    background: colors.cardBg,
                    fontSize: "0.9rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      textDecoration: a.is_done ? "line-through" : "none",
                      color: a.is_done ? colors.muted : colors.inputText,
                    }}
                  >
                    {a.text || "(no text)"}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleToggleActionDone(a)}
                    style={{
                      padding: "0.2rem 0.6rem",
                      borderRadius: "999px",
                      border: `1px solid ${colors.inputBorder}`,
                      background: a.is_done
                        ? "#16a34a"
                        : isLight
                        ? "#f9fafb"
                        : "transparent",
                      color: a.is_done ? "#f9fafb" : colors.inputText,
                      fontSize: "0.75rem",
                      cursor: "pointer",
                    }}
                  >
                    {a.is_done ? "✓ Done" : "Mark done"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}


