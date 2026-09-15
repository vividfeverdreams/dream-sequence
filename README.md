# DREAM SEQUENCE

A shared visual story for live shows and Twitch streams. The host describes how the story begins, selects a clip length and quality, and chooses QR-code or Twitch audience input. Viewers answer **What happens next?**. Approved ideas enter a ranked queue; H3 Max creates the next story beat from the previous generated clip’s final frame.

## Experience

- One required opening prompt; no model picker or visual-DNA questionnaire.
- H3 Max through fal.ai is the only video-generation provider.
- Simple 5-, 10-, and 15-second choices; the API accepts whole seconds from 5 through 15.
- 480P, 768P (default), and 1080P quality. The default clip length is 5 seconds. fal describes 1080P as refinement from native 768P.
- QR page: original free-text continuation, optional nickname, moderation, device limits, and progress tracking.
- Twitch mode: the host connects a Twitch account, and viewers type `!next` followed by their idea. Other chat is ignored. See [Twitch setup](docs/TWITCH_SETUP.md).
- Existing projection, audio-reactive visual effects, overlays, and manual playback controls remain available. Playback continuously cycles through the latest three videos in chronological order, wrapping back to the first at clip boundaries. Newly ready clips take priority, then join the rolling three-video loop. New story clips continue from the latest generated clip's final frame regardless of which video is currently playing.

## Generation and continuity

The opening request goes to `minimax/h3-max/image-to-video` with a text prompt and no image. This endpoint supports text-only opening generation. Each continuation downloads the latest completed generation, decodes its actual final frame, and sends that frame as `image_url` to the same endpoint. A missing or undecodable predecessor fails the request; it never starts an unrelated text-only continuation.

This provides a visual starting anchor, not a guarantee of perfect temporal continuity: image-to-video cannot carry the previous clip’s full motion, audio, or hidden model state. H3 Max can still change details. The player keeps the current clip visible while a successor is generated, so generation latency is not represented as instant live video.

Completed MP4 files are copied to Supabase Storage for durable playback. The queue serializes generation per session and uses the most recently generated clip as the parent even if the host manually replays older footage. API queue submission is not retried in-place after an ambiguous network error. Status checks and output persistence can retry without submitting another generation.

Audience receipts return after moderation and saving the idea; video preparation runs afterward. Text assessment has a 15-second timeout before using the existing local safety check. Twitch intake saves each batch before starting video preparation, and render reconciliation does not wait for chat intake. Rate limits preserve the typed idea and show a clear rejection; exhausted render retries show a final failure instead of an endless queue state.

If the opening video finishes at fal but fails during playback preparation, the dashboard offers **Recover First Video**. This retries preparation of the same saved result and never submits a replacement generation. Completion diagnostics identify the failed preparation step without logging prompts, media URLs, or credentials.

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env.local` and supply your database, auth, storage and fal settings. Prisma reads `.env` for command-line migrations, so supply the same database URLs there or through the command environment.
3. Apply migrations to the intended development database, then run `pnpm db:generate`.
4. Optionally seed a development database with `pnpm db:seed`.
5. Start with `pnpm dev`.

The seed account uses `dj@example.com` / `dreamsequence-demo` unless overridden with `SEED_DJ_EMAIL` and `SEED_DJ_PASSWORD`. Use a development database for this seed.

## Server configuration

Required:

- `AUTH_SECRET`: strong session-signing secret.
- `DATABASE_URL` / `DIRECT_URL`: Supabase Postgres runtime and migration URLs.
- `NEXT_PUBLIC_APP_URL`: application origin.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: durable media storage.
- `FAL_KEY`: fal.ai server credential. Never use a `NEXT_PUBLIC_` prefix or send it to the browser.

Optional:

- `OPENAI_API_KEY` / `OPENAI_TEXT_MODEL`: story moderation and ranking. Without a key, deterministic moderation/ranking is used. These are text operations; all video generation uses H3 Max.
- Twitch values from `.env.example` and [the setup guide](docs/TWITCH_SETUP.md).

No demo-video or alternate-generation-provider fallback is used when `FAL_KEY` is missing. The dashboard reports that video generation needs configuration.

## Deploying this overhaul

Before switching the deployed application:

1. Configure `FAL_KEY` in the target deployment environment and verify Supabase storage is available.
2. Apply `prisma/migrations/20260913000000_h3_story_and_twitch/migration.sql` to the intended database, together with any outstanding earlier migrations. The existing `vercel-build` script includes the idempotent SQL step used by this repository’s deployment convention.
3. Deploy the app. The migration adds clip-quality/audience settings and Twitch tables, updates stored model selections to H3 Max, and constrains old durations to 5–15 seconds. Existing clips stay available; unfinished jobs from retired providers fail with an instruction to start an H3 Max clip.
4. If using Twitch, configure a public HTTPS app origin and complete [Twitch setup](docs/TWITCH_SETUP.md). Localhost cannot receive Twitch webhooks without a public HTTPS tunnel.
5. Exercise one opening clip and one audience continuation in the target environment, then connect a channel and send an `!next` message. This is the live provider/account verification step; automated checks use mocked provider responses. A local live validation of this overhaul also completed one 5-second 480P opening and one image-conditioned continuation through fal, with both files decoding to 832×480. The continuation preserved the opening’s final-frame composition, with small model/codec differences.

The repository's [`vercel.json`](vercel.json) schedules Twitch recovery and token validation every minute on production deployments. This requires **Vercel Pro or Enterprise** and a configured `CRON_SECRET`. For Hobby, remove the `crons` entry before deploying and use an external scheduler; other hosts also need an external scheduler. See [Twitch setup](docs/TWITCH_SETUP.md) for the authenticated request and verification steps.

Native video decoding uses `node-av`; Next traces both its platform binaries and pnpm dependency aliases into the relevant server functions. The isolated native tracing test verifies that the packaged decoder can load outside the development installation. Generation/reconciliation uses the Node.js runtime.

## Main routes

- `/dashboard/new`: create a story space.
- `/dashboard`: start, monitor and control the story.
- `/r/[sessionCode]`: audience continuation page.
- `/r/account/[accountId]`: stable host audience link.
- `/show/[sessionId]`: projection output.
- `/api/twitch/connect`, `/api/twitch/callback`, `/api/twitch/status`, `/api/twitch/disconnect`: account connection.
- `/api/twitch/webhook`: signed EventSub intake.
- `/api/twitch/process`: authenticated scheduled recovery of queued messages and token validation.

## Validation

Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Tests cover provider contracts, final-frame extraction, queue concurrency and failures, story settings/intake, OAuth state, webhook signatures, replay prevention, and existing playback/audio controls.

Provider references: [H3 Max API](https://fal.ai/models/minimax/h3-max/image-to-video/api), [fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue), [Twitch chat authorization](https://dev.twitch.tv/docs/chat/authenticating/), [Twitch webhooks](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).
