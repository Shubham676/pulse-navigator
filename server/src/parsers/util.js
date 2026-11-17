import crypto from "node:crypto";

// "₹1,234.50", "INR 1,234", "(12.00)", "-", "" -> number
export function money(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (!s || s === "-" || s === "--" || /^n\/?a$/i.test(s)) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[^\d\-().]/g, ""));
  s = s.replace(/[^\d.]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
export const int = v => Math.round(money(v));
export const pctNum = v => money(v); // "12.5%" -> 12.5

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const TZ = { utc: 0, gmt: 0, ist: 330, pst: -480, pdt: -420, est: -300, edt: -240, cet: 60, cest: 120 };

// Parses the date and date-time styles Amazon uses in India. Returns a Date (UTC instant) or null.
// Dates without a time or zone are read as Indian time (IST), the seller's day.
export function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  let s = String(v).trim();
  if (!s) return null;
  // ISO, with or without zone
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
    const d = new Date(hasZone ? s : s.replace(" ", "T") + (s.length <= 10 ? "T00:00:00" : "") + "+05:30");
    return isNaN(d) ? null : d;
  }
  // Excel serial number
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((Number(s) - 25569) * 864e5) - 330 * 6e4); return isNaN(d) ? null : d; }
  let zoneMin = 330;
  const z = s.match(/\b(UTC|GMT|IST|PST|PDT|EST|EDT|CET|CEST)\b/i);
  if (z) { zoneMin = TZ[z[1].toLowerCase()]; s = s.replace(z[0], "").trim(); }
  let y, mo, d, h = 0, mi = 0, se = 0;
  const time = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (time) {
    h = Number(time[1]); mi = Number(time[2]); se = Number(time[3] || 0);
    if (time[4]) { const pm = time[4].toLowerCase() === "pm"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    s = s.replace(time[0], "").trim();
  }
  s = s.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  let m;
  if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/))) { d = +m[1]; mo = +m[2] - 1; y = +m[3]; }           // 15/11/2026 (day first, Indian style)
  else if ((m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2,4})$/))) { d = +m[1]; mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]; y = +m[3]; } // 15-Nov-2026, 1 Nov 2026
  else if ((m = s.match(/^([A-Za-z]{3,9})[ -](\d{1,2})[ -](\d{2,4})$/))) { mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = +m[3]; } // Nov 15 2026
  else return null;
  if (mo === undefined || !(d >= 1 && d <= 31)) return null;
  if (y < 100) y += 2000;
  const out = new Date(Date.UTC(y, mo, d, h, mi, se) - zoneMin * 6e4);
  return isNaN(out) ? null : out;
}

// The seller's calendar day (IST) for an instant, as 'YYYY-MM-DD'
export function istDay(date) {
  const d = new Date(date.getTime() + 330 * 6e4);
  return d.toISOString().slice(0, 10);
}

export const yes = v => /^(true|yes|y|1)$/i.test(String(v ?? "").trim());
export const hash = s => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

// Returns the first value whose normalised header is in the alias list
export function pick(row, ...aliases) {
  for (const a of aliases) { const v = row[a]; if (v !== undefined && v !== "") return v; }
  return "";
}
// First header matching a regular expression
export function pickRe(row, re) {
  for (const k of Object.keys(row)) if (re.test(k) && row[k] !== "") return row[k];
  return "";
}
