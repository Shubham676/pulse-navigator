"use strict";
/* All clicks, form submits and changes. */

async function act(fn, btn, okMsg) {
  busy(btn, true);
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message); return null; }
  finally { busy(btn, false); }
}
const confirmModal = (title, body, btnLabel, onYes) => {
  modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">${title}</h3><div style="margin:10px 0 16px">${body}</div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn pri" id="yesBtn">${btnLabel}</button></div>`);
  $("yesBtn").onclick = () => onYes($("yesBtn"));
};

async function applyInsight(i, btn) {
  const body = i.act === "pause" ? { status: "Paused" } : i.act === "budget" ? { budget: Math.round((i.c.budget || 0) * (1 + i.v / 100)) || undefined } : i.act === "bid" ? { bidAdjust: (i.c.bidAdj || 0) + i.v } : null;
  if (i.act === "budget" && !i.c.budget) { toast("This campaign has no budget on file. Set it in Campaign manager first."); return; }
  const r = i.act === "neg" ? await act(() => api("POST", "/api/ads/negatives", { campaignId: i.c.id, keywords: i.terms }), btn)
    : await act(() => api("POST", `/api/ads/campaigns/${encodeURIComponent(i.c.id)}`, { ...body, reason: i.label }), btn);
  if (!r) return;
  toast(r.pushed ? `${i.label}: sent to Amazon` : r.error ? `Saved in Pulse, but Amazon refused it: ${r.error}` : `${i.label}: saved in Pulse. Make the same change in Amazon Ads, or connect Ads to do it automatically.`);
  await reload(true);
}

function alertsDrawer() {
  const d = $("drawer"); d.hidden = !d.hidden; if (d.hidden) return;
  const items = [];
  (S.D.health?.metrics.shipping || []).filter(m => m[2] === "<" ? m[1] >= m[3] : m[1] <= m[3]).forEach(m => items.push(["bad", `${m[0]} is ${m[1]}%`, `Amazon's limit is ${m[2] === "<" ? "under" : "over"} ${m[3]}%.`, "#analytics-home"]));
  const low = SKUS.filter(s => s.daily > 0 && (s.fba + s.fbm) / (s.daily * 7) < 2); if (low.length) items.push(["warn", `${low.length} SKUs will run out within 2 weeks`, low.slice(0, 3).map(s => s.name).join(", "), "#analytics-inventory"]);
  const sup = SKUS.filter(s => s.suppressed); if (sup.length) items.push(["bad", `${sup.length} listings suppressed`, "Hidden from search until fixed.", "#analytics-suppressed"]);
  const ins = hasData() ? insights().length : 0; if (ins) items.push(["info", `${ins} ad insights`, "Waste, risks and opportunities.", "#ads-overview"]);
  S.D.trackers.filter(t => t.on).forEach(t => { const m = matches(t); if (m.length) items.push(["warn", `${t.name}: ${m.length} match${m.length > 1 ? "es" : ""}`, m.slice(0, 3).map(c => c.name).join(", "), "#ads-tracker"]); });
  const nearEnd = S.D.coupons.filter(c => c.budget && c.spent / c.budget > .85 && (!c.end || c.end >= ymdIST(Date.now()))); if (nearEnd.length) items.push(["warn", `${nearEnd.length} coupon${nearEnd.length > 1 ? "s" : ""} near budget`, nearEnd.map(c => c.name || c.id).join(", "), "#analytics-coupons"]);
  d.innerHTML = `<div style="display:flex;align-items:center;margin-bottom:12px"><h3 style="margin:0;flex:1;font-family:var(--f-display);font-size:20px">Alerts</h3><button type="button" class="btn sm ghost" data-act="closedrawer" aria-label="Close">✕</button></div>
    <div class="ins">${items.map(([c, t, p, h]) => `<a class="row" href="${h}" style="text-decoration:none;color:inherit;grid-template-columns:auto 1fr"><span class="pill ${c}">&nbsp;</span><p><b>${esc(t)}</b><small>${esc(p)}</small></p></a>`).join("") || `<p class="note">Nothing needs attention right now.</p>`}</div>`;
}

