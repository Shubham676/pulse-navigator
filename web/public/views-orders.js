"use strict";
/* All orders: Amazon and Shopify orders in one list, filtered and paged on the server. */

const ORD_PERIODS = [["all", "All time"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["month", "This month"], ["lastmonth", "Last month"], ["custom", "Custom dates"]];
const ORD_STATUS = { open: ["Open", "info"], shipped: ["Shipped", "ok"], cancelled: ["Cancelled", "mut"], returned: ["Returned or refunded", "bad"] };
const ordDT = d => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function ordRange(f) {
  const t = new Date(), day = n => { const d = new Date(t); d.setDate(d.getDate() - n); return ymd(d); };
  switch (f.period) {
    case "today": return [ymd(t), ymd(t)];
    case "7": return [day(6), ymd(t)];
    case "30": return [day(29), ymd(t)];
    case "90": return [day(89), ymd(t)];
    case "month": return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)];
    case "lastmonth": return [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))];
    case "custom": return [f.from || "", f.to || ""];
    default: return ["", ""];
  }
}
function ordQuery(f, extra = {}) {
  const [from, to] = ordRange(f), p = new URLSearchParams({ channel: f.channel, status: f.status, page: f.page, size: 50, ...extra });
  if (from) p.set("from", from); if (to) p.set("to", to); if (f.q) p.set("q", f.q);
  return p.toString();
}
function ordLoad() {
  const qs = ordQuery(S.ordF);
  if (S.ordD && S.ordKey === qs) return true;
  if (S.ordLoading !== qs) {
    S.ordLoading = qs;
    api("GET", "/api/orders?" + qs).then(r => { if (S.ordLoading === qs) { S.ordD = r; S.ordKey = qs; } }).catch(e => toast(e.message)).finally(() => { if (S.ordLoading === qs) S.ordLoading = null; render(); });
  }
  return !!S.ordD;   // keep showing the previous page while the next one loads
}

