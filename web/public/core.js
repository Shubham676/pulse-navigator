"use strict";
/* Pulse Seller Platform: shared state, API calls, data shaping, navigation and UI helpers. */
const $ = id => document.getElementById(id);
const sum = a => a.reduce((x, y) => x + (Number(y) || 0), 0);
const S = { me: null, D: null, period: "W", favs: {}, agentFilter: "All", agentQ: "", insFilter: "All", campFilter: "All", campQ: "", rep: { type: "SP", tab: "Campaign" },
  trendMetric: "Ad spend", splitBy: "Sales", bidRun: null, kwQuery: "", projFrom: 30, projTo: 7, stdType: "units", thinking: true, chatId: null, chats: [], chatMsgs: [], uploadOpts: {} };
try { S.favs = JSON.parse(localStorage.getItem("pulse.favs") || "{}"); } catch (e) { /* storage unavailable */ }

/* ---------- API ---------- */
async function api(method, url, body, { raw } = {}) {
  const opts = { method, headers: { "x-pulse": "1" }, credentials: "same-origin" };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth")) { showAuth("login"); throw new Error(data.error || "Please sign in."); }
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.code = data.code; e.status = res.status; throw e; }
  return data;
}

/* ---------- formatting ---------- */
const fmtD = d => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fmtDT = d => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const ymdIST = d => new Date(new Date(d).getTime() + 330 * 6e4).toISOString().slice(0, 10);
const colorOf = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 45% 55%)`; };

/* ---------- data shaping: turns the API payload into the arrays the pages use ---------- */
let SKUS = [], DAILY = [], LONG = [], CAMPAIGNS = [], SEARCH_TERMS = [], HOURLY = Array(24).fill(0), DAYS = 120, TODAY = new Date();
const FEE = () => S.D?.org.feeRate ?? 0.2;
function shape(D) {
  TODAY = new Date(ymdIST(new Date()) + "T00:00:00+05:30");
  const key = (d, sku) => d + "|" + sku, byDaySku = new Map(), ret = new Map(), ord = new Map(D.dayOrders.map(r => [r.d, r]));
  D.daily.forEach(r => byDaySku.set(key(r.d, r.sku), r));
  D.dayReturns.forEach(r => ret.set(key(r.d, r.sku), r.qty));
  const skuSet = new Set([...D.products.map(p => p.sku), ...D.daily.map(r => r.sku)]);
  const mk = n => Array.from({ length: n }, (_, i) => {
    const date = new Date(TODAY.getTime() - (n - 1 - i) * 864e5), ds = ymdIST(date);
    const rows = [...skuSet].map(sku => { const r = byDaySku.get(key(ds, sku)); return { sku, units: r?.units || 0, rev: r?.rev || 0, canc: r?.canc || 0, ret: ret.get(key(ds, sku)) || 0 }; });
    return { date, ds, rows, units: sum(rows.map(r => r.units)), rev: sum(rows.map(r => r.rev)), ret: sum(rows.map(r => r.ret)), canc: sum(rows.map(r => r.canc)), orders: ord.get(ds)?.orders || 0, cancelled: ord.get(ds)?.cancelled || 0 };
  });
  DAILY = mk(DAYS); LONG = mk(400);
  const last30 = new Map(); DAILY.slice(-30).forEach(d => d.rows.forEach(r => { const x = last30.get(r.sku) || { u: 0, rev: 0, ret: 0, canc: 0 }; x.u += r.units; x.rev += r.rev; x.ret += r.ret; x.canc += r.canc; last30.set(r.sku, x); }));
  const traffic = new Map(D.traffic.map(t => [t.sku, t])), links = new Map(); D.links.forEach(l => links.set(l.sku, [...(links.get(l.sku) || []), l.marketplace]));
  SKUS = [...skuSet].map(sku => {
    const p = D.products.find(x => x.sku === sku) || { sku, name: sku }, m = last30.get(sku) || { u: 0, rev: 0, ret: 0, canc: 0 };
    const price = p.price || (m.u ? m.rev / m.u : null);
    return { sku, asin: p.asin, name: p.name || sku, cat: p.category || "Uncategorised", price, cogs: p.cogs, img: colorOf(sku), fba: p.fba_qty || 0, fbm: p.fbm_qty || 0, daily: m.u / 30,
      retRate: m.u ? m.ret / m.u : 0, cancelRate: m.u + m.canc ? m.canc / (m.u + m.canc) : 0, rating: p.rating, reviews: p.reviews, images: p.images, bullets: p.bullets, aplus: p.has_aplus,
      mapped: [D.org.marketplace, ...(links.get(sku) || [])], suppressed: p.status === "Suppressed" ? (p.suppressed_reason || "Suppressed") : null, status: p.status, inventoryAsOf: p.inventory_as_of,
      sessions: traffic.get(sku)?.sessions ?? null, buyBox: traffic.get(sku)?.buy_box ?? null, titleLength: p.title_length };
  });
  CAMPAIGNS = D.campaigns.map(c => ({ ...c, budget: c.budget || 0, start: c.start ? new Date(c.start) : null }));
  SEARCH_TERMS = D.terms.map(t => ({ ...t, bid: t.clicks ? t.spend / t.clicks : 0 }));
  HOURLY = Array(24).fill(0); D.hourly.forEach(h => (HOURLY[h.h] = h.units));
}
const skuOf = id => SKUS.find(s => s.sku === id) || { sku: id, name: id || "Unknown product", price: null, cogs: null, img: "#999", cat: "" };
const margin = s => s && s.cogs != null && s.price ? 1 - s.cogs / s.price - FEE() : null;
const hasData = () => !!S.D && (S.D.daily.length > 0 || S.D.campaigns.length > 0 || S.D.products.length > 0);
const PER = { D: [1, "the day before"], W: [7, "previous 7 days"], M: [30, "previous 30 days"], Q: [60, "previous 60 days"] };
function range(n, back = 0) { const a = DAILY.slice(DAYS - n - back, DAYS - back); return { days: a, units: sum(a.map(d => d.units)), rev: sum(a.map(d => d.rev)), ret: sum(a.map(d => d.ret)), canc: sum(a.map(d => d.canc)), orders: sum(a.map(d => d.orders)), cancelled: sum(a.map(d => d.cancelled)) }; }
function skuRange(sku, n, back = 0) { const a = DAILY.slice(DAYS - n - back, DAYS - back).map(d => d.rows.find(r => r.sku === sku) || { units: 0, rev: 0, ret: 0, canc: 0 }); return { units: sum(a.map(r => r.units)), rev: sum(a.map(r => r.rev)), ret: sum(a.map(r => r.ret)), canc: sum(a.map(r => r.canc)), series: a.map(r => r.units) }; }
const cur = () => range(PER[S.period][0]), prev = () => range(PER[S.period][0], PER[S.period][0]);
const geoFor = n => { const w = [1, 7, 30, 60].find(x => x >= n) || 60; return S.D.geo.filter(g => g.days === w).sort((a, b) => b.rev - a.rev); };

/* ---------- ads maths ---------- */
function cm(c) { const s = skuOf(c.sku), acos = c.sales ? c.spend / c.sales : null, mg = c.sku ? margin(s) : null; return { s, acos, roas: c.spend ? c.sales / c.spend : 0, ctr: c.impressions ? c.clicks / c.impressions : 0, cpc: c.clicks ? c.spend / c.clicks : 0, cvr: c.clicks ? c.orders / c.clicks : 0, be: mg, profit: mg == null ? null : c.sales * mg - c.spend }; }
function adTotals(list = CAMPAIGNS) { const t = k => sum(list.map(c => c[k])); const spend = t("spend"), sales = t("sales"), clicks = t("clicks"), imp = t("impressions"), orders = t("orders"); return { spend, sales, clicks, imp, orders, acos: sales ? spend / sales : 0, roas: spend ? sales / spend : 0, ctr: imp ? clicks / imp : 0, cpc: clicks ? spend / clicks : 0 }; }
function insights() {
  const out = [], target = (S.D.org.targetAcos || 30) / 100, negSet = new Set(S.D.negatives.map(n => n.camp + "|" + n.keyword));
  CAMPAIGNS.forEach(c => {
    const m = cm(c), id = k => c.id + k;
    if (c.status !== "Live") return;
    const limit = m.be ?? target;
    if (c.spend > 300 && m.roas < .8) out.push({ id: id("w"), type: "Waste", c, title: `Pause or cap ${c.name}`, why: `${inr(c.spend)} spent in 31 days for ${inr(c.sales)} in sales (ROAS ${m.roas.toFixed(2)}).`, act: "pause", label: "Pause campaign", val: c.spend - c.sales * (m.be ?? target) });
    else if (m.acos != null && m.acos > limit && c.spend > 200) out.push({ id: id("r"), type: "Risk", c, title: m.be != null ? `${c.name} loses money on every sale` : `${c.name} is above your target ACoS`, why: `ACoS ${pct(m.acos)} against ${m.be != null ? "break-even " + pct(m.be) : "target " + pct(target)}.`, act: "bid", v: -Math.min(40, Math.round((1 - limit / m.acos) * 100)), label: `Lower bids ${Math.min(40, Math.round((1 - limit / m.acos) * 100))}%`, val: c.spend - c.sales * limit });
    else if (m.roas >= 3 && c.orders >= 3 && (m.acos ?? 1) < limit * .8) out.push({ id: id("o"), type: "Opportunity", c, title: `Scale ${c.name}`, why: `ROAS ${m.roas.toFixed(1)} with ${c.orders} orders, well under your ACoS limit.`, act: "budget", v: 25, label: "Raise budget 25%", val: c.sales * .25 });
    const negs = SEARCH_TERMS.filter(t => t.camp === c.id && t.orders === 0 && t.clicks >= 6 && !negSet.has(c.id + "|" + t.term));
    if (negs.length) out.push({ id: id("s"), type: "Suggestion", c, title: `Add ${negs.length} negative keyword${negs.length > 1 ? "s" : ""} to ${c.name}`, why: negs.slice(0, 4).map(t => `“${t.term}”`).join(", ") + (negs.length > 4 ? ` and ${negs.length - 4} more` : "") + " took clicks without orders.", act: "neg", terms: negs.map(t => t.term), label: "Add negatives", val: sum(negs.map(t => t.spend)) });
    if (c.budget && c.spend / 31 > c.budget * .9) out.push({ id: id("i"), type: "Info", c, title: `${c.name} runs out of budget most days`, why: `Average spend ${inr(c.spend / 31)} a day against a ${inr(c.budget)} budget.`, act: "budget", v: 20, label: "Raise budget 20%", val: 0 });
  });
  return out.sort((a, b) => b.val - a.val);
}
const openInsights = () => insights();

/* ---------- UI helpers ---------- */
function delta(a, b, inverse) { if (!b) return `<span class="delta flat">${a ? "new" : "–"}</span>`; const x = (a - b) / b, good = inverse ? x <= 0 : x >= 0; return `<span class="delta ${Math.abs(x) < .005 ? "flat" : good ? "up" : "down"}">${x >= 0 ? "▲" : "▼"} ${Math.abs(x * 100).toFixed(1)}%</span>`; }
function kpi(label, a, b, fmt = num, inverse = false, foot) { return `<div class="kpi"><span>${label}</span><b>${fmt(a)}</b><small>${b == null ? (foot || "") : delta(a, b, inverse) + (foot || fmt(b) + " " + PER[S.period][1])}</small></div>`; }
function periodSeg() { return `<div class="seg" role="group" aria-label="Compare period">${["D", "W", "M", "Q"].map(p => `<button type="button" data-period="${p}" aria-pressed="${S.period === p}" title="${{ D: "Day", W: "Week", M: "30 days", Q: "60 days" }[p]}">${p}</button>`).join("")}</div>`; }
function head(title, sub, right = "") { return `<div class="ph"><div class="grow"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>${right}</div>`; }
function card(title, body, { sub = "", right = "", id = "" } = {}) { return `<section class="card"${id ? ` id="${id}"` : ""}><div class="hd"><h3>${title}</h3>${sub ? `<span class="sub">${sub}</span>` : ""}<div class="r">${right}</div></div>${body}</section>`; }
function strip(items) { items = items.filter(Boolean); return items.length ? `<div class="strip">${items.map(i => `<div class="it ${i.t || ""}"><div><b>${i.h}</b><span>${i.p}</span></div></div>`).join("")}</div>` : ""; }
// A note shown where a page needs a report that has not been uploaded yet
function need(what, report) { return `<div class="need"><span>${what}</span><a href="#account-data${report ? "-" + report : ""}">Add data</a></div>`; }
let TBL = {}, tblN = 0;
function table(cols, rows, { empty = "No rows for this filter.", name = "report", max } = {}) {
  const id = "t" + (++tblN); TBL[id] = { cols: cols.map(c => c.l || c), rows: rows.map(r => r.map(c => typeof c === "object" && c !== null ? c.csv ?? c.v : c)), name };
  const body = rows.length ? rows.map(r => `<tr>${r.map((c, i) => { const o = typeof c === "object" && c !== null ? c : { v: c, h: esc(c) }; const cls = cols[i] && cols[i].left ? ' class="l"' : ""; return `<td${cls} data-v="${esc(o.s ?? o.v)}">${o.h ?? esc(o.v)}</td>`; }).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="empty">${empty}</td></tr>`;
  return `<div class="tw"${max ? ` style="max-height:${max}px"` : ""}><table data-tbl="${id}"><thead><tr>${cols.map(c => `<th${c.left ? ' class="l"' : ""}>${esc(c.l || c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const copyBtn = () => `<button type="button" class="btn sm" data-act="copycsv"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy CSV</button>`;
const prod = s => ({ v: s.name, s: s.name, csv: s.sku, h: `<div class="prod"><i style="background:linear-gradient(135deg,${s.img},color-mix(in srgb,${s.img} 55%,#000))"></i><div>${esc(s.name)}<small>${esc(s.sku)}</small></div></div>` });
const N = (v, f = num) => ({ v: v ?? "", h: v == null ? "–" : f(v) });
const pill = (t, cls) => ({ v: t, h: `<span class="pill ${cls}">${esc(t)}</span>` });
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3200); }
function modal(html) { $("modal").innerHTML = html; $("scrim").hidden = false; const f = $("modal").querySelector("input,select,textarea,button:not(.x)"); if (f) f.focus(); }
function closeModal() { $("scrim").hidden = true; $("modal").innerHTML = ""; }
const busy = (btn, on) => { if (!btn) return; if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${btn.dataset.busy || "Working"}`; } else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; } };
const canEdit = () => S.me && ["owner", "admin", "member"].includes(S.me.org?.role);
const isAdmin = () => S.me && ["owner", "admin"].includes(S.me.org?.role);
function emptyPage(title, sub) {
  return head(title, sub) + `<section class="card empty-state"><h3>No data yet for ${esc(S.D.org.name)}</h3><p style="margin:0;color:var(--ink2);max-width:62ch">Upload your Amazon reports or connect your Amazon seller account, and this page fills in. Most sellers start with the All Orders report and the Sponsored Products campaign report.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn pri" href="#account-data">Upload reports</a><a class="btn" href="#account-channels">Connect Amazon</a>${isAdmin() && !hasData() ? `<button type="button" class="btn" data-act="loadsample">Try with sample data</button>` : ""}</div></section>`;
}

