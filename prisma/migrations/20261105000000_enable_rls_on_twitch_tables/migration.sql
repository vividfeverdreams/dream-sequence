-- The 2026-09-13 migration created these tables without RLS, unlike every other
-- table in this schema. The API roles have no usage on dream_sequence today, so
-- this is defense in depth for stored Twitch tokens. Prisma connects as the
-- table owner, which bypasses RLS, so the app is not affected.
-- Idempotent: runs on every Vercel build.
ALTER TABLE "dream_sequence"."TwitchConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dream_sequence"."TwitchEventDelivery" ENABLE ROW LEVEL SECURITY;
