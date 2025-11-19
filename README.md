# Notably – AI Meeting Assistant (MVP)

Notably is a meeting assistant web app that lets you:

* Create a **meeting**
* **Upload** a recording for that meeting
* Process the recording in a **background worker**
* Generate a **transcript** (Whisper)
* Generate a **summary and action bullets** (GPT‑4o mini)
* View everything on a **Meeting Detail** page
* **Export** the meeting to **PDF** and **Markdown**

This README explains:

1. What the app does and what we accomplished
2. How the system is structured (backend, frontend, workers)
3. How to run it locally (step‑by‑step)
4. How to demo the key flow in class
5. What is left (deployment + polish)

---

## 1. Features & What We Accomplished

### Core user flow

A logged‑in user can now:

1. **Log in** via Supabase Auth from the frontend
2. **Create a meeting** from the Dashboard ("New meeting" button)
3. **Upload** an audio/video file tied to that meeting
4. Watch the upload move from **queued → processing → done** (live status polling)
5. **Open the Meeting Detail page** and see:

   * A **transcript** (timestamped segments)
   * A **summary** with bullet points
   * **Action items** (both AI‑generated and manually added)
6. **Export** the meeting to:

   * **PDF** (`/v1/meetings/{id}/export/pdf`)
   * **Markdown** (`/v1/meetings/{id}/export/md`)

This entire loop now works end‑to‑end with **real AI** (Whisper + GPT‑4o mini), not just stub data.

### Backend capabilities

* FastAPI backend with:

  * JWT‑based auth (Supabase) + optional dev API key
  * Meeting model + team‑based access control
  * Uploads model with deduplication and size/duration limits
  * Transcript/segment models for Whisper output
  * Summary + SummaryBullet + BulletCitation models for GPT output
  * ActionItem model for manual or future AI‑generated actions
* Background processing using **Redis + RQ**:

  * `process_stub(upload_id, meeting_id)` worker function:

    * Marks upload `queued → processing → done`
    * Downloads original media from MinIO (if enabled)
    * Uses `ffprobe` to detect duration
    * Uses `ffmpeg` to transcode to 16 kHz mono WAV
    * Calls Whisper (if `WHISPER_ENABLE=true`) to write transcript rows
    * Calls GPT‑4o mini (if `OPENAI_API_KEY` present) to write Summary + bullets + citations
    * Falls back to safe stub output if AI is disabled or fails

### Frontend capabilities

* **Dashboard page** (`/dashboard`):

  * Shows logged‑in user info (from `/v1/auth/ping`)
  * **Uploads** card:

    * Meeting dropdown + manual meeting ID textbox
    * File input for audio/video
    * "Upload recording" button wired to `POST /v1/uploads`
    * Live status polling of the last upload
  * **My meetings** list:

    * Driven by `/v1/my/meetings`
    * Each meeting has a **View meeting →** button
    * Each meeting has a **Delete** button (trash icon, with confirm)
    * "New meeting" button wired to `POST /v1/meetings`

* **Meeting Detail page** (`/meetings/:meetingId`):

  * Fetches from:

    * `/v1/meetings/{id}/transcript`
    * `/v1/meetings/{id}/summary`
    * `/v1/meetings/{id}/actions`
  * Shows:

    * Summary bullets (with segment citations shown inline)
    * Scrollable transcript with segment IDs + timestamps
    * Action items list + form to add manual actions
    * Export buttons for PDF + Markdown

---

## 2. Architecture Overview

High‑level components:

* **Frontend**

  * React + Vite app in `web/`
  * Talks to the FastAPI backend via `apiFetch`, adding `Authorization: Bearer <Supabase JWT>`

* **Backend API**

  * FastAPI app in `backend/app/`
  * Exposes REST endpoints under `/v1/...`
  * Uses SQLAlchemy ORM and Postgres via `DATABASE_URL`
  * Enforces per‑user access with `require_user` + team membership checks

