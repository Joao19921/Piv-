-- Security baseline: keep the application database behind the Pivô API.
--
-- Confirmed architecture:
--   browser -> Pivô REST API -> PostgreSQL
-- The repository does not use Supabase client/Data API directly.
--
-- Therefore anon/authenticated do not need table access. The backend connects
-- through DATABASE_URL and is not affected by these grants.

-- 1) Migration bookkeeping is an internal implementation table.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schema_migrations FROM anon, authenticated;

-- 2) Remove the unused legacy salary benchmark view.
-- It has no database dependencies and is not referenced by the application.
DROP VIEW IF EXISTS public.salary_benchmark_current;

-- 3) Close direct Data API access to all application tables.
-- RLS remains enabled on the existing tables; the application accesses them
-- through the backend database connection instead of anon/authenticated.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- 4) Prevent new public tables from being exposed automatically.
-- Explicit GRANTs will be required if a future feature intentionally exposes
-- a database object through Supabase Data API.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER
  ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE
  ON SEQUENCES FROM anon, authenticated;

-- 5) Keep database functions private by default as well.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
