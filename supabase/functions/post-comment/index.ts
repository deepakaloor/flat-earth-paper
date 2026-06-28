// Supabase Edge Function: post-comment
// Verifies a Google reCAPTCHA v2 token server-side, then inserts the
// comment using the service-role key (which bypasses Row Level Security).
// The reCAPTCHA SECRET never reaches the browser.
//
// Deploy:  supabase functions deploy post-comment
// Secret:  supabase secrets set RECAPTCHA_SECRET=your_recaptcha_secret
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

  if (!body) return json({ error: "Please write something first." }, 400);
  if (!token) return json({ error: "Human check missing. Please tick the box." }, 400);

  // 1) Verify the reCAPTCHA token with Google.
  const secret = Deno.env.get("RECAPTCHA_SECRET");
  if (!secret) return json({ error: "Server not configured (RECAPTCHA_SECRET)." }, 500);

  const verify = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  }).then((r) => r.json()).catch(() => ({ success: false }));

  if (!verify.success) {
    return json({ error: "Human check failed. Please try again." }, 403);
  }

  // 2) Insert with the service role (bypasses RLS).
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // For pre-moderation, change approved to false and approve rows by hand.
  const { error } = await supabase
    .from("comments")
    .insert({ name, body, approved: true });

  if (error) return json({ error: "Could not save your entry." }, 500);

  // 3) OPTIONAL: email yourself on each new entry. See GUESTBOOK_SETUP.md.
  // await notifyByEmail(name, body);

  return json({ ok: true }, 200);
});
