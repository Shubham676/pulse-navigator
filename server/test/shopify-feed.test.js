import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

let t, u, org;
const today = new Date(Date.now() - 2 * 3600e3).toISOString();          // a couple of hours ago
const istDay = iso => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
before(async () => {
  t = await setup();
  u = await t.signup("feed@example.com", "Feed Brand");
  org = (await t.db.one("select org_id from memberships m join users x on x.id = m.user_id where x.email = 'feed@example.com'")).org_id;
  // Amazon: one product and one order line for DIAPER-S today
  await t.db.q("insert into products (org_id, sku, name, price, fba_qty, fbm_qty) values ($1, 'DIAPER-S', 'Cloth diaper S', 399, 20, 0)", [org]);
  await t.db.q("insert into order_items (org_id, order_id, sku, purchased_at, status, fulfillment, quantity, item_price, ship_state) values ($1, '402-1', 'DIAPER-S', $2, 'Shipped', 'Amazon', 1, 399, 'Karnataka')", [org, today]);
  // Shopify: DIAPER-S (also on Amazon) and a variant without a SKU
  await t.db.q(`insert into shopify_variants (org_id, variant_id, product_id, sku, product_title, variant_title, product_type, status, price, compare_at, cost, inventory) values
    ($1, 'gid://shopify/ProductVariant/11', 'gid://shopify/Product/1', 'DIAPER-S', 'Cloth diaper', 'S', 'Diapers', 'ACTIVE', 449, 599, 150, 35),
    ($1, 'gid://shopify/ProductVariant/22', 'gid://shopify/Product/2', '', 'Wet bag', 'Default Title', '', 'ACTIVE', 299, null, null, 8)`, [org]);
  const o = (id, name, at, extra = {}) => t.db.q(`insert into shopify_orders (org_id, order_id, name, created_at, updated_at, cancelled_at, financial_status, fulfillment_status, subtotal, total, discounts, discount_codes, ship_state, customer_key)
    values ($1,$2,$3,$4,$4,$5,'PAID','FULFILLED',$6,$6,$7,$8,'KA',$9)`, [org, id, name, at, extra.cancelled || null, extra.total || 449, extra.disc || 0, extra.codes || null, extra.cust || "c1"]);
  await o("gid://shopify/Order/1", "#1001", today, { codes: "WELCOME10", disc: 50, total: 849 });
  await o("gid://shopify/Order/2", "#1002", today, { cust: "c1", total: 449 });
  await o("gid://shopify/Order/3", "#1003", today, { cancelled: today, cust: "c2" });
  const l = (line, order, sku, variant, title, qty, ordered, total) => t.db.q(`insert into shopify_order_lines (org_id, line_id, order_id, sku, title, variant_id, quantity, ordered_qty, unit_price, line_total) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [org, line, order, sku, title, variant, qty, ordered, total]);
  await l("l1", "gid://shopify/Order/1", "DIAPER-S", "gid://shopify/ProductVariant/11", "Cloth diaper", 1, 1, 449);
  await l("l2", "gid://shopify/Order/1", "", "gid://shopify/ProductVariant/22", "Wet bag", 0, 1, 400);   // refunded
  await l("l3", "gid://shopify/Order/2", "DIAPER-S", "gid://shopify/ProductVariant/11", "Cloth diaper", 1, 1, 449);
  await l("l4", "gid://shopify/Order/3", "DIAPER-S", "gid://shopify/ProductVariant/11", "Cloth diaper", 2, 2, 898);
});
after(async () => { await t.close(); });

test("Shopify flows into every Sales, Inventory and Business data set", async () => {
  const D = (await u.req("GET", "/api/data")).json();
  const d = istDay(today);
  assert.deepEqual(D.channels, { amazon: true, shopify: true });
  // products: the shared SKU keeps Amazon details and gains Shopify cost/stock; the SKU-less variant gets its own key
  const ds = D.products.find(p => p.sku === "DIAPER-S"), bag = D.products.find(p => p.sku === "SHOP-22");
  assert.equal(ds.channel, "both"); assert.equal(ds.fba_qty, 20); assert.equal(ds.fbm_qty, 35); assert.equal(ds.cogs, 150); assert.equal(ds.name, "Cloth diaper S");
  assert.equal(bag.name, "Wet bag"); assert.equal(bag.category, "Shopify"); assert.equal(bag.fbm_qty, 8); assert.equal(bag.channel, "shopify");
  // daily: Amazon 1 + Shopify 2 live units of DIAPER-S on the same day, cancelled order counted separately
  const row = D.daily.find(r => r.d === d && r.sku === "DIAPER-S");
  assert.equal(row.units, 3); assert.equal(row.rev, 399 + 449 + 449); assert.equal(row.canc, 2);
  const day = D.dayOrders.find(r => r.d === d);
  assert.equal(day.orders, 3); assert.equal(day.cancelled, 1); assert.equal(day.shopRev, 449 + 400 + 449);
  // refunds become returns
  assert.equal(D.dayReturns.find(r => r.sku === "SHOP-22").qty, 1);
  assert.equal(D.returns.find(r => r.sku === "SHOP-22").reason, "Refunded on Shopify");
  // order list, states, fulfilment split
  assert.ok(D.orders.find(o => o.order_id === "#1001" && o.fulfillment === "Shopify" && o.ship_state === "Karnataka"));
  const ka = D.geo.find(g => g.days === 1 && g.state === "Karnataka");
  assert.equal(ka.orders, 1 + 2, "Amazon and Shopify orders for the same state are added together");
  assert.equal(D.splits.find(s => s.days === 1 && s.fulfillment === "Shopify").orders, 2);
  // discount codes, sale prices, repeat customers, links
  const code = D.coupons.find(c => c.id === "WELCOME10");
  assert.equal(code.redemptions, 1); assert.equal(code.spent, 50); assert.equal(code.end, null);
  const deal = D.deals.find(x => x.sku === "DIAPER-S");
  assert.equal(deal.type, "Sale price on Shopify"); assert.equal(deal.units, 2);
  const rep = D.repeat.find(r => r.sku === "DIAPER-S");
  assert.equal(rep.unique_customers, 1); assert.equal(rep.orders, 2); assert.equal(rep.repeat_customers_pct, 100); assert.equal(rep.repeat_revenue, 449);
  assert.ok(D.links.find(x => x.sku === "SHOP-22" && x.marketplace === "Shopify"));
  assert.equal(D.hourly.reduce((s, h) => s + h.units, 0), 1 + 3, "Amazon unit + 3 live Shopify units");
});

test("brands without Shopify are unchanged", async () => {
  const v = await t.signup("plain@example.com", "Plain Brand");
  const D = (await v.req("GET", "/api/data")).json();
  assert.deepEqual(D.channels, { amazon: false, shopify: false });
  assert.equal(D.products.length, 0);
});
