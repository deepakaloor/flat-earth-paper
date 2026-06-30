-- ============================================================
-- Flat Earth Paper — guestbook threaded replies
-- Run this ONCE in Supabase → SQL Editor, then click RUN.
-- Safe to re-run. No secrets — schema only.
--
-- Lets visitors reply to each other's entries. Replies live in the
-- same comments table, one level deep, and are read with the same
-- "approved = true" policy that already governs top-level entries.
--
-- After this runs you must ALSO redeploy the post-comment Edge
-- Function (supabase/functions/post-comment/index.ts), which now
-- accepts an optional parent_id:
--     supabase functions deploy post-comment
-- ============================================================

-- A reply points at the entry it answers. ON DELETE CASCADE means
-- removing an entry in moderation also removes its replies.
alter table public.comments
  add column if not exists parent_id bigint
    references public.comments(id) on delete cascade;

create index if not exists comments_parent_id_idx
  on public.comments(parent_id);
