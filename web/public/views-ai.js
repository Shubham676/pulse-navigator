"use strict";
/* Copilot and AI agents. The copilot sends a compact summary of the brand's numbers with each question;
   the server answers with an AI model when one is configured, otherwise the rules below answer. */

function factsForCopilot() {
  const m = range(30), p = range(30, 30), A = adTotals(), ins = insights().slice(0, 6);
  const top = SKUS.map(s => ({ s, ...skuRange(s.sku, 30) })).sort((a, b) => b.rev - a.rev).slice(0, 8);
  const low = SKUS.filter(s => s.daily > 0 && (s.fba + s.fbm) / (s.daily * 7) < 2).map(s => `${s.name} (${s.fba + s.fbm} units, ${((s.fba + s.fbm) / (s.daily * 7)).toFixed(1)} weeks)`);
  const reasons = {}; S.D.returns.slice(0, 200).forEach(r => (reasons[r.reason || "Not given"] = (reasons[r.reason || "Not given"] || 0) + r.quantity));
  const camps = [...CAMPAIGNS].sort((a, b) => b.spend - a.spend).slice(0, 12).map(c => { const x = cm(c); return `${c.name} [${c.type}, ${c.status}]: spend ${inr(c.spend)}, sales ${inr(c.sales)}, orders ${c.orders}, ROAS ${x.roas.toFixed(2)}, ACoS ${x.acos == null ? "n/a" : pct(x.acos)}, break-even ${x.be == null ? "unknown" : pct(x.be)}`; });
  const negTerms = SEARCH_TERMS.filter(t => t.orders === 0 && t.clicks >= 6).slice(0, 8).map(t => `${t.term} (${t.clicks} clicks, ${inr(t.spend)})`);
  return [`Brand: ${S.D.org.name} on ${S.D.org.marketplace}. Target ACoS ${S.D.org.targetAcos}%. Marketplace fee rate assumed ${pct(FEE(), 0)}.`,
    `Last 30 days: revenue ${inr(m.rev)} (previous 30: ${inr(p.rev)}), orders ${m.orders} (${p.orders}), units ${m.units}, returned units ${m.ret}, cancelled units ${m.canc}.`,
    `Ads last 31 days: spend ${inr(A.spend)}, ad sales ${inr(A.sales)}, ROAS ${A.roas.toFixed(2)}, ACoS ${pct(A.acos)}, TACoS ${m.rev ? pct(A.spend / m.rev) : "n/a"}.`,
    `Top products by 30-day revenue: ${top.map(x => `${x.s.name} ${inr(x.rev)} (${x.units} units, price ${inr(x.s.price)}, cost ${x.s.cogs == null ? "unknown" : inr(x.s.cogs)}, stock ${x.s.fba + x.s.fbm})`).join("; ")}.`,
    `Campaigns: ${camps.join("; ") || "none"}.`,
    `Open insights: ${ins.map(i => `${i.type}: ${i.title} (${i.why})`).join("; ") || "none"}.`,
    `Search terms with clicks and no orders: ${negTerms.join("; ") || "none"}.`,
    `Low stock (under 2 weeks): ${low.join("; ") || "none"}.`,
    `Return reasons (recent units): ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r, n]) => `${r} ${n}`).join("; ") || "no returns data"}.`,
    `Suppressed listings: ${SKUS.filter(s => s.suppressed).map(s => `${s.name}: ${s.suppressed}`).join("; ") || "none"}.`,
    S.D.health ? `Account health: ${(S.D.health.metrics.shipping || []).map(x => `${x[0]} ${x[1]}%`).join(", ")}.` : "Account health: not provided."].join("\n");
}

