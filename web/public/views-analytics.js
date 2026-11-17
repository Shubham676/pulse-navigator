"use strict";
/* Analytics pages: overview, sales, inventory and business reports. */

function healthCards() {
  const h = S.D.health;
  if (!h) return card("Account health", need("Connect your Amazon seller account, or enter the figures from Seller Central > Performance > Account Health.", "") + `<div style="margin-top:10px"><button type="button" class="btn sm" data-act="healthform">Enter account health</button></div>`);
  const m = h.metrics, src = h.source === "api" ? "From Amazon" : "Entered by hand";
  return `<div class="grid g3">${card("Shipping performance", (m.shipping || []).map(([n, v, op, t]) => { const ok = op === "<" ? v < t : v > t; return `<div class="metric"><span>${n}<small>Target ${op === "<" ? "under" : "over"} ${t}%</small></span><span class="pill ${ok ? "ok" : "bad"}">${v}%</span></div>`; }).join("") || `<p class="note">No shipping metrics.</p>`, { sub: `${src}, ${fmtD(h.as_of)}` })}
    ${card("Policy compliance", (m.policy || []).map(([n, v]) => `<div class="metric"><span>${n}</span><span class="pill ${v ? "bad" : "ok"}">${v}</span></div>`).join("") || `<p class="note">No policy figures.</p>`, { sub: m.accountHealthRating != null ? `Account health rating ${m.accountHealthRating}` : "" })}
    ${card("Customer service", `<div class="metric" style="color:var(--muted);font-size:12px"><span>Metric</span><span>Seller fulfilled · Amazon fulfilled</span></div>` + (m.service || []).map(([n, a1, a2]) => `<div class="metric"><span>${n}<small>Target under 1%</small></span><span>${a1 == null ? "–" : a1 + "%"} · ${a2 == null ? "–" : a2 + "%"}</span></div>`).join(""), { right: `<button type="button" class="btn sm ghost" data-act="healthform">Update</button>` })}</div>`;
}

VIEWS["analytics-home"] = () => {
  if (!hasData()) return emptyPage(`Welcome, ${esc(S.me.user.name.split(" ")[0])}`, "Your sales, ads and stock in one place.");
  const a = cur(), b = prev(), n = PER[S.period][0], hr = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" })) % 24;
  const todayUnits = DAILY[DAYS - 1].units, hours = HOURLY.map(h => h / Math.max(1, sum(HOURLY)) * todayUnits);
  const top = SKUS.map(s => ({ s, ...skuRange(s.sku, n) })).filter(x => x.rev).sort((x, y) => y.rev - x.rev).slice(0, 5);
  const sh = (S.D.health?.metrics.shipping || []).filter(m => m[2] === "<" ? m[1] >= m[3] : m[1] <= m[3]);
  const lowStock = SKUS.filter(s => s.daily > 0 && (s.fba + s.fbm) / (s.daily * 7) < 2), ins = openInsights().length;
  const greet = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
  return head(`Good ${greet}, ${esc(S.me.user.name.split(" ")[0])}`, `${esc(S.D.org.name)} on ${esc(S.D.org.marketplace)}, compared with the ${PER[S.period][1]}.`, periodSeg())
    + strip([
      b.rev ? { t: a.rev >= b.rev ? "ok" : "bad", h: `Revenue ${a.rev >= b.rev ? "up" : "down"} ${pct(Math.abs(a.rev - b.rev) / b.rev)}`, p: `${inr(a.rev)} against ${inr(b.rev)}.` } : null,
      S.D.health ? (sh.length ? { t: "bad", h: `${sh.length} account health metric${sh.length > 1 ? "s" : ""} off target`, p: sh.map(m => m[0]).join(", ") + "." } : { t: "ok", h: "Account health is on target", p: "All shipping metrics inside limits." }) : null,
      lowStock.length ? { t: "warn", h: `${lowStock.length} SKU${lowStock.length > 1 ? "s" : ""} under 2 weeks of stock`, p: lowStock.slice(0, 2).map(s => esc(s.name)).join(", ") + (lowStock.length > 2 ? "…" : ".") } : null,
      ins ? { t: "warn", h: `${ins} ad insight${ins > 1 ? "s" : ""} waiting`, p: `<a href="#ads-overview">Review and apply</a>` } : null])
    + `<div class="kpis">${kpi("Revenue", a.rev, b.rev, inr)}${kpi("Orders", a.orders, b.orders)}${kpi("Units", a.units, b.units)}${kpi("Returns", a.ret, b.ret, num, true)}${kpi("Return rate", a.units ? a.ret / a.units : 0, b.units ? b.ret / b.units : 0, v => pct(v), true)}</div>`
    + `<div class="grid g21">${card("Hourly trend", hr >= 1 ? lineChart([{ name: "Units", values: hours.slice(0, hr + 1) }], hours.slice(0, hr + 1).map((_, i) => i + "h"), { fmt: v => v.toFixed(1), label: "Expected units by hour today" }) : `<p class="note">The day has just started.</p>`, { sub: "Today so far, shaped by your last 30 days" })}
      ${card("Top 5 SKUs", top.length ? hbars(top.map(x => ({ l: x.s.name, v: x.rev })), v => inr(v)) : `<p class="note">No sales in this period.</p>`, { sub: "By revenue" })}</div>`
    + card("Revenue report", barChart(DAILY.slice(-30).map(d => ({ l: fmtD(d.date), v: d.rev })), { fmt: compact, label: "Daily revenue, last 30 days" }), { sub: "Daily revenue, last 30 days" })
    + healthCards();
};

function orderRows(list) { return list.map(o => { const s = skuOf(o.sku); return [o.order_id, prod(s), pill(o.status, o.status === "Shipped" ? "ok" : o.status === "Cancelled" ? "bad" : "info"), N(o.item_price || null, inr), o.quantity, { v: new Date(o.purchased_at).getTime(), h: fmtDT(o.purchased_at), csv: fmtDT(o.purchased_at) }, o.fulfillment === "Amazon" ? "Fulfilled by Amazon" : "Self shipped", o.ship_state || "–"]; }); }

