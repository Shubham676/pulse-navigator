"use strict";
/* Shopify store page: the brand's own website sales, from the Shopify connection. */

async function loadShop() { try { S.shop = await api("GET", "/api/shopify"); } catch (e) { S.shop = { error: e.message }; toast(e.message); } render(); }

function shopDays(daily) {
  const by = new Map(daily.map(d => [String(d.d).slice(0, 10), d])), out = [], today = ymdIST(Date.now());
  for (let i = 119; i >= 0; i--) {
    const k = ymdIST(new Date(today + "T12:00:00Z").getTime() - i * 864e5 - 330 * 6e4), d = by.get(k);
    out.push({ date: k, orders: d?.orders || 0, cancelled: d?.cancelled || 0, cod: d?.cod || 0, net: d?.net || 0, total: d?.total || 0, discounts: d?.discounts || 0, shipping: d?.shipping || 0 });
  }
  return out;
}
const shopRange = (days, n, back = 0) => { const a = days.slice(days.length - n - back, days.length - back), t = k => sum(a.map(d => d[k])); return { orders: t("orders"), cancelled: t("cancelled"), cod: t("cod"), net: t("net"), total: t("total"), discounts: t("discounts"), shipping: t("shipping") }; };

VIEWS["analytics-shopify"] = () => {
  if (!S.shop) { loadShop(); return `<div class="empty">Loading…</div>`; }
  const X = S.shop;
  if (X.error) return head("Shopify store", "") + `<section class="card empty-state"><h3>Could not load Shopify data</h3><p>${esc(X.error)}</p></section>`;
  if (!X.connected) return head("Shopify store", "Sales from your own website, next to your marketplace data.")
    + `<section class="card empty-state"><h3>Connect your Shopify store</h3><p style="margin:0;color:var(--ink2);max-width:62ch">Pulse Navigator reads orders, discount codes, COD and prepaid mix, products and stock from Shopify every few hours. It never changes anything in your store.</p><div><a class="btn pri" href="#connections-shopify">Connect Shopify</a></div></section>`;
  const st = X.store, days = shopDays(X.daily), n = PER[S.period][0], a = shopRange(days, n), b = shopRange(days, n, n);
  const aov = r => r.orders ? r.net / r.orders : 0, sync = st.lastSync ? `Synced ${fmtDT(st.lastSync)}` : "First sync running";
  if (!st.lastSync && !X.daily.length) return head(esc(st.name || "Shopify store"), esc(st.domain || st.shop))
    + `<section class="card empty-state"><h3>First sync in progress</h3><p style="margin:0;color:var(--ink2)">Pulling orders and products from Shopify. This usually takes a few minutes.</p><div><button type="button" class="btn" data-act="shoprefresh">Check again</button></div></section>`;
  const lowStock = X.stock.filter(v => v.status === "ACTIVE" && v.units30 > 0 && v.inventory != null && v.inventory < v.units30 / 30 * 14);
  const repeatPct = X.repeat?.customers ? X.repeat.repeaters / X.repeat.customers : 0;
  return head(esc(st.name || "Shopify store"), `${esc(st.domain || st.shop)} · ${sync} · compared with the ${PER[S.period][1]}`, `<div style="display:flex;gap:8px;align-items:center">${periodSeg()}<button type="button" class="btn sm" data-act="shoprefresh">Refresh</button></div>`)
    + strip([
      st.error ? { t: "bad", h: "Sync needs attention", p: `${esc(st.error)} <a href="#connections-shopify">Open the Shopify connection</a>` } : null,
      b.net ? { t: a.net >= b.net ? "ok" : "bad", h: `Net sales ${a.net >= b.net ? "up" : "down"} ${pct(Math.abs(a.net - b.net) / b.net)}`, p: `${inr(a.net)} against ${inr(b.net)}.` } : null,
      lowStock.length ? { t: "warn", h: `${lowStock.length} variant${lowStock.length > 1 ? "s" : ""} under 2 weeks of stock`, p: lowStock.slice(0, 2).map(v => esc(v.sku || v.product)).join(", ") + (lowStock.length > 2 ? "…" : ".") } : null])
    + `<div class="kpis">${kpi("Net sales", a.net, b.net, inr, false)}${kpi("Orders", a.orders, b.orders)}${kpi("Average order", aov(a), aov(b), inr)}${kpi("COD share", a.orders ? a.cod / a.orders : 0, b.orders ? b.cod / b.orders : 0, v => pct(v), true)}${kpi("Cancelled or refunded", a.cancelled, b.cancelled, num, true)}</div>`
    + card("Daily net sales", barChart(days.slice(-30).map(d => ({ l: fmtD(d.date), v: d.net })), { fmt: compact, label: "Daily Shopify net sales, last 30 days" }), { sub: "After discounts, before shipping and tax · last 30 days" })
    + `<div class="grid g2">${card("Top products", X.skus.length ? hbars(X.skus.slice(0, 8).map(s => ({ l: s.sku || s.title, v: s.revenue || 0 })), v => inr(v)) : `<p class="note">No sales in the last 30 days.</p>`, { sub: "By net sales, last 30 days" })}
      ${card("Payment mix", a.orders ? donut([{ l: "Prepaid", v: a.orders - a.cod }, { l: "Cash on delivery", v: a.cod }], { center: pct(a.orders ? (a.orders - a.cod) / a.orders : 0, 0), sub: "prepaid", label: "Prepaid and COD orders" }) : `<p class="note">No orders in this period.</p>`, { sub: PER[S.period][1].replace("previous", "last") })}</div>`
    + `<div class="grid g2">${card("Discount codes", table([{ l: "Code", left: true }, "Orders", "Discount given", "Net sales"], X.codes.map(c => [c.code, N(c.orders), N(c.discount, v => inr(v)), N(c.net, v => inr(v))]), { empty: "No discount codes used in the last 30 days.", name: "shopify-discount-codes" }), { sub: "Last 30 days", right: copyBtn() })}
      ${card("Orders by state", hbars(X.states.slice(0, 10).map(s => ({ l: s.state, v: s.orders }))), { sub: `Last 30 days · ${pct(repeatPct, 0)} of customers ordered more than once in the last year` })}</div>`
    + card("Products and stock", table([{ l: "Product", left: true }, { l: "SKU", left: true }, "Status", "Price", "MRP", "Stock", "Sold, 30 days", "Days of stock"], X.stock.map(v => {
        const doc = v.units30 > 0 && v.inventory != null ? v.inventory / (v.units30 / 30) : null;
        return [{ v: v.product, h: `${esc(v.product)}${v.variant ? `<small style="display:block;color:var(--muted)">${esc(v.variant)}</small>` : ""}` }, v.sku || "–", pill(v.status === "ACTIVE" ? "Active" : v.status === "DRAFT" ? "Draft" : "Archived", v.status === "ACTIVE" ? "ok" : "mut"),
          N(v.price, x => inr(x)), N(v.compare_at, x => inr(x)), N(v.inventory), N(v.units30), { v: doc ?? "", h: doc == null ? "–" : `<span style="color:${doc < 14 ? "var(--bad)" : "inherit"}">${Math.round(doc)}</span>` }];
      }), { name: "shopify-stock", max: 520 }), { right: copyBtn() })
    + card("Recent orders", table([{ l: "Order", left: true }, "Date", { l: "Items", left: true }, "Payment", "Status", "Total", { l: "Ship to", left: true }], X.recent.map(o => [o.name, { v: new Date(o.created_at).getTime(), h: fmtDT(o.created_at) },
        { v: o.items || "", h: `<div style="white-space:normal;max-width:320px">${esc(o.items || "")}</div>` }, o.is_cod ? "COD" : "Prepaid",
        o.cancelled_at ? pill("Cancelled", "bad") : o.financial_status === "REFUNDED" ? pill("Refunded", "bad") : pill(o.fulfillment_status === "FULFILLED" ? "Fulfilled" : "To ship", o.fulfillment_status === "FULFILLED" ? "ok" : "info"),
        N(o.total - (o.refunded || 0), x => inr(x, 2)), [o.ship_city, o.ship_state].filter(Boolean).join(", ") || "–"]), { name: "shopify-orders", max: 520 }), { right: copyBtn() });
};