async function topUp(amount, btn) {
  const r = await act(() => api("POST", "/api/wallet/topup", { amount }), btn); if (!r) return;
  if (r.credited) { closeModal(); toast(`${inr(amount)} added`); S.wallet = null; await reload(true); return; }
  await new Promise((res, rej) => { if (window.Razorpay) return res(); const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = res; s.onerror = () => rej(new Error("Could not load the payment window. Check your connection.")); document.head.appendChild(s); }).catch(e => toast(e.message));
  if (!window.Razorpay) return;
  const rz = new window.Razorpay({ key: r.keyId, order_id: r.orderId, amount: r.amountPaise, currency: "INR", name: "Pulse", description: `Wallet top-up ${inr(amount)} + GST`, prefill: { email: S.me.user.email, name: S.me.user.name },
    handler: async p => { const v = await act(() => api("POST", "/api/wallet/verify", p), null); if (v) { closeModal(); toast(`${inr(amount)} added. Invoice ${v.invoiceNo}`); S.wallet = null; await reload(true); } },
    theme: { color: "#0E6B62" } });
  rz.on("payment.failed", e => toast(`Payment failed: ${e.error?.description || "try again"}`));
  rz.open();
}

document.addEventListener("click", async e => {
  const th = e.target.closest("thead th");
  if (th) { const tb = th.closest("table"), i = [...th.parentNode.children].indexOf(th), dir = th.dataset.dir === "desc" ? "asc" : "desc"; th.parentNode.querySelectorAll("th").forEach(x => delete x.dataset.dir); th.dataset.dir = dir;
    const rows = [...tb.tBodies[0].rows]; if (rows.length < 2 || !rows[0].cells[i]) return; rows.sort((a, b) => { const x = a.cells[i].dataset.v, y = b.cells[i].dataset.v, nx = parseFloat(x), ny = parseFloat(y); const r = !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x).localeCompare(String(y)); return dir === "asc" ? r : -r; }); rows.forEach(r => tb.tBodies[0].appendChild(r)); return; }
  const authLink = e.target.closest("[data-auth]");
  if (authLink) { e.preventDefault(); const m = authLink.dataset.auth; showAuth(m === "invite-login" ? "login" : m, { invite: !!S.invite }); return; }
  if (!e.target.closest("#userMenu") && !e.target.closest("#userBtn")) $("userMenu")?.remove();
  const b = e.target.closest("button,[data-act]"); if (!b) return; const d = b.dataset;
  if (d.period) { S.period = d.period; render(); return; }
  if (d.agf) { S.agentFilter = d.agf; render(); return; }
  if (d.insf) { S.insFilter = d.insf; render(); return; }
  if (d.trend) { S.trendMetric = d.trend; render(); return; }
  if (d.split) { S.splitBy = d.split; render(); return; }
  if (d.campf) { S.campFilter = d.campf; render(); return; }
  if (d.rept) { S.rep.type = d.rept; render(); return; }
  if (d.reptab) { S.rep.tab = d.reptab; render(); return; }
  if (d.hr !== undefined && b.closest("#modal")) { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); return; }
  switch (d.act) {
    case "close": closeModal(); break;
    case "closedrawer": $("drawer").hidden = true; break;
    case "copycsv": { const t = TBL[b.closest(".card,.page").querySelector("table[data-tbl]")?.dataset.tbl]; if (!t) return; const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v ?? ""; const csv = [t.cols, ...t.rows].map(r => r.map(q).join(",")).join("\n"); navigator.clipboard.writeText(csv).then(() => toast(`Copied ${t.rows.length} rows as CSV`), () => toast("The browser blocked copying")); break; }
    case "ask": ask(d.q); break;
    case "newchat": S.chatId = null; S.chatMsgs = []; render(); break;
    case "openchat": { const r = await act(() => api("GET", `/api/copilot/chats/${d.id}`)); if (r) { S.chatId = Number(d.id); S.chatMsgs = r.messages; render(); } break; }
    case "thinking": S.thinking = !S.thinking; render(); break;
    case "agent": openAgent(d.id); break;
    case "runagent": {
      const a = S.agents.find(x => x.id === d.id), sku = $("agSku")?.value, body = { agent: d.id, sku, keyword: $("agKw")?.value || undefined, brief: $("agBrief")?.value || undefined };
      $("agMsg").textContent = "";
      busy(b, true);
      try { const r = await api("POST", "/api/agents/run", body); $("agOut").innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:16px 0">${agentOutput(r.output)}`; S.D.org.wallet = r.balance; $("walBal").textContent = inr(r.balance); S.runs = null; toast(`${inr(a.cost)} charged`); }
      catch (err) { $("agMsg").innerHTML = esc(err.message) + (err.code === "low_balance" && isAdmin() ? ` <button type="button" class="btn sm" data-act="addmoney">Add money</button>` : ""); }
      busy(b, false); break;
    }
    case "viewrun": { const r = (S.runs || []).find(x => String(x.id) === d.id); if (r) modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">${esc(r.agent_name)}</h3><p class="note" style="margin-top:0">${fmtDT(r.created_at)} · ${esc(r.input?.sku || "")}</p>${agentOutput(r.output)}`); break; }
    case "fav": S.favs[d.id] = !S.favs[d.id]; try { localStorage.setItem("pulse.favs", JSON.stringify(S.favs)); } catch (x) { /* ignore */ } render(); break;
    case "addmoney": modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">Add money to wallet</h3><p class="note" style="margin-top:0">18% GST is added at checkout. A GST invoice is created for each top-up.</p><div class="chips" style="margin:14px 0">${[200, 500, 1000, 2000, 5000].map(v => `<button type="button" class="chip" data-act="topup" data-v="${v}">+ ${inr(v)}</button>`).join("")}</div>`); break;
    case "topup": topUp(Number(d.v), b); break;
    case "ins": { const i = insights().find(x => x.id === d.id); if (i) applyInsight(i, b); break; }
    case "newtracker": modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">Create tracker</h3><form id="trkForm" style="display:flex;flex-direction:column;gap:12px;margin-top:12px"><label class="f">Tracker name<input class="inp" id="tkName" placeholder="High spend, no orders"></label>
      <div class="form"><label class="f">Metric<select class="inp" id="tkMet">${Object.keys(MET).map(m => `<option>${m}</option>`).join("")}</select></label><label class="f">Condition<select class="inp" id="tkOp"><option value=">">greater than</option><option value="<">less than</option><option value="=">equal to</option></select></label><label class="f">Value<input class="inp" id="tkVal" inputmode="decimal" value="1"></label></div>
      <p class="note" style="margin:0">ACoS and CTR are in percent. Checked against the last 31 days every time data arrives.</p><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Create tracker</button></div></form>`); break;
    case "deltracker": if (await act(() => api("DELETE", `/api/ads/trackers/${d.id}`))) await reload(true); break;
    case "newdp": case "tpl": modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">Create schedule</h3><form id="dpForm" style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
      <label class="f">Campaign<select class="inp" id="dpCamp">${CAMPAIGNS.filter(c => c.status === "Live").map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>
      <label class="f">Days<select class="inp" id="dpDays"><option>Every day</option><option>Weekdays</option><option>Weekends</option></select></label>
      <div class="f">Tap the hours to switch ads off (Indian time)<div class="heat" style="grid-template-columns:repeat(12,1fr);margin-top:6px">${Array.from({ length: 24 }, (_, i) => `<button type="button" class="chip" data-hr="${i}" aria-pressed="${d.act === "tpl" && i < 6}" style="justify-content:center;padding:4px 0">${i}</button>`).join("")}</div></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn pri" type="submit">Save schedule</button></div></form>`); break;
    case "deldp": if (await act(() => api("DELETE", `/api/ads/dayparts/${d.id}`))) await reload(true); break;
    case "healthform": modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">Account health</h3><p class="note" style="margin-top:0">Copy these from Seller Central > Performance > Account Health. Leave a field blank if you don't have it.</p><form id="healthForm" class="form" style="margin-top:12px">${[["hLate", "Late shipment rate (%)"], ["hCancel", "Pre-fulfilment cancel rate (%)"], ["hTrack", "Valid tracking rate (%)"], ["hOnTime", "On-time delivery rate (%)"], ["hOdr", "Order defect rate (%)"], ["hPol", "Policy violations (count)"], ["hAhr", "Account health rating (0–1000)"]].map(([id, l]) => `<label class="f">${l}<input class="inp" id="${id}" inputmode="decimal"></label>`).join("")}<button class="btn pri" type="submit">Save</button></form>`); break;
    case "loadsample": confirmModal("Load sample data?", `<p style="margin:0">This fills ${esc(S.D.org.name)} with 90 days of invented reports for a food brand, so you can explore every page. You can delete it later from Upload reports.</p>`, "Load sample data", async btn => { btn.dataset.busy = "Importing"; if (await act(() => api("POST", "/api/imports/sample"), btn, "Sample data loaded")) { closeModal(); S.imports = null; await reload(); } }); break;
    case "cleardata": confirmModal("Delete imported data?", `<p style="margin:0 0 10px">All sales, ads, inventory, returns and payment data for ${esc(S.D.org.name)} will be deleted. This cannot be undone.</p><label class="f">Type DELETE to confirm<input class="inp" id="delConfirm" autocomplete="off"></label>`, "Delete data", async btn => { if (await act(() => api("POST", "/api/imports/clear", { confirm: $("delConfirm").value }), btn, "Data deleted")) { closeModal(); S.imports = null; await reload(); } }); break;
    case "shoprefresh": S.shop = null; render(); break;
    case "sync": if (await act(() => api("POST", `/api/connections/${d.id}/sync`), b, r => r.queued ? "Sync started. New data appears in a few minutes." : "A sync is already running.")) { S.conns = null; S.shop = null; render(); } break;
    case "disconnect": confirmModal("Disconnect?", `<p style="margin:0">Pulse stops pulling data from this account. Data already imported stays.</p>`, "Disconnect", async btn => { if (await act(() => api("DELETE", `/api/connections/${d.id}`), btn, "Disconnected")) { closeModal(); S.conns = null; S.shop = null; render(); } }); break;
    case "delmem": if (await act(() => api("DELETE", `/api/memory/${d.id}`))) await reload(true); break;
    case "rmmember": confirmModal("Remove from brand?", `<p style="margin:0">They lose access to ${esc(S.D.org.name)} straight away.</p>`, "Remove", async btn => { if (await act(() => api("DELETE", `/api/team/${d.id}`), btn, "Removed")) { closeModal(); S.team = null; render(); } }); break;
    case "ordpage": S.ordF.page = Math.max(1, Number(d.p)); render(); $("work")?.scrollTo?.({ top: 0 }); break;
    case "ordview": ordView(d.ch, d.id); break;
    case "copy": { const el = $(d.copy); if (el) navigator.clipboard.writeText(el.value).then(() => toast("Copied"), () => { el.type = "text"; el.select(); toast("Select it and copy"); }); break; }
    case "intshow": { const el = $("intSecret"); el.type = el.type === "password" ? "text" : "password"; b.textContent = el.type === "password" ? "Show" : "Hide"; break; }
    case "inttest": { const r = await act(() => api("POST", `/api/integrations/${d.id}/test`), b); if (r) { toast(r.message); intReset(); render(); } break; }
    case "intdel": confirmModal("Disconnect?", "The saved credentials and webhook address are deleted. Events already received are deleted too.", "Disconnect", async yb => { const r = await act(() => api("DELETE", `/api/integrations/${d.id}`), yb, "Disconnected"); if (r) { closeModal(); intReset(); render(); } }); break;
    case "introtate": confirmModal("Get a new webhook address?", "The current address and signing secret stop working immediately. Update them wherever you set them up.", "Get new address", async yb => { const r = await act(() => api("POST", `/api/integrations/${d.id}/rotate`), yb, "New address ready"); if (r) { closeModal(); intReset(); render(); } }); break;
    case "expdel": confirmModal("Delete this expense?", "It is removed from Profit and loss. This can't be undone.", "Delete", async yb => { const r = await act(() => api("DELETE", `/api/expenses/${d.id}`), yb, "Expense deleted"); if (r) { closeModal(); reload(true); } }); break;
    case "intrefresh": S.intAllEvents = null; render(); break;
    case "viewevent": { const all = [...(S.intAllEvents?.events || []), ...Object.values(S.intEvents || {}).flatMap(x => x.events || [])], ev = all.find(x => String(x.id) === d.id);
      if (ev) modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">${esc(ev.topic || "Webhook event")}</h3><p class="note" style="margin-top:0">${fmtDT(ev.received_at)} · ${ev.verified ? "Signature verified" : "Not verified"}</p><pre class="lcd" style="max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word">${esc(ev.body ? JSON.stringify(ev.body, null, 2) : ev.body_text || "(empty)")}</pre>`);
      break; }
    case "copyinvite": navigator.clipboard.writeText($("invLink").value).then(() => toast("Invite link copied"), () => toast("Select the link and copy it")); break;
    case "neworg": newOrgModal(); break;
    case "signout": await api("POST", "/api/auth/logout"); location.hash = ""; location.reload(); break;
  }
});
function newOrgModal() { modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">Add a brand</h3><p class="note" style="margin-top:0">Each brand has its own data, team and wallet.</p><form id="orgNewForm" style="display:flex;gap:8px;margin-top:12px"><input class="inp" id="newOrgName" placeholder="Brand name" aria-label="Brand name"><button class="btn pri" type="submit">Add</button></form>`); }

$("scrim").addEventListener("click", e => { if (e.target === $("scrim")) closeModal(); });
addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); $("drawer").hidden = true; $("userMenu")?.remove(); } if (e.key === "Enter" && !e.shiftKey && e.target.id === "chatIn") { e.preventDefault(); const v = e.target.value; e.target.value = ""; ask(v); } });

