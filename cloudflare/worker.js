// Cloudflare Worker: serves Pulse Navigator at www.dumbledo.com/pulse-navigator by forwarding to the app server (Render).
// Everything else on the domain (the Shopify store) never reaches this Worker: its route only matches /pulse-navigator*.
// Set ORIGIN in Cloudflare (Worker > Settings > Variables), e.g. https://pulse-navigator.onrender.com

const PREFIX = "/pulse-navigator";

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
    if (request.method !== "GET" && request.method !== "HEAD") { init.body = request.body; init.duplex = "half"; }
    const res = await fetch(target, init);

    // Keep redirects on this address, never on the server's own address
    const loc = res.headers.get("location");
    if (loc && loc.startsWith(origin)) {
      const out = new Response(res.body, res);
      out.headers.set("location", `${url.origin}${prefix}${loc.slice(origin.length)}`);
      return out;
    }
    return res;
  },
};
