# Crowd Remix

Crowd Remix is a single-DJ MVP for live AI visuals. A DJ logs in, defines a visual DNA for the show, seeds the first loop, and lets the crowd send remix ideas through SMS or a QR-linked web form. The app moderates and ranks those ideas, rewrites the winning one into a focused Sora remix prompt, and crossfades into the next completed loop when it is ready.

## What This MVP Includes

- Next.js App Router frontend for:
  - DJ login
  - live dashboard
  - public crowd submission page
  - fullscreen show page
- Prisma data model with:
  - `User`
  - `DJSession`
  - `PromptSubmission`
  - `ModerationResult`
  - `RankingResult`
  - `VisualAsset`
  - `RenderJob`
  - `PlaybackState`
  - `AuditEvent`
- SMS intake via Twilio webhook
- Public web prompt intake via `/r/[sessionCode]`
- OpenAI text scoring for moderation/ranking/prompt compilation
- OpenAI Sora seed/remix orchestration
- SSE-driven realtime updates for the dashboard and show screen
- Double-buffer video crossfade on the fullscreen playback route
- Local file storage for downloaded MP4 assets
- Demo-mode fallback if `OPENAI_API_KEY` is missing

## Important Product Constraint

Sora video generation is asynchronous. This app is built so the experience feels responsive in under 10 seconds through fast intake, queueing, and status updates, while the current loop stays on screen until the next completed remix is ready.

## Local Setup

1. Install dependencies.
2. Copy `.env.example` to `.env`.
3. Run the Prisma migration.
4. Seed the demo user and starter session.
5. Start the app.

Example commands:

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

If you use `npm` instead of `pnpm`, the equivalent commands are:

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

## Demo Credentials

The seed script creates:

- Email: `dj@example.com`
- Password: `crowdremix-demo`

You can override those values with `SEED_DJ_EMAIL` and `SEED_DJ_PASSWORD`.

## Environment Variables

### Required for the full live stack

- `AUTH_SECRET`
- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`

### Required for OpenAI-backed moderation and Sora rendering

- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_VIDEO_MODEL`

### Required for Twilio SMS intake

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

### Optional demo fallback

- `DEMO_LOOP_URL`

If `OPENAI_API_KEY` is absent, the app uses a demo video URL so the playback and crossfade flow can still be exercised locally.

## Core Routes

- `/login`
- `/dashboard`
- `/r/[sessionCode]`
- `/show/[sessionId]`

## Core API Endpoints

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/sessions`
- `POST /api/sessions/[sessionId]/start`
- `POST /api/sessions/[sessionId]/control`
- `GET /api/sessions/[sessionId]/stream`
- `POST /api/sessions/[sessionId]/transition`
- `POST /api/sessions/[sessionId]/reconcile`
- `POST /api/r/[sessionCode]`
- `POST /api/twilio/inbound`
- `POST /api/openai/video-webhook`
- `GET /api/assets/[assetId]`

## How The Queue Works

1. Crowd prompt arrives from SMS or web form.
2. The app rate-limits and normalizes it.
3. The text model scores it for safety, cohesion, novelty, and remixability.
4. Approved prompts enter the ranked queue.
5. If no render is active and no next asset is waiting, the best approved prompt is selected.
6. The app starts a seed render or remix render with Sora.
7. Once the render is completed, the output becomes the next queued loop.
8. The fullscreen show view crossfades and then promotes that asset to live.

## Notes About Infrastructure Choices

- This MVP uses SQLite locally for fast setup even though a future deployment would likely move to Postgres.
- Downloaded video files are stored under `storage/videos/`.
- The app supports OpenAI video webhooks, but it also includes a manual reconciliation endpoint so local development does not depend on webhook delivery.

## Testing

Run:

```bash
pnpm test
```

The current tests cover the heuristic assessment fallback and the auth helper primitives.
