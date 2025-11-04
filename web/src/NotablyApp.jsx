import React, { useEffect, useMemo, useRef, useState } from "react";

// Minimal single-file React UI to exercise Notably backend
// - Configure API base + (optional) X-Api-Key
// - Upload audio to a Meeting (auto UUID or custom)
// - Poll upload status → fetch Summary, Transcript, Actions
// - Create/Toggle Actions
// - Tokenized Search (new /v1/search)
// - Export MD/PDF (downloads)
//
// Drop this into your frontend as e.g. src/NotablyApp.jsx and render <NotablyApp />.
// Tailwind classes used for quick styling; feel free to adapt.

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

  const cfg = useMemo(() => ({ baseUrl, apiKey }), [baseUrl, apiKey]);

  async function refreshMeetings() {
    try {
      const items = await apiFetch(cfg.baseUrl, '/v1/meetings', { apiKey: cfg.apiKey });
      // Endpoint returns newest first; normalize to array
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
      // auto-select meeting and fetch data
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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">Notably – Backend Wiring UI</h1>
          <button className="text-sm px-3 py-1 rounded bg-gray-200 hover:bg-gray-300" onClick={refreshMeetings}>Refresh</button>
        </header>

        {/* Config */}
        <section className="grid md:grid-cols-3 gap-3 bg-white p-4 rounded-2xl shadow">
          <div className="col-span-2">
            <label className="block text-sm font-medium">API Base URL</label>
            <input className="mt-1 w-full border rounded px-3 py-2" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:8000" />
          </div>
          <div>
            <label className="block text-sm font-medium">X-Api-Key (optional)</label>
            <input className="mt-1 w-full border rounded px-3 py-2" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="dev-api" />
          </div>
        </section>

        {/* Upload */}
        <section className="bg-white p-4 rounded-2xl shadow space-y-3">
          <h2 className="text-lg font-semibold">Upload audio → Meeting</h2>
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Meeting ID</label>
              <input className="mt-1 w-full border rounded px-3 py-2" value={meetingId} onChange={e=>setMeetingId(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium">Audio file</label>
              <input className="mt-1 w-full" type="file" accept="audio/*,.wav,.mp3,.m4a" onChange={e=>setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="flex gap-2">
              <button disabled={uploading || !file} onClick={handleUpload} className="w-full h-10 mt-6 rounded-xl bg-blue-600 text-white disabled:opacity-50">{uploading ? 'Uploading…' : 'Upload'}</button>
              <button onClick={()=>setMeetingId(uuidv4())} className="h-10 mt-6 px-3 rounded-xl border">New UUID</button>
            </div>
          </div>
          {uploadStatus && <p className="text-sm text-gray-600">Status: {uploadStatus}</p>}
        </section>

        {/* Meeting viewer */}
        <section className="bg-white p-4 rounded-2xl shadow space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grow min-w-[260px]">
              <label className="block text-sm font-medium">Select Meeting</label>
              <select className="mt-1 w-full border rounded px-3 py-2" value={selectedMeeting} onChange={e=>onPickMeeting(e.target.value)}>
                <option value="">— choose —</option>
                {meetings.map((m, i) => (
                  <option key={m.id || i} value={m.id || m.meeting_id || m}> {m.id || m.meeting_id || m} </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={exportMD} disabled={!selectedMeeting} className="px-3 h-10 rounded-xl border">Export MD</button>
              <button onClick={exportPDF} disabled={!selectedMeeting} className="px-3 h-10 rounded-xl border">Export PDF</button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-3">
              <h3 className="font-semibold">Summary</h3>
              {summary?.bullets?.length ? (
                <ul className="list-disc pl-6">
                  {summary.bullets.map(b => (
                    <li key={b.id} className="mb-1">{b.text} {b.citations?.length ? <span className="text-xs text-gray-500">[{b.citations.map(c => `${c.t_start_str}–${c.t_end_str}`).join(', ')}]</span> : null}</li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-500">No bullets yet.</p>}

              <h3 className="font-semibold mt-4">Transcript</h3>
              <div className="max-h-64 overflow-auto border rounded p-3">
                {transcript.length ? transcript.map(s => (
                  <div key={s.id} className="py-1">
                    <span className="text-xs text-gray-500 mr-2">[{s.t_start_str}]</span>
                    <span>{s.text}</span>
                  </div>
                )) : <p className="text-sm text-gray-500">No transcript.</p>}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Actions</h3>
              <div className="flex gap-2">
                <input className="flex-1 border rounded px-3 py-2" placeholder="Action text" value={actionText} onChange={e=>setActionText(e.target.value)} />
                <select className="w-24 border rounded px-2" value={actionPriority} onChange={e=>setActionPriority(e.target.value)}>
                  <option value={1}>P1</option>
                  <option value={2}>P2</option>
                  <option value={3}>P3</option>
                </select>
                <button onClick={createAction} disabled={!selectedMeeting} className="px-3 rounded-xl bg-emerald-600 text-white">Add</button>
              </div>
              <ul className="space-y-2">
                {actions.map(a => (
                  <li key={a.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={!!a.is_done} onChange={()=>toggleAction(a)} />
                    <span className={a.is_done ? 'line-through text-gray-500' : ''}>{a.text}</span>
                  </li>
                ))}
                {!actions.length && <p className="text-sm text-gray-500">No actions yet.</p>}
              </ul>
            </div>
          </div>
        </section>

        {/* Search */}
        <section className="bg-white p-4 rounded-2xl shadow space-y-3">
          <h2 className="text-lg font-semibold">Search</h2>
          <div className="flex gap-2">
            <input className="flex-1 border rounded px-3 py-2" placeholder="search terms (supports phrases, -negation)" value={searchQ} onChange={e=>setSearchQ(e.target.value)} />
            <button className="px-3 rounded-xl bg-indigo-600 text-white" onClick={doSearch}>Search</button>
          </div>
          <p className="text-sm text-gray-600">{searchTotal} results</p>
          <div className="grid md:grid-cols-2 gap-3">
            {searchResults.map((it, idx) => (
              <div key={idx} className="border rounded-xl p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{it.kind || 'result'}</div>
                <div className="font-medium">{it.text}</div>
                {it.t_start_str && <div className="text-xs text-gray-500 mt-1">[{it.t_start_str}–{it.t_end_str}]</div>}
                {it.snippet && <div className="text-sm text-gray-600 mt-2">…{it.snippet}…</div>}
              </div>
            ))}
            {!searchResults.length && <p className="text-sm text-gray-500">No results yet.</p>}
          </div>
        </section>

      </div>
    </div>
  );
}
