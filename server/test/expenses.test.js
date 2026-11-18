import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, u, other;
before(async () => { t = await setup(); u = await t.signup("exp@example.com", "Exp Brand"); other = await t.signup("exp2@example.com", "Other Brand"); });
after(async () => { await t.close(); });

test("expenses: add, show in /api/data, validate, delete, scoped to brand", async () => {
  const today = new Date().toISOString().slice(0, 10);
  let r = await u.req("POST", "/api/expenses", { date: today, category: "Rent", description: "Warehouse", amount: 15000, monthly: true });
  assert.equal(r.statusCode, 200, r.body);
  const id = r.json().id;
  r = await u.req("POST", "/api/expenses", { date: today, category: "Packaging", amount: 1250.5 });
  assert.equal(r.statusCode, 200, r.body);
  r = await u.req("POST", "/api/expenses", { date: today, category: "Rent", amount: -5 });
  assert.equal(r.statusCode, 400);
  r = await u.req("POST", "/api/expenses", { date: today, category: "Bribes", amount: 5 });
  assert.equal(r.statusCode, 400);
  const d = (await u.req("GET", "/api/data")).json();
  assert.equal(d.expenses.length, 2);
  assert.ok(d.expenses.find(e => e.category === "Rent" && e.monthly && e.amount === 15000));
  assert.equal((await other.req("GET", "/api/data")).json().expenses.length, 0);
  assert.equal((await other.req("DELETE", `/api/expenses/${id}`, {})).statusCode, 404);
  assert.equal((await u.req("DELETE", `/api/expenses/${id}`, {})).statusCode, 200);
  assert.equal((await u.req("GET", "/api/data")).json().expenses.length, 1);
});
