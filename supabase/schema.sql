-- ============================================================
-- Guestbook schema for "Flat Earth Paper"
-- Paste into Supabase > SQL Editor and Run.
-- ============================================================

create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  name        text        not null default 'Anonymous Visitor',
  body        text        not null,
  approved    boolean     not null default true,
  created_at  timestamptz not null default now()
);

alter table public.comments enable row level security;

-- The page (anon key) may READ approved comments only.
drop policy if exists "read approved comments" on public.comments;
create policy "read approved comments"
  on public.comments
  for select
  to anon
  using (approved = true);

-- No anon INSERT / UPDATE / DELETE policies exist on purpose.
-- All writes go through the post-comment Edge Function, which uses
-- the service-role key and therefore bypasses RLS.

-- Helpful index for the newest-first feed.
create index if not exists comments_created_at_idx
  on public.comments (created_at desc);