VIEWS["analytics-orders"] = () => {
  S.ordF = S.ordF || { channel: "all", status: "all", period: "all", q: "", page: 1, from: "", to: "" };
  const f = S.ordF;
  if (!ordLoad()) return head("All orders", "") + `<div class="empty">Loading orders…</div>`;
  const D = S.ordD, s = D.summary;
  if (!D.channels.amazon && !D.channels.shopify) return head("All orders", "Every order from Amazon and Shopify in one list.")
    + `<section class="card empty-state"><h3>No orders yet</h3><p style="margin:0;color:var(--ink2)">Upload your Amazon order report, or connect Amazon or Shopify so orders sync automatically.</p>
       <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn pri" href="#account-data">Upload reports</a><a class="btn" href="#connections-amazon">Connect Amazon</a><a class="btn" href="#connections-shopify">Connect Shopify</a></div></section>`;
  const sel = (id, label, opts, val) => `<label class="f">${label}<select class="inp" id="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === val ? " selected" : ""}>${t}</option>`).join("")}</select></label>`;
  const loading = !!S.ordLoading;
  const filters = `<form id="ordForm" class="card ordbar">
      ${sel("ordChannel", "Channel", [["all", "All channels"], ["amazon", "Amazon"], ["shopify", "Shopify"]], f.channel)}
      ${sel("ordStatus", "Status", [["all", "All statuses"], ...Object.entries(ORD_STATUS).map(([k, [t]]) => [k, t])], f.status)}
      ${sel("ordPeriod", "Period", ORD_PERIODS, f.period)}
      ${f.period === "custom" ? `<label class="f">From<input class="inp" type="date" id="ordFrom" value="${esc(f.from)}"></label><label class="f">To<input class="inp" type="date" id="ordTo" value="${esc(f.to)}"></label>` : ""}
      <label class="f grow">Search<input class="inp" id="ordQ" type="search" value="${esc(f.q)}" placeholder="Order number, SKU, product, city or state"></label>
      <button class="btn pri" type="submit">Search</button></form>`;
  const kpis = `<div class="kpis">${[["Orders", num(s.orders), `${num(s.units)} units · ${num(s.amazon)} Amazon · ${num(s.shopify)} Shopify`], ["Sales", inr(s.amount), "excludes cancelled and returned"],
    ["Open", num(s.open), "not shipped yet"], ["Cancelled", num(s.cancelled), s.orders ? pct(s.cancelled / s.orders) + " of orders" : ""], ["Returned or refunded", num(s.returned), s.orders ? pct(s.returned / s.orders) + " of orders" : ""]]
    .map(([l, v, sub]) => `<div class="kpi"><span>${l}</span><b>${v}</b><small>${sub}</small></div>`).join("")}</div>`;
  const chPill = c => c === "amazon" ? `<span class="pill warn">Amazon</span>` : `<span class="pill ok">Shopify</span>`;
  const rows = D.orders.map(o => [
    { v: new Date(o.placed_at).getTime(), h: ordDT(o.placed_at) },
    { v: o.channel, h: chPill(o.channel) },
    { v: o.order_no, h: `<b>${esc(o.order_no)}</b>` },
    { v: o.items || "", h: `<span class="trunc" title="${esc(o.items || "")}">${esc(o.items || "–")}</span>` },
    N(o.units),
    o.status === "open" && !Number(o.amount) ? { v: 0, h: `<span class="note" title="Amazon adds the price once the order is confirmed">–</span>` } : N(o.amount, v => inr(v, 2)),
    { v: o.status, h: `<span class="pill ${ORD_STATUS[o.status][1]}" title="${esc(o.detail || "")}">${ORD_STATUS[o.status][0]}</span>` },
    o.channel === "amazon" ? (o.fulfillment === "Amazon" ? "FBA" : o.fulfillment === "Merchant" ? "Self-ship" : o.fulfillment || "–") : (o.payment || "–"),
    [o.city, o.state].filter(Boolean).join(", ") || "–",
    { v: "", h: `<button type="button" class="btn sm" data-act="ordview" data-ch="${o.channel}" data-id="${esc(o.id)}">View</button>` }
  ]);
  const first = (D.page - 1) * D.size + 1, last = Math.min(D.page * D.size, D.total), pages = Math.max(1, Math.ceil(D.total / D.size));
  const pager = D.total ? `<div class="pager"><span class="note" style="margin:0">Showing ${num(first)}–${num(last)} of ${num(D.total)} orders${loading ? " · loading…" : ""}</span><span class="grow"></span>
      <button type="button" class="btn sm" data-act="ordpage" data-p="${D.page - 1}"${D.page <= 1 ? " disabled" : ""}>← Newer</button><span class="note" style="margin:0">Page ${num(D.page)} of ${num(pages)}</span>
      <button type="button" class="btn sm" data-act="ordpage" data-p="${D.page + 1}"${D.page >= pages ? " disabled" : ""}>Older →</button></div>` : "";
  return head("All orders", "Every order from Amazon and Shopify in one list, newest first. Click View to see the items.",
      `<a class="btn" href="api/orders?${esc(ordQuery(f, { format: "csv" }))}" download>Download CSV</a>`)
    + filters + kpis
    + card("Orders", table([{ l: "Placed", left: true }, { l: "Channel", left: true }, { l: "Order", left: true }, { l: "Items", left: true }, "Units", "Amount", { l: "Status", left: true }, { l: "Fulfilment / payment", left: true }, { l: "Ship to", left: true }, ""],
        rows, { name: "orders", empty: "No orders match these filters." }) + pager, { sub: loading ? "Updating…" : "" });
};

// Order detail
async function ordView(ch, id) {
  let r;
  try { r = await api("GET", `/api/orders/${ch}/${encodeURIComponent(id)}`); } catch (e) { return toast(e.message); }
  const close = `<button type="button" class="btn sm ghost x" data-act="close" aria-label="Close">✕</button>`;
  if (ch === "amazon") {
    const L = r.lines, at = L[0]?.purchased_at;
    return modal(`<div class="ordmodal"></div>${close}<h3 id="mTitle">Amazon order ${esc(r.orderNo)}</h3><p class="note" style="margin-top:0">${at ? fmtDT(at) : ""} · ${esc(L[0]?.fulfillment === "Amazon" ? "Fulfilled by Amazon" : L[0]?.fulfillment === "Merchant" ? "Self-shipped" : L[0]?.fulfillment || "")}</p>`
      + table([{ l: "SKU", left: true }, { l: "Product", left: true }, "Qty", "Item price", "Tax", "Shipping", "Promo", { l: "Status", left: true }],
        L.map(l => [l.sku, l.title || "–", N(l.quantity), N(l.amount, v => inr(v, 2)), N(l.tax, v => inr(v, 2)), N(l.shipping, v => inr(v, 2)), N(l.discount, v => inr(v, 2)), l.status]), { name: "order-" + r.orderNo })
      + (r.returns.length ? `<h4 style="margin:16px 0 6px">Returns</h4>` + table([{ l: "SKU", left: true }, "Returned on", "Qty", "Refund", { l: "Reason", left: true }],
        r.returns.map(x => [x.sku, fmtD(x.returned_at), N(x.quantity), N(x.refund_amount, v => inr(v, 2)), x.reason || "–"]), { name: "returns-" + r.orderNo }) : ""));
  }
  const o = r.order, money = v => inr(Number(v || 0), 2);
  modal(`<div class="ordmodal"></div>${close}<h3 id="mTitle">Shopify order ${esc(r.orderNo)}</h3><p class="note" style="margin-top:0">${fmtDT(o.created_at)} · ${o.is_cod ? "Cash on delivery" : "Prepaid"}${o.payment ? " (" + esc(o.payment) + ")" : ""} · ${esc([o.financial_status, o.fulfillment_status].filter(Boolean).join(", ").toLowerCase().replace(/_/g, " "))}${o.cancelled_at ? " · cancelled " + fmtDT(o.cancelled_at) : ""}</p>`
    + table([{ l: "SKU", left: true }, { l: "Product", left: true }, "Qty", "Unit price", "Discount", "Line total"], r.lines.map(l => [l.sku || "–", l.title || "–", N(l.quantity), N(l.unit_price, v => inr(v, 2)), N(l.discount, v => inr(v, 2)), N(l.amount, v => inr(v, 2))]), { name: "order-" + r.orderNo })
    + `<div class="grid g2" style="margin-top:12px"><div class="lcd">${[["Subtotal", o.subtotal], ["Discounts", o.discounts], ["Shipping", o.shipping], ["Tax", o.tax], ["Total", o.total], ["Refunded", o.refunded]].map(([k, v]) => `<div class="metric"><span>${k}</span><b>${money(v)}</b></div>`).join("")}</div>
       <div class="lcd"><div class="metric"><span>Ship to</span><b>${esc([o.ship_city, o.ship_state, o.ship_postal].filter(Boolean).join(", ") || "–")}</b></div>${o.discount_codes ? `<div class="metric"><span>Discount codes</span><b>${esc(o.discount_codes)}</b></div>` : ""}</div></div>`);
}
