// Cloudflare Worker: serves Pulse Navigator at www.dumbledo.com/pulse-navigator by forwarding to the app server (Render).
// Everything else on the domain (the Shopify store) never reaches this Worker: its route only matches /pulse-navigator*.
// Set ORIGIN in Cloudflare (Worker > Settings > Variables), e.g. https://pulse-navigator.onrender.com

const PREFIX = "/pulse-navigator";
const WAKE_STATUSES = new Set([502, 503, 504]);   // what Render's free server answers while it is waking up
const WAKE_WAIT_MS = 90000, RETRY_EVERY_MS = 3000; // keep retrying for up to 90 seconds
const MAX_BUFFER = 2 * 1024 * 1024;                // bodies up to 2 MB are kept so they can be re-sent on retry
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fetch from the app server, waiting for it if Render's free plan has put it to sleep.
async function fetchWaking(target, init, canRetry) {
  const until = Date.now() + WAKE_WAIT_MS;
  for (;;) {
    let res;
    try { res = await fetch(target, init); }
    catch (e) { if (!canRetry || Date.now() > until) throw e; await sleep(RETRY_EVERY_MS); continue; }
    if (!canRetry || !WAKE_STATUSES.has(res.status) || Date.now() > until) return res;
    await sleep(RETRY_EVERY_MS);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = (env.ORIGIN || "").replace(/\/+$/, "");
    if (!origin) return new Response("Pulse Navigator is not connected to its server yet (ORIGIN is not set).", { status: 503 });

    // /pulse-navigator -> /pulse-navigator/ so the app's relative links resolve under the prefix
    if (url.pathname === PREFIX) return Response.redirect(`${url.origin}${PREFIX}/${url.search}`, 301);

    let path, prefix = "";
    if (url.pathname.startsWith(PREFIX + "/")) { path = url.pathname.slice(PREFIX.length); prefix = PREFIX; }
    else if (url.hostname.endsWith(".workers.dev")) path = url.pathname;      // test address: app at the root
    else return fetch(request);                                               // not ours: pass through untouched

    const target = origin + path + url.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");
    if (prefix) headers.set("x-forwarded-prefix", prefix); else headers.delete("x-forwarded-prefix");
    const ip = request.headers.get("cf-connecting-ip");
    if (ip) headers.set("x-forwarded-for", ip);

    const init = { method: request.method, headers, redirect: "manual" };
    let canRetry = true;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const len = Number(request.headers.get("content-length") || "0");
      if (len > 0 && len <= MAX_BUFFER) init.body = await request.arrayBuffer();          // small body: keep it for retries
      else if (len === 0 && !request.body) init.body = undefined;
      else { init.body = request.body; init.duplex = "half"; canRetry = false; }        // big upload: stream once
    }
    const res = await fetchWaking(target, init, canRetry);

    // Keep redirects on this address, never on the server's own address
    const loc = res.headers.get("location");
    if (loc && loc.startsWith(origin)) {
      const out = new Response(res.body, res);
      out.headers.set("location", `${url.origin}${prefix}${loc.slice(origin.length)}`);
      return out;
    }
    return res;
  },

  // Runs every 10 minutes (wrangler.jsonc "triggers"): keeps Render's free server from falling asleep.
  async scheduled(event, env, ctx) {
    const origin = (env.ORIGIN || "").replace(/\/+$/, "");
    if (origin) ctx.waitUntil(fetch(origin + "/healthz", { headers: { "user-agent": "pulse-navigator-keepalive" } }).catch(() => {}));
  },
};