document.addEventListener("change", async e => {
  const t = e.target, d = t.dataset;
  if (t.id === "upFiles") { uploadFiles(t.files); t.value = ""; return; }
  if (["ordChannel", "ordStatus", "ordPeriod", "ordFrom", "ordTo"].includes(t.id)) {
    const k = { ordChannel: "channel", ordStatus: "status", ordPeriod: "period", ordFrom: "from", ordTo: "to" }[t.id];
    S.ordF[k] = t.value; S.ordF.page = 1; S.ordF.q = $("ordQ") ? $("ordQ").value.trim() : S.ordF.q;
    render();
    return;
  }
  if (d.camp) { const c = CAMPAIGNS.find(x => x.id === d.camp), status = t.checked ? "Live" : "Paused"; const r = await act(() => api("POST", `/api/ads/campaigns/${encodeURIComponent(c.id)}`, { status })); if (r) { toast(r.pushed ? `${c.name} ${status === "Live" ? "switched on" : "paused"} on Amazon` : r.error ? `Saved in Pulse; Amazon refused: ${r.error}` : `${c.name} marked ${status === "Live" ? "on" : "paused"} in Pulse`); await reload(true); } else t.checked = !t.checked; return; }
  if (d.budget) { const c = CAMPAIGNS.find(x => x.id === d.budget), v = Math.round(+t.value); if (!(v > 0)) { t.value = c.budget || ""; toast("Enter a budget above zero"); return; } const r = await act(() => api("POST", `/api/ads/campaigns/${encodeURIComponent(c.id)}`, { budget: v })); if (r) { toast(r.pushed ? `Budget set to ${inr(v)} on Amazon` : `Budget saved in Pulse as ${inr(v)}`); await reload(true); } return; }
  if (d.tracker) { if (await act(() => api("PATCH", `/api/ads/trackers/${d.tracker}`, { enabled: t.checked }))) await reload(true); return; }
  if (t.id === "toolSel" && t.value) { openAgent(t.value); t.value = ""; return; }
  if (t.id === "projFrom") { S.projFrom = +t.value; render(); return; }
  if (t.id === "projTo") { S.projTo = +t.value; render(); return; }
  if (t.id === "stdType") { S.stdType = t.value; render(); return; }
  if (t.id === "orgSel") {
    if (t.value === "new") { t.value = String(S.me.org.id); newOrgModal(); return; }
    if (await act(() => api("POST", "/api/orgs/switch", { orgId: Number(t.value) }))) { Object.assign(S, { imports: null, conns: null, wallet: null, team: null, ordD: null, ordKey: null, ordF: null, ints: null, intEvents: {}, intAllEvents: null, agents: null, runs: null, chats: [], chatMsgs: [], chatId: null }); await boot(); }
    return;
  }
  if (t.id === "lang") render();
});
document.addEventListener("input", e => {
  const keep = id => { const p = e.target.selectionStart; render(); const el = $(id); if (el) { el.focus(); el.setSelectionRange(p, p); } };
  if (e.target.id === "agentQ") { S.agentQ = e.target.value; keep("agentQ"); }
  if (e.target.id === "campQ") { S.campQ = e.target.value; keep("campQ"); }
});
document.addEventListener("dragover", e => { const z = e.target.closest?.("#drop"); if (z) { e.preventDefault(); z.classList.add("over"); } });
document.addEventListener("dragleave", e => { const z = e.target.closest?.("#drop"); if (z) z.classList.remove("over"); });
document.addEventListener("drop", e => { const z = e.target.closest?.("#drop"); if (z) { e.preventDefault(); z.classList.remove("over"); uploadFiles(e.dataTransfer.files); } });