* **Database**

  * PostgreSQL
  * Tables: `meeting`, `upload`, `upload_object`, `transcript`, `transcript_segment`, `summary`, `summary_bullet`, `bullet_citation`, `action_item`, `team`, `team_member`, etc.

* **Storage**

  * Optional **MinIO** (S3‑compatible) for binary blobs:

    * Original uploaded files
    * Derived `audio-16k.wav`

* **Background Workers**

  * Redis queue named `notably`
  * RQ worker process running `rq worker notably`
  * Worker executes `backend.app.tasks.process_stub`

* **AI Services**

  * Whisper (via `maybe_transcribe_from_minio`) for transcription
  * GPT‑4o mini (via `maybe_generate_summary`) for summary + actions

Data flow for one recording:

1. User hits `POST /v1/uploads` with form data (`file`, `meeting_id`).
2. Backend writes an `upload` row and (optionally) stores the file in MinIO.
3. Backend enqueues `process_stub(upload_id, meeting_id)` on the `notably` queue.
4. Worker pops that job and:

   * Downloads and transcoded audio
   * Calls Whisper → writes `transcript` + `transcript_segment` rows
   * Calls GPT → writes `summary`, `summary_bullet`, `bullet_citation`
   * Marks `upload.status = "done"`
5. Frontend polls `/v1/uploads/{upload_id}` until `status = done`.
6. User opens Meeting Detail page; frontend calls `/transcript` + `/summary` + `/actions` and renders the result.

---

## 3. Prerequisites

To run the app locally, you’ll need:

* **Python** 3.10+
* **Node.js** + npm (or yarn) for the React frontend
* **PostgreSQL** (local or Docker)
* **Redis** (local or Docker)
* **ffmpeg** and **ffprobe** installed and on your PATH
* **OpenAI API key** (for GPT and optionally Whisper)
* **Supabase project** (for auth) with:

  * Project URL
  * anon/public key

Optional but recommended:

* **MinIO** (or S3) for storing large uploads in development

---

## 4. Backend – Local Setup & Run

> These instructions assume you are in the repository root.

### 4.1. Create and activate a virtualenv

```bash
python -m venv .venv
source .venv/bin/activate  # macOS / Linux
# .venv\Scripts\activate  # Windows (PowerShell)
```

### 4.2. Install backend dependencies

(Adapt to your project’s actual dependency manager – pip, pip-tools, Poetry, etc.)

```bash
pip install -r requirements.txt
# or: poetry install
```

### 4.3. Start Postgres

Either local Postgres or Docker. Example with Docker:

```bash
docker run --name notably-postgres \
  -e POSTGRES_USER=notably \
  -e POSTGRES_PASSWORD=notably \
  -e POSTGRES_DB=notably_dev \
  -p 5432:5432 \
  -d postgres:16-alpine
```

Then set `DATABASE_URL` to match:

```bash
export DATABASE_URL='postgresql+psycopg2://notably:notably@localhost:5432/notably_dev'
```

### 4.4. Run migrations

Use Alembic (or your migration tool) to create the schema:\n

```bash
alembic upgrade head
# or: poetry run alembic upgrade head
```

### 4.5. Configure backend environment

Create a `.env` or export environment variables in your shell. Example:

```bash
# Database
export DATABASE_URL='postgresql+psycopg2://notably:notably@localhost:5432/notably_dev'

# Redis / RQ
export RQ_ENABLE=1

# AI
export OPENAI_API_KEY='sk-...'          # your real key
export SUMMARY_MODEL='gpt-4o-mini'
export WHISPER_ENABLE=true              # or false to disable

# Optional: MinIO
export MINIO_ENABLE=false                # true if you have MinIO running
# export MINIO_ENDPOINT='http://127.0.0.1:9000'
# export MINIO_ACCESS_KEY='minioadmin'
# export MINIO_SECRET_KEY='minioadmin'

# Logging (shared by tasks + summarizer)
export NOTABLY_LOG_FILE='/tmp/notably_worker.log'

# macOS safety for RQ + ffmpeg
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
```

For local Supabase JWT auth, the backend expects `Authorization: Bearer <JWT>` from the frontend; most of the configuration lives on the frontend side (see below).

