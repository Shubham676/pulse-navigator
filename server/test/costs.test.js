import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, u, other;
before(async () => { t = await setup(); u = await t.signup("cost@example.com", "Cost Brand"); other = await t.signup("cost2@example.com", "Other Cost Brand"); });
after(async () => { await t.close(); });

test("cost sheets: products and bundles, upsert, validation, scoped delete", async () => {
  let r = await u.req("PUT", "/api/costs", { sku: "DIAPER-S", rawMaterial: 120, packaging: 15.5, marketing: 30 });
  assert.equal(r.statusCode, 200, r.body);
  r = await u.req("PUT", "/api/costs", { sku: "DIAPER-S", rawMaterial: 125, packaging: 15.5, marketing: 30 });   // update, not duplicate
  assert.equal(r.json().raw, 125);
  r = await u.req("PUT", "/api/costs", { sku: "PACK-3", name: "Pack of 3", kind: "bundle", packaging: 20, items: [{ sku: "DIAPER-S", qty: 2 }, { sku: "DIAPER-S", qty: 1 }, { sku: "INSERT", qty: 4 }] });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().items, [{ sku: "DIAPER-S", qty: 3 }, { sku: "INSERT", qty: 4 }]);
  assert.equal((await u.req("PUT", "/api/costs", { sku: "B", kind: "bundle", items: [] })).statusCode, 400);
  assert.equal((await u.req("PUT", "/api/costs", { sku: "B", kind: "bundle", items: [{ sku: "B", qty: 1 }] })).statusCode, 400);
  assert.equal((await u.req("PUT", "/api/costs", { sku: "X", packaging: -1 })).statusCode, 400);
  const d = (await u.req("GET", "/api/data")).json();
  assert.equal(d.costSheets.length, 2);
  assert.equal((await other.req("GET", "/api/data")).json().costSheets.length, 0);
  const id = d.costSheets.find(x => x.sku === "PACK-3").id;
  assert.equal((await other.req("DELETE", `/api/costs/${id}`, {})).statusCode, 404);
  assert.equal((await u.req("DELETE", `/api/costs/${id}`, {})).statusCode, 200);
  assert.equal((await u.req("GET", "/api/data")).json().costSheets.length, 1);
});
