"use strict";
/* Connections: every sales channel, store and shipping partner in one place, with API credentials and webhooks. */

const ACCESS = {
  live: ["Live sync", "ok", "Data syncs automatically."],
  api: ["API", "info", "Credentials are checked against the platform's API."],
  keys: ["API keys", "mut", "Credentials are stored securely. Automatic data sync for this platform is coming later."],
  partner: ["Partner API", "warn", "This platform gives API access to approved partners only."],
  webhook: ["Webhook", "info", "Receives events from any system."]
};

function intLoad() {
  if (S.intCat && S.ints && S.conns) return true;
  if (!S.intLoading) {
    S.intLoading = true;
    Promise.all([S.intCat || api("GET", "/api/integrations/catalog"), S.ints || api("GET", "/api/integrations"), S.conns || api("GET", "/api/connections")])
      .then(([c, i, a]) => { S.intCat = c; S.ints = i; S.conns = a; })
      .catch(e => toast(e.message)).finally(() => { S.intLoading = false; render(); });
  }
  return false;
}
const intOf = id => (S.ints?.integrations || []).find(i => i.platform === id);
function logoTile(p, size = 44) {
  if (p.logo) return `<span class="clogo" style="width:${size}px;height:${size}px"><img src="${esc(p.logo)}" alt="" loading="lazy"></span>`;
  const c = p.color.replace("#", ""), [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16)), light = (r * 299 + g * 587 + b * 114) / 1000 > 160;
  return `<span class="clogo" aria-hidden="true" style="width:${size}px;height:${size}px;background:${esc(p.color)};color:${light ? "#1B1F1E" : "#fff"};font-size:${Math.round(size * (p.letters.length > 1 ? .36 : .46))}px">${esc(p.letters)}</span>`;
}
// Amazon and Shopify sync fully and live on the Account › Amazon and Shopify page
function liveStatus(id) {
  const c = S.conns?.connections || [], mine = c.filter(x => (id === "amazon" ? ["sp_api", "ads_api"] : [id]).includes(x.kind));
  if (!mine.length) return null;
  return mine.some(x => x.last_error) ? "error" : "connected";
}
function statusPill(st) {
  return st === "connected" ? `<span class="pill ok">Connected</span>` : st === "error" ? `<span class="pill bad">Needs attention</span>` : st === "saved" ? `<span class="pill info">Saved</span>` : `<span class="pill mut">Not connected</span>`;
}

