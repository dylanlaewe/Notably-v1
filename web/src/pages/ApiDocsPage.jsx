// web/src/pages/ApiDocsPage.jsx
import React, { useEffect, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import "./AppPage.css";
import "./ApiDocsPage.css";

const ApiDocsPage = () => {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const [showScrollTop, setShowScrollTop] = useState(false);

  const colors = {
    heroBg: isLight
      ? "radial-gradient(circle at top left, rgba(34,197,94,0.08) 0, #f9fafb 55%, #f9fafb 100%)"
      : "radial-gradient(circle at top left, rgba(34,197,94,0.2) 0, #020617 55%, #020617 100%)",
    heroBorder: isLight
      ? "1px solid rgba(148,163,184,0.6)"
      : "1px solid rgba(34,197,94,0.35)",
    heading: isLight ? "#0f172a" : "#f9fafb",
    muted: isLight ? "#6b7280" : "#9ca3af",
    chipBg: isLight ? "rgba(34,197,94,0.08)" : "rgba(15,23,42,0.85)",
    chipText: isLight ? "#166534" : "#bbf7d0",
  };

  // Scroll detection against the app-shell content area
  useEffect(() => {
    const container =
      document.querySelector(".app-shell-content") || window;

    const handleScroll = () => {
      const scrollTop =
        container === window
          ? window.pageYOffset || document.documentElement.scrollTop
          : container.scrollTop;

      setShowScrollTop(scrollTop > 300);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    const container =
      document.querySelector(".app-shell-content") || window;

    if (container === window) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      container.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="app-page" data-theme={theme}>
      <main
        className="api-docs-main"
        style={{
          flex: 1,
          padding: 0,
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
        }}
      >
        {/* Hero / header card */}
        <section
          style={{
            marginTop: "1.5rem",
            marginBottom: "1rem",
            padding: "1rem 1.25rem",
            borderRadius: "0.75rem",
            background: colors.heroBg,
            border: colors.heroBorder,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.8rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#bbf7d0",
                  marginBottom: "0.25rem",
                }}
              >
                API
              </div>
              <h1
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 600,
                  margin: 0,
                  color: colors.heading,
                }}
              >
                Notably API documentation
              </h1>
              <p
                style={{
                  fontSize: "0.85rem",
                  color: colors.muted,
                  marginTop: "0.3rem",
                  maxWidth: "40rem",
                }}
              >
                Upload meeting recordings, process them asynchronously, and
                fetch transcripts and summaries with timestamped citations.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "0.35rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.8rem",
                  padding: "0.15rem 0.55rem",
                  borderRadius: "999px",
                  border: "1px solid rgba(34,197,94,0.4)",
                  backgroundColor: colors.chipBg,
                  color: colors.chipText,
                }}
              >
                v1.0.0 · MVP
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  color: colors.muted,
                }}
              >
                Base URL: <code>http://localhost:8000</code>
              </span>
            </div>
          </div>
        </section>

        {/* Overview Section */}
        <section id="overview" className="docs-section">
          <h2>High-level overview</h2>
          <p className="section-intro">
            The Notably API accepts meeting uploads, runs background processing
            (transcription + summarization), and exposes results. Heavy work is
            async via a queue/worker. Clients poll status or subscribe to
            events.
          </p>

          <div className="info-grid">
            <div className="info-card">
              <h3>Base URL (development)</h3>
              <code>http://localhost:8000</code>
            </div>
            <div className="info-card">
              <h3>Authentication</h3>
              <code>Authorization: Bearer &lt;jwt&gt;</code>
            </div>
            <div className="info-card">
              <h3>Content type</h3>
              <code>application/json</code>
            </div>
            <div className="info-card">
              <h3>API version</h3>
              <code>/v1/...</code>
            </div>
          </div>

          <div className="workflow-section">
            <h3>Core workflow (MVP)</h3>
            <ol className="workflow-steps">
              <li>
                <strong>Upload:</strong>{" "}
                <code>POST /v1/uploads</code> — client uploads audio/video
                (multipart).
              </li>
              <li>
                <strong>Storage:</strong> API stores media in MinIO and creates
                an upload record (<code>status=queued</code>).
              </li>
              <li>
                <strong>Processing:</strong> worker extracts audio, transcribes,
                summarizes, and sets <code>status=done</code>.
              </li>
              <li>
                <strong>Retrieval:</strong> client polls{" "}
                <code>GET /v1/uploads/&lbrace;id&rbrace;</code> and{" "}
                <code>GET /v1/uploads/&lbrace;id&rbrace;/result</code>.
              </li>
            </ol>
          </div>

          <div className="limits-section">
            <h3>Upload behavior</h3>
            <ul className="limits-list">
              <li>
                <strong>Size cap:</strong> none enforced by the application
              </li>
              <li>
                <strong>Duration cap:</strong> none enforced by the application
              </li>
              <li>
                <strong>Accepted formats:</strong> .mp3, .wav, .m4a, .mp4, .mov
              </li>
              <li>
                <strong>Note:</strong> practical limits can still come from the
                browser, available memory, storage, or any proxy in front of the
                API.
              </li>
            </ul>
          </div>
        </section>

        {/* Authentication Section */}
        <section id="auth" className="docs-section">
          <h2>Authentication</h2>
          <p>
            All API endpoints require authentication via Supabase JWT tokens.
            Include the token in the <code>Authorization</code> header of your
            requests.
          </p>

          <div className="code-block">
            <h4>Header format</h4>
            <pre>
              <code>{`Authorization: Bearer <your-jwt-token>`}</code>
            </pre>
          </div>

          <div className="auth-info">
            <div className="auth-card">
              <h4>Development mode</h4>
              <p>For local development, you can use the API key authentication:</p>
              <pre>
                <code>{`X-Api-Key: your-dev-api-key`}</code>
              </pre>
            </div>
            <div className="auth-card">
              <h4>Production</h4>
              <p>
                Production requires valid Supabase JWT tokens obtained through
                the authentication flow.
              </p>
            </div>
          </div>
        </section>

        {/* Data Models Section */}
        <section id="models" className="docs-section">
          <h2>Data models</h2>

          <div className="model-section">
            <h3>Upload model</h3>
            <div className="code-block">
              <pre>
                <code>{`{
  "id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "status": "queued",
  "original_filename": "team_meeting.mp3",
  "mime_type": "audio/mpeg",
  "object_key": "uploads/8f2a2a2e...mp3",
  "created_at": "2025-09-28T14:03:12Z",
  "error_message": null
}`}</code>
              </pre>
            </div>
            <div className="field-descriptions">
              <h4>Field descriptions</h4>
              <ul>
                <li>
                  <strong>id:</strong> unique identifier for the upload (UUID)
                </li>
                <li>
                  <strong>status:</strong> current processing status (queued,
                  processing, done, error)
                </li>
                <li>
                  <strong>original_filename:</strong> original name of the
                  uploaded file
                </li>
                <li>
                  <strong>mime_type:</strong> MIME type of the uploaded file
                </li>
                <li>
                  <strong>object_key:</strong> storage key in MinIO
                </li>
                <li>
                  <strong>created_at:</strong> upload timestamp (ISO 8601)
                </li>
                <li>
                  <strong>error_message:</strong> error details if status is{" "}
                  <code>"error"</code>
                </li>
              </ul>
            </div>
          </div>

          <div className="model-section">
            <h3>Transcript model</h3>
            <div className="code-block">
              <pre>
                <code>{`{
  "upload_id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "language": "en",
  "text": "Full transcript text...",
  "segments": [
    {
      "start": 12.3,
      "end": 18.9,
      "text": "Let's start the sprint review."
    },
    {
      "start": 19.0,
      "end": 31.0,
      "text": "Action item for Rob..."
    }
  ],
  "created_at": "2025-09-28T14:07:22Z"
}`}</code>
              </pre>
            </div>
          </div>

          <div className="model-section">
            <h3>Summary model</h3>
            <div className="code-block">
              <pre>
                <code>{`{
  "upload_id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "bullets": [
    {
      "text": "Sprint scope agreed: features A, B, C.",
      "ts_refs": [{"start": 45.2, "end": 52.6}]
    }
  ],
  "action_items": [
    {
      "verb": "Prepare",
      "item": "API docs draft",
      "owner": "Dylan",
      "due": "2025-10-06",
      "ts_refs": [{"start": 312.0, "end": 320.5}]
    }
  ],
  "created_at": "2025-09-28T14:08:10Z"
}`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* API Endpoints Section */}
        <section id="endpoints" className="docs-section">
          <h2>API endpoints</h2>

          <div className="endpoint-section">
            <div className="endpoint-header">
              <span className="method post">POST</span>
              <span className="endpoint-path">/v1/uploads</span>
            </div>
            <p>Upload a file for processing.</p>

            <h4>Headers</h4>
            <ul>
              <li>
                <code>Authorization: Bearer &lt;token&gt;</code> (production)
              </li>
              <li>
                <code>Content-Type: multipart/form-data</code>
              </li>
            </ul>

            <h4>Body (multipart)</h4>
            <ul>
              <li>
                <code>file</code>: the audio/video file (required)
              </li>
              <li>
                <code>title</code>: string (optional)
              </li>
            </ul>

            <h4>Responses</h4>
            <div className="response-section">
              <div className="response-item">
                <span className="status-code success">200 OK</span>
                <div className="code-block small">
                  <pre>
                    <code>{`{
  "upload_id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "status": "queued",
  "object_key": "uploads/..."
}`}</code>
                  </pre>
                </div>
              </div>
              <div className="response-item">
                <span className="status-code error">400 Bad Request</span>
                <span>Empty file or over size/duration cap</span>
              </div>
              <div className="response-item">
                <span className="status-code error">502 Bad Gateway</span>
                <span>Storage transient error (MinIO)</span>
              </div>
            </div>
          </div>

          <div className="endpoint-section">
            <div className="endpoint-header">
              <span className="method get">GET</span>
              <span className="endpoint-path">
                /v1/uploads/&lbrace;upload_id&rbrace;
              </span>
            </div>
            <p>Fetch status and metadata for an upload.</p>

            <h4>Parameters</h4>
            <ul>
              <li>
                <code>upload_id</code>: UUID of the upload (path parameter)
              </li>
            </ul>

            <h4>Responses</h4>
            <div className="response-section">
              <div className="response-item">
                <span className="status-code success">200 OK</span>
                <div className="code-block small">
                  <pre>
                    <code>{`{
  "id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "status": "processing",
  "original_filename": "meeting.mp3",
  "mime_type": "audio/mpeg",
  "created_at": "2025-09-28T14:03:12Z"
}`}</code>
                  </pre>
                </div>
              </div>
              <div className="response-item">
                <span className="status-code error">404 Not Found</span>
                <span>Unknown upload ID</span>
              </div>
            </div>
          </div>

          <div className="endpoint-section">
            <div className="endpoint-header">
              <span className="method get">GET</span>
              <span className="endpoint-path">
                /v1/uploads/&lbrace;upload_id&rbrace;/result
              </span>
            </div>
            <p>Return transcript and summary when ready.</p>

            <h4>Responses</h4>
            <div className="response-section">
              <div className="response-item">
                <span className="status-code success">200 OK</span>
                <div className="code-block small">
                  <pre>
                    <code>{`{
  "transcript": {
    "language": "en",
    "text": "...",
    "segments": [...]
  },
  "summary": {
    "bullets": [...],
    "action_items": [...]
  }
}`}</code>
                  </pre>
                </div>
              </div>
              <div className="response-item">
                <span className="status-code pending">202 Accepted</span>
                <span>Still processing</span>
              </div>
              <div className="response-item">
                <span className="status-code error">409 Conflict</span>
                <span>Status not done</span>
              </div>
            </div>
          </div>

          <div className="endpoint-section">
            <div className="endpoint-header">
              <span className="method get">GET</span>
              <span className="endpoint-path">/v1/uploads</span>
            </div>
            <p>List uploads for the authenticated user.</p>

            <h4>Query parameters</h4>
            <ul>
              <li>
                <code>status</code>: filter by status (queued, processing, done,
                error)
              </li>
              <li>
                <code>limit</code>: number of items to return (default: 20)
              </li>
              <li>
                <code>before</code>: ISO timestamp for pagination
              </li>
            </ul>

            <h4>Response</h4>
            <div className="code-block">
              <pre>
                <code>{`{
  "items": [
    {
      "id": "...",
      "status": "done",
      "created_at": "..."
    }
  ]
}`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Error Handling Section */}
        <section id="errors" className="docs-section">
          <h2>Error handling</h2>

          <div className="error-codes-section">
            <h3>HTTP status codes</h3>
            <div className="status-grid">
              <div className="status-item success">
                <code>200</code>
                <span>Success with body</span>
              </div>
              <div className="status-item success">
                <code>201</code>
                <span>Created</span>
              </div>
              <div className="status-item pending">
                <code>202</code>
                <span>Accepted (queued)</span>
              </div>
              <div className="status-item error">
                <code>400</code>
                <span>Bad input</span>
              </div>
              <div className="status-item error">
                <code>401</code>
                <span>Unauthorized</span>
              </div>
              <div className="status-item error">
                <code>404</code>
                <span>Not found</span>
              </div>
              <div className="status-item error">
                <code>409</code>
                <span>Conflict</span>
              </div>
              <div className="status-item error">
                <code>422</code>
                <span>Validation error</span>
              </div>
              <div className="status-item error">
                <code>429</code>
                <span>Rate limited</span>
              </div>
              <div className="status-item error">
                <code>5xx</code>
                <span>Server errors</span>
              </div>
            </div>
          </div>

          <div className="error-format-section">
            <h3>Error response format</h3>
            <div className="code-block">
              <pre>
                <code>{`{
  "error": {
    "code": "UploadFailed",
    "message": "storage error"
  }
}`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Examples Section */}
        <section id="examples" className="docs-section">
          <h2>Examples</h2>

          <div className="example-section">
            <h3>Upload a file</h3>
            <div className="code-block">
              <h4>cURL</h4>
              <pre>
                <code>{`curl -X POST http://localhost:8000/v1/uploads \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -F "file=@meeting.mp3" \\
  -F "title=Sprint Planning Meeting"`}</code>
              </pre>
            </div>

            <div className="code-block">
              <h4>JavaScript (fetch)</h4>
              <pre>
                <code>{`const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('title', 'Sprint Planning Meeting');

const response = await fetch('http://localhost:8000/v1/uploads', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token
  },
  body: formData
});

const result = await response.json();
console.log('Upload ID:', result.upload_id);`}</code>
              </pre>
            </div>
          </div>

          <div className="example-section">
            <h3>Check upload status</h3>
            <div className="code-block">
              <h4>cURL</h4>
              <pre>
                <code>{`curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  http://localhost:8000/v1/uploads/8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d`}</code>
              </pre>
            </div>
          </div>

          <div className="example-section">
            <h3>Get results</h3>
            <div className="code-block">
              <h4>cURL</h4>
              <pre>
                <code>{`curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  http://localhost:8000/v1/uploads/8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d/result`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* OpenAPI Section */}
        <section id="openapi" className="docs-section">
          <h2>OpenAPI specification</h2>

          <div className="openapi-info">
            <p>
              The complete OpenAPI specification is automatically generated by
              FastAPI and can be accessed when the backend server is running
              locally.
            </p>
          </div>

          <div className="sequence-diagram">
            <h3>Sequence diagram (text version)</h3>
            <div className="code-block">
              <pre>
                <code>{`Client → API: POST /v1/uploads (file)
API → MinIO: put_object(file)
API → DB: INSERT upload(status=queued)
API → Queue: enqueue process_upload(upload_id)
Client ← API: {upload_id, status=queued}

Worker → MinIO: get_object(file)
Worker → WhisperAPI: transcribe(audio)
Worker → DB: INSERT transcript
Worker → GPT: summarize(transcript)
Worker → DB: INSERT summary; UPDATE upload(status=done)

Client → API: GET /v1/uploads/{id}
Client → API: GET /v1/uploads/{id}/result`}</code>
              </pre>
            </div>
          </div>
        </section>
      </main>

      {/* Scroll to top button */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="scroll-to-top-btn"
          title="Scroll to top"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 15l-6-6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ApiDocsPage;