document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, id = f.id, v = x => ($(x) ? $(x).value.trim() : ""), btn = f.querySelector("button[type=submit]");
  if (id === "authForm") return submitAuth(f);
  if (id === "expForm") {
    const amt = Number(v("expAmt").replace(/[₹,\s]/g, ""));
    if (!v("expDate") || !(amt > 0)) { toast("Enter a date and an amount above zero."); return; }
    const r = await act(() => api("POST", "/api/expenses", { date: v("expDate"), category: v("expCat"), description: v("expDesc"), amount: amt, monthly: $("expMonthly").checked }), btn, "Expense added");
    if (r) reload(true); return;
  }
  if (id === "ordForm") { Object.assign(S.ordF, { q: v("ordQ"), from: v("ordFrom"), to: v("ordTo"), page: 1 }); render(); return; }
  if (id === "intForm") {
    const fields = Object.fromEntries([...f.querySelectorAll("input[name]")].map(i => [i.name, i.value]));
    const r = await act(() => api("PUT", `/api/integrations/${f.dataset.platform}`, { fields }), btn);
    if (r) { toast(r.message); intReset(); render(); }
    return;
  }
  if (id === "chatForm") { const q = v("chatIn"); $("chatIn").value = ""; return ask(q); }
  if (id === "trkForm") { const val = parseFloat(v("tkVal")); if (!v("tkName")) return toast("Give the tracker a name"); if (isNaN(val)) return toast("Enter a number for the value"); if (await act(() => api("POST", "/api/ads/trackers", { name: v("tkName"), metric: v("tkMet"), op: v("tkOp"), value: val }), btn)) { closeModal(); await reload(true); } return; }
  if (id === "dpForm") { const hours = [...$("modal").querySelectorAll('[data-hr][aria-pressed="true"]')].map(x => +x.dataset.hr).sort((a, b) => a - b); if (!hours.length) return toast("Pick at least one hour to switch off"); if (await act(() => api("POST", "/api/ads/dayparts", { campaignId: v("dpCamp"), days: v("dpDays"), hours }), btn, "Schedule saved")) { closeModal(); await reload(true); } return; }
  if (id === "bidForm") { const target = parseFloat(v("bTarget")), budget = parseFloat(v("bBudget")); if (!(target > 0) || !(budget > 0)) return toast("Enter a target ACoS and a budget above zero"); S.bidRun = { target, budget }; render(); return; }
  if (id === "kwForm") { S.kwQuery = v("kwQ"); render(); return; }
  if (id === "memForm") { const m = v("memIn"); if (m && await act(() => api("POST", "/api/memory", { fact: m }), btn)) await reload(true); return; }
  if (id === "healthForm") { const n = x => v(x) === "" ? null : Number(v(x)); if (await act(() => api("PUT", "/api/account-health", { lateShipment: n("hLate"), preCancel: n("hCancel"), validTracking: n("hTrack"), onTime: n("hOnTime"), odr: n("hOdr"), policyViolations: n("hPol"), ahr: n("hAhr") }), btn, "Account health saved")) { closeModal(); await reload(true); } return; }
  if (id === "orgForm") { if (await act(() => api("PATCH", "/api/org", { name: v("oName"), targetAcos: Number(v("oAcos")), feeRate: Number(v("oFee")) / 100 }), btn, "Settings saved")) { await reload(true); S.me = await api("GET", "/api/me"); } return; }
  if (id === "billForm") { if (await act(() => api("PATCH", "/api/org", { billing: { name: v("bName"), gstin: v("bGst").toUpperCase(), stateCode: v("bState"), address: v("bAddr") } }), btn, "Billing details saved")) await reload(true); return; }
  if (id === "inviteForm") { const r = await act(() => api("POST", "/api/team/invite", { email: v("invEmail"), role: v("invRole") }), btn); if (r) { $("invOut").innerHTML = `<div class="lcd" style="margin-top:12px">Send this link to ${esc(v("invEmail"))}. It works for 14 days.<div style="display:flex;gap:8px;margin-top:8px"><input class="inp" id="invLink" readonly value="${esc(r.link)}"><button type="button" class="btn" data-act="copyinvite">Copy</button></div></div>`; S.team = null; } return; }
  if (id === "orgNewForm") { const n = v("newOrgName"); if (!n) return toast("Enter the brand name"); if (await act(() => api("POST", "/api/orgs", { name: n }), btn)) { closeModal(); Object.assign(S, { imports: null, conns: null, wallet: null, team: null, ordD: null, ordKey: null, ordF: null, ints: null, intEvents: {}, intAllEvents: null, chats: [], chatMsgs: [], chatId: null }); await boot(); } return; }
  if (id === "spForm") { if (await act(() => api("POST", "/api/connections/sp-api", { refreshToken: v("spRt"), clientId: v("spCid") || undefined, clientSecret: v("spCs") || undefined }), btn, "Seller account connected. The first sync takes 10–30 minutes.")) { S.conns = null; render(); } return; }
  if (id === "shopForm") { const tok = v("shTok"); if (await act(() => api("POST", "/api/connections/shopify", tok ? { shop: v("shShop"), accessToken: tok } : { shop: v("shShop"), clientId: v("shCid"), clientSecret: v("shCs") }), btn, r => `Connected to ${r.account}. The first sync takes a few minutes.`)) { S.conns = null; S.shop = null; render(); } return; }
  if (id === "adForm") { if (await act(() => api("POST", "/api/connections/ads-api", { refreshToken: v("adRt"), clientId: v("adCid") || undefined, clientSecret: v("adCs") || undefined }), btn, r => `Connected to ${r.account}. The first sync takes 10–30 minutes.`)) { S.conns = null; render(); } return; }
});

