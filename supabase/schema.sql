-- ============================================================
-- Guestbook schema for "Flat Earth Paper"
-- Paste into Supabase > SQL Editor and Run.
-- This is the full, current schema (entries + likes + replies).
-- ============================================================

create table if not exists public.comments (
  id          bigint generated always as identity primary key,
  name        text        not null default 'Anonymous Visitor',
  body        text        not null,
  approved    boolean     not null default true,
  likes       integer     not null default 0,
  parent_id   bigint      references public.comments(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- For existing projects created before likes / replies were added:
alter table public.comments add column if not exists likes integer not null default 0;
alter table public.comments add column if not exists parent_id bigint
  references public.comments(id) on delete cascade;

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

-- Atomic, type-agnostic "like" increment the public (anon) site may call.
-- SECURITY DEFINER lets it add 1 past the anon RLS policy, but it can only
-- ever bump the counter on a single already-approved row.
create or replace function public.increment_like(cid text)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.comments
     set likes = coalesce(likes, 0) + 1
   where id::text = cid
     and approved = true
  returning likes;
$$;

revoke all on function public.increment_like(text) from public;
grant execute on function public.increment_like(text) to anon, authenticated;

-- Helpful indexes.
create index if not exists comments_created_at_idx
  on public.comments (created_at desc);
create index if not exists comments_parent_id_idx
  on public.comments (parent_id);
