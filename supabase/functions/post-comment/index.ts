// Supabase Edge Function: post-comment
// Verifies a Cloudflare Turnstile token server-side, then inserts the
// guestbook entry (or a reply) using the service-role key, which bypasses
// Row Level Security. The Turnstile SECRET never reaches the browser.
//
// Deploy:  supabase functions deploy post-comment
// Secret:  supabase secrets set TURNSTILE_SECRET=your_turnstile_secret
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// by the Supabase runtime.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*", // tighten to your domain in production
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const name = (payload?.name ?? "Anonymous Visitor")
    .toString().trim().slice(0, 40) || "Anonymous Visitor";
  const body = (payload?.body ?? "").toString().trim().slice(0, 600);
  const token = (payload?.token ?? "").toString();

  // parent_id is present only when this is a reply to an existing entry.
  let parentId: number | null = null;
  const rawParent = payload?.parent_id;
  if (rawParent !== undefined && rawParent !== null && rawParent !== "") {
    parentId = Number(rawParent);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return json({ error: "Bad reply target." }, 400);
    }
  }

  if (!body) return json({ error: "Please write something first." }, 400);
  if (!token) return json({ error: "Human check missing. Please complete the check." }, 400);

  // 1) Verify the Turnstile token with Cloudflare.
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) return json({ error: "Server not configured (TURNSTILE_SECRET)." }, 500);

  const verify = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    },
  ).then((r) => r.json()).catch(() => ({ success: false }));

  if (!verify.success) {
    return json({ error: "Human check failed. Please try again." }, 403);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 2) For a reply, confirm the parent exists, is approved, and is itself a
  //    top-level entry (keeps threads a single level deep, and stops people
  //    pointing replies at arbitrary / hidden rows).
  if (parentId !== null) {
    const { data: parent, error: pErr } = await supabase
      .from("comments")
      .select("id, approved, parent_id")
      .eq("id", parentId)
      .maybeSingle();
    if (pErr) return json({ error: "Could not save your reply." }, 500);
    if (!parent || parent.approved !== true || parent.parent_id !== null) {
      return json({ error: "That entry can’t be replied to." }, 400);
    }
  }

  // 3) Insert with the service role (bypasses RLS).
  // For pre-moderation, change approved to false and approve rows by hand.
  const row: Record<string, unknown> = { name, body, approved: true };
  if (parentId !== null) row.parent_id = parentId;

  const { error } = await supabase.from("comments").insert(row);
  if (error) return json({ error: "Could not save your entry." }, 500);

  // 4) OPTIONAL: email yourself on each new entry. See GUESTBOOK_SETUP.md.
  // await notifyByEmail(name, body);

  return json({ ok: true }, 200);
});
