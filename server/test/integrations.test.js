import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { setup } from "./helpers.js";

// Mock Shopify Admin API and an outgoing-webhook receiver
const received = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c)); req.on("end", () => {
    if (req.url === "/admin/api/2025-10/shop.json") {
      if (req.headers["x-shopify-access-token"] !== "shpat_good") { res.writeHead(401); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ shop: { name: "Dumbledo Test Store" } }));
    }
    if (req.url === "/hook") { received.push({ headers: req.headers, body: b }); res.writeHead(200); return res.end("ok"); }
    res.writeHead(404); res.end();
  });
});
let t, u, base;
before(async () => {
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${mock.address().port}`;
  process.env.SHOPIFY_TEST_BASE = base;
  t = await setup();
  u = await t.signup("hub@example.com", "Hub Brand");
});
after(async () => { mock.close(); await t.close(); });

const post = (url, body, headers = {}) => t.app.inject({ method: "POST", url, headers: { "content-type": "application/json", ...headers }, payload: body });

test("catalog lists marketplaces, stores, shipping and custom connections", async () => {
  const c = (await u.req("GET", "/api/integrations/catalog")).json();
  assert.ok(c.platforms.length >= 30);
  for (const id of ["amazon", "flipkart", "meesho", "shopify", "woocommerce", "blinkit", "shiprocket", "webhook_in", "webhook_out"]) assert.ok(c.platforms.find(p => p.id === id), id);
  assert.equal(c.platforms.find(p => p.id === "amazon").access, "live");
  assert.ok(c.platforms.find(p => p.id === "shopify").testable);
  assert.ok(c.categories.includes("Quick commerce"));
});

test("partner platform: saved with masked secrets, a webhook address and a signing secret", async () => {
  let r = await u.req("PUT", "/api/integrations/meesho", { fields: { seller_id: "", api_key: "abc" } });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /seller or partner id/i);
  r = await u.req("PUT", "/api/integrations/meesho", { fields: { seller_id: "MS-123", api_key: "key-secret-9876" } });
  assert.equal(r.statusCode, 200, r.body);
  const i = r.json().integration;
  assert.equal(i.status, "saved");
  assert.equal(i.settings.seller_id, "MS-123");
  assert.equal(i.secrets.api_key, "••••9876");
  assert.ok(!JSON.stringify(i).includes("key-secret-9876"), "secret never returned");
  assert.match(i.webhookUrl, /\/api\/webhooks\/in\/[\w-]{20,}$/);
  assert.match(i.signingSecret, /^whsec_/);
  // Re-saving with a blank secret keeps the stored one
  r = await u.req("PUT", "/api/integrations/meesho", { fields: { seller_id: "MS-124", api_key: "" } });
  assert.equal(r.json().integration.secrets.api_key, "••••9876");
  assert.equal(r.json().integration.settings.seller_id, "MS-124");
});

test("shopify: good token connects, bad token is reported in plain words", async () => {
  let r = await u.req("PUT", "/api/integrations/shopify", { fields: { shop: "dumbledo.myshopify.com", access_token: "shpat_bad", api_secret: "shp-secret" } });
  assert.equal(r.json().status, "error");
  assert.match(r.json().message, /refused the credentials/);
  r = await u.req("PUT", "/api/integrations/shopify", { fields: { shop: "dumbledo.myshopify.com", access_token: "shpat_good" } });
  assert.equal(r.json().status, "connected", r.body);
  assert.match(r.json().message, /Dumbledo Test Store/);
  assert.equal(r.json().integration.secrets.api_secret, "••••cret", "api secret kept from the first save");
});

test("inbound webhooks: shopify HMAC checked, generic signed and unsigned events stored", async () => {
  const list = (await u.req("GET", "/api/integrations")).json().integrations;
  const shop = list.find(i => i.platform === "shopify"), mee = list.find(i => i.platform === "meesho");
  const path = url => new URL(url).pathname;
  const body = JSON.stringify({ id: 1, total_price: "799.00" });
  const good = crypto.createHmac("sha256", "shp-secret").update(body).digest("base64");
  let r = await post(path(shop.webhookUrl), body, { "x-shopify-topic": "orders/create", "x-shopify-hmac-sha256": "bad" });
  assert.equal(r.statusCode, 401);
  r = await post(path(shop.webhookUrl), body, { "x-shopify-topic": "orders/create", "x-shopify-hmac-sha256": good });
  assert.equal(r.statusCode, 200, r.body);

  const ev = JSON.stringify({ event: "order.created", order: "MS-1" });
  r = await post(path(mee.webhookUrl), ev);
  assert.equal(r.statusCode, 200);
  const sig = "sha256=" + crypto.createHmac("sha256", mee.signingSecret).update(ev).digest("hex");
  r = await post(path(mee.webhookUrl), ev, { "x-pulse-signature": sig });
  assert.equal(r.statusCode, 200);
  r = await post(path(mee.webhookUrl), ev, { "x-pulse-signature": "sha256=00" });
  assert.equal(r.statusCode, 401);
  r = await t.app.inject({ method: "POST", url: path(mee.webhookUrl), headers: { "content-type": "text/plain" }, payload: "hello" });
  assert.equal(r.statusCode, 200, "non-JSON bodies are kept as text");
  assert.equal((await post("/api/webhooks/in/not-a-real-token", ev)).statusCode, 404);

  const events = (await u.req("GET", "/api/integrations/events")).json().events;
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(e => [e.platform, e.topic, e.verified]), [["meesho", null, false], ["meesho", "order.created", true], ["meesho", "order.created", false], ["shopify", "orders/create", true]]);
  assert.equal(events[0].body_text, "hello");
  assert.equal((await u.req("GET", "/api/integrations")).json().integrations.find(i => i.platform === "meesho").events, 3);
});

test("outgoing webhook: test event is delivered and signed", async () => {
  const r = await u.req("PUT", "/api/integrations/webhook_out", { fields: { url: base + "/hook" } });
  assert.equal(r.json().status, "connected", r.body);
  const got = received.at(-1), secret = r.json().integration.signingSecret;
  assert.equal(got.headers["x-pulse-signature"], "sha256=" + crypto.createHmac("sha256", secret).update(got.body).digest("hex"));
  assert.equal(JSON.parse(got.body).event, "pulse.test");
});

test("rotate gives a new webhook address; disconnect removes it", async () => {
  const before = (await u.req("GET", "/api/integrations")).json().integrations.find(i => i.platform === "meesho").webhookUrl;
  const after = (await u.req("POST", "/api/integrations/meesho/rotate", {})).json().integration.webhookUrl;
  assert.notEqual(before, after);
  assert.equal((await post(new URL(before).pathname, "{}")).statusCode, 404);
  assert.equal((await post(new URL(after).pathname, "{}")).statusCode, 200);
  assert.equal((await u.req("DELETE", "/api/integrations/meesho", {})).statusCode, 200);
  assert.equal((await post(new URL(after).pathname, "{}")).statusCode, 404);
  assert.equal((await u.req("PUT", "/api/integrations/amazon", { fields: {} })).statusCode, 404, "Amazon uses its own page");
});
