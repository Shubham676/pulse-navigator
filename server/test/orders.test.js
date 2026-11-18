import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, u, org;
before(async () => {
  t = await setup();
  u = await t.signup("orders@example.com", "Orders Brand");
  org = (await t.db.one("select org_id from memberships m join users x on x.id = m.user_id where x.email = 'orders@example.com'")).org_id;
  const ins = (o, sku, at, status, qty, price, city = "Pune", state = "MH") => t.db.q(
    `insert into order_items (org_id, order_id, sku, purchased_at, status, fulfillment, quantity, item_price, ship_city, ship_state) values ($1,$2,$3,$4,$5,'Amazon',$6,$7,$8,$9)`, [org, o, sku, at, status, qty, price, city, state]);
  await ins("402-1", "DIAPER-S", "2026-11-10T05:00:00Z", "Shipped", 2, 798);
  await ins("402-1", "INSERT-4", "2026-11-10T05:00:00Z", "Shipped", 1, 299);
  await ins("402-2", "DIAPER-M", "2026-11-12T05:00:00Z", "Pending", 1, 399, "Delhi", "DL");
  await ins("402-3", "DIAPER-L", "2026-11-14T05:00:00Z", "Cancelled", 1, 399);
  await ins("402-4", "DIAPER-S", "2026-10-01T05:00:00Z", "Shipped", 1, 399);
  await t.db.q("insert into returns (org_id, order_id, sku, returned_at, quantity, refund_amount, reason) values ($1,'402-4','DIAPER-S','2026-10-09',1,399,'Too small')", [org]);
  const sh = (id, name, at, extra = {}) => t.db.q(`insert into shopify_orders (org_id, order_id, name, created_at, updated_at, cancelled_at, financial_status, fulfillment_status, is_cod, subtotal, total, refunded, ship_city, ship_state)
    values ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$9,$10,'Bengaluru','KA')`, [org, id, name, at, extra.cancelled || null, extra.fin || "PAID", extra.ful || "FULFILLED", !!extra.cod, extra.total || 1199, extra.refunded || 0]);
  await sh("gid://shopify/Order/1", "#1001", "2026-11-13T06:00:00Z", { cod: true });
  await sh("gid://shopify/Order/2", "#1002", "2026-11-15T06:00:00Z", { ful: "UNFULFILLED", total: 599 });
  await sh("gid://shopify/Order/3", "#1003", "2026-11-16T06:00:00Z", { fin: "REFUNDED", refunded: 899, total: 899 });
  await t.db.q(`insert into shopify_order_lines (org_id, line_id, order_id, sku, title, quantity, ordered_qty, unit_price, line_total) values
    ($1,'l1','gid://shopify/Order/1','DIAPER-S','Cloth diaper S',3,3,399.67,1199), ($1,'l2','gid://shopify/Order/2','','Gift card',1,1,599,599)`, [org]);
});
after(async () => { await t.close(); });

test("all orders: both channels, newest first, statuses normalised", async () => {
  const r = await u.req("GET", "/api/orders");
  assert.equal(r.statusCode, 200, r.body);
  const d = r.json();
  assert.equal(d.total, 7);
  assert.deepEqual(d.orders.map(o => [o.order_no, o.channel, o.status]), [
    ["#1003", "shopify", "returned"], ["#1002", "shopify", "open"], ["402-3", "amazon", "cancelled"], ["#1001", "shopify", "shipped"],
    ["402-2", "amazon", "open"], ["402-1", "amazon", "shipped"], ["402-4", "amazon", "returned"]]);
  const a1 = d.orders.find(o => o.order_no === "402-1");
  assert.equal(a1.units, 3); assert.equal(a1.amount, 1097); assert.equal(a1.items, "DIAPER-S, INSERT-4");
  assert.equal(d.orders.find(o => o.order_no === "#1001").payment, "COD");
  assert.equal(d.orders.find(o => o.order_no === "#1002").items, "Gift card", "falls back to the title when there is no SKU");
  assert.equal(d.summary.amount, 1097 + 399 + 1199 + 599, "cancelled and returned orders are left out of the amount");
  assert.deepEqual([d.summary.open, d.summary.shipped, d.summary.cancelled, d.summary.returned, d.summary.amazon, d.summary.shopify], [2, 2, 1, 2, 4, 3]);
  assert.deepEqual(d.channels, { amazon: true, shopify: true });
});

test("filters: channel, status, dates (IST), search, paging", async () => {
  const get = async qs => (await u.req("GET", "/api/orders?" + qs)).json();
  assert.equal((await get("channel=shopify")).total, 3);
  assert.deepEqual((await get("status=returned")).orders.map(o => o.order_no), ["#1003", "402-4"]);
  assert.deepEqual((await get("from=2026-11-12&to=2026-11-13")).orders.map(o => o.order_no), ["#1001", "402-2"]);
  assert.deepEqual((await get("q=delhi")).orders.map(o => o.order_no), ["402-2"]);
  assert.deepEqual((await get("q=insert")).orders.map(o => o.order_no), ["402-1"]);
  const p2 = await get("size=10&page=1&channel=amazon&status=shipped");
  assert.equal(p2.total, 1);
  assert.equal((await u.req("GET", "/api/orders?from=2026-11-20&to=2026-11-01")).statusCode, 400);
  assert.equal((await u.req("GET", "/api/orders?q=100%25")).statusCode, 200, "special characters are safe in search");
});

test("order detail and CSV export", async () => {
  const a = (await u.req("GET", "/api/orders/amazon/402-4")).json();
  assert.equal(a.lines.length, 1); assert.equal(a.returns[0].reason, "Too small");
  const s = (await u.req("GET", "/api/orders/shopify/" + encodeURIComponent("gid://shopify/Order/1"))).json();
  assert.equal(s.orderNo, "#1001"); assert.equal(s.lines[0].quantity, 3);
  assert.equal((await u.req("GET", "/api/orders/amazon/nope")).statusCode, 404);
  const csv = await u.req("GET", "/api/orders?format=csv&channel=amazon");
  assert.match(csv.headers["content-type"], /text\/csv/);
  const lines = csv.body.replace(/^﻿/, "").trim().split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^Channel,Order,Placed \(IST\),Status/);
  assert.match(csv.body, /"DIAPER-S, INSERT-4"/);
});
