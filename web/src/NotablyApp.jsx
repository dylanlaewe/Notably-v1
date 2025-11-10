import React, { useEffect, useMemo, useRef, useState } from "react";

// Notably React UI with design matching the reference mockups
// - Dark theme with #00FF88 accent color
// - Sidebar navigation
// - Card-based layout
// - Upload functionality with visual feedback
// - Meeting management and transcript viewing

function uuidv4() {
  // Simple uuid v4 for client side meeting IDs
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
}

async function apiFetch(baseUrl, path, { apiKey, method = 'GET', headers = {}, body, responseType = 'json' } = {}) {
  const url = baseUrl.replace(/\/$/, '') + path;
  const h = new Headers(headers);
  if (apiKey && !h.has('X-Api-Key')) h.set('X-Api-Key', apiKey);
  const res = await fetch(url, { method, headers: h, body });
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail || JSON.stringify(j); } catch {}
    throw new Error(`${res.status} ${detail}`);
  }
  if (responseType === 'blob') return await res.blob();
  if (responseType === 'text') return await res.text();
  return await res.json();
}

export default function NotablyApp() {
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8000');
  const [apiKey, setApiKey] = useState(''); // optional

  const [meetingId, setMeetingId] = useState(uuidv4());
  const [meetings, setMeetings] = useState([]);
  const [selectedMeeting, setSelectedMeeting] = useState('');

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  const [summary, setSummary] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [actions, setActions] = useState([]);

  const [actionText, setActionText] = useState('');
  const [actionPriority, setActionPriority] = useState(2);

  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchTotal, setSearchTotal] = useState(0);

  // UI state
  const [currentView, setCurrentView] = useState('home');
  const [showSettings, setShowSettings] = useState(false);

  const cfg = useMemo(() => ({ baseUrl, apiKey }), [baseUrl, apiKey]);

  async function refreshMeetings() {
    try {
      const items = await apiFetch(cfg.baseUrl, '/v1/meetings', { apiKey: cfg.apiKey });
      setMeetings(Array.isArray(items) ? items : (items.items || []));
    } catch (e) {
      console.error('list meetings failed', e);
    }
  }

  useEffect(() => { refreshMeetings(); }, []);

  async function handleUpload() {
    if (!file) return alert('Pick an audio file first');
    setUploading(true); setUploadStatus('starting…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('meeting_id', meetingId);
      const up = await apiFetch(cfg.baseUrl, '/v1/uploads', { apiKey: cfg.apiKey, method: 'POST', body: fd });
      const uploadId = up.upload_id || up.id;
      setUploadStatus(`queued: ${uploadId}`);
      // poll
      const t0 = Date.now();
      while (true) {
        const info = await apiFetch(cfg.baseUrl, `/v1/uploads/${uploadId}`, { apiKey: cfg.apiKey });
        setUploadStatus(info.status);
        if (info.status === 'done') break;
        if (info.status === 'failed') throw new Error(info.error || 'failed');
        if (Date.now() - t0 > 10000) throw new Error('timeout waiting for background job');
        await new Promise(r => setTimeout(r, 300));
      }
      setSelectedMeeting(meetingId);
      await Promise.all([fetchSummary(meetingId), fetchTranscript(meetingId), fetchActions(meetingId)]);
      await refreshMeetings();
    } catch (e) {
      console.error(e);
      alert('Upload failed: ' + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function fetchSummary(mid) {
    try {
      const data = await apiFetch(cfg.baseUrl, `/v1/meetings/${mid}/summary`, { apiKey: cfg.apiKey });
      setSummary(data);
    } catch (e) { setSummary(null); }
  }
  async function fetchTranscript(mid) {
    try {
      const data = await apiFetch(cfg.baseUrl, `/v1/meetings/${mid}/transcript?limit=200`, { apiKey: cfg.apiKey });
      setTranscript(data.items || []);
    } catch (e) { setTranscript([]); }
  }
  async function fetchActions(mid) {
    try {
      const data = await apiFetch(cfg.baseUrl, `/v1/meetings/${mid}/actions`, { apiKey: cfg.apiKey });
      setActions(data.items || data || []);
    } catch (e) { setActions([]); }
  }

  async function toggleAction(a) {
    try {
      const updated = await apiFetch(cfg.baseUrl, `/v1/actions/${a.id}`, {
        apiKey: cfg.apiKey, method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_done: !a.is_done })
      });
      setActions(prev => prev.map(x => x.id === a.id ? updated : x));
    } catch (e) { alert('Toggle failed: ' + e.message); }
  }

  async function createAction() {
    if (!selectedMeeting) return alert('Select a meeting first');
    try {
      const firstSegId = transcript[0]?.id;
      const payload = { text: actionText || 'Follow up', priority: Number(actionPriority) };
      if (firstSegId) payload.citations = [firstSegId];
      const a = await apiFetch(cfg.baseUrl, `/v1/meetings/${selectedMeeting}/actions`, {
        apiKey: cfg.apiKey, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      setActions(prev => [a, ...prev]);
      setActionText('');
    } catch (e) { alert('Create action failed: ' + e.message); }
  }

  async function doSearch() {
    try {
      const data = await apiFetch(cfg.baseUrl, `/v1/search?q=${encodeURIComponent(searchQ)}&mode=any${selectedMeeting ? `&meeting_id=${selectedMeeting}` : ''}`, { apiKey: cfg.apiKey });
      const items = Array.isArray(data) ? data : (data.items || []);
      setSearchResults(items);
      setSearchTotal(Array.isArray(data) ? items.length : (data.total || items.length));
    } catch (e) { setSearchResults([]); setSearchTotal(0); }
  }

  async function exportMD() {
    if (!selectedMeeting) return;
    try {
      const txt = await apiFetch(cfg.baseUrl, `/v1/meetings/${selectedMeeting}/export.md?filename=meeting.md`, { apiKey: cfg.apiKey, responseType: 'text' });
      const blob = new Blob([txt], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'meeting.md'; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { alert('Export MD failed: ' + e.message); }
  }

  async function exportPDF() {
    if (!selectedMeeting) return;
    try {
      const blob = await apiFetch(cfg.baseUrl, `/v1/meetings/${selectedMeeting}/export.pdf?filename=meeting.pdf`, { apiKey: cfg.apiKey, responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'meeting.pdf'; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { alert('Export PDF failed: ' + e.message); }
  }

  function onPickMeeting(mid) {
    setSelectedMeeting(mid);
    if (mid) {
      fetchSummary(mid); fetchTranscript(mid); fetchActions(mid);
    } else {
      setSummary(null); setTranscript([]); setActions([]);
    }
  }

  function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      window.location.href = '/login';
    }
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Top Blue Bar */}
      <div className="w-full h-2" style={{ backgroundColor: '#0a4a6e' }}></div>

      {/* Header */}
      <header className="flex justify-between items-center px-12 py-8">
        <div className="flex items-center gap-0">
          <div className="w-48 h-32">
            <div className="notably-primary text-6xl font-bold">Notably</div>
            <div className="text-lg notably-secondary">AI Meeting Intelligence</div>
          </div>
        </div>
        <button 
          onClick={handleLogout}
          className="notably-button px-9 py-3"
        >
          Logout
        </button>
      </header>

      <div className="flex px-12 gap-12">
        {/* Sidebar Navigation */}
        <aside className="w-40 flex flex-col gap-4">
          <button 
            onClick={() => setCurrentView('home')} 
            className={`notably-button-outline ${currentView === 'home' ? 'bg-green-500 bg-opacity-10' : ''}`}
          >
            Home
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className="notably-button-outline"
          >
            Settings
          </button>
          <button 
            onClick={() => setCurrentView('api')} 
            className="notably-button-outline text-xs leading-tight"
          >
            API Docs
          </button>
          <button 
            onClick={() => setCurrentView('faq')} 
            className="notably-button-outline"
          >
            FAQ
          </button>
        </aside>

        {/* Main Content */}
        <main className="flex-1">
          {showSettings && (
            <div className="notably-card-container mb-8">
              <h3 className="notably-primary text-lg font-semibold mb-6">Configuration</h3>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium notably-primary mb-3 tracking-wide">API BASE URL</label>
                  <input 
                    className="notably-input" 
                    value={baseUrl} 
                    onChange={e=>setBaseUrl(e.target.value)} 
                    placeholder="http://127.0.0.1:8000" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium notably-primary mb-3 tracking-wide">X-API-KEY (OPTIONAL)</label>
                  <input 
                    className="notably-input" 
                    value={apiKey} 
                    onChange={e=>setApiKey(e.target.value)} 
                    placeholder="dev-api" 
                  />
                </div>
              </div>
            </div>
          )}

          {/* Upload Section */}
          <section className="mb-10">
            <h2 className="notably-primary text-base font-medium mb-3">Upload audio file</h2>
            <div className="w-96">
              <label htmlFor="file-upload" className="block">
                <div className="notably-upload-box">
                  <div className="w-10 h-10 mx-auto mb-4">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#00FF88" strokeWidth="2" className="w-full h-full">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7,10 12,15 17,10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </div>
                  <h3 className="notably-primary text-lg font-semibold mb-2">Click to upload</h3>
                  <p className="notably-secondary text-sm">or drag and drop</p>
                  <p className="notably-tertiary text-xs mt-2">WAV, MP3, M4A files</p>
                  {file && (
                    <p className="notably-text text-sm mt-3 font-medium">{file.name}</p>
                  )}
                </div>
              </label>
              <input 
                id="file-upload"
                type="file" 
                accept="audio/*,.wav,.mp3,.m4a" 
                onChange={e=>setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </div>
            
            <div className="mt-6 flex items-center gap-4">
              <div className="flex-1 max-w-md">
                <label className="block text-sm font-medium notably-primary mb-2 tracking-wide">MEETING ID</label>
                <input 
                  className="notably-input" 
                  value={meetingId} 
                  onChange={e=>setMeetingId(e.target.value)} 
                />
              </div>
              <div className="flex gap-3 mt-7">
                <button 
                  disabled={uploading || !file} 
                  onClick={handleUpload} 
                  className="notably-button disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <button 
                  onClick={()=>setMeetingId(uuidv4())} 
                  className="notably-button-outline"
                >
                  New UUID
                </button>
              </div>
            </div>
            
            {uploadStatus && (
              <div className="mt-4 p-3 notably-dark rounded-lg">
                <p className="text-sm notably-text">Status: {uploadStatus}</p>
              </div>
            )}
          </section>

          {/* Recent Files Dashboard */}
          <section className="max-w-4xl">
            <h2 className="notably-primary text-lg font-medium mb-5">Recent Files</h2>
            
            <div className="mb-6 flex items-center gap-4">
              <select 
                className="notably-input max-w-sm" 
                value={selectedMeeting} 
                onChange={e=>onPickMeeting(e.target.value)}
              >
                <option value="">— Select Meeting —</option>
                {meetings.map((m, i) => (
                  <option key={m.id || i} value={m.id || m.meeting_id || m}>
                    {m.id || m.meeting_id || m}
                  </option>
                ))}
              </select>
              <div className="flex gap-3">
                <button 
                  onClick={exportMD} 
                  disabled={!selectedMeeting} 
                  className="notably-button-outline disabled:opacity-50"
                >
                  Export MD
                </button>
                <button 
                  onClick={exportPDF} 
                  disabled={!selectedMeeting} 
                  className="notably-button-outline disabled:opacity-50"
                >
                  Export PDF
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {meetings.slice(0, 5).map((meeting, i) => (
                <div 
                  key={meeting.id || i} 
                  className="notably-file-item cursor-pointer"
                  onClick={() => onPickMeeting(meeting.id || meeting.meeting_id || meeting)}
                >
                  <div>
                    <h3 className="font-medium notably-text">
                      Meeting {meeting.id || meeting.meeting_id || meeting}
                    </h3>
                    <p className="text-sm notably-secondary">
                      Audio transcription and analysis
                    </p>
                  </div>
                  <button className="notably-button px-7 text-sm">
                    Open
                  </button>
                </div>
              ))}
              {!meetings.length && (
                <p className="notably-secondary text-center py-8">No meetings found. Upload an audio file to get started.</p>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Meeting Viewer Modal/Card */}
      {selectedMeeting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-8" onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedMeeting('');
        }}>
          <div className="notably-card-container max-w-6xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="notably-primary text-xl font-semibold">
                Meeting: {selectedMeeting}
              </h2>
              <button 
                onClick={() => setSelectedMeeting('')}
                className="notably-secondary text-2xl"
              >
                ✕
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                {/* Summary */}
                <div>
                  <h3 className="notably-primary font-semibold text-lg mb-3">Summary</h3>
                  <div className="notably-dark p-4 rounded-lg">
                    {summary?.bullets?.length ? (
                      <ul className="space-y-2">
                        {summary.bullets.map(b => (
                          <li key={b.id} className="notably-text">
                            • {b.text}
                            {b.citations?.length && (
                              <span className="notably-secondary text-xs ml-2">
                                [{b.citations.map(c => `${c.t_start_str}–${c.t_end_str}`).join(', ')}]
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="notably-secondary">No summary available yet.</p>}
                  </div>
                </div>

                {/* Transcript */}
                <div>
                  <h3 className="notably-primary font-semibold text-lg mb-3">Transcript</h3>
                  <div className="notably-dark p-4 rounded-lg max-h-64 overflow-auto">
                    {transcript.length ? transcript.map(s => (
                      <div key={s.id} className="py-2 border-b border-gray-800 last:border-b-0">
                        <span className="notably-primary font-bold text-sm mr-3">
                          [{s.t_start_str}]
                        </span>
                        <span className="notably-text">{s.text}</span>
                      </div>
                    )) : <p className="notably-secondary">No transcript available.</p>}
                  </div>
                </div>

                {/* Search */}
                <div>
                  <h3 className="notably-primary font-semibold text-lg mb-3">Search Transcript</h3>
                  <div className="flex gap-3 mb-4">
                    <input 
                      className="notably-input flex-1" 
                      placeholder="Find keywords, speakers, or timestamps" 
                      value={searchQ} 
                      onChange={e=>setSearchQ(e.target.value)} 
                    />
                    <button className="notably-button px-6" onClick={doSearch}>
                      Search
                    </button>
                  </div>
                  <p className="notably-secondary text-sm mb-3">{searchTotal} results</p>
                  <div className="space-y-3">
                    {searchResults.map((it, idx) => (
                      <div key={idx} className="notably-dark p-3 rounded-lg">
                        <div className="notably-primary text-xs uppercase tracking-wide mb-1">
                          {it.kind || 'result'}
                        </div>
                        <div className="notably-text font-medium">{it.text}</div>
                        {it.t_start_str && (
                          <div className="notably-secondary text-xs mt-1">
                            [{it.t_start_str}–{it.t_end_str}]
                          </div>
                        )}
                        {it.snippet && (
                          <div className="notably-secondary text-sm mt-2">…{it.snippet}…</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Actions Panel */}
              <div className="space-y-6">
                <div>
                  <h3 className="notably-primary font-semibold text-lg mb-3">Actions</h3>
                  <div className="space-y-3">
                    <input 
                      className="notably-input" 
                      placeholder="Action text" 
                      value={actionText} 
                      onChange={e=>setActionText(e.target.value)} 
                    />
                    <div className="flex gap-2">
                      <select 
                        className="notably-input w-20" 
                        value={actionPriority} 
                        onChange={e=>setActionPriority(e.target.value)}
                      >
                        <option value={1}>P1</option>
                        <option value={2}>P2</option>
                        <option value={3}>P3</option>
                      </select>
                      <button 
                        onClick={createAction} 
                        disabled={!selectedMeeting} 
                        className="notably-button flex-1 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                  
                  <div className="mt-4 space-y-3">
                    {actions.map(a => (
                      <div key={a.id} className="flex items-center gap-3 p-3 notably-dark rounded-lg">
                        <input 
                          type="checkbox" 
                          checked={!!a.is_done} 
                          onChange={()=>toggleAction(a)}
                          className="w-4 h-4"
                        />
                        <span className={`notably-text ${a.is_done ? 'line-through opacity-50' : ''}`}>
                          {a.text}
                        </span>
                      </div>
                    ))}
                    {!actions.length && (
                      <p className="notably-secondary text-center py-4">No actions yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
