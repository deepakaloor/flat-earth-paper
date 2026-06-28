# Flat Earth Paper, shared guestbook setup

The page works two ways:

- **Local mode (default).** Open `index.html` and the guestbook runs entirely
  in the browser: an on-page human check (checkbox + CAPTCHA + question) and
  entries saved to that browser only. No setup needed.
- **Shared mode.** Fill in four values and the same guestbook becomes a public
  wall, protected by **Google reCAPTCHA** and stored in **Supabase**, so every
  visitor sees the same entries.

reCAPTCHA does not run from `file://`. For shared mode you must host the page
on a real domain (or test on `http://localhost`).

---

## 1. Create the Supabase project
1. Sign in at supabase.com and create a project.
2. **SQL Editor > New query**: paste `supabase/schema.sql`, then **Run**.
3. **Project Settings > API**: copy the **Project URL** and the **anon public** key.

## 2. Get reCAPTCHA keys
1. Go to google.com/recaptcha/admin and register a site.
2. Choose **reCAPTCHA v2 > "I'm not a robot" checkbox**.
3. Add your domain(s), including `localhost` for testing.
4. Copy the **Site key** and the **Secret key**.

## 3. Deploy the Edge Function
Install the Supabase CLI (`npm i -g supabase`), then from this folder:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set RECAPTCHA_SECRET=your_recaptcha_secret_key
supabase functions deploy post-comment
```

Your function URL will be:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/post-comment`

## 4. Fill in the page config
Open `index.html`, find the `CONFIG` block in the guestbook script, and set:

```js
var CONFIG = {
  SUPABASE_URL:       "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY:  "your-anon-public-key",
  FUNCTION_URL:       "https://YOUR_PROJECT_REF.supabase.co/functions/v1/post-comment",
  RECAPTCHA_SITE_KEY: "your-recaptcha-site-key"
};
```

When all four are present the page automatically switches to shared mode
(the pill near the form will read "shared guestbook").

## 5. Host it
Any static host works: drag the folder onto Netlify, deploy with Vercel, or use
GitHub Pages. Make sure the live domain matches one you registered with reCAPTCHA.

---

## Moderation (optional)
To review entries before they appear:
1. In `schema.sql` / the function, set `approved` to **false** on insert.
2. New rows stay hidden until you flip `approved` to true in **Table Editor**.

## Email notifications (the "Gmail" option)
Two easy routes from inside the Edge Function (uncomment the `notifyByEmail`
call and add one of these):

**A. Resend (simplest, recommended).**
```ts
async function notifyByEmail(name: string, body: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "guestbook@yourdomain.com",
      to: "you@gmail.com",
      subject: `New guestbook entry from ${name}`,
      text: body,
    }),
  });
}
```
Set the secret: `supabase secrets set RESEND_API_KEY=...`

**B. Gmail directly (SMTP + App Password).**
Turn on 2-Step Verification on your Google account, create an **App Password**,
and send via SMTP from the function using a Deno mailer such as `denomailer`:
```ts
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";
const client = new SMTPClient({ connection: {
  hostname: "smtp.gmail.com", port: 465, tls: true,
  auth: { username: "you@gmail.com", password: Deno.env.get("GMAIL_APP_PASSWORD")! },
}});
await client.send({ from: "you@gmail.com", to: "you@gmail.com",
  subject: `New guestbook entry from ${name}`, content: body });
await client.close();
```
Set the secret: `supabase secrets set GMAIL_APP_PASSWORD=...`
(Use an App Password, never your real Gmail password.)
