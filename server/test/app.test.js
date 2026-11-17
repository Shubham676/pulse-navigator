import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { setup } from "./helpers.js";

// Mock Anthropic API: answers copilot questions, returns listing JSON, and fails when asked to
let mode = "ok";
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c)); req.on("end", () => {
    const body = JSON.parse(b);
    if (req.headers["x-api-key"] !== "test-key" || !body.model || !body.max_tokens) { res.writeHead(401); return res.end("{}"); }
    if (mode === "fail") { res.writeHead(529, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "overloaded" } })); }
    const sys = body.system || "", text = /Reply with JSON/.test(sys)
      ? JSON.stringify({ score: 61, scoreAfter: 86, issues: ["Only 3 bullets"], title: "Annam Low GI Rice 5 kg", bullets: ["a", "b", "c", "d", "e"], description: "d", searchTerms: "chawal", keywords: [{ keyword: "low gi rice", reason: "converts", evidence: "12 orders" }] })
      : "Your ROAS is 1.97. Pause the big packs campaign.";
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }));
  });
});
let t, u, base;
before(async () => {
  await new Promise(r => ai.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { RAZORPAY_KEY_SECRET: "rzp-secret", RAZORPAY_WEBHOOK_SECRET: "hook-secret", ANTHROPIC_API_KEY: "test-key", AI_BASE_URL: `http://127.0.0.1:${ai.address().port}`, ALLOW_TEST_CREDIT: "true" });
  t = await setup();
  u = await t.signup("ai@example.com", "AI Brand");
  const dir = "/tmp/pulse-test-samples2";
  execFileSync("node", ["../tools/sample-reports.js", dir, "40"], { cwd: new URL("..", import.meta.url).pathname });
  const { importBuffer } = await import("../src/lib/importer.js");
  const org = (await t.db.one("select org_id from memberships m join users x on x.id=m.user_id where x.email='ai@example.com'")).org_id;
  for (const f of ["All_Listings_Report.txt", "All_Orders_Report.txt", "Sponsored_Products_Campaign_report.xlsx", "Sponsored_Products_Search_term_report.xlsx", "Sponsored_Products_Advertised_product_report.csv"])
    await importBuffer({ orgId: org, buf: fs.readFileSync(`${dir}/${f}`), filename: f });
});
after(async () => { ai.close(); await t.close(); });

const fallback = { text: "rules answer", think: ["x"], acts: [] };

test("data endpoint returns the brand's numbers", async () => {
  const r = await u.req("GET", "/api/data");
  assert.equal(r.statusCode, 200);
  const d = r.json();
  assert.equal(d.products.length, 14);
  assert.ok(d.daily.length > 100 && d.campaigns.length >= 10 && d.terms.length > 10);
});

test("copilot answers with the AI model, and falls back to rules when it fails", async () => {
  let r = await u.req("POST", "/api/copilot", { message: "How can I increase my ROAS?", facts: "Brand: AI Brand", fallback });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().message.meta.source, "ai");
  assert.match(r.json().message.content, /ROAS is 1.97/);
  mode = "fail";
  r = await u.req("POST", "/api/copilot", { chatId: r.json().chatId, message: "And profit?", facts: "x", fallback });
  mode = "ok";
  assert.equal(r.json().message.meta.source, "rules");
  const chats = (await u.req("GET", "/api/copilot/chats")).json().chats;
  assert.equal(chats.length, 1);
  assert.equal((await u.req("GET", `/api/copilot/chats/${chats[0].id}`)).json().messages.length, 4);
});

