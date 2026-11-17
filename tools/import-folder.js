// Imports every report file in a folder into one brand. Usage: node scripts/import-folder.js <orgId> <folder>
import fs from "node:fs";
import path from "node:path";
import { migrate } from "../server/src/migrate.js";
import { importBuffer } from "../server/src/lib/importer.js";
import { pool } from "../server/src/db.js";
const [orgId, dir] = [Number(process.argv[2]), process.argv[3]];
await migrate(() => {});
const order = f => /listing|catalog/i.test(f) ? 0 : /order/i.test(f) && !/repeat/i.test(f) ? 1 : 2;
const end = new Date(Date.now() + 330 * 6e4).toISOString().slice(0, 10), start = new Date(Date.now() + 330 * 6e4 - 29 * 864e5).toISOString().slice(0, 10);
for (const f of fs.readdirSync(dir).sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
  try {
    const r = await importBuffer({ orgId, buf: fs.readFileSync(path.join(dir, f)), filename: f, periodStart: start, periodEnd: end });
    console.log(`OK   ${f.padEnd(48)} ${r.report.padEnd(16)} read ${r.rowsRead} saved ${r.rowsSaved} ${r.message}`);
  } catch (e) { console.log(`FAIL ${f.padEnd(48)} ${e.message}`); }
}
await pool.end();
