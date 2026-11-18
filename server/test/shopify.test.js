import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// A stand-in for Shopify's token endpoint and GraphQL Admin API
const calls = [];
let orderPages, variants;
const mny = a => ({ shopMoney: { amount: String(a) } });
const line = (id, sku, qty, price, cur = qty) => ({ id: `gid://shopify/LineItem/${id}`, sku, name: sku + " title", quantity: qty, currentQuantity: cur,
  variant: { id: `gid://shopify/ProductVariant/${sku}`, product: { id: "gid://shopify/Product/1" } }, originalUnitPriceSet: mny(price), discountedTotalSet: mny(price * qty), totalDiscountSet: mny(0), taxLines: [{ priceSet: mny(price * qty * 0.05) }] });
const order = (n, { daysAgo = 1, gw = ["Razorpay"], cancelled = false, lines = [], moreLines = false, codes = [] } = {}) => ({
  id: `gid://shopify/Order/${n}`, name: `#${n}`, createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString(), updatedAt: new Date().toISOString(),
  cancelledAt: cancelled ? new Date().toISOString() : null, test: false, displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", sourceName: "web",
  paymentGatewayNames: gw, discountCodes: codes, customer: { id: "gid://shopify/Customer/" + (n % 2) }, shippingAddress: { city: "Pune", provinceCode: "MH", zip: "411001" },
  currentSubtotalPriceSet: mny(sum(lines)), currentTotalPriceSet: mny(sum(lines) + 45), totalShippingPriceSet: mny(45), currentTotalTaxSet: mny(0), currentTotalDiscountsSet: mny(0), totalRefundedSet: mny(0),
  lineItems: { nodes: lines, pageInfo: { hasNextPage: moreLines, endCursor: moreLines ? "L1" : null } } });
const sum = ls => ls.reduce((s, l) => s + Number(l.discountedTotalSet.shopMoney.amount), 0);

const server = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c)); req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/admin/oauth/access_token") {
      const p = new URLSearchParams(body); calls.push("token");
      if (p.get("grant_type") !== "client_credentials") return send(400, { error: "unsupported_grant_type" });
      if (p.get("client_id") === "other-org") return send(400, { error: "shop_not_permitted", error_description: "Client credentials cannot be performed on this shop." });
      if (p.get("client_id") !== "cid" || p.get("client_secret") !== "csecret") return send(401, { error: "invalid_client" });
      return send(200, { access_token: "shpat_from_grant", scope: "read_orders,read_products", expires_in: 86399 });
    }
    if (!req.url.startsWith("/admin/api/2026-10/graphql.json")) return send(404, {});
    if (!["shpat_from_grant", "shpat_static"].includes(req.headers["x-shopify-access-token"])) return send(401, { errors: "Invalid API key or access token" });
    const { query, variables } = JSON.parse(body); calls.push(query.match(/\{\s*(\w+)/)[1]);
    const cost = { extensions: { cost: { requestedQueryCost: 100, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1900, restoreRate: 100 } } } };
    if (/\bshop\s*\{/.test(query)) return send(200, { data: { shop: { name: "Dumbledo", myshopifyDomain: "e0rpax-nb.myshopify.com", currencyCode: "INR", primaryDomain: { host: "www.dumbledo.com" } } }, ...cost });
    if (/orders\(/.test(query) && req.headers["x-shopify-access-token"] === "shpat_static" && /customer \{/.test(query))
      return send(200, { data: null, errors: [{ message: "Access denied for customer field. Required access: `read_customers` access scope.", path: ["orders", "nodes", "0", "customer"], extensions: { code: "ACCESS_DENIED" } }] });
    if (/orders\(/.test(query)) { calls.push("q=" + variables.q.split(":")[0]); const i = variables.after ? Number(variables.after) : 0, page = orderPages[i].map(o => /customer \{/.test(query) ? o : { ...o, customer: undefined });
      return send(200, { data: { orders: { nodes: page, pageInfo: { hasNextPage: i + 1 < orderPages.length, endCursor: String(i + 1) } } }, ...cost }); }
    if (/order\(id/.test(query)) return send(200, { data: { order: { lineItems: { nodes: [line(99, "DB-INS-SM-BLK-5L", 2, 50)], pageInfo: { hasNextPage: false, endCursor: null } } } }, ...cost });
    if (/productVariants/.test(query)) return send(200, { data: { productVariants: { nodes: variants, pageInfo: { hasNextPage: false, endCursor: null } } }, ...cost });
    send(400, { errors: [{ message: "unknown query" }] });
  });
});

let t;
before(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  process.env.SHOPIFY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const { setup } = await import("./helpers.js");
  t = await setup();
});
after(async () => { server.close(); await t.close(); });

const orgOf = async email => (await t.db.one("select org_id from memberships m join users u on u.id=m.user_id where u.email=$1", [email])).org_id;

test("Shopify: store address is normalised from any form", async () => {
  const { normalizeShop } = await import("../src/shopify/client.js");
  assert.equal(normalizeShop("E0RPAX-NB"), "e0rpax-nb.myshopify.com");
  assert.equal(normalizeShop("https://e0rpax-nb.myshopify.com/admin/products"), "e0rpax-nb.myshopify.com");
  assert.equal(normalizeShop("https://admin.shopify.com/store/e0rpax-nb/orders"), "e0rpax-nb.myshopify.com");
  assert.throws(() => normalizeShop("not a shop!"));
});

test("Shopify: wrong secret and a different organization get clear messages", async () => {
  const u = await t.signup("s1@example.com");
  let r = await u.req("POST", "/api/connections/shopify", { shop: "e0rpax-nb", clientId: "cid", clientSecret: "wrong" });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /client ID and secret/);
  r = await u.req("POST", "/api/connections/shopify", { shop: "e0rpax-nb", clientId: "other-org", clientSecret: "x" });
  assert.equal(r.statusCode, 400); assert.match(r.json().error, /different Shopify organizations/);
  r = await u.req("POST", "/api/connections/shopify", { shop: "e0rpax-nb" });
  assert.equal(r.statusCode, 400);
});