VIEWS["connections"] = arg => {
  if (!intLoad()) return `<div class="empty">Loading connections…</div>`;
  if (arg) return connectionPage(arg);
  const P = S.intCat.platforms, st = p => p.access === "live" ? liveStatus(p.id) : intOf(p.id)?.status;
  const q = (S.intQ || "").toLowerCase(), shown = P.filter(p => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  const counts = { connected: P.filter(p => st(p) === "connected").length, saved: P.filter(p => st(p) === "saved").length, error: P.filter(p => st(p) === "error").length };
  const events = (S.ints.integrations || []).reduce((n, i) => n + i.events, 0);
  return head("Connections", "Connect your marketplaces, own store and shipping partners. API credentials are stored encrypted, and webhooks bring events in as they happen.")
    + `<div class="kpis">${[["Connected", counts.connected, "checked and working"], ["Saved", counts.saved, "waiting for API access or sync"], ["Need attention", counts.error, counts.error ? "open them to fix" : "all good"], ["Webhook events", events, `<a href="#connections-events">see all</a>`]]
      .map(([l, v, s]) => `<div class="kpi"><span>${l}</span><b>${num(v)}</b><small>${s}</small></div>`).join("")}</div>`
    + `<div class="card" style="padding:12px"><input class="inp" id="intSearch" type="search" placeholder="Search platforms, e.g. Flipkart, Shopify, quick commerce" aria-label="Search platforms" value="${esc(S.intQ || "")}"></div>`
    + S.intCat.categories.map(cat => {
      const list = shown.filter(p => p.category === cat);
      if (!list.length) return "";
      return `<h3 class="csec">${esc(cat)}</h3><div class="ctiles">${list.map(p => {
        const [al, ac] = ACCESS[p.access];
        return `<a class="ctile" href="#${p.access === "live" ? "account-channels" : "connections-" + p.id}">${logoTile(p)}<span class="cname"><b>${esc(p.name)}</b><span class="cpills"><span class="pill ${ac}">${al}</span>${statusPill(st(p))}</span></span></a>`;
      }).join("")}</div>`;
    }).join("")
    + (shown.length ? "" : `<div class="empty">No platform matches “${esc(S.intQ)}”. Use <a href="#connections-webhook_in">Incoming webhook</a> to connect any other system.</div>`)
    + `<p class="note" style="margin-top:18px">Logos: brand logos are shown when the official logo file is added to the app (web/public/logos/&lt;platform&gt;.svg). Until then each platform shows its initials.</p>`;
};

function connectionPage(id) {
  const p = S.intCat.platforms.find(x => x.id === id);
  if (!p) return head("Not found", "") + `<a href="#connections">Back to connections</a>`;
  if (p.access === "live") { location.hash = "account-channels"; return ""; }
  const it = intOf(p.id), [al, ac, ad] = ACCESS[p.access], admin = isAdmin();
  if (it && p.webhook && canEdit() && !(S.intEvents || {})[p.id]) {
    S.intEvents = S.intEvents || {}; S.intEvents[p.id] = { loading: true };
    api("GET", "/api/integrations/events?platform=" + encodeURIComponent(p.id)).then(r => { S.intEvents[p.id] = r; render(); }).catch(() => { S.intEvents[p.id] = { events: [] }; });
  }
  const field = f => {
    const saved = f.type === "secret" ? it?.secrets?.[f.key] : it?.settings?.[f.key];
    const ph = f.type === "secret" && saved ? `Saved (${saved}). Leave blank to keep it.` : f.placeholder;
    return `<label class="f">${esc(f.label)}${f.required ? "" : ` <small style="font-weight:500;color:var(--muted)">optional</small>`}<input class="inp" name="${esc(f.key)}" ${f.type === "secret" ? 'type="password"' : f.type === "url" ? 'type="url"' : 'type="text"'} autocomplete="off" spellcheck="false" placeholder="${esc(ph || "")}" value="${f.type === "secret" ? "" : esc(saved || "")}"${admin ? "" : " disabled"}></label>`;
  };
  const statusLine = it ? `<div class="metric"><span>Status</span>${statusPill(it.status)}</div>${it.message ? `<p class="note" style="${it.status === "error" ? "color:var(--bad)" : ""}">${esc(it.message)}</p>` : ""}${it.lastTestAt ? `<p class="note">Last checked ${fmtDT(it.lastTestAt)}</p>` : ""}` : "";
  const actions = it && admin ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${p.testable ? `<button type="button" class="btn sm" data-act="inttest" data-id="${p.id}" data-busy="Testing">Test connection</button>` : ""}<button type="button" class="btn sm ghost" data-act="intdel" data-id="${p.id}">Disconnect</button></div>` : "";
  const form = `<form id="intForm" data-platform="${p.id}" style="display:flex;flex-direction:column;gap:12px">${p.fields.length ? `<div class="form">${p.fields.map(field).join("")}</div>` : ""}
    <div><button class="btn pri" type="submit" data-busy="${p.testable ? "Checking" : "Saving"}"${admin ? "" : " disabled"}>${!p.fields.length ? (it ? "Save" : "Turn on") : p.testable ? (it ? "Save and test again" : "Save and test") : "Save"}</button></div></form>
    ${admin ? "" : `<p class="note">Only the brand owner or an admin can change connections.</p>`}`;
  const secretRow = it && admin ? `<div class="lcd" style="margin-top:12px"><b>Signing secret</b><div style="display:flex;gap:8px;margin-top:6px"><input class="inp" id="intSecret" type="password" readonly value="${esc(it.signingSecret || "")}" aria-label="Signing secret"><button type="button" class="btn" data-act="intshow">Show</button><button type="button" class="btn" data-act="copy" data-copy="intSecret">Copy</button></div></div>` : "";
  const how = {
    shopify: `In Shopify admin go to <b>Settings → Notifications → Webhooks</b>, click <b>Create webhook</b>, choose an event (for example Order creation), format <b>JSON</b>, and paste the address above. Paste the key Shopify signs webhooks with into <b>API secret key</b> above so Pulse Navigator can verify each event.`,
    woocommerce: `In WordPress go to <b>WooCommerce → Settings → Advanced → Webhooks → Add webhook</b>. Set the delivery URL to the address above and use the same <b>Secret</b> as the webhook secret saved above.`,
    generic: `Send a <b>POST</b> with a JSON body to the address above. Put the event name in the <b>X-Event-Type</b> header or an <code>event</code> field. To prove it came from you, add the header <b>X-Pulse-Signature: sha256=&lt;HMAC-SHA256 of the body, hex, using the signing secret&gt;</b>. Unsigned events are kept but marked unverified.`
  }[p.webhook];
  const ev = (S.intEvents || {})[p.id];
  const webhookCard = !p.webhook ? "" : card("Webhooks", !it ? `<p class="note" style="margin-top:0">${p.fields.length ? "Save the connection above" : "Turn this on"} to get a webhook address for ${esc(p.name)}.</p>` : `
      <label class="f">Webhook address<div style="display:flex;gap:8px"><input class="inp" id="intHook" readonly value="${esc(it.webhookUrl)}"><button type="button" class="btn" data-act="copy" data-copy="intHook">Copy</button></div></label>
      ${p.webhook === "generic" ? secretRow : ""}
      <p class="note">${how}</p>
      ${admin ? `<p class="note">Address leaked? <button type="button" class="linkbtn" data-act="introtate" data-id="${p.id}">Get a new address and secret</button>. The old one stops working at once.</p>` : ""}
      <h4 style="margin:18px 0 6px">Recent events</h4>${!canEdit() ? `<p class="note">Members and above can see events.</p>` : !ev || ev.loading ? `<p class="note">Loading…</p>` : eventsTable(ev.events, false)}`, { right: it ? `<span class="pill info">${num(it.events)} received</span>` : "" });
  return `<p style="margin:0 0 10px"><a href="#connections">← All connections</a></p>`
    + `<div class="ph"><div class="grow" style="display:flex;gap:14px;align-items:center">${logoTile(p, 56)}<div><h2 style="margin:0">${esc(p.name)}</h2><p style="margin:4px 0 0"><span class="pill ${ac}">${al}</span> <span class="note">${esc(ad)}</span></p></div></div></div>`
    + (p.note ? `<div class="lcd" style="margin-bottom:14px">${esc(p.note)}</div>` : "")
    + `<div class="grid g2">${card(p.id === "webhook_out" ? "Where to send events" : p.fields.length ? "API connection" : "Connection", form + statusLine + actions + (p.id === "webhook_out" ? secretRow : ""))}${webhookCard}</div>`;
}

function eventsTable(events, showPlatform) {
  if (!events.length) return `<p class="note">No events yet.</p>`;
  const name = id => S.intCat?.platforms.find(p => p.id === id)?.name || id;
  return table([{ l: "Received", left: true }, ...(showPlatform ? [{ l: "From", left: true }] : []), { l: "Event", left: true }, "Verified", { l: "Content", left: true }, ""],
    events.map(e => {
      const preview = e.body ? JSON.stringify(e.body) : e.body_text || "";
      return [{ v: new Date(e.received_at).getTime(), h: fmtDT(e.received_at) }, ...(showPlatform ? [name(e.platform)] : []), e.topic || "—",
        { v: e.verified ? 1 : 0, h: e.verified ? `<span class="pill ok">Yes</span>` : `<span class="pill mut">No</span>` },
        { v: preview, h: `<code class="trunc">${esc(preview.slice(0, 90))}</code>` }, { v: "", h: `<button type="button" class="btn sm" data-act="viewevent" data-id="${e.id}">View</button>` }];
    }), { name: "webhook-events" });
}

VIEWS["connections-events"] = () => {
  if (!intLoad()) return `<div class="empty">Loading…</div>`;
  if (!canEdit()) return head("Webhook events", "") + `<p class="note">Members and above can see webhook events.</p>`;
  if (!S.intAllEvents) { S.intAllEvents = { loading: true }; api("GET", "/api/integrations/events").then(r => { S.intAllEvents = r; render(); }).catch(e => { S.intAllEvents = { events: [] }; toast(e.message); }); }
  return head("Webhook events", "The latest 50 events sent to Pulse Navigator by your connected platforms.", `<button type="button" class="btn" data-act="intrefresh">Refresh</button>`)
    + card("Events", S.intAllEvents.loading ? `<p class="note">Loading…</p>` : eventsTable(S.intAllEvents.events, true));
};

function intReset() { S.ints = null; S.intEvents = {}; S.intAllEvents = null; }
