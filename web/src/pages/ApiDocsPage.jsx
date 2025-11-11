import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import './ApiDocsPage.css';
import notablyLogo from '../assets/notably logo.png';

const ApiDocsPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [activeSection, setActiveSection] = useState('overview');
  const [showScrollTop, setShowScrollTop] = useState(false);

  const sections = [
    { id: 'overview', title: 'Overview', icon: '📋' },
    { id: 'auth', title: 'Authentication', icon: '🔐' },
    { id: 'models', title: 'Data Models', icon: '🗂️' },
    { id: 'endpoints', title: 'API Endpoints', icon: '🔗' },
    { id: 'errors', title: 'Error Handling', icon: '⚠️' },
    { id: 'examples', title: 'Examples', icon: '💡' },
    { id: 'openapi', title: 'OpenAPI Spec', icon: '📄' }
  ];

  // Scroll detection for scroll-to-top button
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      setShowScrollTop(scrollTop > 300);
      
      // Update active section based on scroll position
      const sections = ['overview', 'auth', 'models', 'endpoints', 'errors', 'examples', 'openapi'];
      const currentSection = sections.find(sectionId => {
        const element = document.getElementById(sectionId);
        if (element) {
          const rect = element.getBoundingClientRect();
          return rect.top <= 150 && rect.bottom > 150;
        }
        return false;
      });
      
      if (currentSection && currentSection !== activeSection) {
        setActiveSection(currentSection);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [activeSection]);

  const goToDashboard = () => {
    navigate('/dashboard');
  };

  const scrollToSection = (sectionId) => {
    setActiveSection(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="api-docs-container">
      {/* Top Bar */}
      <div className="top-bar"></div>
      
      {/* Header */}
      <div className="api-docs-header">
        <div className="logo-container">
          <img src={notablyLogo} alt="Notably" className="logo-icon" />
        </div>
        <button onClick={goToDashboard} className="back-to-dashboard-btn">
          ← Back to Dashboard
        </button>
      </div>

      <div className="api-docs-layout">
        {/* Sidebar Navigation */}
        <aside className="api-docs-sidebar">
          <nav className="sidebar-nav">
            {sections.map((section) => (
              <button
                key={section.id}
                className={`nav-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => scrollToSection(section.id)}
              >
                <span className="nav-icon">{section.icon}</span>
                <span className="nav-title">{section.title}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="api-docs-content">
          <div className="docs-header">
            <h1>Notably API Documentation</h1>
            <div className="version-badge">v1.0.0</div>
          </div>

          {/* Overview Section */}
          <section id="overview" className="docs-section">
            <h2>🚀 High-Level Overview</h2>
            <p className="section-intro">
              The Notably API accepts meeting uploads, runs background processing (transcription + summarization), 
              and exposes results. Heavy work is async via a queue/worker. Clients poll status or subscribe to events.
            </p>
            
            <div className="info-grid">
              <div className="info-card">
                <h3>Base URL (Development)</h3>
                <code>http://localhost:8000</code>
              </div>
              <div className="info-card">
                <h3>Authentication</h3>
                <code>Authorization: Bearer &lt;jwt&gt;</code>
              </div>
              <div className="info-card">
                <h3>Content Type</h3>
                <code>application/json</code>
              </div>
              <div className="info-card">
                <h3>API Version</h3>
                <code>/v1/...</code>
              </div>
            </div>

            <div className="workflow-section">
              <h3>Core Workflow (MVP)</h3>
              <ol className="workflow-steps">
                <li>
                  <strong>Upload:</strong> <code>POST /v1/uploads</code> — Client uploads audio/video (multipart)
                </li>
                <li>
                  <strong>Storage:</strong> API stores media in MinIO → creates upload record (status=queued)
                </li>
                <li>
                  <strong>Processing:</strong> Worker extracts audio → transcribes → summarizes → sets status=done
                </li>
                <li>
                  <strong>Retrieval:</strong> Client polls <code>GET /v1/uploads/{"{id}"}</code> and <code>GET /v1/uploads/{"{id}"}/result</code>
                </li>
              </ol>
            </div>

            <div className="limits-section">
              <h3>File Limits (Phase 1)</h3>
              <ul className="limits-list">
                <li><strong>Max size:</strong> 1 GB</li>
                <li><strong>Max duration:</strong> 60 minutes</li>
                <li><strong>Accepted formats:</strong> .mp3, .wav, .m4a, .mp4, .mov</li>
              </ul>
            </div>
          </section>

          {/* Authentication Section */}
          <section id="auth" className="docs-section">
            <h2>🔐 Authentication</h2>
            <p>
              All API endpoints require authentication via Supabase JWT tokens. Include the token in the 
              Authorization header of your requests.
            </p>
            
            <div className="code-block">
              <h4>Header Format</h4>
              <pre><code>{`Authorization: Bearer <your-jwt-token>`}</code></pre>
            </div>

            <div className="auth-info">
              <div className="auth-card">
                <h4>Development Mode</h4>
                <p>For local development, you can use the API key authentication:</p>
                <pre><code>X-Api-Key: your-dev-api-key</code></pre>
              </div>
              <div className="auth-card">
                <h4>Production</h4>
                <p>Production requires valid Supabase JWT tokens obtained through the authentication flow.</p>
              </div>
            </div>
          </section>

          {/* Data Models Section */}
          <section id="models" className="docs-section">
            <h2>🗂️ Data Models</h2>
            
            <div className="model-section">
              <h3>Upload Model</h3>
              <div className="code-block">
                <pre><code>{`{
  "id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "status": "queued",
  "original_filename": "team_meeting.mp3",
  "mime_type": "audio/mpeg",
  "object_key": "uploads/8f2a2a2e...mp3",
  "created_at": "2025-09-28T14:03:12Z",
  "error_message": null
}`}</code></pre>
              </div>
              <div className="field-descriptions">
                <h4>Field Descriptions</h4>
                <ul>
                  <li><strong>id:</strong> Unique identifier for the upload (UUID)</li>
                  <li><strong>status:</strong> Current processing status (queued, processing, done, error)</li>
                  <li><strong>original_filename:</strong> Original name of the uploaded file</li>
                  <li><strong>mime_type:</strong> MIME type of the uploaded file</li>
                  <li><strong>object_key:</strong> Storage key in MinIO</li>
                  <li><strong>created_at:</strong> Upload timestamp (ISO 8601)</li>
                  <li><strong>error_message:</strong> Error details if status is "error"</li>
                </ul>
              </div>
            </div>

            <div className="model-section">
              <h3>Transcript Model</h3>
              <div className="code-block">
                <pre><code>{`{
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
}`}</code></pre>
              </div>
            </div>

            <div className="model-section">
              <h3>Summary Model</h3>
              <div className="code-block">
                <pre><code>{`{
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
}`}</code></pre>
              </div>
            </div>
          </section>

          {/* API Endpoints Section */}
          <section id="endpoints" className="docs-section">
            <h2>🔗 API Endpoints</h2>
            
            <div className="endpoint-section">
              <div className="endpoint-header">
                <span className="method post">POST</span>
                <span className="endpoint-path">/v1/uploads</span>
              </div>
              <p>Upload a file for processing.</p>
              
              <h4>Headers</h4>
              <ul>
                <li><code>Authorization: Bearer &lt;token&gt;</code> (production)</li>
                <li><code>Content-Type: multipart/form-data</code></li>
              </ul>

              <h4>Body (multipart)</h4>
              <ul>
                <li><code>file</code>: the audio/video file (required)</li>
                <li><code>title</code>: string (optional)</li>
              </ul>

              <h4>Responses</h4>
              <div className="response-section">
                <div className="response-item">
                  <span className="status-code success">200 OK</span>
                  <div className="code-block small">
                    <pre><code>{`{
  "upload_id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "status": "queued",
  "object_key": "uploads/..."
}`}</code></pre>
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
                <span className="endpoint-path">/v1/uploads/{"{upload_id}"}</span>
              </div>
              <p>Fetch status and metadata for an upload.</p>
              
              <h4>Parameters</h4>
              <ul>
                <li><code>upload_id</code>: UUID of the upload (path parameter)</li>
              </ul>

              <h4>Responses</h4>
              <div className="response-section">
                <div className="response-item">
                  <span className="status-code success">200 OK</span>
                  <div className="code-block small">
                    <pre><code>{`{
  "id": "8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d",
  "status": "processing",
  "original_filename": "meeting.mp3",
  "mime_type": "audio/mpeg",
  "created_at": "2025-09-28T14:03:12Z"
}`}</code></pre>
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
                <span className="endpoint-path">/v1/uploads/{"{upload_id}"}/result</span>
              </div>
              <p>Return transcript and summary when ready.</p>
              
              <h4>Responses</h4>
              <div className="response-section">
                <div className="response-item">
                  <span className="status-code success">200 OK</span>
                  <div className="code-block small">
                    <pre><code>{`{
  "transcript": {
    "language": "en",
    "text": "...",
    "segments": [...]
  },
  "summary": {
    "bullets": [...],
    "action_items": [...]
  }
}`}</code></pre>
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
              
              <h4>Query Parameters</h4>
              <ul>
                <li><code>status</code>: Filter by status (queued, processing, done, error)</li>
                <li><code>limit</code>: Number of items to return (default: 20)</li>
                <li><code>before</code>: ISO timestamp for pagination</li>
              </ul>

              <h4>Response</h4>
              <div className="code-block">
                <pre><code>{`{
  "items": [
    {
      "id": "...",
      "status": "done",
      "created_at": "..."
    }
  ]
}`}</code></pre>
              </div>
            </div>
          </section>

          {/* Error Handling Section */}
          <section id="errors" className="docs-section">
            <h2>⚠️ Error Handling</h2>
            
            <div className="error-codes-section">
              <h3>HTTP Status Codes</h3>
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
              <h3>Error Response Format</h3>
              <div className="code-block">
                <pre><code>{`{
  "error": {
    "code": "TooLarge",
    "message": "Max 1GB exceeded"
  }
}`}</code></pre>
              </div>
            </div>
          </section>

          {/* Examples Section */}
          <section id="examples" className="docs-section">
            <h2>💡 Examples</h2>
            
            <div className="example-section">
              <h3>Upload a File</h3>
              <div className="code-block">
                <h4>cURL</h4>
                <pre><code>{`curl -X POST http://localhost:8000/v1/uploads \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -F "file=@meeting.mp3" \\
  -F "title=Sprint Planning Meeting"`}</code></pre>
              </div>
              
              <div className="code-block">
                <h4>JavaScript (Fetch)</h4>
                <pre><code>{`const formData = new FormData();
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
console.log('Upload ID:', result.upload_id);`}</code></pre>
              </div>
            </div>

            <div className="example-section">
              <h3>Check Upload Status</h3>
              <div className="code-block">
                <h4>cURL</h4>
                <pre><code>{`curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  http://localhost:8000/v1/uploads/8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d`}</code></pre>
              </div>
            </div>

            <div className="example-section">
              <h3>Get Results</h3>
              <div className="code-block">
                <h4>cURL</h4>
                <pre><code>{`curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  http://localhost:8000/v1/uploads/8f2a2a2e-8b35-4e25-9d5e-6f9b5f8a6e7d/result`}</code></pre>
              </div>
            </div>
          </section>

          {/* OpenAPI Section */}
          <section id="openapi" className="docs-section">
            <h2>📄 OpenAPI Specification</h2>
            
            <div className="openapi-info">
              <p>
                The complete OpenAPI specification is automatically generated by FastAPI and can be accessed 
                when the backend server is running locally.
              </p>
            </div>

            <div className="sequence-diagram">
              <h3>Sequence Diagram (Text Version)</h3>
              <div className="code-block">
                <pre><code>{`Client → API: POST /v1/uploads (file)
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
Client → API: GET /v1/uploads/{id}/result`}</code></pre>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <button 
          onClick={scrollToTop}
          className="scroll-to-top-btn"
          title="Scroll to top"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 15l-6-6-6 6"/>
          </svg>
        </button>
      )}
    </div>
  );
};

export default ApiDocsPage;