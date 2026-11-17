// Turns an uploaded file (CSV, TSV, TXT flat file or XLSX) into rows of { normalisedHeader: value }.
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export const normHeader = h => String(h ?? "").replace(/^﻿/, "").toLowerCase().replace(/\(#\)/g, "").replace(/[^a-z0-9]+/g, "");

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(r => r.text).join("");
    if ("result" in v) return cellText(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink) return String(v.hyperlink);
  }
  return String(v);
}

async function xlsxRows(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  // use the sheet with the most filled rows
  let best = null;
  wb.eachSheet(ws => { if (!best || ws.actualRowCount > best.actualRowCount) best = ws; });
  if (!best) return [];
  const out = [];
  best.eachRow({ includeEmpty: false }, row => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = cellText(cell.value); });
    out.push(Array.from(vals, v => v ?? ""));
  });
  return out;
}

function textRows(buf) {
  let text = buf.toString("utf8");
  // Some Amazon flat files are Windows-1252, which is not valid UTF-8; latin1 keeps headers and numbers readable
  if (text.includes("�")) text = buf.toString("latin1");
  text = text.replace(/^﻿/, "");
  const sample = text.split(/\r?\n/).slice(0, 30).join("\n");
  const tabs = (sample.match(/\t/g) || []).length, commas = (sample.match(/,/g) || []).length, semis = (sample.match(/;/g) || []).length;
  const delimiter = tabs > commas / 2 ? "\t" : semis > commas ? ";" : ",";
  return parse(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, bom: true, trim: true, quote: delimiter === "\t" ? false : '"' });
}

// knownHeaders: Set of normalised header names any parser understands; used to find the header row under preamble lines
export async function readTable(buf, filename, knownHeaders) {
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (/\.xls$/i.test(filename) && !isZip) throw new Error("Old .xls files are not supported. Open the file and save it as .xlsx or .csv.");
  const raw = isZip ? await xlsxRows(buf) : textRows(buf);
  if (!raw.length) throw new Error("The file is empty.");
  let hi = 0, bestScore = -1;
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const score = raw[i].filter(c => knownHeaders.has(normHeader(c))).length;
    if (score > bestScore) { bestScore = score; hi = i; }
  }
  const headers = raw[hi].map(normHeader);
  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r.some(c => String(c).trim() !== "")) continue;
    const o = {};
    headers.forEach((h, j) => { if (h && o[h] === undefined) o[h] = r[j] === undefined ? "" : String(r[j]).trim(); });
    rows.push(o);
  }
  return { headers, rows, rawHeaders: raw[hi] };
}
