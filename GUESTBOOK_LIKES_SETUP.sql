-- ============================================================
-- Flat Earth Paper — guestbook "likes" setup
-- Run this ONCE in Supabase → SQL Editor, then click RUN.
-- Safe to re-run (idempotent). No secrets here — schema only.
-- Until this is run, the pages simply show no like buttons;
-- nothing breaks. After it runs, a heart + count appears on
-- every entry across the home page, the megathread and /guestbook.
-- ============================================================

-- 1. Add a likes counter to the shared comments table.
alter table public.comments
  add column if not exists likes integer not null default 0;

-- 2. Atomic, type-agnostic increment that the public (anon) site can call.
--    SECURITY DEFINER lets it bump the counter past the anon RLS policy,
--    but it can ONLY add 1 to a single already-approved row — nothing else.
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

-- 3. Allow the site's anon key (and signed-in users) to call it.
revoke all on function public.increment_like(text) from public;
grant execute on function public.increment_like(text) to anon, authenticated;