test("Shopify: connect with client credentials, sync orders and catalogue, then an incremental sync", async () => {
  calls.length = 0;
  const u = await t.signup("s2@example.com");
  const r = await u.req("POST", "/api/connections/shopify", { shop: "e0rpax-nb.myshopify.com", clientId: "cid", clientSecret: "csecret" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().account, "Dumbledo");
  const org = await orgOf("s2@example.com");
  const conn = await t.db.one("select config, secret_enc from connections where org_id=$1 and kind='shopify'", [org]);
  assert.equal(conn.config.domain, "www.dumbledo.com");
  assert.ok(!conn.secret_enc.includes("csecret"), "secret must be stored encrypted");
  assert.ok(await t.db.one("select 1 from jobs where org_id=$1 and kind='shopify_sync'", [org]), "connecting queues a sync");

  orderPages = [
    [order(1001, { lines: [line(1, "DB-CD-FS-HEART-V1", 2, 299)], codes: ["NEWPARENT15"] }), order(1002, { gw: ["Cash on Delivery (COD)"], lines: [line(2, "DB-CD-FS-HEART-V1", 1, 299)] })],
    [order(1003, { cancelled: true, lines: [line(3, "DB-MN-S-PINK-V1", 3, 99)] }), order(1004, { lines: [line(4, "DB-MN-S-PINK-V1", 1, 99)], moreLines: true })]
  ];
  variants = [
    { id: "gid://shopify/ProductVariant/DB-CD-FS-HEART-V1", sku: "DB-CD-FS-HEART-V1", title: "Free size", price: "299.00", compareAtPrice: "599.00", inventoryQuantity: 3, product: { id: "gid://shopify/Product/1", title: "HeartBloom Cloth Diaper", status: "ACTIVE", productType: "Cloth Diaper", handle: "heartbloom" }, inventoryItem: { unitCost: { amount: "120.0" } } },
    { id: "gid://shopify/ProductVariant/DB-MN-S-PINK-V1", sku: "DB-MN-S-PINK-V1", title: "Default Title", price: "99.00", compareAtPrice: null, inventoryQuantity: 50, product: { id: "gid://shopify/Product/2", title: "Muslin Nappy", status: "ACTIVE", productType: "Nappy", handle: "muslin" }, inventoryItem: { unitCost: null } }
  ];
  const { syncShopify } = await import("../src/shopify/client.js");
  const done = await syncShopify(org);
  assert.match(done.join(";"), /orders: 4 \(5 items\)/);
  assert.equal(calls.filter(c => c === "token").length, 1, "the 24-hour token is reused between connect and sync");
  const o = await t.db.one("select count(*)::int n, count(*) filter (where is_cod)::int cod, count(*) filter (where cancelled_at is not null)::int canc from shopify_orders where org_id=$1", [org]);
  assert.deepEqual(o, { n: 4, cod: 1, canc: 1 });
  assert.equal((await t.db.one("select count(*)::int n from shopify_order_lines where org_id=$1 and order_id='gid://shopify/Order/1004'", [org])).n, 2, "extra line items are paged in");
  assert.equal((await t.db.one("select count(*)::int n from shopify_variants where org_id=$1", [org])).n, 2);
  assert.equal((await t.db.one("select variant_title from shopify_variants where org_id=$1 and sku='DB-MN-S-PINK-V1'", [org])).variant_title, null);
  assert.ok(calls.includes("q=created_at"));

  // Second sync only asks for orders updated since the last one, and drops variants deleted in Shopify
  orderPages = [[order(1002, { gw: ["Cash on Delivery (COD)"], cancelled: true, lines: [line(2, "DB-CD-FS-HEART-V1", 1, 299)] })]];
  variants = variants.slice(0, 1);
  await syncShopify(org);
  assert.ok(calls.includes("q=updated_at"));
  assert.equal((await t.db.one("select count(*)::int n from shopify_orders where org_id=$1 and cancelled_at is not null", [org])).n, 2);
  assert.equal((await t.db.one("select count(*)::int n from shopify_variants where org_id=$1", [org])).n, 1);

  const page = (await u.req("GET", "/api/shopify")).json();
  assert.equal(page.connected, true);
  assert.equal(page.store.name, "Dumbledo");
  assert.equal(page.recent.length, 4);
  assert.equal(page.skus[0].sku, "DB-CD-FS-HEART-V1");
  assert.equal(page.skus[0].units, 2);
  assert.equal(page.codes[0].code, "NEWPARENT15");
  assert.equal(page.stock[0].units30, 2);
  assert.equal(page.repeat.customers, 2);

  const s = await u.req("POST", "/api/connections/shopify/sync", {});
  assert.equal(s.statusCode, 200, s.body);
  const d = await u.req("DELETE", "/api/connections/shopify", {});
  assert.equal(d.statusCode, 200);
  assert.equal((await u.req("GET", "/api/shopify")).json().connected, false);
});

test("Shopify: an older custom app's access token works too", async () => {
  const u = await t.signup("s3@example.com");
  const r = await u.req("POST", "/api/connections/shopify", { shop: "e0rpax-nb", accessToken: "shpat_static" });
  assert.equal(r.statusCode, 200, r.body);
  // This store's app has no read_customers: the sync drops the customer field and still saves orders
  orderPages = [[order(2001, { lines: [line(21, "DB-CD-FS-HEART-V1", 1, 299)] })]];
  const { syncShopify } = await import("../src/shopify/client.js");
  const done = await syncShopify(await orgOf("s3@example.com"));
  assert.match(done.join(";"), /orders: 1 /);
  assert.match(done.join(";"), /read_customers/);
  const saved = await t.db.one("select customer_key, ship_state from shopify_orders where org_id=$1", [await orgOf("s3@example.com")]);
  assert.deepEqual(saved, { customer_key: null, ship_state: "MH" });
  const bad = await u.req("POST", "/api/connections/shopify", { shop: "e0rpax-nb", accessToken: "shpat_wrong" });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /access token/);
});