VIEWS["analytics-shipped"] = () => {
  if (!S.D.daily.length) return emptyPage("Shipped orders", "Orders, units and revenue shipped in the period.");
  const a = cur(), b = prev(), n = PER[S.period][0], wk = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const skus = SKUS.map(s => ({ s, ...skuRange(s.sku, n) })).filter(x => x.units).sort((x, y) => y.rev - x.rev);
  const adByDay = new Map(S.D.adDaily.map(d => [d.d, d.sales]));
  const share = wk.map((_, i) => { const days = DAILY.slice(-28).filter(d => ((d.date.getDay() + 6) % 7) === i), tot = sum(days.map(d => d.rev)), ad = sum(days.map(d => adByDay.get(d.ds) || 0)); return tot ? Math.min(1, ad / tot) : 0; });
  const w = [1, 7, 30, 60].find(x => x >= n) || 60, sp = S.D.splits.filter(x => x.days === w);
  const geo = geoFor(n);
  return head("Shipped orders", "Orders, units and revenue in the period, excluding cancellations.", periodSeg())
    + `<div class="kpis">${kpi("Orders", a.orders, b.orders)}${kpi("Units", a.units, b.units)}${kpi("Revenue", a.rev, b.rev, inr)}${kpi("Average order value", a.orders ? a.rev / a.orders : 0, b.orders ? b.rev / b.orders : 0, inr)}</div>`
    + `<div class="grid g2">${card("Units sold", lineChart([{ name: "Units", values: DAILY.slice(-Math.max(n, 7)).map(d => d.units) }], DAILY.slice(-Math.max(n, 7)).map(d => fmtD(d.date)), { label: "Units sold per day" }))}
      ${card("Average selling price", skus.length ? barChart(skus.slice(0, 8).map(x => ({ l: x.s.sku.length > 12 ? x.s.sku.slice(-12) : x.s.sku, v: x.rev / x.units })), { fmt: v => "₹" + compact(v), label: "Average selling price by SKU" }) : `<p class="note">No sales in this period.</p>`)}</div>`
    + `<div class="grid g3">${card("Geographical contribution", geo.length ? hbars(geo.slice(0, 9).map(g => ({ l: g.state, v: g.rev })), v => inr(v)) : `<p class="note">No orders in this period.</p>`, { sub: "Revenue by state" })}
      ${card("Ad vs organic sales", S.D.adDaily.length ? hbars(wk.map((d, i) => ({ l: d, v: share[i] })), v => pct(v, 0) + " ad") : need("Upload a campaign report to split ad and organic sales.", "ads"), { sub: "Share of sales from ads by weekday, last 4 weeks" })}
      ${card("Customers and fulfilment", donut([{ l: "Consumers", v: sum(sp.filter(x => !x.is_business).map(x => x.orders)) }, { l: "Business buyers", v: sum(sp.filter(x => x.is_business).map(x => x.orders)) }], { center: num(sum(sp.map(x => x.orders))), sub: "orders" }) + `<div style="height:12px"></div>` + donut([{ l: "Fulfilled by Amazon", v: sum(sp.filter(x => x.fulfillment === "Amazon").map(x => x.orders)) }, { l: "Self shipped", v: sum(sp.filter(x => x.fulfillment !== "Amazon").map(x => x.orders)) }], { center: "Orders", sub: "by fulfilment" }))}</div>`
    + card("SKU-wise performance", table([{ l: "Product", left: true }, "Units", "Revenue", "Avg. selling price", "Return rate", "Cancel rate"], skus.map(x => [prod(x.s), N(x.units), N(x.rev, inr), N(x.rev / x.units, inr), N(x.units ? x.ret / x.units : 0, v => pct(v)), N(x.units + x.canc ? x.canc / (x.units + x.canc) : 0, v => pct(v))]), { name: "sku-performance" }), { right: copyBtn() })
    + card("Order report", table([{ l: "Order ID", left: true }, { l: "Product", left: true }, "Status", "Item price", "Units", "Ordered", { l: "Fulfilment", left: true }, { l: "State", left: true }], orderRows(S.D.orders.slice(0, 200)), { name: "orders" }), { right: copyBtn(), sub: "Latest 200 order lines. Pending orders show no price until Amazon confirms it." });
};

VIEWS["analytics-cancelled"] = () => {
  if (!S.D.daily.length) return emptyPage("Cancellations", "Cancelled orders by category, SKU and order.");
  const a = cur(), b = prev(), n = PER[S.period][0], cats = [...new Set(SKUS.map(s => s.cat))];
  const since = Date.now() - n * 864e5, os = S.D.orders.filter(o => o.status === "Cancelled" && new Date(o.purchased_at).getTime() >= since);
  return head("Cancellations", "Cancelled orders by category, SKU and order.", periodSeg())
    + `<div class="kpis">${kpi("Orders placed", a.orders + a.cancelled, b.orders + b.cancelled)}${kpi("Cancelled orders", a.cancelled, b.cancelled, num, true)}${kpi("Cancelled units", a.canc, b.canc, num, true)}${kpi("Cancellation rate", a.orders + a.cancelled ? a.cancelled / (a.orders + a.cancelled) : 0, b.orders + b.cancelled ? b.cancelled / (b.orders + b.cancelled) : 0, v => pct(v), true)}</div>`
    + `<div class="grid g21">${card("Cancelled order report", table([{ l: "Order ID", left: true }, { l: "Product", left: true }, "Units", "Ordered", { l: "Fulfilment", left: true }, { l: "State", left: true }], os.map(o => [o.order_id, prod(skuOf(o.sku)), o.quantity, { v: new Date(o.purchased_at).getTime(), h: fmtDT(o.purchased_at), csv: fmtDT(o.purchased_at) }, o.fulfillment === "Amazon" ? "Fulfilled by Amazon" : "Self shipped", o.ship_state || "–"]), { name: "cancelled-orders", empty: "No cancellations among the latest orders in this period." }), { right: copyBtn() })}
      ${card("Category-wise cancels", hbars(cats.map(c => ({ l: c, v: sum(SKUS.filter(s => s.cat === c).map(s => skuRange(s.sku, n).canc)) })), num, "var(--c4)"))}</div>`
    + card("Cancelled units by SKU", table([{ l: "Product", left: true }, "Cancelled units", "Value at list price", "Cancel rate"], SKUS.map(s => ({ s, ...skuRange(s.sku, n) })).filter(x => x.canc).sort((x, y) => y.canc - x.canc).map(x => [prod(x.s), x.canc, N(x.s.price ? x.canc * x.s.price : null, inr), N(x.canc / (x.units + x.canc), v => pct(v))]), { name: "cancel-by-sku", empty: "No cancellations in this period." }), { right: copyBtn() });
};