// Rule-based answers, used when no AI model is configured or the model call fails
function ruleAnswer(q) {
  const t = q.toLowerCase(), hi = $("lang").value !== "English", A = adTotals(), think = []; let text, acts = [];
  if (!hasData()) return { text: "There is no data for this brand yet. Upload your Amazon reports first, and I can answer questions about sales, ads, stock and returns.", think, acts: [["Upload reports", "#account-data"]] };
  if (/roas|acos|ads?\b|campaign|vigyapan/.test(t)) {
    const bad = CAMPAIGNS.filter(c => c.status === "Live" && c.spend > 0 && cm(c).roas < 1).sort((a, b) => b.spend - a.spend), good = CAMPAIGNS.filter(c => c.status === "Live" && cm(c).roas >= 3).sort((a, b) => cm(b).roas - cm(a).roas);
    think.push("Read 31 days of campaign results", "Compared ACoS with break-even where product costs are known");
    text = `${hi ? "Aapka overall ROAS" : "Your overall ROAS is"} ${A.roas.toFixed(2)} (ACoS ${pct(A.acos)}, target ${S.D.org.targetAcos}%).\n\n${hi ? "Ye 3 kaam kijiye:" : "Three moves:"}\n1. ${bad.length ? `Pause or cap ${bad.slice(0, 2).map(c => c.name).join(" and ")}: ${inr(sum(bad.slice(0, 2).map(c => c.spend)))} spent at ROAS under 1.` : "No live campaign is under ROAS 1."}\n2. ${good.length ? `Move that budget to ${good[0].name} (ROAS ${cm(good[0]).roas.toFixed(1)}).` : "Build exact-match campaigns from converting search terms."}\n3. Add the ${SEARCH_TERMS.filter(x => x.orders === 0 && x.clicks >= 6).length} search terms with clicks but no orders as negatives.`;
    acts = [["Open AI insights", "#ads-overview"], ["Campaign manager", "#ads-campaigns"]];
  } else if (/profit|munafa|margin|p&l|pnl/.test(t)) {
    const m = range(30), withCost = SKUS.filter(s => s.cogs != null), gp = sum(withCost.map(s => skuRange(s.sku, 30).rev * (margin(s) || 0)));
    think.push("Added 30 days of sales by SKU", "Took off product cost and marketplace fees", "Took off ad spend");
    text = withCost.length ? `Estimated profit for the last 30 days: ${inr(gp - A.spend)}.\nSales ${inr(m.rev)}; margin after product cost and fees ${inr(gp)}; ads ${inr(A.spend)}.${withCost.length < SKUS.length ? `\n${SKUS.length - withCost.length} products have no cost yet, so they are left out.` : ""}` : "Profit needs your cost per unit. Fill in the product costs sheet and upload it.";
    acts = [["Profit and loss", "#analytics-pnl"]];
  } else if (/stock|inventory|maal|restock/.test(t)) {
    const low = SKUS.filter(s => s.daily > 0).map(s => ({ s, woc: (s.fba + s.fbm) / (s.daily * 7) })).filter(x => x.woc < 2).sort((a, b) => a.woc - b.woc);
    think.push("Divided stock on hand by average weekly sales");
    text = low.length ? `${low.length} SKUs have under 2 weeks of cover:\n` + low.map(x => `• ${x.s.name}: ${x.s.fba + x.s.fbm} units, ${x.woc.toFixed(1)} weeks`).join("\n") : "Every selling SKU has more than 2 weeks of stock.";
    acts = [["Inventory dashboard", "#analytics-inventory"]];
  } else if (/return|refund|wapas/.test(t)) {
    const r = range(30), reasons = {}; S.D.returns.forEach(x => (reasons[x.reason || "Not given"] = (reasons[x.reason || "Not given"] || 0) + x.quantity));
    const top = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]; think.push("Grouped returns by reason");
    text = `${num(r.ret)} units returned in 30 days (${r.units ? pct(r.ret / r.units) : "–"} of units).${top ? ` Top reason: ${top[0].toLowerCase()} (${top[1]} units).` : ""}`;
    acts = [["Returns", "#analytics-returns"]];
  } else if (/listing|title|a\+|image|content/.test(t)) {
    const w = SKUS.filter(s => s.images != null).sort((a, b) => (a.images + a.bullets + (a.aplus ? 3 : 0)) - (b.images + b.bullets + (b.aplus ? 3 : 0))).slice(0, 3);
    think.push("Checked images, bullets and A+ for each listing");
    text = w.length ? "Weakest listings:\n" + w.map(s => `• ${s.name}: ${s.images} images, ${s.bullets} bullets, ${s.aplus ? "has A+" : "no A+"}`).join("\n") + "\nRun the listing optimizer on these first." : "Upload the category listings report so I can check images and bullets.";
    acts = [["Listing optimizer", "agent:optim"]];
  } else if (/fix|today|aaj|what should|kya kar|priorit/.test(t)) {
    const ins = insights().slice(0, 3); think.push("Checked campaigns, stock and listings", "Ranked by rupee value");
    text = (hi ? "Aaj ye kijiye:\n" : "Today, do these:\n") + (ins.map((i, k) => `${k + 1}. ${i.label}: ${i.c.name}`).join("\n") || "1. No urgent ad fixes.") + `\n${ins.length + 1}. Restock ${SKUS.filter(s => s.daily > 0 && (s.fba + s.fbm) / (s.daily * 7) < 2).length} low-cover SKUs.`;
    acts = [["Open AI insights", "#ads-overview"]];
  } else if (/keyword|search term/.test(t)) {
    const top = [...SEARCH_TERMS].sort((a, b) => b.orders - a.orders).slice(0, 5); think.push("Ranked search terms by orders");
    text = top.length ? "Best converting search terms:\n" + top.map(x => `• ${x.term}: ${x.orders} orders, ${inr(x.spend)} spend`).join("\n") : "Upload the search term report first.";
    acts = [["Keyword intelligence", "#ads-keywords"]];
  } else text = "I can answer questions about ROAS and campaigns, profit, stock, returns, listings, keywords, or what to fix today.";
  return { text, think, acts };
}

