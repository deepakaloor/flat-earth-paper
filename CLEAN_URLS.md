# Hiding the .html in the address bar

Internal links now point to clean URLs (`/megathread`, `/privacy`, `/terms`).
For the address bar to actually show them, the host must serve `megathread.html`
at `/megathread` and redirect the old `.html` URL to the clean one. The right
config for your host is already in this folder:

- **Vercel** — uses `vercel.json` (`cleanUrls: true`). Nothing else needed.
- **Netlify** — serves clean URLs automatically; `_redirects` 301s the old `.html` URLs.
- **Cloudflare Pages** — same as Netlify; uses `_redirects`.
- **Apache** (most shared hosting / cPanel) — uses `.htaccess`.
- **Nginx** — add to your server block:
  ```
  location / {
      if ($request_uri ~ ^/(.*)\.html$) { return 301 /$1; }
      try_files $uri $uri.html $uri/ =404;
  }
  ```
- **GitHub Pages** — does NOT strip `.html`. To get clean URLs there you must
  move each page into its own folder (`megathread/index.html`, `privacy/index.html`,
  `terms/index.html`) and use absolute asset paths. Tell me if you deploy there
  and I will restructure it that way.

Only the file your host reads is used; the others are harmless.
