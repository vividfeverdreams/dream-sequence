-- Prisma keeps its migration history in public._prisma_migrations. Supabase
-- exposes the public schema through its Data API and grants anon and
-- authenticated full access to new tables there, so with RLS off anyone with
-- the project URL could read, edit or truncate this table (Supabase advisor:
-- rls_disabled_in_public). Prisma connects as the table owner, which bypasses
-- RLS, so locking the API roles out does not affect migrations.
-- Idempotent: runs on every Vercel build.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON TABLE public."_prisma_migrations" FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON TABLE public."_prisma_migrations" FROM authenticated;
    END IF;
  END IF;
END
$$;
