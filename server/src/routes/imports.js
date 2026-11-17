import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { one } from "../db.js";
import { many, q } from "../db.js";
import { REPORTS } from "../parsers/reports.js";
import { importBuffer } from "../lib/importer.js";
import { requireAuth, requireOrg, canEdit, canAdmin, HttpError, audit } from "../lib/auth.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export default async function importRoutes(app) {
  app.get("/api/imports", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const history = await many("select id, source, report, filename, rows_read, rows_saved, status, message, created_at from imports where org_id=$1 order by id desc limit 100", [req.org.id]);
    const latest = await many("select distinct on (report) report, created_at from imports where org_id=$1 and status='done' order by report, id desc", [req.org.id]);
    return { reports: REPORTS.map(r => ({ id: r.id, label: r.label, group: r.group, how: r.how, needsPeriod: !!r.needsPeriod })), history, latest };
  });

  // multipart: one or more files, plus optional fields report, adType, periodStart, periodEnd
  app.post("/api/imports", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const fields = {}, files = [];
    for await (const part of req.parts()) {
      if (part.type === "file") files.push({ filename: part.filename, buf: await part.toBuffer() });
      else fields[part.fieldname] = part.value;
    }
    if (!files.length) throw new HttpError(400, "Choose a report file to upload.");
    const f = z.object({ report: z.string().optional(), adType: z.enum(["SP", "SB", "SD", ""]).optional(), periodStart: day, periodEnd: day })
      .parse(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === "" && k !== "adType" ? undefined : v])));
    if (f.report && !REPORTS.some(r => r.id === f.report)) throw new HttpError(400, "Unknown report type.");
    const results = [];
    for (const file of files) {
      try {
        results.push({ filename: file.filename, ok: true, ...(await importBuffer({ orgId: req.org.id, userId: req.user.id, buf: file.buf, filename: file.filename, reportId: f.report || undefined, adType: f.adType || undefined, periodStart: f.periodStart, periodEnd: f.periodEnd })) });
      } catch (e) {
        if (!(e instanceof HttpError)) req.log.error(e);
        results.push({ filename: file.filename, ok: false, error: e instanceof HttpError ? e.message : "This file could not be saved. Check it is an unedited Amazon report." });
      }
    }
    return { results };
  });

  // Product costs template, pre-filled with the brand's SKUs
  app.get("/api/imports/template/product-costs.csv", { preHandler: requireAuth }, async (req, reply) => {
    requireOrg(req);
    const rows = await many("select sku, name, category, price, cogs, rating, reviews, fbm_qty from products where org_id=$1 order by sku", [req.org.id]);
    const esc = v => v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const csv = ["sku,name,category,price,cogs,rating,reviews,stock", ...rows.map(r => [r.sku, r.name, r.category, r.price, r.cogs, r.rating, r.reviews, r.fbm_qty || ""].map(esc).join(","))].join("\n");
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="pulse-product-costs.csv"');
    return csv || "sku,name,category,price,cogs,rating,reviews,stock\n";
  });

  // Fills an empty brand with 90 days of invented sample reports, run through the normal import path
  app.post("/api/imports/sample", { preHandler: requireAuth, config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async req => {
    canAdmin(req);
    if (await one("select 1 from order_items where org_id=$1 limit 1", [req.org.id])) throw new HttpError(400, "This brand already has data. Sample data can only go into an empty brand.");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-sample-"));
    const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "sample-reports.js");
    try {
      await promisify(execFile)(process.execPath, [tool, dir, "90"], { cwd: path.join(path.dirname(tool), "..") });
      const order = f => /listing|catalog/i.test(f) ? 0 : /order/i.test(f) && !/repeat/i.test(f) ? 1 : 2;
      const end = new Date(Date.now() + 330 * 6e4).toISOString().slice(0, 10), start = new Date(Date.now() + 330 * 6e4 - 29 * 864e5).toISOString().slice(0, 10);
      let n = 0;
      for (const f of fs.readdirSync(dir).sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
        await importBuffer({ orgId: req.org.id, userId: req.user.id, buf: fs.readFileSync(path.join(dir, f)), filename: "sample/" + f, periodStart: start, periodEnd: end });
        n++;
      }
      await audit(req, "data.sample");
      return { ok: true, files: n };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // Remove all imported data for this brand (keeps settings, team, wallet)
  app.post("/api/imports/clear", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    z.object({ confirm: z.literal("DELETE") }).parse(req.body);
    for (const t of ["order_items", "returns", "traffic_daily", "transactions", "coupons", "deals", "ad_daily", "ad_terms", "ad_placements", "campaigns", "products", "repeat_purchase", "account_health"])
      await q(`delete from ${t} where org_id=$1`, [req.org.id]);
    await audit(req, "data.clear");
    return { ok: true };
  });
}
