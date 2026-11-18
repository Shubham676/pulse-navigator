import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { setup } from "./helpers.js";

// Mock WooCommerce REST API and an outgoing-webhook receiver
const received = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c)); req.on("end", () => {
    if (req.url === "/wp-json/wc/v3/system_status") {
      if (req.headers.authorization !== "Basic " + Buffer.from("ck_good:cs_good").toString("base64")) { res.writeHead(401); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ environment: { site_url: "https://dumbledo-test.store" } }));
    }
    if (req.url === "/hook") { received.push({ headers: req.headers, body: b }); res.writeHead(200); return res.end("ok"); }
    res.writeHead(404); res.end();
  });
});
let t, u, base;
before(async () => {
  await new Promise(r => mock.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${mock.address().port}`;
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
  assert.equal(c.platforms.find(p => p.id === "shopify").access, "live", "Shopify has its own full sync");
  assert.ok(c.platforms.find(p => p.id === "woocommerce").testable);
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

test("woocommerce: good keys connect, bad keys are reported in plain words", async () => {
  let r = await u.req("PUT", "/api/integrations/woocommerce", { fields: { store_url: base, consumer_key: "ck_bad", consumer_secret: "cs_bad", webhook_secret: "woo-secret" } });
  assert.equal(r.json().status, "error");
  assert.match(r.json().message, /refused the credentials/);
  r = await u.req("PUT", "/api/integrations/woocommerce", { fields: { store_url: base, consumer_key: "ck_good", consumer_secret: "cs_good" } });
  assert.equal(r.json().status, "connected", r.body);
  assert.match(r.json().message, /dumbledo-test.store/);
  assert.equal(r.json().integration.secrets.webhook_secret, "••••cret", "webhook secret kept from the first save");
});

test("inbound webhooks: WooCommerce signature checked, generic signed and unsigned events stored", async () => {
  const list = (await u.req("GET", "/api/integrations")).json().integrations;
  const woo = list.find(i => i.platform === "woocommerce"), mee = list.find(i => i.platform === "meesho");
  const path = url => new URL(url).pathname;
  const body = JSON.stringify({ id: 1, total: "799.00" });
  const good = crypto.createHmac("sha256", "woo-secret").update(body).digest("base64");
  let r = await post(path(woo.webhookUrl), body, { "x-wc-webhook-topic": "order.created", "x-wc-webhook-signature": "bad" });
  assert.equal(r.statusCode, 401);
  r = await post(path(woo.webhookUrl), body, { "x-wc-webhook-topic": "order.created", "x-wc-webhook-signature": good });
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
  assert.deepEqual(events.map(e => [e.platform, e.topic, e.verified]), [["meesho", null, false], ["meesho", "order.created", true], ["meesho", "order.created", false], ["woocommerce", "order.created", true]]);
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
  assert.equal((await u.req("PUT", "/api/integrations/shopify", { fields: {} })).statusCode, 404, "Shopify uses its own page");
});