test("agents: low balance is refused, a run charges the wallet, a failed run is refunded", async () => {
  let r = await u.req("POST", "/api/agents/run", { agent: "optim", sku: "AF-RICE-LG-5" });
  assert.equal(r.statusCode, 402);
  assert.equal(r.json().code, "low_balance");
  assert.equal((await u.req("POST", "/api/wallet/topup", { amount: 100 })).json().credited, true);
  r = await u.req("POST", "/api/agents/run", { agent: "optim", sku: "AF-RICE-LG-5" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().output.score, 61);
  assert.equal(r.json().balance, 80);
  mode = "fail";
  r = await u.req("POST", "/api/agents/run", { agent: "kw", sku: "AF-RICE-LG-5" });
  mode = "ok";
  assert.equal(r.statusCode, 502);
  const w = (await u.req("GET", "/api/wallet")).json();
  assert.equal(w.balance, 80, "failed run must be refunded");
  assert.deepEqual(w.ledger.map(l => l.kind), ["refund", "agent", "agent", "topup"]);
  assert.equal(w.invoices.length, 1);
  r = await u.req("POST", "/api/agents/run", { agent: "bg", sku: "AF-RICE-LG-5" });
  assert.equal(r.statusCode, 400, "image agents are not available yet");
});

test("campaign changes are logged; viewers cannot change them; other brands cannot see them", async () => {
  const d = (await u.req("GET", "/api/data")).json(), c = d.campaigns[0];
  let r = await u.req("POST", `/api/ads/campaigns/${encodeURIComponent(c.id)}`, { status: "Paused" });
  assert.equal(r.statusCode, 200); assert.equal(r.json().pushed, false);
  const d2 = (await u.req("GET", "/api/data")).json();
  assert.equal(d2.campaigns.find(x => x.id === c.id).status, "Paused");
  assert.equal(d2.changes[0].action, "Paused");
  // a second user in another brand sees nothing of the first
  const other = await t.signup("other@example.com", "Other Brand");
  const d3 = (await other.req("GET", "/api/data")).json();
  assert.equal(d3.campaigns.length, 0); assert.equal(d3.products.length, 0);
  r = await other.req("POST", `/api/ads/campaigns/${encodeURIComponent(c.id)}`, { status: "Live" });
  assert.equal(r.statusCode, 404);
  // invite as viewer
  const inv = (await u.req("POST", "/api/team/invite", { email: "viewer@example.com", role: "viewer" })).json().link.split("invite=")[1];
  const acc = await t.app.inject({ method: "POST", url: "/api/invites/accept", headers: { "content-type": "application/json", "x-pulse": "1" }, payload: { token: inv, name: "Viewer", password: "viewer-password-1" } });
  assert.equal(acc.statusCode, 200);
  const cookie = acc.headers["set-cookie"].split(";")[0];
  r = await t.app.inject({ method: "POST", url: `/api/ads/campaigns/${encodeURIComponent(c.id)}`, headers: { "content-type": "application/json", "x-pulse": "1", cookie }, payload: { status: "Live" } });
  assert.equal(r.statusCode, 403);
});

test("upload endpoint detects reports and rejects unreadable files", async () => {
  const boundary = "----pulse";
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Coupons.csv"\r\nContent-Type: text/csv\r\n\r\n`), fs.readFileSync("/tmp/pulse-test-samples2/Coupons.csv"),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.csv"\r\nContent-Type: text/csv\r\n\r\nhello,world\r\n1,2\r\n--${boundary}--\r\n`)]);
  const cookie = u.cookie;
  const r = await t.app.inject({ method: "POST", url: "/api/imports", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "x-pulse": "1", cookie }, payload: body });
  assert.equal(r.statusCode, 200, r.body);
  const [a, b] = r.json().results;
  assert.equal(a.ok, true); assert.equal(a.report, "coupons");
  assert.equal(b.ok, false); assert.match(b.error, /did not recognise/);
});

test("requests without the app header are blocked", async () => {
  const r = await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: u.cookie } });
  assert.equal(r.statusCode, 403);
});

test("payments: a bad signature is refused; verify and the webhook credit once only", async () => {
  const crypto = await import("node:crypto");
  const org = (await t.db.one("select org_id from memberships m join users x on x.id=m.user_id where x.email='ai@example.com'")).org_id;
  const before = (await u.req("GET", "/api/wallet")).json().balance;
  await t.db.q("insert into payments (order_id, org_id, amount_paise, credit_paise) values ('order_T1',$1,59000,50000)", [org]);
  let r = await u.req("POST", "/api/wallet/verify", { razorpay_order_id: "order_T1", razorpay_payment_id: "pay_1", razorpay_signature: "forged" });
  assert.equal(r.statusCode, 400);
  const sig = crypto.createHmac("sha256", "rzp-secret").update("order_T1|pay_1").digest("hex");
  r = await u.req("POST", "/api/wallet/verify", { razorpay_order_id: "order_T1", razorpay_payment_id: "pay_1", razorpay_signature: sig });
  assert.equal(r.statusCode, 200, r.body);
  const hook = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_T1" } } } });
  const bad = await t.app.inject({ method: "POST", url: "/api/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": "nope" }, payload: hook });
  assert.equal(bad.statusCode, 400);
  const good = await t.app.inject({ method: "POST", url: "/api/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": crypto.createHmac("sha256", "hook-secret").update(hook).digest("hex") }, payload: hook });
  assert.equal(good.statusCode, 200, good.body);
  const w = (await u.req("GET", "/api/wallet")).json();
  assert.equal(w.balance, before + 500, "credited exactly once");
  const inv = await u.req("GET", `/api/wallet/invoices/${w.invoices[0].invoice_no}`);
  assert.match(inv.body, /IGST 18%/);
  assert.match(inv.body, /₹590\.00/);
});