VIEWS["analytics-returns"] = () => {
  if (!S.D.returns.length && !S.D.dayReturns.length) return head("Returns", "What comes back, from where, and why.") + need("Upload the FBA customer returns report and the seller-fulfilled returns report to see returns.", "returns");
  const a = cur(), b = prev(), n = PER[S.period][0], cats = [...new Set(SKUS.map(s => s.cat))], since = ymdIST(Date.now() - (n - 1) * 864e5);
  const rs = S.D.returns.filter(r => r.returned_at >= since), reasons = {}, states = {};
  rs.forEach(r => { reasons[r.reason || "Not given"] = (reasons[r.reason || "Not given"] || 0) + r.quantity; if (r.ship_state) states[r.ship_state] = (states[r.ship_state] || 0) + r.quantity; });
  const topR = Object.entries(reasons).sort((x, y) => y[1] - x[1]), rows = SKUS.map(s => ({ s, ...skuRange(s.sku, n) })).filter(x => x.ret).sort((x, y) => y.ret - x.ret);
  const refunds = sum(rs.map(r => r.refund)), carriers = {}; rs.forEach(r => { if (r.carrier) carriers[r.carrier] = (carriers[r.carrier] || 0) + 1; });
  const topCarrier = Object.entries(carriers).sort((x, y) => y[1] - x[1])[0], paidBuyer = rs.filter(r => /customer|buyer/i.test(r.label_paid_by || "")).length, withLabel = rs.filter(r => r.label_paid_by).length;
  return head("Returns", "What comes back, from where, and why.", periodSeg())
    + strip([topR[0] ? { t: "bad", h: `${esc(topR[0][0])} is the top reason`, p: `${pct(topR[0][1] / Math.max(1, sum(topR.map(x => x[1]))), 0)} of returned units in this period.` } : null, rows[0] ? { t: "warn", h: `${esc(rows[0].s.name)} returns most`, p: `${rows[0].ret} units, ${pct(rows[0].ret / Math.max(1, rows[0].units))} return rate.` } : null])
    + `<div class="kpis">${kpi("Returned units", a.ret, b.ret, num, true)}${kpi("Refund amount", refunds, null, inr, false, "for returns in this period")}${kpi("Return rate", a.units ? a.ret / a.units : 0, b.units ? b.ret / b.units : 0, v => pct(v), true)}</div>`
    + `<div class="grid g3">${card("Return reasons", topR.length ? hbars(topR.slice(0, 8).map(([l, v]) => ({ l, v })), num, "var(--c4)") : `<p class="note">No returns in this period.</p>`)}
      ${card("Returns by state", Object.keys(states).length ? hbars(Object.entries(states).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([l, v]) => ({ l, v })), num) : `<p class="note">States show once the matching orders are uploaded.</p>`)}
      ${card("Category-wise returns", hbars(cats.map(c => ({ l: c, v: sum(SKUS.filter(s => s.cat === c).map(s => skuRange(s.sku, n).ret)) })), num, "var(--c3)"))}</div>`
    + `<div class="grid g3">${card("Claims and carriers", `<div class="metric"><span>A-to-Z claims</span><b>${rs.filter(r => r.a_to_z).length}</b></div><div class="metric"><span>Return label paid by buyer</span><b>${withLabel ? pct(paidBuyer / withLabel, 0) : "–"}</b></div><div class="metric"><span>Top carrier</span><b>${topCarrier ? esc(topCarrier[0]) : "–"}</b></div>`, { sub: "Seller-fulfilled returns" })}
      <div style="grid-column:span 2;min-width:0">${card("SKU-wise returns", table([{ l: "Product", left: true }, "Returned units", "Units sold", "Return rate"], rows.map(x => [prod(x.s), x.ret, x.units, N(x.units ? x.ret / x.units : null, v => pct(v))]), { name: "returns-by-sku", max: 330, empty: "No returns in this period." }), { right: copyBtn() })}</div></div>`
    + card("Return orders report", table([{ l: "Order ID", left: true }, { l: "Product", left: true }, "Status", "Refund", "Units", "Returned", { l: "Reason", left: true }], rs.map(r => [r.order_id, prod(skuOf(r.sku)), pill(r.status || "–", /refund|closed|approved|returned/i.test(r.status || "") ? "ok" : "warn"), N(r.refund, inr), r.quantity, { v: r.returned_at, h: fmtD(r.returned_at) }, r.reason || "–"]), { name: "return-orders", empty: "No returns in this period." }), { right: copyBtn() });
};

