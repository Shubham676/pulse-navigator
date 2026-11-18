// Product cost sheets for Profit and loss: per-unit raw material, packaging and marketing cost; bundles of other products.
import { z } from "zod";
import { one } from "../db.js";
import { requireAuth, requireOrg, canEdit, audit, HttpError } from "../lib/auth.js";

const money = z.coerce.number().min(0).max(1e8).default(0);
const Body = z.object({
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().max(200).optional().default(""),
  kind: z.enum(["product", "bundle"]).default("product"),
  rawMaterial: money, packaging: money, marketing: money,
  items: z.array(z.object({ sku: z.string().trim().min(1).max(100), qty: z.coerce.number().int().min(1).max(1000) })).max(30).default([])
});
const COLS = "id, sku, name, kind, raw_material::float8 as raw, packaging::float8 as pack, marketing::float8 as mkt, items, updated_at";
const r2 = n => Math.round(n * 100) / 100;

export default async function costRoutes(app) {
  app.put("/api/costs", { preHandler: requireAuth }, async req => {
    requireOrg(req); canEdit(req);
    const b = Body.safeParse(req.body || {});
    if (!b.success) throw new HttpError(400, "Check the product and the costs. Costs must be zero or more.");
    const c = b.data;
    let items = [];
    if (c.kind === "bundle") {
      const m = new Map();
      for (const it of c.items) { if (it.sku === c.sku) throw new HttpError(400, "A bundle can't contain itself."); m.set(it.sku, (m.get(it.sku) || 0) + it.qty); }
      items = [...m].map(([sku, qty]) => ({ sku, qty }));
      if (!items.length) throw new HttpError(400, "Add at least one product to the bundle.");
    }
    const row = await one(`insert into cost_sheets (org_id, sku, name, kind, raw_material, packaging, marketing, items, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict (org_id, sku) do update set name=excluded.name, kind=excluded.kind, raw_material=excluded.raw_material, packaging=excluded.packaging,
        marketing=excluded.marketing, items=excluded.items, updated_by=excluded.updated_by, updated_at=now()
      returning ${COLS}`, [req.org.id, c.sku, c.name || null, c.kind, r2(c.rawMaterial), r2(c.packaging), r2(c.marketing), JSON.stringify(items), req.user?.id || null]);
    await audit(req, "cost.save", { sku: c.sku, kind: c.kind });
    return row;
  });
  app.delete("/api/costs/:id", { preHandler: requireAuth }, async req => {
    requireOrg(req); canEdit(req);
    const id = Number(req.params.id);
    const row = Number.isInteger(id) && id > 0 ? await one("delete from cost_sheets where org_id=$1 and id=$2 returning sku", [req.org.id, id]) : null;
    if (!row) throw new HttpError(404, "Cost sheet not found.");
    await audit(req, "cost.delete", { sku: row.sku });
    return { ok: true };
  });
}
export { COLS as COST_COLS };
