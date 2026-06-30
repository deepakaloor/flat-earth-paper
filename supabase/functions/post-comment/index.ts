// Supabase Edge Function: post-comment
// The single write path for the guestbook. Layered anti-spam:
//   1. Honeypot   — a hidden field real humans never fill.
//   2. Turnstile  — Cloudflare human check (token verified server-side).
//   3. Filters    — reject links and obvious spam words.
//   4. Rate limit — per-IP (salted-hashed), short + hourly windows.
// Then it inserts the entry/reply with the service-role key (bypasses RLS).
// No secret ever reaches the browser.
//
// Deploy:  supabase functions deploy post-comment
// Secrets: supabase secrets set TURNSTILE_SECRET=...   (required)
//          supabase secrets set RL_SALT=<random string> (recommended)

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

// Reject anything that looks like a URL — links are the #1 guestbook spam signal.
function hasLink(s: string): boolean {
  return /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ru|cn|xyz|top|info|biz|club|online|site|shop|live|link|click|loan|win|vip|buzz|gq|tk|ml|cf|ga|pw|icu|monster|rest|fit|men|stream)\b|\[url|\bt\.me\/|@[a-z0-9_]{4,}\b)/i
    .test(s);
}

const BANNED = [
  "viagra", "cialis", "casino", "porn", "xxx", "escort", "sex cam",
  "payday loan", "crypto giveaway", "binary option", "forex signal",
  "seo service", "buy followers", "telegram @",
];
function isBanned(s: string): boolean {
  const low = s.toLowerCase();
  return BANNED.some((w) => low.includes(w));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

  // 1) Honeypot — a bot fills the hidden field; a human leaves it empty.
  //    Pretend success so the bot moves on, but insert nothing.
  if ((payload?.hp ?? "").toString().trim() !== "") {
    return json({ ok: true }, 200);
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
  if (body.length < 2) return json({ error: "That entry is too short." }, 400);
  if (!token) return json({ error: "Human check missing. Please complete the check." }, 400);

  // 2) Content filters.
  if (hasLink(body)) {
    return json({ error: "Links aren’t allowed in the guestbook. Please post without a URL." }, 400);
  }
  if (isBanned(body) || isBanned(name)) {
    return json({ error: "That entry looks like spam and was blocked." }, 400);
  }

  // 3) Verify the Turnstile token with Cloudflare.
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

  // 4) Per-IP rate limit (IP is salted-hashed, never stored in the clear).
  const salt = Deno.env.get("RL_SALT") ?? "fep-default-salt";
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256Hex(salt + "|" + ip);
  const now = Date.now();
  const since5 = new Date(now - 5 * 60 * 1000).toISOString();
  const sinceHr = new Date(now - 60 * 60 * 1000).toISOString();

  const short = await supabase.from("rate_events")
    .select("*", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since5);
  if ((short.count ?? 0) >= 4) {
    return json({ error: "You’re posting too fast. Please slow down a moment." }, 429);
  }
  const hourly = await supabase.from("rate_events")
    .select("*", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", sinceHr);
  if ((hourly.count ?? 0) >= 15) {
    return json({ error: "You’ve posted a lot in a short time. Please try again later." }, 429);
  }

  // 5) For a reply, confirm the parent exists, is approved, and is top-level.
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

  // 6) Insert with the service role (bypasses RLS).
  const row: Record<string, unknown> = { name, body, approved: true };
  if (parentId !== null) row.parent_id = parentId;

  const { error } = await supabase.from("comments").insert(row);
  if (error) return json({ error: "Could not save your entry." }, 500);

  // Record this post for rate limiting, and best-effort prune of old rows.
  await supabase.from("rate_events").insert({ ip_hash: ipHash });
  await supabase.from("rate_events").delete()
    .lt("at", new Date(now - 24 * 60 * 60 * 1000).toISOString());

  return json({ ok: true }, 200);
});