$("addMoney").dataset.act = "addmoney";
$("bell").addEventListener("click", alertsDrawer);
$("userBtn").addEventListener("click", () => {
  if ($("userMenu")) return $("userMenu").remove();
  const m = document.createElement("div"); m.className = "menu"; m.id = "userMenu";
  m.innerHTML = `<small><b>${esc(S.me.user.name)}</b><br>${esc(S.me.user.email)}<br>${esc(S.me.org?.name || "")} · ${esc(S.me.org?.role || "")}</small><a href="#account-settings">Brand and team</a><a href="#account-data">Upload reports</a><button type="button" data-act="neworg">Add a brand</button><button type="button" data-act="signout">Sign out</button>`;
  document.body.appendChild(m);
});
$("themeBtn").addEventListener("click", () => { const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; r.dataset.theme = dark ? "light" : "dark"; try { localStorage.setItem("pulse.theme", r.dataset.theme); } catch (x) { /* ignore */ } });
try { const th = localStorage.getItem("pulse.theme"); if (th) document.documentElement.dataset.theme = th; } catch (x) { /* ignore */ }
boot();

// Connections search: filter the tiles in place so typing keeps focus
document.addEventListener("input", e => {
  if (e.target.id !== "intSearch") return;
  S.intQ = e.target.value;
  const q = S.intQ.trim().toLowerCase();
  document.querySelectorAll(".ctiles").forEach(g => {
    let any = false;
    g.querySelectorAll(".ctile").forEach(t => { const hit = !q || t.textContent.toLowerCase().includes(q) || g.previousElementSibling.textContent.toLowerCase().includes(q); t.hidden = !hit; any = any || hit; });
    g.hidden = !any; g.previousElementSibling.hidden = !any;
  });
});
