-- ============================================================
-- Flat Earth Paper — guestbook anti-spam (rate limiting)
-- Run this ONCE in Supabase → SQL Editor, then click RUN.
-- Safe to re-run. No secrets — schema only.
--
-- Stores a short-lived, SALTED-HASHED form of each poster's IP so the
-- Edge Function can rate-limit. It is NOT readable by the public (RLS is
-- on with no anon/authenticated policy); only the service-role Edge
-- Function can touch it, and rows older than a day are pruned on each post.
--
-- After this runs, redeploy the Edge Function and set its secrets:
--   supabase functions deploy post-comment
--   supabase secrets set TURNSTILE_SECRET=your_turnstile_secret   (you already have this)
--   supabase secrets set RL_SALT=<any long random string>          (recommended)
-- ============================================================

create table if not exists public.rate_events (
  id       bigint generated always as identity primary key,
  ip_hash  text        not null,
  at       timestamptz not null default now()
);

create index if not exists rate_events_iphash_at_idx
  on public.rate_events (ip_hash, at);

-- Lock it down: no public access at all. The Edge Function uses the
-- service-role key, which bypasses RLS.
alter table public.rate_events enable row level security;