const SUGGEST = ["How can I increase my ROAS?", "What should I fix today?", "How much profit did I make this month?", "Which SKUs will run out of stock?", "Why are customers returning orders?", "Which listings need work?"];
VIEWS["copilot"] = () => {
  const msgs = S.chatMsgs.length ? S.chatMsgs.map(m => m.role === "user" ? `<div class="bub me">${esc(m.content)}</div>` : `<div class="bub ai">${S.thinking && m.meta?.think?.length ? `<div class="think"><b>How I worked it out</b><br>${m.meta.think.map(esc).join("<br>")}</div>` : ""}${esc(m.content)}${m.meta?.acts?.length ? `<div class="acts">${m.meta.acts.map(([l, h]) => h.startsWith("agent:") ? `<button type="button" class="btn sm" data-act="agent" data-id="${h.slice(6)}">${esc(l)}</button>` : `<a class="btn sm" href="${h}">${esc(l)}</a>`).join("")}</div>` : ""}${m.meta?.source === "rules" ? `<div class="note" style="margin-top:6px">Answered by rules${S.me.features.ai ? " because the AI model did not respond" : "; add an AI key to get written answers"}.</div>` : ""}</div>`).join("") + (S.waiting ? `<div class="bub ai"><span class="spin"></span> Thinking…</div>` : "")
    : `<div class="hello"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg><h3>Let's grow ${esc(S.D.org.name)}</h3><p>Ask about ads, profit, stock or listings. Answers use your latest data and the facts in Copilot memory.</p><div class="chips" style="justify-content:center">${SUGGEST.map(q => `<button type="button" class="chip" data-act="ask" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>`;
  return `<div class="chatwrap"><div class="card hist"><button type="button" class="btn pri" data-act="newchat" style="margin-bottom:8px">+ New chat</button><div style="font-size:11.5px;color:var(--muted);font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:6px 10px">History</div>
    ${S.chats.map(x => `<button type="button" data-act="openchat" data-id="${x.id}" aria-current="${x.id === S.chatId}">${esc(x.title)}<small>${fmtDT(x.created_at)}</small></button>`).join("") || `<p class="note" style="margin:6px 10px">No chats yet.</p>`}</div>
   <div class="convo"><div class="msgs" id="msgs" aria-live="polite">${msgs}</div>
    <form class="composer" id="chatForm"><label for="chatIn" style="position:absolute;left:-9999px">Message</label><textarea id="chatIn" rows="2" placeholder="Ask about your ads, profit, stock or listings…"></textarea>
     <div class="row"><button type="button" class="btn sm" data-act="thinking" aria-pressed="${S.thinking}" style="${S.thinking ? "border-color:var(--accent);color:var(--accent)" : ""}">Show thinking</button>
      <select class="sel" id="toolSel" aria-label="Run a tool" style="min-height:32px;padding:3px 8px"><option value="">Tools…</option>${(S.agents || []).map(a => `<option value="${a.id}">${esc(a.name)} · ${inr(a.cost)}</option>`).join("")}</select>
      <a class="btn sm" href="#account-memory">Memory (${S.D.memory.length})</a><span class="sp"></span>
      <span class="note" style="margin:0">${S.me.features.ai ? "AI answers" : "Rule-based answers"}</span><button class="btn pri sm" type="submit"${S.waiting ? " disabled" : ""}>Send</button></div></form></div></div>`;
};
async function ask(q) {
  q = q.trim(); if (!q || S.waiting) return;
  S.chatMsgs.push({ role: "user", content: q }); S.waiting = true; render();
  const rules = ruleAnswer(q);
  try {
    const r = await api("POST", "/api/copilot", { chatId: S.chatId, message: q, facts: factsForCopilot(), language: $("lang").value, fallback: { text: rules.text, think: rules.think, acts: rules.acts } });
    S.chatId = r.chatId; S.chatMsgs.push(r.message);
    if (!S.chats.some(c => c.id === r.chatId)) S.chats.unshift({ id: r.chatId, title: q.slice(0, 60), created_at: new Date().toISOString() });
  } catch (e) { S.chatMsgs.push({ role: "assistant", content: rules.text, meta: { think: rules.think, acts: rules.acts, source: "rules" } }); toast(e.message); }
  S.waiting = false; render();
}

/* ---------- agents ---------- */
const ART = { Visual: "#E8D9B5", Listing: "#CFE6DF", Market: "#DCE6F3" };
const AICON = { Visual: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>', Listing: '<path d="M7 4h10M7 9h10M7 14h6M4 4h.01M4 9h.01M4 14h.01"/><path d="M15 18l2 2 4-4"/>', Market: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8.5 11h5M11 8.5v5"/>' };
function agentCard(a) { return `<article class="agent"><div class="art" style="background:${ART[a.group]}"><svg viewBox="0 0 24 24">${AICON[a.group]}</svg><button type="button" class="fav" data-act="fav" data-id="${a.id}" aria-pressed="${!!S.favs[a.id]}" aria-label="Favourite ${esc(a.name)}">${S.favs[a.id] ? "★" : "☆"}</button></div><div class="bd"><span class="grp">${a.group} intelligence</span><b>${esc(a.name)}</b><p>${esc(a.desc)}</p>${a.available ? "" : `<span class="demo">${esc(a.unavailable)}</span>`}</div><div class="ft"><span>${inr(a.cost)} <small style="color:var(--muted);font-weight:500">per run</small></span><button type="button" class="btn pri sm" data-act="agent" data-id="${a.id}"${a.available ? "" : " disabled"}>Launch</button></div></article>`; }
VIEWS["agents"] = () => {
  if (!S.agents) { loadAgents(); return `<div class="empty">Loading agents…</div>`; }
  const list = S.agents.filter(a => (S.agentFilter === "All" || a.group === S.agentFilter) && (!S.agentQ || (a.name + a.desc).toLowerCase().includes(S.agentQ.toLowerCase())));
  const favs = S.agents.filter(a => S.favs[a.id] && a.available);
  return head("AI agents", "Each agent does one job. You see the price before it runs, it is paid from your wallet, and a failed run is refunded.", `<a class="btn" href="#agents-history">Run history</a>`)
    + (favs.length ? card("Favourites", `<div class="chips">${favs.map(a => `<button type="button" class="chip" data-act="agent" data-id="${a.id}">★ ${esc(a.name)} · ${inr(a.cost)}</button>`).join("")}</div>`) : "")
    + `<div class="ph" style="align-items:center"><div class="chips grow">${["All", "Visual", "Listing", "Market"].map(f => `<button type="button" class="chip" data-agf="${f}" aria-pressed="${S.agentFilter === f}">${f === "All" ? "All" : f + " intelligence"}</button>`).join("")}</div><input class="inp" id="agentQ" style="max-width:280px" placeholder="Search agents" value="${esc(S.agentQ)}" aria-label="Search agents"></div>`
    + `<div class="agrid">${list.map(agentCard).join("") || `<div class="empty">No agent matches “${esc(S.agentQ)}”.</div>`}</div>`;
};
async function loadAgents() { try { const r = await api("GET", "/api/agents"); S.agents = r.agents; S.runs = r.runs; render(); } catch (e) { toast(e.message); } }
VIEWS["agents-history"] = () => {
  if (!S.runs) { loadAgents(); return `<div class="empty">Loading…</div>`; }
  return head("Run history", "Every agent run with its cost and result.", copyBtn())
    + card("Runs", table([{ l: "When", left: true }, { l: "Agent", left: true }, { l: "Product or input", left: true }, "Cost", "Status", ""], S.runs.map(r => [{ v: new Date(r.created_at).getTime(), h: fmtDT(r.created_at), csv: r.created_at }, r.agent_name, r.input?.sku || r.input?.keyword || "–", N(r.cost_paise / 100, inr), pill(r.status === "done" ? "Done" : r.status === "refunded" ? "Refunded" : "Failed", r.status === "done" ? "ok" : "mut"), { v: "", h: r.status === "done" ? `<button type="button" class="btn sm" data-act="viewrun" data-id="${r.id}">View</button>` : "" }]), { name: "agent-runs", empty: "No agent runs yet." }));
};
function openAgent(id) {
  const a = (S.agents || []).find(x => x.id === id); if (!a) { loadAgents().then(() => openAgent(id)); return; }
  if (!a.available) { toast(a.unavailable); return; }
  const skuSel = `<label class="f">Product<select class="inp" id="agSku">${SKUS.map(s => `<option value="${esc(s.sku)}">${esc(s.name)} · ${esc(s.sku)}</option>`).join("")}</select></label>`;
  const inp = a.input === "keyword" ? `<label class="f">Product to research<select class="inp" id="agSku">${SKUS.map(s => `<option value="${esc(s.sku)}">${esc(s.name)}</option>`).join("")}</select></label><label class="f">Seed keyword (optional)<input class="inp" id="agKw" placeholder="e.g. low gi rice"></label>`
    : a.input === "brief" ? skuSel + `<label class="f">What makes it different<textarea class="inp" id="agBrief" rows="3" placeholder="Key benefits, proof, pack size, who it is for"></textarea></label>`
      : a.input === "image" ? skuSel + `<label class="f">Product image<input class="inp" type="file" id="agFile" accept="image/png,image/jpeg"></label>` : skuSel;
  modal(`<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button><h3 id="mTitle">${esc(a.name)}</h3><p class="note" style="margin-top:0">${esc(a.desc)}</p>
   <div style="display:flex;flex-direction:column;gap:12px;margin:14px 0">${SKUS.length ? inp : need("Add your products first by uploading reports.", "")}</div>
   <div class="lcd">This run costs <b>${inr(a.cost)}</b>. Wallet ${inr(S.D.org.wallet)} now, ${inr(S.D.org.wallet - a.cost)} after.</div><p class="msg" id="agMsg" style="color:var(--bad);font-weight:600;min-height:1.2em"></p>
   <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-act="close">Cancel</button><button type="button" class="btn pri" data-act="runagent" data-id="${a.id}" data-busy="Running"${SKUS.length && canEdit() ? "" : " disabled"}>Run for ${inr(a.cost)}</button></div><div id="agOut"></div>`);
}
function agentOutput(o) {
  if (!o) return "";
  if (o.keywords) return table([{ l: "Keyword", left: true }, { l: "Why", left: true }, { l: "Your data", left: true }], o.keywords.map(k => [k.keyword, k.reason || "", k.evidence || "–"]), { name: "keyword-ideas" }) + (o.note ? `<p class="note">${esc(o.note)}</p>` : "");
  return `${o.score != null ? `<div class="kpis" style="margin:10px 0"><div class="kpi"><span>Listing score now</span><b>${o.score}</b></div>${o.scoreAfter != null ? `<div class="kpi"><span>After changes</span><b style="color:var(--ok)">${o.scoreAfter}</b></div>` : ""}</div>` : ""}
   ${o.issues?.length ? `<p class="note" style="font-weight:700;color:var(--ink2)">What to fix</p><ul style="margin:0;padding-left:20px;font-size:13.5px">${o.issues.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
   ${o.title ? `<p class="note" style="font-weight:700;color:var(--ink2)">Suggested title (${o.title.length} characters)</p><div class="lcd">${esc(o.title)}</div>` : ""}
   ${o.bullets?.length ? `<p class="note" style="font-weight:700;color:var(--ink2)">Bullets</p><ol style="margin:0;padding-left:20px;font-size:13.5px">${o.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ol>` : ""}
   ${o.description ? `<p class="note" style="font-weight:700;color:var(--ink2)">Description</p><div class="lcd" style="white-space:pre-line">${esc(o.description)}</div>` : ""}
   ${o.searchTerms ? `<p class="note" style="font-weight:700;color:var(--ink2)">Backend search terms</p><div class="lcd">${esc(o.searchTerms)}</div>` : ""}
   <p class="note">Check claims before you publish: Amazon removes listings with health claims it cannot verify.</p>`;
}