VIEWS["analytics-coupons"] = () => {
  const C = S.D.coupons;
  if (!C.length) return head("Coupons", "Budget, clips, redemptions and the sales each coupon brings in.") + need("Upload your coupons export from Seller Central to see coupon results.", "coupons");
  const t = k => sum(C.map(c => c[k])), todayS = ymdIST(Date.now()), act = C.filter(c => !c.end || c.end >= todayS), exp = act.filter(c => c.end && (new Date(c.end) - Date.now()) / 864e5 <= 7);
  return head("Coupons", "Budget, clips, redemptions and the sales each coupon brings in.")
    + `<div class="kpis">${kpi("Active coupons", act.length, null, num, false, `${C.length} in total`)}${kpi("Expiring in 7 days", exp.length, null, num, false, exp.map(c => esc(c.id)).join(", ") || "none")}${kpi("Budget spent", t("spent"), null, inr, false, `of ${inr(t("budget"))}`)}${kpi("Sales generated", t("sales"), null, inr, false, `${num(t("redemptions"))} redemptions`)}${kpi("Clips", t("clips"), null, num, false, t("clips") ? pct(t("redemptions") / t("clips")) + " redeemed" : "")}${kpi("Coupon cost of sales", t("sales") ? t("spent") / t("sales") : 0, null, v => pct(v), false, "spend ÷ sales")}</div>`
    + card("All coupons", table([{ l: "Coupon", left: true }, { l: "Type", left: true }, "Discount", "Clips", "Budget spent", "Redemptions", "Sales", "Redemption rate", "Cost of sales", "Start", "End", "Status"], C.map(c => [{ v: c.name || c.id, h: `<b>${esc(c.name || c.id)}</b><br><small style="color:var(--muted)">${esc(c.id)}</small>`, csv: c.id }, c.type || "–", c.disc == null ? "–" : /percent/i.test(c.type || "") ? c.disc + "%" : "₹" + c.disc, N(c.clips), N(c.spent, inr), N(c.redemptions), N(c.sales, inr), N(c.clips ? c.redemptions / c.clips : null, v => pct(v)), N(c.sales ? c.spent / c.sales : null, v => pct(v)), c.start ? fmtD(c.start) : "–", c.end ? fmtD(c.end) : "–", c.end && c.end < todayS ? pill("Ended", "mut") : c.budget && c.spent / c.budget > .85 ? pill("Near budget", "warn") : pill("Active", "ok")]), { name: "coupons" }), { right: copyBtn() })
    + `<div class="grid g2">${card("Sales per rupee of coupon spend", hbars(C.filter(c => c.spent).sort((a, b) => b.sales / b.spent - a.sales / a.spent).map(c => ({ l: c.name || c.id, v: c.sales / c.spent })), v => v.toFixed(1) + "x"))}
      ${card("Budget used", hbars(act.filter(c => c.budget).map(c => ({ l: c.name || c.id, v: c.spent / c.budget, c: c.spent / c.budget > .85 ? "var(--c4)" : "var(--c1)" })), v => pct(v, 0)))}</div>`;
};

VIEWS["analytics-promotions"] = () => {
  const DL = S.D.deals;
  if (!DL.length) return head("Deals and promotions", "Lightning deals and 7-day deals.") + need("Upload your deals export from Seller Central to see deal results.", "deals");
  const live = DL.filter(x => x.views);
  return head("Deals and promotions", "Lightning deals and 7-day deals with views, units and conversion.")
    + `<div class="kpis">${kpi("Deal revenue", sum(live.map(x => x.rev)), null, inr, false, `${live.length} deals with results`)}${kpi("Units sold", sum(live.map(x => x.units)), null)}${kpi("Conversion", sum(live.map(x => x.views)) ? sum(live.map(x => x.units)) / sum(live.map(x => x.views)) : 0, null, v => pct(v), false, "units ÷ glance views")}</div>`
    + card("Deal analysis", table([{ l: "Deal type", left: true }, { l: "Product", left: true }, "Start", "Glance views", "Units sold", "Revenue", "Conversion", "Status"], DL.map(x => [x.type || "–", prod(skuOf(x.sku)), x.start ? fmtD(x.start) : "–", N(x.views), N(x.units), N(x.rev, inr), N(x.views ? x.units / x.views : null, v => pct(v)), pill(x.status || "–", /running|live|active/i.test(x.status || "") ? "ok" : /upcoming|scheduled/i.test(x.status || "") ? "info" : "mut")]), { name: "deals" }), { right: copyBtn() });
};

VIEWS["analytics-analysis"] = () => {
  if (!S.D.daily.length) return emptyPage("Sales analysis", "Where, when and what sells.");
  const n = PER[S.period][0], a = cur(), wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], dow = wk.map((_, i) => sum(DAILY.slice(-Math.max(n, 28)).filter(d => d.date.getDay() === i).map(d => d.units)));
  const worst = SKUS.map(s => ({ s, ...skuRange(s.sku, n) })).filter(x => x.canc + x.ret).sort((x, y) => (y.canc + y.ret) - (x.canc + x.ret)).slice(0, 5);
  return head("Sales analysis", "Where, when and what sells, and what comes back.", periodSeg())
    + `<div class="grid g3">${card("Units sold by category", hbars([...new Set(SKUS.map(s => s.cat))].map(c => ({ l: c, v: sum(SKUS.filter(s => s.cat === c).map(s => skuRange(s.sku, n).units)) })).sort((x, y) => y.v - x.v)), { sub: num(a.units) + " units" })}
      ${card("Day of the week", barChart(wk.map((d, i) => ({ l: d, v: dow[i] })), { h: 200, label: "Units by weekday" }), { sub: n < 28 ? "Last 4 weeks" : "" })}
      ${card("Geographical contribution", hbars(geoFor(n).slice(0, 8).map(g => ({ l: g.state, v: g.orders })), num), { sub: "Orders by state" })}</div>`
    + `<div class="grid g21">${card("Trends", lineChart([{ name: "Units", values: DAILY.slice(-60).map(d => d.units) }, { name: "Returned units", values: DAILY.slice(-60).map(d => d.ret), area: false }], DAILY.slice(-60).map(d => fmtD(d.date)), { label: "Units and returns, 60 days" }), { sub: "Last 60 days" })}
      ${card("Top cancelled and returned SKUs", worst.length ? hbars(worst.map(x => ({ l: x.s.name, v: x.canc + x.ret })), num, "var(--c4)") : `<p class="note">None in this period.</p>`)}</div>`
    + card("Weekly summary", table([{ l: "Week", left: true }, "Orders", "Units", "Revenue", "Returned units", "Cancelled units"], [0, 1, 2, 3, 4, 5].map(w => { const r = range(7, w * 7); return [`${fmtD(r.days[0].date)} – ${fmtD(r.days[6].date)}`, r.orders, r.units, N(r.rev, inr), r.ret, r.canc]; }), { name: "weekly-summary" }), { right: copyBtn() });
};