/* ---------- navigation ---------- */
const NAV = {
  copilot: { title: "Copilot", groups: [["", [["copilot", "Chat"]]]] },
  agents: { title: "AI agents", groups: [["", [["agents", "All agents"], ["agents-history", "Run history"]]]] },
  analytics: { title: "Analytics", groups: [["", [["analytics-home", "Overview"]]], ["Sales", [["analytics-shipped", "Shipped orders"], ["analytics-cancelled", "Cancellations"], ["analytics-returns", "Returns"], ["analytics-coupons", "Coupons"], ["analytics-promotions", "Deals and promotions"], ["analytics-analysis", "Sales analysis"], ["analytics-projection", "Sales projection"], ["analytics-repeat", "Repeat purchase"]]], ["Inventory", [["analytics-inventory", "Inventory dashboard"], ["analytics-invproj", "Inventory projection"], ["analytics-suppressed", "Suppressed listings"], ["analytics-pim", "Product master"]]], ["Business", [["analytics-standard", "Standard report"], ["analytics-weekly", "Weekly comparison"], ["analytics-timesheet", "Time sheet"], ["analytics-pnl", "Profit and loss"]]]] },
  ads: { title: "Ads", groups: [["", [["ads-overview", "Ads overview"], ["ads-campaigns", "Campaign manager"], ["ads-reports", "Reports"]]], ["Tools", [["ads-tracker", "Performance tracker"], ["ads-dayparting", "Dayparting"], ["ads-bids", "Bid analysis"], ["ads-keywords", "Keyword intelligence"]]]] },
  account: { title: "Data and account", groups: [["", [["account-data", "Upload reports"], ["account-channels", "Amazon connections"], ["account-wallet", "Wallet and invoices"], ["account-memory", "Copilot memory"], ["account-settings", "Brand and team"]]]] }
};
const VIEWS = {};
function route() { const h = (location.hash.slice(1) || "analytics-home").split("?")[0], base = VIEWS[h] ? h : h.replace(/-[a-z0-9_]+$/, ""), sec = base.split("-")[0]; return NAV[sec] && VIEWS[base] ? { h: base, sec, arg: h !== base ? h.slice(base.length + 1) : "" } : { h: "analytics-home", sec: "analytics", arg: "" }; }
function renderSide(r) {
  const n = NAV[r.sec], badge = { "ads-overview": hasData() ? openInsights().length : 0, "analytics-suppressed": SKUS.filter(s => s.suppressed).length };
  const lastOrders = S.D.imports.find(i => i.report === "orders"), lastAds = S.D.imports.find(i => i.report === "ads_campaigns");
  $("side").innerHTML = `<h1>${n.title}</h1>` + n.groups.map(([g, items]) => (g ? `<div class="grp">${g}</div>` : "") + items.map(([k, t]) => `<a href="#${k}"${k === r.h ? ' aria-current="page"' : ""}>${t}${badge[k] ? `<span class="n">${badge[k]}</span>` : ""}</a>`).join("")).join("")
    + `<div class="card"><b>${esc(S.D.org.name)}</b><br>${lastOrders ? "Orders updated " + fmtDT(lastOrders.created_at) : "No orders data yet"}<br>${lastAds ? "Ads updated " + fmtDT(lastAds.created_at) : "No ads data yet"}<br><a href="#account-data">Add data</a></div>`;
  document.querySelectorAll(".rail a").forEach(a => a.dataset.sec === r.sec ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const t = n.groups.flatMap(g => g[1]).find(x => x[0] === r.h);
  $("crumb").innerHTML = `${n.title}${t && t[1] !== n.title ? ` <span aria-hidden="true">›</span> <b>${t[1]}</b>` : ""}`;
}
function render() {
  if (!S.D) return;
  const r = route(); tblN = 0; TBL = {};
  renderSide(r);
  try { $("page").innerHTML = VIEWS[r.h](r.arg); }
  catch (e) { console.error(e); $("page").innerHTML = `<section class="card empty-state"><h3>This page could not be shown</h3><p>${esc(e.message)}</p></section>`; }
  $("walBal").textContent = inr(S.D.org.wallet);
  const o = S.D.imports.find(i => i.report === "orders");
  $("fresh").textContent = o ? `Data to ${fmtD(S.D.daily.reduce((m, r) => r.d > m ? r.d : m, "2000-01-01"))}` : "No data yet";
  if (r.h === "copilot") { const m = $("msgs"); if (m) m.scrollTop = m.scrollHeight; }
}
addEventListener("hashchange", () => { render(); $("work").scrollTop = 0; });

async function reload(silent) {
  try { S.D = await api("GET", "/api/data"); shape(S.D); render(); }
  catch (e) { if (!silent) toast(e.message); }
}

/* ---------- sign in / sign up ---------- */
function showAuth(mode, extra = {}) {
  $("appRoot").hidden = true; $("boot").hidden = true; const a = $("auth"); a.hidden = false;
  const inviteNote = extra.invite ? `<p>You've been invited to a brand on Pulse. ${mode === "invite-new" ? "Create your account to join." : "Sign in to accept."}</p>` : "";
  const f = (id, label, type = "text", ac = "") => `<label class="f">${label}<input class="inp" id="${id}" type="${type}" autocomplete="${ac}" required></label>`;
  const body = mode === "signup" ? `<h1>Create your Pulse account</h1><p>Free to start. You can add your team later.</p>${f("auName", "Your name", "text", "name")}${f("auBrand", "Brand name")}${f("auEmail", "Work email", "email", "email")}${f("auPw", "Password (10+ characters)", "password", "new-password")}<p class="err" id="auErr"></p><button class="btn pri" type="submit">Create account</button><p>Already have an account? <a href="#" data-auth="login">Sign in</a></p>`
    : mode === "invite-new" ? `<h1>Join your team</h1>${inviteNote}${f("auName", "Your name", "text", "name")}${f("auPw", "Choose a password (10+ characters)", "password", "new-password")}<p class="err" id="auErr"></p><button class="btn pri" type="submit">Join</button><p>Already have an account? <a href="#" data-auth="invite-login">Sign in</a></p>`
      : `<h1>Sign in to Pulse</h1>${inviteNote}${f("auEmail", "Email", "email", "email")}${f("auPw", "Password", "password", "current-password")}<p class="err" id="auErr"></p><button class="btn pri" type="submit">Sign in</button>${extra.invite ? "" : `<p>New to Pulse? <a href="#" data-auth="signup">Create an account</a></p>`}`;
  a.innerHTML = `<form class="authcard" id="authForm" data-mode="${mode}" novalidate><div class="logo" aria-hidden="true" style="width:40px;height:40px;border-radius:12px;background:var(--accent);display:grid;place-items:center"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg></div>${body}</form>`;
  const first = a.querySelector("input"); if (first) first.focus();
}
async function submitAuth(form) {
  const v = id => ($(id) ? $(id).value.trim() : ""), mode = form.dataset.mode, err = $("auErr"), btn = form.querySelector("button[type=submit]");
  err.textContent = ""; busy(btn, true);
  try {
    const invite = S.invite;
    if (mode === "signup") await api("POST", "/api/auth/signup", { name: v("auName"), brand: v("auBrand"), email: v("auEmail"), password: $("auPw").value });
    else if (mode === "invite-new") await api("POST", "/api/invites/accept", { token: invite, name: v("auName"), password: $("auPw").value });
    else {
      await api("POST", "/api/auth/login", { email: v("auEmail"), password: $("auPw").value });
      if (invite) await api("POST", "/api/invites/accept", { token: invite, password: $("auPw").value });
    }
    S.invite = null; history.replaceState(null, "", location.pathname + "#analytics-home");
    await boot();
  } catch (e) {
    if (e.code === "needs_account") { showAuth("invite-new", { invite: true }); return; }
    err.textContent = e.message; busy(btn, false);
  }
}

async function boot() {
  const inv = location.hash.match(/invite=([\w-]+)/);
  if (inv) { S.invite = inv[1]; }
  try { S.me = await api("GET", "/api/me"); }
  catch (e) { showAuth(S.invite ? "invite-new" : "login", { invite: !!S.invite }); return; }
  if (S.invite) { try { await api("POST", "/api/invites/accept", { token: S.invite }); } catch (e) { if (e.code === "needs_login") { await api("POST", "/api/auth/logout"); showAuth("login", { invite: true }); return; } toast(e.message); } S.invite = null; S.me = await api("GET", "/api/me"); history.replaceState(null, "", location.pathname + "#analytics-home"); }
  $("auth").hidden = true; $("boot").hidden = true; $("appRoot").hidden = false;
  $("orgSel").innerHTML = S.me.orgs.map(o => `<option value="${o.id}"${o.id === S.me.org?.id ? " selected" : ""}>${esc(o.name)}</option>`).join("") + `<option value="new">+ Add a brand</option>`;
  $("userBtn").textContent = (S.me.user.name || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (!S.me.org) { $("page").innerHTML = head("Add your first brand", "") + `<section class="card"><button class="btn pri" data-act="neworg">Add a brand</button></section>`; return; }
  await reload();
  api("GET", "/api/copilot/chats").then(r => { S.chats = r.chats; }).catch(() => {});
}
