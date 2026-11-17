import { tx, q } from "../db.js";
import { readTable } from "../parsers/table.js";
import { REPORTS, KNOWN_HEADERS, detectReport } from "../parsers/reports.js";
import { HttpError } from "./auth.js";

// Reads a report file, works out which report it is (unless told), saves it and records the import.
export async function importBuffer({ orgId, userId = null, source = "upload", buf, filename = "", reportId, adType, periodStart, periodEnd }) {
  let table;
  try { table = await readTable(buf, filename, KNOWN_HEADERS); }
  catch (e) { throw new HttpError(400, /xls files|empty/.test(e.message) ? `${filename || "The file"}: ${e.message}` : `Pulse could not read ${filename || "the file"}. Upload the report exactly as Amazon gives it: CSV, tab-separated TXT or XLSX.`); }
  const def = reportId ? REPORTS.find(r => r.id === reportId) : detectReport(table.headers);
  if (!def) {
    await logImport({ orgId, userId, source, report: "unknown", filename, rowsRead: table.rows.length, rowsSaved: 0, status: "failed", message: "Report type not recognised" });
    throw new HttpError(400, `Pulse did not recognise ${filename || "this file"}. Its first columns are: ${table.rawHeaders.slice(0, 6).join(", ")}. Pick the report type by hand, or check it is one of the supported reports.`, "unknown_report");
  }
  if (!table.rows.length) throw new HttpError(400, `${filename || "The file"} has headers but no rows.`);
  const opts = { headers: new Set(table.headers), filename, adType, periodStart, periodEnd };
  let res;
  try { res = await tx(c => def.save(c, orgId, table.rows, opts)); }
  catch (e) {
    await logImport({ orgId, userId, source, report: def.id, filename, rowsRead: table.rows.length, rowsSaved: 0, status: "failed", message: e.message.slice(0, 300) });
    throw e;
  }
  const message = [res.from && res.to ? `Covers ${res.from} to ${res.to}.` : "", res.adType ? `Saved as ${res.adType} campaigns.` : "", res.message || ""].filter(Boolean).join(" ");
  await logImport({ orgId, userId, source, report: def.id, filename, rowsRead: table.rows.length, rowsSaved: res.saved, status: "done", message });
  return { report: def.id, label: def.label, rowsRead: table.rows.length, rowsSaved: res.saved, from: res.from, to: res.to, message };
}

async function logImport(i) {
  await q("insert into imports (org_id, user_id, source, report, filename, rows_read, rows_saved, status, message) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [i.orgId, i.userId, i.source, i.report, i.filename, i.rowsRead, i.rowsSaved, i.status, i.message || null]);
}

// Saves rows that already have normalised keys (from Amazon API JSON) with a known report type.
export async function importRows({ orgId, userId = null, source, reportId, rows, adType, periodStart, periodEnd }) {
  const def = REPORTS.find(r => r.id === reportId);
  if (!def) throw new Error(`Unknown report ${reportId}`);
  const headers = new Set(rows.flatMap(r => Object.keys(r)));
  const res = await tx(c => def.save(c, orgId, rows, { headers, filename: source, adType, periodStart, periodEnd }));
  const message = [res.from && res.to ? `Covers ${res.from} to ${res.to}.` : "", res.message || ""].filter(Boolean).join(" ");
  await logImport({ orgId, userId, source, report: def.id, filename: source, rowsRead: rows.length, rowsSaved: res.saved, status: "done", message });
  return { report: def.id, label: def.label, rowsRead: rows.length, rowsSaved: res.saved, message };
}
