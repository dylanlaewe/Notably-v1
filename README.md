# Notably

Notably is a local-first audio and video transcription app that turns recordings into transcripts, summaries, and action items. The frontend uses Supabase Auth for login, the backend queues upload processing jobs, and the worker pipeline handles transcription and summarization.

This repo is set up primarily for local development. It uses React/Vite for the web app, FastAPI for the API, Postgres for relational data, Redis + RQ for background jobs, and optional MinIO for object storage.

## What Notably Does

- Sign up and sign in with Supabase email/password auth
- Upload audio or video recordings from the dashboard
- Create meetings and attach uploads automatically
- Queue background jobs for processing
- Generate transcripts from uploaded media
- Generate summaries and action items from those transcripts
- View results on the dashboard and meeting detail pages
- Export meeting content in supported formats

## Project Structure

- `backend/`: FastAPI app, auth, database access, models, worker tasks, and API routes
- `web/`: React/Vite frontend
- `tests/`: backend tests
- `docker-compose.yml`: local Postgres, Redis, and MinIO services
- `alembic.ini` and `backend/migrations/`: database migrations

## High-Level Flow

1. The user signs in through Supabase on the frontend.
2. Supabase returns an access token to the browser.
3. The frontend sends that token to the FastAPI backend as a bearer token.
4. The backend verifies the token using the configured Supabase JWT settings.
5. The upload is saved, queued, and processed by an RQ worker.
6. The frontend polls for status updates and then shows the transcript, summary, and actions.

## Requirements

- Python 3.10+
- Node.js 18+ and npm
- Docker Desktop, or local Postgres/Redis/MinIO equivalents
- `ffmpeg` and `ffprobe` installed and available on `PATH`
- A Supabase project for authentication
- An OpenAI API key if you want real transcription/summarization

## Environment Files

Real credentials stay in ignored local files and should not be committed.

### Backend `.env`

The backend reads environment variables from the repo root `.env`.

Example:

```env
DATABASE_URL=postgresql+psycopg://notably:notably@localhost:5432/notably_dev
REDIS_URL=redis://127.0.0.1:6379/0
RQ_ENABLE=true
MINIO_ENABLE=true
DEV_MODE=true
DEV_API_KEY=dev-api
NOTABLY_DEV_USER_ID=11111111-1111-1111-1111-111111111111

JWT_ISSUER=https://YOUR_PROJECT_ID.supabase.co/auth/v1
JWT_AUDIENCE=authenticated
JWKS_URL=https://YOUR_PROJECT_ID.supabase.co/auth/v1/.well-known/jwks.json
JWT_LEEWAY_SECONDS=60
SUPABASE_JWT_SECRET=YOUR_SUPABASE_LEGACY_JWT_SECRET
JWT_SECRET=${SUPABASE_JWT_SECRET}

WHISPER_ENABLE=true
ENABLE_DIARIZATION=true
TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

### Frontend `web/.env.local`

Example:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Notes:

- Use the Supabase publishable key in the frontend.
- Do not put the Supabase secret key in the browser env file.
- This backend currently verifies Supabase JWTs with the shared legacy JWT secret.
- Tracked examples are included as `.env.example` and `web/.env.local.example`.

## Local Setup

### 1. Install backend dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
cd web
npm install
cd ..
```

### 3. Start infrastructure

```bash
docker compose up -d postgres redis minio
```

This exposes:

- Postgres at `localhost:5432`
- Redis at `localhost:6379`
- MinIO API at `localhost:9000`
- MinIO Console at `localhost:9001`

### 4. Run migrations

```bash
alembic upgrade head
```

### 5. Start the backend API

```bash
uvicorn backend.app.main:app --reload
```

### 6. Start the background worker

In a second terminal:

```bash
source .venv/bin/activate
rq worker notably
```

### 7. Start the frontend

In a third terminal:

```bash
cd web
npm run dev
```

Open the local Vite URL shown in the terminal, usually `http://127.0.0.1:5173`.

## Using the App

1. Sign up or sign in.
2. Open the dashboard.
3. Upload an audio or video file.
4. Wait for the upload to progress from `queued` to `processing` to `done`.
5. Open the meeting detail page to review transcript, summary, and actions.

## Upload Limits

Notably no longer enforces an application-level upload size or duration cap in the FastAPI upload route. That means large files are allowed by the app itself.

Practical limits can still come from:

- browser behavior for large multipart uploads
- local memory or disk limits
- MinIO or storage failures
- reverse proxy body-size limits if you deploy behind one later
- background worker or transcription timeouts

## Helpful Commands

```bash
docker compose up -d
docker compose down
alembic upgrade head
uvicorn backend.app.main:app --reload
cd web && npm run dev
pytest
```

## Verification

Useful local checks:

```bash
cd web && npm run build
pytest
```

## Current Caveats

- The backend JWT verification path is built around a shared-secret Supabase JWT setup.
- Full upload processing depends on Redis/RQ and, if enabled, MinIO.
- Real transcription/summarization requires OpenAI configuration.
- Some older docs/components in the repo may still reflect MVP-era wording outside the primary user flow.

## License

No license file is currently included in this repository.
