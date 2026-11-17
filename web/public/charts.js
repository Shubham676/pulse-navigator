"use strict";
/* Small SVG chart helpers. Colours come from the theme tokens. */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n, d = 0) => n == null || isNaN(n) ? "–" : (n < 0 ? "−" : "") + "₹" + Math.abs(Number(n)).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const num = n => n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("en-IN");
const pct = (n, d = 1) => n == null || !isFinite(n) ? "–" : (n * 100).toFixed(d) + "%";
const compact = n => n < 0 ? "−" + compact(-n) : n >= 1e7 ? (n / 1e7).toFixed(1) + "Cr" : n >= 1e5 ? (n / 1e5).toFixed(1) + "L" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : Math.round(n) + "";
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];

function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

/* series: [{name, values, color, area}] ; labels: x labels */
function lineChart(series, labels, { h = 220, fmt = compact, every = 0, label = "Chart" } = {}) {
  const W = 640, H = h, L = 44, R = 10, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const n = labels.length, x = i => L + (n > 1 ? i / (n - 1) * iw : iw / 2), y = v => T + ih - v / max * ih;
  const step = every || Math.max(1, Math.ceil(n / 8));
  let g = `<g class="grid">`; for (let k = 0; k <= 4; k++) { const v = max * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; } g += `</g>`;
  labels.forEach((lb, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(lb)}</text>`; });
  const paths = series.map((s, si) => {
    const c = s.color || COLORS[si], d = s.values.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const last = s.values.length - 1;
    return (s.area !== false && si === 0 ? `<path d="${d} L${x(last)} ${T + ih} L${x(0)} ${T + ih} Z" fill="${c}" opacity=".12"/>` : "") +
      `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>` + `<circle cx="${x(last)}" cy="${y(s.values[last])}" r="3.5" fill="${c}"/>`;
  }).join("");
  const leg = series.length > 1 ? `<div class="legend">${series.map((s, i) => `<span><i style="background:${s.color || COLORS[i]}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}${paths}</svg>${leg}`;
}

function barChart(items, { h = 220, fmt = compact, color = "var(--c1)", label = "Bar chart", line = null } = {}) {
  const W = 640, H = h, L = 44, R = 10, T = 10, B = 30, iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(1, ...items.map(i => i.v), ...(line ? line.map(Number) : [])));
  const n = items.length, bw = iw / n, y = v => T + ih - v / max * ih, step = Math.max(1, Math.ceil(n / 10));
  let g = `<g class="grid">`; for (let k = 0; k <= 4; k++) { const v = max * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; } g += `</g>`;
  const bars = items.map((it, i) => `<rect x="${(L + i * bw + bw * .18).toFixed(1)}" y="${y(it.v).toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${(T + ih - y(it.v)).toFixed(1)}" rx="3" fill="${it.c || color}"><title>${esc(it.l)}: ${fmt(it.v)}</title></rect>` + (i % step === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(it.l)}</text>` : "")).join("");
  const ln = line ? `<path d="${line.map((v, i) => (i ? "L" : "M") + (L + i * bw + bw / 2).toFixed(1) + " " + y(v).toFixed(1)).join(" ")}" fill="none" stroke="var(--c2)" stroke-width="2"/>` : "";
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}${bars}${ln}</svg>`;
}

function donut(parts, { center = "", sub = "", label = "Share" } = {}) {
  const tot = parts.reduce((a, p) => a + p.v, 0) || 1, R = 70, C = 2 * Math.PI * R; let off = 0;
  const arcs = parts.map((p, i) => { const len = p.v / tot * C, s = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${p.c || COLORS[i]}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 90 90)"/>`; off += len; return s; }).join("");
  return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 180 180" style="width:160px;flex:none" role="img" aria-label="${esc(label)}"><circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="22"/>${arcs}<text x="90" y="88" text-anchor="middle" style="font:700 17px var(--f-display);fill:var(--ink)">${esc(center)}</text><text x="90" y="106" text-anchor="middle" style="font-size:11px;fill:var(--muted)">${esc(sub)}</text></svg>
   <div class="bars" style="flex:1;min-width:160px">${parts.map((p, i) => `<div class="metric" style="padding:6px 0"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p.c || COLORS[i]};margin-right:8px"></i>${esc(p.l)}</span><b>${p.f ? p.f(p.v) : num(p.v)} <small style="display:inline;color:var(--muted)">${pct(p.v / tot, 0)}</small></b></div>`).join("")}</div></div>`;
}

function hbars(items, fmt = num, color) {
  const max = Math.max(1, ...items.map(i => i.v));
  return `<div class="bars">${items.map((it, i) => `<div class="b"><span title="${esc(it.l)}">${esc(it.l)}</span><div class="t"><i style="width:${(it.v / max * 100).toFixed(1)}%;background:${it.c || color || "var(--c1)"}"></i></div><em>${fmt(it.v)}</em></div>`).join("")}</div>`;
}

function spark(vals, w = 90, h = 26, color = "var(--c1)") {
  const max = Math.max(1, ...vals), d = vals.map((v, i) => (i ? "L" : "M") + (i / (vals.length - 1 || 1) * w).toFixed(1) + " " + (h - 2 - v / max * (h - 4)).toFixed(1)).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
}

/* rows: [{l, cells:[values]}] ; cols: labels ; values 0..max */
function heatmap(rows, cols, fmt = v => v.toFixed(0)) {
  const max = Math.max(1, ...rows.flatMap(r => r.cells));
  return `<div style="overflow-x:auto"><div class="heat" style="grid-template-columns:52px repeat(${cols.length},minmax(26px,1fr));min-width:${60 + cols.length * 28}px">
   <div class="h"></div>${cols.map(c => `<div class="h">${esc(c)}</div>`).join("")}
   ${rows.map(r => `<div class="h" style="justify-content:start">${esc(r.l)}</div>` + r.cells.map(v => `<div title="${esc(r.l)}: ${fmt(v)}" style="background:color-mix(in srgb, var(--c1) ${(8 + v / max * 80).toFixed(0)}%, var(--surface))">${v / max > .55 ? `<span style="color:var(--accent-ink);font-weight:700">${fmt(v)}</span>` : ""}</div>`).join("")).join("")}
  </div></div>`;
}