VIEWS["analytics-projection"] = () => {
  if (!S.D.daily.length) return emptyPage("Sales projection", "Projected units and revenue per SKU.");
  const rows = SKUS.map(s => { const r = skuRange(s.sku, S.projFrom), avgU = r.units / S.projFrom, asp = r.units ? r.rev / r.units : s.price || 0; return { s, ...r, avgU, asp, pu: avgU * S.projTo, pr: avgU * S.projTo * asp }; }).filter(r => r.units).sort((a, b) => b.pr - a.pr);
  const opt = (id, v0) => `<select class="sel" id="${id}">${[[7, "One week"], [14, "Two weeks"], [30, "One month"], [60, "Two months"]].map(([v, l]) => `<option value="${v}"${v === v0 ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  return head("Sales projection", "Projected units and revenue for each SKU, from its average over a past window.", `<label class="f">Based on${opt("projFrom", S.projFrom)}</label><label class="f">Project ahead${opt("projTo", S.projTo)}</label>`)
    + `<div class="kpis">${kpi("Projected revenue", sum(rows.map(r => r.pr)), null, inr, false, "next " + S.projTo + " days")}${kpi("Projected units", sum(rows.map(r => r.pu)), null, num, false, "next " + S.projTo + " days")}</div>`
    + card("Sales projection report", table([{ l: "Product", left: true }, "Units", "Revenue", "Avg units a day", "Avg selling price", "Projected units", "Projected revenue"], rows.map(r => [prod(r.s), r.units, N(r.rev, inr), N(r.avgU, v => v.toFixed(2)), N(r.asp, inr), N(r.pu), N(r.pr, inr)]), { name: "sales-projection" }), { right: copyBtn(), sub: "A straight-line projection; it does not know about upcoming sales events." });
};

VIEWS["analytics-repeat"] = () => {
  const R = S.D.repeat;
  if (!R.length) return head("Repeat purchase", "How many customers come back, and for what.") + need("Amazon only shares repeat-customer data through Brand Analytics. Upload the Repeat Purchase Behaviour report (brand-registered sellers).", "repeat");
  const t = k => sum(R.map(r => r[k])), bySku = new Map(SKUS.filter(s => s.asin).map(s => [s.asin, s]));
  const repeatCust = sum(R.map(r => r.unique_customers * (r.repeat_customers_pct || 0) / 100));
  return head("Repeat purchase", `Brand Analytics, period ending ${fmtD(R[0].period_end)}.`)
    + `<div class="kpis">${kpi("Orders", t("orders"), null)}${kpi("Unique customers", t("unique_customers"), null)}${kpi("Repeat customers", repeatCust, null, num, false, t("unique_customers") ? pct(repeatCust / t("unique_customers")) + " of customers" : "")}${kpi("Repeat revenue", t("repeat_revenue"), null, inr)}</div>`
    + card("Repeat purchase report", table([{ l: "Product", left: true }, "Orders", "Unique customers", "Repeat customers", "Repeat revenue", "Repeat share of revenue"], R.sort((a, b) => b.orders - a.orders).map(r => { const s = bySku.get(r.asin); return [s ? prod(s) : { v: r.title || r.asin, h: `${esc(r.title || r.asin)}<br><small style="color:var(--muted)">${esc(r.asin)}</small>` }, N(r.orders), N(r.unique_customers), N(r.repeat_customers_pct == null ? null : r.repeat_customers_pct / 100, v => pct(v)), N(r.repeat_revenue, inr), N(r.repeat_revenue_pct == null ? null : r.repeat_revenue_pct / 100, v => pct(v))]; }), { name: "repeat-purchase" }), { right: copyBtn() });
};

/* ---------- inventory ---------- */
function inv() { return SKUS.map(s => { const units = s.fba + s.fbm, woc = s.daily > 0 ? units / (s.daily * 7) : Infinity; return { s, units, value: s.cogs != null ? units * s.cogs : null, woc, rev: skuRange(s.sku, 30).rev }; }); }
const wocTxt = w => w === Infinity ? "No sales" : w.toFixed(1);
VIEWS["analytics-inventory"] = () => {
  if (!SKUS.length) return emptyPage("Inventory dashboard", "Stock on hand and how long it lasts.");
  const rows = inv(), tot = sum(rows.map(r => r.rev)) || 1; let acc = 0;
  const ranked = [...rows].sort((a, b) => b.rev - a.rev).map(r => { acc += r.rev; return { ...r, bucket: Math.min(4, Math.floor((acc - r.rev) / tot * 5)) }; });
  const buckets = ["Top 20%", "20% – 40%", "40% – 60%", "60% – 80%", "Bottom 20%"], cls = (w, u) => u === 0 ? 0 : w < 2 ? 1 : w < 4 ? 2 : w < 6 ? 3 : 4;
  const mat = buckets.map((_, bi) => [0, 1, 2, 3, 4].map(ci => ranked.filter(r => r.bucket === bi && cls(r.woc, r.units) === ci).length));
  const fast = r => r.s.daily >= Math.max(.5, sum(SKUS.map(s => s.daily)) / SKUS.length), low = r => r.woc < 3, q = (f, l) => rows.filter(r => f(r) && l(r)).map(r => r.s.name);
  const asOf = SKUS.map(s => s.inventoryAsOf).filter(Boolean).sort().pop(), noCost = SKUS.filter(s => s.cogs == null).length;
  return head("Inventory dashboard", `Stock on hand, where it sits, and how long it lasts.${asOf ? " Stock as of " + fmtD(asOf) + "." : ""}`)
    + (asOf ? "" : need("Upload the FBA inventory report (and your own stock in the product costs sheet) to see stock levels.", "fba_inventory"))
    + `<div class="kpis">${kpi("SKUs", rows.length, null, num, false, "with listings or sales")}${kpi("Inventory units", sum(rows.map(r => r.units)), null, num, false, "Amazon and own warehouse")}${kpi("Inventory value", sum(rows.map(r => r.value || 0)), null, inr, false, noCost ? `at cost; ${noCost} SKUs have no cost yet` : "at cost")}${kpi("Under 2 weeks of cover", rows.filter(r => r.woc < 2).length, null, num, false, "SKUs")}</div>`
    + `<div class="grid g3">${card("Amazon vs own warehouse", donut([{ l: "Fulfilled by Amazon", v: sum(SKUS.map(s => s.fba)) }, { l: "Own warehouse", v: sum(SKUS.map(s => s.fbm)) }], { center: num(sum(rows.map(r => r.units))), sub: "units" }))}
      ${card("Most units at Amazon", hbars([...SKUS].sort((a, b) => b.fba - a.fba).slice(0, 5).map(s => ({ l: s.sku, v: s.fba }))))}
      ${card("Most units in own warehouse", hbars([...SKUS].sort((a, b) => b.fbm - a.fbm).slice(0, 5).map(s => ({ l: s.sku, v: s.fbm })), num, "var(--c2)"))}</div>`
    + `<div class="grid g2">${card("Weeks of cover by sales contribution", `<div class="tw"><table><thead><tr><th class="l">Sales contribution</th><th>Out of stock</th><th>Under 2 wks</th><th>2–4 wks</th><th>4–6 wks</th><th>Over 6 wks</th></tr></thead><tbody>${mat.map((r, i) => `<tr><td>${buckets[i]}</td>${r.map((v, ci) => `<td style="${v ? `background:${ci < 2 && i < 2 ? "var(--bad-soft)" : ci === 4 && i > 2 ? "var(--warn-soft)" : "var(--accent-soft)"};font-weight:700` : "color:var(--muted)"}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="note">Red cells are best-sellers about to run out. Amber cells are slow sellers tying up cash.</p>`)}
      ${card("Speed vs stock", `<div class="quad"><div style="background:var(--bad-soft)"><b>Fast moving, low stock</b>${q(fast, low).map(n => `<span>${esc(n)}</span>`).join("") || "<span>None</span>"}</div><div style="background:var(--ok-soft)"><b>Fast moving, high stock</b>${q(fast, r => !low(r)).map(n => `<span>${esc(n)}</span>`).join("") || "<span>None</span>"}</div><div><b>Slow moving, low stock</b>${q(r => !fast(r), low).map(n => `<span>${esc(n)}</span>`).join("") || "<span>None</span>"}</div><div style="background:var(--warn-soft)"><b>Slow moving, high stock</b>${q(r => !fast(r), r => !low(r)).map(n => `<span>${esc(n)}</span>`).join("") || "<span>None</span>"}</div></div>`, { sub: "Fast = above the average daily sales per SKU" })}</div>`
    + card("Inventory report", table([{ l: "Product", left: true }, "At Amazon", "Own warehouse", "Total units", "Value at cost", "Sells a day", "Weeks of cover", "Status"], rows.sort((a, b) => a.woc - b.woc).map(r => [prod(r.s), r.s.fba, r.s.fbm, r.units, N(r.value, inr), N(r.s.daily, v => v.toFixed(1)), { v: r.woc === Infinity ? 9999 : r.woc, h: wocTxt(r.woc) }, r.units === 0 && r.s.daily > 0 ? pill("Out of stock", "bad") : r.woc < 2 ? pill("Reorder now", "bad") : r.woc < 4 ? pill("Reorder soon", "warn") : pill("Healthy", "ok")]), { name: "inventory" }), { right: copyBtn() });
};
VIEWS["analytics-invproj"] = () => {
  if (!SKUS.length) return emptyPage("Inventory projection", "Stock left after the coming days.");
  const rows = inv().filter(r => r.s.daily > 0 || r.units).map(r => { const need = r.s.daily * (S.projTo + 14) - r.units; return { ...r, proj: r.s.daily * S.projTo, after: r.units - r.s.daily * S.projTo, need: Math.max(0, Math.ceil(need)) }; }).sort((a, b) => a.after - b.after);
  return head("Inventory projection", `Stock left after the next ${S.projTo} days, and what to send in to keep two more weeks of cover.`, `<label class="f">Project ahead<select class="sel" id="projTo">${[[7, "One week"], [14, "Two weeks"], [30, "One month"]].map(([v, l]) => `<option value="${v}"${v === S.projTo ? " selected" : ""}>${l}</option>`).join("")}</select></label>`)
    + card("Inventory projection report", table([{ l: "Product", left: true }, "Units sold (30 d)", "Avg units a day", "Current units", "Projected sales", "Units left", "Send in"], rows.map(r => [prod(r.s), skuRange(r.s.sku, 30).units, N(r.s.daily, v => v.toFixed(1)), r.units, N(r.proj), { v: r.after, h: r.after < 0 ? `<b style="color:var(--bad)">${num(r.after)}</b>` : num(r.after) }, { v: r.need, h: r.need ? `<b>${num(r.need)}</b>` : "–" }]), { name: "inventory-projection" }), { right: copyBtn() });
};
VIEWS["analytics-suppressed"] = () => {
  const rows = SKUS.filter(s => s.suppressed);
  return head("Suppressed listings", "Listings hidden from search, the sales they are losing, and the fix.")
    + (S.D.imports.some(i => i.report === "suppressed") || rows.length ? "" : need("Upload the suppressed listings file from Manage All Inventory to track suppressed listings.", "suppressed"))
    + `<div class="kpis">${kpi("Suppressed listings", rows.length, null, num, false, "of " + SKUS.length)}${kpi("Units stuck", sum(rows.map(s => s.fba + s.fbm)), null, num, false, "in stock but not visible")}${kpi("Sales at risk", sum(rows.map(s => s.daily * (s.price || 0) * 7)), null, inr, false, "a week, at recent sales rate")}</div>`
    + card("Suppressed listings report", table([{ l: "Product", left: true }, "Inventory", "Sales at risk a week", "Status", { l: "Reason", left: true }, ""], rows.map(s => [prod(s), s.fba + s.fbm, N(s.daily * (s.price || 0) * 7, inr), pill("Suppressed", "bad"), { v: s.suppressed, h: `<div style="white-space:normal;max-width:360px">${esc(s.suppressed)}</div>` }, { v: "", h: /image/i.test(s.suppressed) ? `<button type="button" class="btn sm" data-act="agent" data-id="bg">Fix image</button>` : `<button type="button" class="btn sm" data-act="agent" data-id="optim">Check listing</button>` }]), { name: "suppressed", empty: "No suppressed listings." }), { right: copyBtn() });
};
VIEWS["analytics-pim"] = () => {
  if (!SKUS.length) return emptyPage("Product master", "One record per product.");
  const noCost = SKUS.filter(s => s.cogs == null);
  return head("Product master", "One master record per product: costs, categories and listings.", `<a class="btn" href="api/imports/template/product-costs.csv">Download costs sheet</a><a class="btn pri" href="#account-data-product_costs">Upload costs sheet</a>`)
    + (noCost.length ? strip([{ t: "warn", h: `${noCost.length} SKU${noCost.length > 1 ? "s have" : " has"} no cost per unit`, p: "Without costs, profit and break-even ACoS cannot be worked out. Download the sheet, fill in costs and upload it." }]) : "")
    + `<div class="kpis">${kpi("Master SKUs", SKUS.length, null)}${kpi("With cost per unit", SKUS.length - noCost.length, null)}${kpi("With listing content", SKUS.filter(s => s.bullets != null).length, null, num, false, "from the category listings report")}${kpi("Marketplaces", 1, null, num, false, "Flipkart and Meesho come next")}</div>`
    + card("Products", table([{ l: "Product", left: true }, { l: "Category", left: true }, { l: "ASIN", left: true }, "Price", "Cost per unit", "Margin after fees", "Images", "Bullets", "A+"], SKUS.map(s => [prod(s), s.cat, s.asin || "–", N(s.price, inr), N(s.cogs, inr), N(margin(s), v => pct(v)), N(s.images), N(s.bullets), s.aplus == null ? "–" : s.aplus ? "Yes" : "No"]), { name: "product-master" }), { right: copyBtn(), sub: `Margin after fees uses your fee rate of ${pct(FEE(), 0)}; change it in Brand and team.` });
};

/* ---------- business ---------- */
VIEWS["analytics-standard"] = () => {
  if (!S.D.daily.length) return emptyPage("Standard report", "Daily business figures.");
  const days = DAILY.slice(-30), T = { units: ["Units sold vs units returned", d => d.units, d => d.ret, num], revenue: ["Revenue vs cancelled units", d => d.rev, d => d.canc, inr], orders: ["Orders vs cancelled orders", d => d.orders, d => d.cancelled, num] }[S.stdType];
  return head("Standard report", "Daily business figures for the last 30 days.", `<label class="f">Report type<select class="sel" id="stdType">${[["units", "Units sold vs units returned"], ["revenue", "Revenue vs cancelled units"], ["orders", "Orders vs cancelled orders"]].map(([v, l]) => `<option value="${v}"${v === S.stdType ? " selected" : ""}>${l}</option>`).join("")}</select></label>`)
    + card("Business chart", barChart(days.map(d => ({ l: fmtD(d.date), v: T[1](d) })), { line: S.stdType === "revenue" ? null : days.map(T[2]), label: T[0] }) + `<div class="legend"><span><i style="background:var(--c1)"></i>${T[0].split(" vs ")[0]}</span>${S.stdType === "revenue" ? "" : `<span><i style="background:var(--c2)"></i>${T[0].split(" vs ")[1]}</span>`}</div>`)
    + card("Reports", table([{ l: "Date", left: true }, T[0].split(" vs ")[0], T[0].split(" vs ")[1]], [...days].reverse().map(d => [{ v: d.date.getTime(), h: fmtD(d.date), csv: d.ds }, N(T[1](d), T[3]), N(T[2](d))]), { name: "standard-report" }), { right: copyBtn() });
};
VIEWS["analytics-weekly"] = () => {
  if (!S.D.daily.length) return emptyPage("Weekly comparison", "Revenue per SKU for six weeks.");
  const wk = [5, 4, 3, 2, 1, 0], lbl = w => "Wk of " + fmtD(range(7, w * 7).days[0].date);
  const rows = SKUS.map(s => ({ s, v: wk.map(w => skuRange(s.sku, 7, w * 7).rev) })).filter(x => sum(x.v)).sort((a, b) => b.v[5] - a.v[5]).map(({ s, v }) => [prod(s), { v: 0, h: spark(v), csv: "" }, ...v.map(x => N(x, inr)), N(v[5] - v[4], x => (x >= 0 ? "+" : "−") + inr(Math.abs(x)))]);
  return head("Weekly comparison", "Revenue per SKU for the last six weeks, with the trend at a glance.") + card("Weekly report", table([{ l: "Product", left: true }, "Trend", ...wk.map(lbl), "Change"], rows, { name: "weekly-comparison" }), { right: copyBtn() });
};
VIEWS["analytics-timesheet"] = () => {
  if (!S.D.daily.length) return emptyPage("Time sheet", "When in the day your orders arrive.");
  const cols = Array.from({ length: 24 }, (_, i) => i + ""), days = DAILY.slice(-7), cell = new Map(S.D.heat7.map(x => [x.d + "|" + x.h, x.units]));
  const m = range(30), lyDays = LONG.slice(400 - 365 - 30, 400 - 365), ly = { units: sum(lyDays.map(d => d.units)), rev: sum(lyDays.map(d => d.rev)) };
  const peak = HOURLY.indexOf(Math.max(...HOURLY)), h12 = h => `${(h % 12) || 12} ${h < 12 ? "am" : "pm"}`;
  return head("Time sheet", "When in the day your orders arrive. Use it to time ads and deals.")
    + `<div class="grid g21">${card("Hourly trend", lineChart([{ name: "Units", values: HOURLY.map(h => h / 30) }], cols.map(c => c + "h"), { fmt: v => v.toFixed(1), label: "Average units by hour" }), { sub: "Average units per hour, last 30 days" })}
      ${card("Business time sheet", `<div class="metric"><span>Last 30 days</span><b>${num(m.units)} units · ${inr(m.rev)}</b></div><div class="metric"><span>Same days last year</span><b>${ly.units ? num(ly.units) + " units · " + inr(ly.rev) : "No data for last year yet"}</b></div>${ly.units ? `<div class="metric"><span>Change on last year</span>${delta(m.units, ly.units)}</div>` : ""}<div class="metric"><span>Peak hour</span><b>${sum(HOURLY) ? h12(peak) + " – " + h12((peak + 1) % 24) : "–"}</b></div>`)}</div>`
    + card("Units by hour, last 7 days", heatmap(days.map(d => ({ l: fmtD(d.date), cells: cols.map(h => cell.get(d.ds + "|" + h) || 0) })), cols), { sub: "Darker means more units ordered" });
};
VIEWS["analytics-pnl"] = () => {
  if (!S.D.daily.length && !S.D.txBuckets.length) return emptyPage("Profit and loss", "What came in, what Amazon and ads took, and what is left.");
  const tb = S.D.txBuckets, exact = tb.length > 0, m = range(30), adsFromReports = adTotals().spend;
  const units30 = new Map(SKUS.map(s => [s.sku, skuRange(s.sku, 30).units])), cogs = sum(SKUS.map(s => (units30.get(s.sku) || 0) * (s.cogs || 0))), noCost = SKUS.filter(s => s.cogs == null && units30.get(s.sku)).length;
  let income, lines;
  if (exact) {
    const g = f => sum(tb.filter(f).map(x => x.product_sales));
    const sales = g(x => x.type === "Order"), refunds = g(x => /refund/i.test(x.type)), credits = sum(tb.map(x => x.shipping_credits)), promos = sum(tb.map(x => x.promo_rebates));
    const adCost = -sum(tb.filter(x => x.ads).map(x => x.total)), storage = -sum(tb.filter(x => x.storage).map(x => x.total + 0));
    income = [["Product sales", sales], ["Shipping and gift wrap credits", credits], ["Refunds", refunds], ["Promotional rebates", promos]];
    lines = [["Selling fees (commission and closing fee)", -sum(tb.map(x => x.selling_fees))], ["Fulfilment and shipping fees", -sum(tb.filter(x => !x.storage).map(x => x.fba_fees))], ["Storage and inventory fees", storage > 0 ? storage : -sum(tb.filter(x => x.storage).map(x => x.fba_fees))],
      ["Other transaction fees", -sum(tb.map(x => x.other_fees))], ["Cost of advertising", adCost || adsFromReports], ["Other charges", -sum(tb.filter(x => !x.ads && !x.storage).map(x => x.other))]];
    lines.push(["TCS and TDS withheld (claimable)", -sum(tb.map(x => x.tax_withheld))]);
  } else {
    income = [["Product sales (from orders)", m.rev]];
    lines = [[`Marketplace fees (estimated at ${pct(FEE(), 0)})`, m.rev * FEE()], ["Cost of advertising", adsFromReports]];
  }
  const ti = sum(income.map(x => x[1])), te = sum(lines.map(x => x[1])), net = ti - te, colors = ["#0E6B62", "#E09A1A", "#6C8EBF", "#B5483B", "#8A9A5B", "#9C6ADE", "#4BA3A3", "#C9A227"];
  const feeBySku = new Map(S.D.txSku.map(r => [r.sku, r]));
  return head("Profit and loss", `Last 30 days. ${exact ? "From your Amazon transaction report." : "Estimated from orders and ads; upload the transaction report for exact fees."}`, `<a class="btn" href="#analytics-pim">Edit costs</a>${copyBtn()}`)
    + (exact ? "" : need("Fees here are an estimate. Upload the date range transaction report from Payments for exact fees, refunds and TCS.", "transactions"))
    + (noCost ? strip([{ t: "warn", h: `${noCost} selling SKU${noCost > 1 ? "s have" : " has"} no cost`, p: "Profit after COGS leaves them out. Add costs in Product master." }]) : "")
    + `<div class="kpis">${kpi("Net sales", ti, null, inr, false, "after refunds and rebates")}${kpi("Amazon fees and ads", te, null, inr, false, ti ? pct(te / ti) + " of sales" : "")}${kpi("Payout", net, null, inr, false, "before product cost")}${kpi("Profit after COGS", net - cogs, null, inr, false, ti ? pct((net - cogs) / ti) + " margin" : "")}</div>`
    + (ti > 0 ? card("Where each rupee of sales goes", `<div class="pnlbar">${lines.filter(e => e[1] > 0).map((e, i) => `<i style="width:${(e[1] / ti * 100).toFixed(2)}%;background:${colors[i % 8]}" title="${esc(e[0])}: ${inr(e[1])}"></i>`).join("")}<i style="width:${Math.max(0, cogs / ti * 100).toFixed(2)}%;background:var(--line2)" title="COGS"></i><i style="flex:1;background:var(--ok)" title="Profit"></i></div><div class="legend">${lines.filter(e => e[1] > 0).map((e, i) => `<span><i style="background:${colors[i % 8]}"></i>${esc(e[0])}</span>`).join("")}<span><i style="background:var(--line2)"></i>COGS</span><span><i style="background:var(--ok)"></i>Profit</span></div>`) : "")
    + `<div class="grid g2">${card("Income", income.map(([l, v]) => `<div class="metric"><span>${esc(l)}</span><b>${inr(v, 2)}</b></div>`).join("") + `<div class="metric"><b>Total income</b><b>${inr(ti, 2)}</b></div>`)}
      ${card("Expenses", lines.map(([l, v]) => `<div class="metric"><span>${esc(l)}</span><b>${inr(-v, 2)}</b></div>`).join("") + `<div class="metric"><span>Cost of goods (COGS)</span><b>${inr(-cogs, 2)}</b></div><div class="metric"><b>Total expenses</b><b>${inr(-(te + cogs), 2)}</b></div>`)}</div>`
    + card("Profit by SKU", table([{ l: "Product", left: true }, "Sales", "COGS", "Amazon fees", "Ads", "Profit", "Margin"], SKUS.map(s => { const r = skuRange(s.sku, 30), t = feeBySku.get(s.sku), c = s.cogs == null ? null : r.units * s.cogs, f = t ? -t.fees : r.rev * FEE(), a = sum(CAMPAIGNS.filter(x => x.sku === s.sku).map(x => x.spend)), p = c == null ? null : r.rev - c - f - a; return { s, r, row: [prod(s), N(r.rev, inr), N(c, inr), N(f, inr), N(a, inr), { v: p ?? "", h: p == null ? "Add cost" : `<b style="color:${p < 0 ? "var(--bad)" : "var(--ok)"}">${inr(p)}</b>` }, N(p == null || !r.rev ? null : p / r.rev, v => pct(v))] }; }).filter(x => x.r.rev).sort((a, b) => b.r.rev - a.r.rev).map(x => x.row), { name: "pnl-by-sku" }), { sub: "Ads cost is only counted for campaigns linked to a product (from the advertised product report)." });
};
