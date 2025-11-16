// web/src/pages/MeetingDetailPage.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { apiFetch, getApiBaseUrl } from "../lib/apiClient";
import { clearAccessToken } from "../lib/authToken";

export default function MeetingDetailPage() {
  const { meetingId } = useParams();
  const navigate = useNavigate();

  // Core state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [transcript, setTranscript] = useState(null); // { items: [...] } or null
  const [summary, setSummary] = useState(null);       // { bullets: [...] } or null

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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("idle"); // "idle" | "loading" | "ok" | "error"
  const [searchError, setSearchError] = useState(null);
  const [searchResults, setSearchResults] = useState([]);


    function handleDownloadPdf() {
    if (!meetingId) return;
    const base = getApiBaseUrl();
    const url = `${base}/v1/exports/pdf?meeting_id=${meetingId}`;
    window.open(url, "_blank");
  }

    function handleDownloadMarkdown() {
    if (!meetingId) return;
    const base = getApiBaseUrl();
    const url = `${base}/v1/exports/markdown?meeting_id=${meetingId}`;
    window.open(url, "_blank");
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

  // ---- PDF download ----
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
      const url =
        `/v1/search?mode=any&meeting_id=${encodeURIComponent(
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
  
  function handleDownloadPdf() {
    downloadExport("pdf");
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

        setTranscript(trJson);
        setSummary(sumJson);
        setActions(actJson || []);
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
            err instanceof Error
              ? err.message
              : "Failed to load actions"
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

  const idShort = meetingId ? String(meetingId).slice(0, 8) : "";

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
      {/* Header */}
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
            Meeting detail
          </div>
        </div>

        <Link
          to="/dashboard"
          style={{
            padding: "0.4rem 0.8rem",
            borderRadius: "999px",
            border: "1px solid #4b5563",
            background: "transparent",
            color: "#e5e7eb",
            fontSize: "0.85rem",
            textDecoration: "none",
          }}
        >
          ← Back to dashboard
        </Link>
      </header>

      {/* Main content */}
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
        {/* Heading */}
        <section
          style={{
            padding: "1rem 1.25rem",
            borderRadius: "0.75rem",
            background:
              "radial-gradient(circle at top left, #4f46e5 0, #020617 55%, #020617 100%)",
            border: "1px solid #1f2937",
          }}
        >
          <div
            style={{
              fontSize: "0.8rem",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#c7d2fe",
              marginBottom: "0.25rem",
            }}
          >
            Meeting
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 500 }}>
            {`Meeting ${idShort || ""}`}
          </div>
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "0.8rem",
              color: "#cbd5f5",
            }}
          >
            id: <code>{meetingId}</code>
          </div>
          
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
                border: "1px solid #4b5563",
                background: "transparent",
                color: "#e5e7eb",
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
                border: "1px solid #4b5563",
                background: "transparent",
                color: "#e5e7eb",
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
              border: "1px solid #7f1d1d",
              background: "#450a0a",
              color: "#fecaca",
              fontSize: "0.9rem",
            }}
          >
            <strong>Something went wrong loading this meeting.</strong>
            <div style={{ marginTop: "0.25rem" }}>{error}</div>
          </section>
        )}

        {/* Loading */}
        {loading && !error && (
          <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
            Loading transcript and summary…
          </p>
        )}

        {/* Summary */}
        {!loading && !error && (
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
                Summary
              </h2>

              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={pdfStatus === "downloading"}
                style={{
                  padding: "0.25rem 0.7rem",
                  borderRadius: "999px",
                  border: "1px solid #374151",
                  background:
                    pdfStatus === "downloading" ? "#4b5563" : "transparent",
                  color: "#e5e7eb",
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
                  color: "#fecaca",
                  background: "#450a0a",
                  padding: "0.35rem 0.5rem",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                Failed to download PDF: {pdfError}
              </p>
            )}

            {!summary && (
              <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
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
                  {summary.bullets.map((b) => (
                    <li key={b.id}>
                      <span>{b.text}</span>
                      {b.citations && b.citations.length > 0 && (
                        <span
                          style={{ fontSize: "0.75rem", color: "#9ca3af" }}
                        >
                          {" "}
                          · cites segment{" "}
                          {b.citations
                            .map((c) => c.segment_id)
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

            {summary &&
              (!summary.bullets || summary.bullets.length === 0) && (
                <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
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
                  background: "#020617",
                  color: "#e5e7eb",
                  borderRadius: "0.5rem",
                  border: "1px solid #374151",
                  padding: "0.4rem 0.5rem",
                }}
              />
              <button
                type="submit"
                disabled={searchStatus === "loading" || !searchQuery.trim()}
                style={{
                  padding: "0.35rem 0.9rem",
                  borderRadius: "999px",
                  border: "1px solid #374151",
                  background:
                    searchStatus === "loading" || !searchQuery.trim()
                      ? "#4b5563"
                      : "transparent",
                  color: "#e5e7eb",
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
                  color: "#fecaca",
                  background: "#450a0a",
                  padding: "0.4rem 0.6rem",
                  borderRadius: "0.5rem",
                  marginBottom: "0.5rem",
                }}
              >
                Failed to search: {searchError}
              </p>
            )}

            {searchStatus === "ok" && searchResults.length === 0 && searchQuery.trim() && (
              <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
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
                    key={`${hit.transcript_id || "t"}:${hit.segment_id || hit.id || Math.random()}`}
                    style={{
                      padding: "0.45rem 0.55rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #111827",
                      background: "#020617",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.15rem",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#9ca3af",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.5rem",
                      }}
                    >
                      <span>
                        seg #{hit.segment_id ?? "?"} ·{" "}
                        {hit.t_start != null ? `${hit.t_start.toFixed?.(2) ?? hit.t_start}s` : "0s"} →{" "}
                        {hit.t_end != null ? `${hit.t_end.toFixed?.(2) ?? hit.t_end}s` : "0s"}
                      </span>
                      {hit.filename && (
                        <span>
                          file: <code>{hit.filename}</code>
                        </span>
                      )}
                    </div>
                    <div>{hit.text || "(no text)"}</div>
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
              Transcript
            </h2>

            {!transcript && (
              <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
                No transcript found for this meeting yet.
              </p>
            )}

            {transcript &&
              transcript.items &&
              transcript.items.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.35rem",
                    fontSize: "0.9rem",
                    maxHeight: "360px",
                    overflowY: "auto",
                    paddingRight: "0.25rem",
                  }}
                >
                  {transcript.items.map((seg) => (
                    <div
                      key={seg.id}
                      style={{
                        padding: "0.45rem 0.55rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #111827",
                        background: "#020617",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.1rem",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#9ca3af",
                          display: "flex",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>
                          #{seg.id} ·{" "}
                          {seg.t_start_str ?? seg.t_start ?? 0}s →{" "}
                          {seg.t_end_str ?? seg.t_end ?? 0}s
                        </span>
                      </div>
                      <div>{seg.text}</div>
                    </div>
                  ))}
                </div>
              )}

            {transcript &&
              (!transcript.items || transcript.items.length === 0) && (
                <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
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
              <span style={{ color: "#e5e7eb" }}>New action</span>
              <input
                type="text"
                value={newActionText}
                onChange={(e) => setNewActionText(e.target.value)}
                placeholder="e.g. Send recap email to team"
                style={{
                  background: "#020617",
                  color: "#e5e7eb",
                  borderRadius: "0.5rem",
                  border: "1px solid #374151",
                  padding: "0.4rem 0.5rem",
                }}
              />
            </label>

            {newActionError && (
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#fecaca",
                  background: "#450a0a",
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
                border: "1px solid #374151",
                background:
                  newActionStatus === "creating" || !newActionText.trim()
                    ? "#4b5563"
                    : "transparent",
                color: "#e5e7eb",
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
            <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
              Loading actions…
            </p>
          )}

          {actionsStatus === "error" && (
            <p
              style={{
                fontSize: "0.85rem",
                color: "#fecaca",
                background: "#450a0a",
                padding: "0.4rem 0.6rem",
                borderRadius: "0.5rem",
              }}
            >
              Failed to load actions: {actionsError}
            </p>
          )}

          {actionsStatus === "ok" && actions.length === 0 && (
            <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
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
                    border: "1px solid #111827",
                    background: "#020617",
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
                      color: a.is_done ? "#6b7280" : "#e5e7eb",
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
                      border: "1px solid #374151",
                      background: a.is_done ? "#16a34a" : "transparent",
                      color: "#e5e7eb",
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

          {/* Debug: raw JSON so we can see backend shape */}
          {actionsStatus === "ok" && (
            <pre
              style={{
                marginTop: "0.75rem",
                fontSize: "0.7rem",
                color: "#9ca3af",
                background: "#020617",
                borderRadius: "0.5rem",
                padding: "0.5rem",
                border: "1px dashed #374151",
                overflowX: "auto",
              }}
            >
              Actions debug: {JSON.stringify(actions, null, 2)}
            </pre>
          )}
        </section>
      </main>
    </div>
  );
}

