# Pulse Navigator changelog

Newest first. The version and date also show at the bottom of the app's side menu.

## 1.1.1 (18 Nov 2026)

- Fixed "Request failed (502)" when signing in after the app had been idle: Render's free server sleeps after 15 minutes, and requests failed while it woke up.
- The Cloudflare Worker now pings the server every 10 minutes so it stays awake, and waits up to 90 seconds (retrying) if it is still waking.
- If the server is starting up, the app now says so instead of showing an error code.

## 1.1.0 (18 Nov 2026)

- Left menu: each icon now shows its name underneath (Copilot, AI agents, Analytics, Ads, Account), replacing the hover pop-up that covered the side menu.
- Version number and update date shown at the bottom of the side menu, and returned by `/healthz`.

## 1.0.0 (18 Nov 2026)

- First live release at www.dumbledo.com/pulse-navigator.
- App server on Render (free plan), database on Supabase (Mumbai), Cloudflare Worker serving the `/pulse-navigator` path; the rest of www.dumbledo.com stays on Shopify.
- App works under a path prefix (relative links, cookies scoped to `/pulse-navigator`).