### 4.6. Run Redis

If you don’t have `redis-server` installed locally, you can run it via Docker:

```bash
docker run --name notably-redis -p 6379:6379 -d redis:7-alpine
```

### 4.7. Run the API server

From the repo root (with `.venv` activated):

```bash
uvicorn backend.app.main:app --reload
# or however your project normally starts FastAPI
```

The API will be available at:

* `http://127.0.0.1:8000`

### 4.8. Run the RQ worker

In a second terminal (same `.venv`, same env vars):

```bash
rq worker notably
```

You should see the worker subscribe to the `notably` queue and log jobs as they are processed.

---

## 5. Frontend – Local Setup & Run

From the repo root:

```bash
cd web
npm install
```

Create `web/.env.local` with:

```bash
VITE_API_BASE_URL='http://127.0.0.1:8000'
VITE_SUPABASE_URL='https://<your-project>.supabase.co'
VITE_SUPABASE_ANON_KEY='<your-supabase-anon-key>'
```

Then run the dev server:

```bash
npm run dev
```

By default, Vite serves the frontend at:

* `http://127.0.0.1:5173` (or similar port)

When the user logs in via Supabase, the frontend receives a JWT and stores it in `localStorage`. Every call via `apiFetch` attaches `Authorization: Bearer <token>` so the backend can use `require_user` to authenticate and enforce access.

---

## 6. How to Demo the App in Class

Here is a simple, reliable demo script:

1. **Start services** (before class):

   * Postgres
   * Redis
   * FastAPI backend (`uvicorn`)
   * RQ worker (`rq worker notably`)
   * Frontend (`npm run dev`)

2. **Log in** through the frontend using a Supabase test account.

3. On the **Dashboard**:

   * Show the "Signed in as" card (proves auth is working).
   * Click **New meeting** – point out that it appears in the “My meetings” list.

4. **Upload a recording**:

   * In the "Uploads" card, select the new meeting in the dropdown.
   * Choose an audio file (a short ~1–3 minute recording works best).
   * Click **Upload recording**.
   * Show the "Latest upload status" card changing from `queued → processing → done`.

5. **Open the Meeting Detail page**:

   * Click **View meeting →** on the meeting.
   * Show:

     * **Summary** bullets and how they reference transcript segments.
     * **Transcript** segments with timestamps.
     * **Action items** (add a manual one to prove the POST works).

6. **Export**:

   * Click **Export PDF** and **Export .md** to show that we can generate and download structured outputs.

7. If time allows, briefly show the **worker logs** to highlight how the job is processed (ffmpeg/Whisper/GPT).

---

## 7. How We Built It (Process)

* We followed a **vertical slice** approach:

  1. First, get `POST /v1/uploads` working with simple stubbed transcript/summary written to the database.
  2. Then wire Redis/RQ so uploads are processed in the background.
  3. Then add real AI integration: Whisper transcription + GPT‑4o mini summaries.
  4. Finally, connect all endpoints to the React UI and clean up the UX.

* We used **curl + logs** heavily to debug each API endpoint before wiring the frontend.

* We added small but important features like:

  * Meeting creation and deletion
  * Team‑based access control for meeting‑scoped endpoints
  * Clean error handling and 401/403 flows

The result is a realistic MVP that not only demonstrates AI capabilities, but also shows good engineering practices: background work, storage, auth, and a clear web UI.

---

## 8. Remaining Work (Deployment & Polish)

We intentionally stopped at a solid local‑dev MVP. Remaining tasks include:

1. **Deployment**

   * Containerize the stack with Docker Compose
   * Deploy to a small cloud VM or managed service
   * Set up HTTPS, environment variables, logging, and basic monitoring

2. **Bug fixes & testing**

   * Fix minor edge cases around meeting list refreshes and worker errors
   * Add unit tests / integration tests for key endpoints

Even with these remaining items, the current state of Notably already demonstrates a complete AI‑powered meeting workflow from upload to transcript and summary, which was our main goal for this project phase.
