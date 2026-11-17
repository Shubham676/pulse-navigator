import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { startMockAmazon } from "./mock-amazon.js";
import { setup } from "./helpers.js";

const SAMPLES = "/tmp/pulse-test-samples";
let mock, t;
before(async () => {
  execFileSync("node", ["../tools/sample-reports.js", SAMPLES, "40"], { cwd: new URL("..", import.meta.url).pathname });
  mock = await startMockAmazon(SAMPLES);
  t = await setup({ mockBase: mock.base });
});
after(async () => { mock.close(); await t.close(); });

test("SP-API: bad refresh token is rejected with a clear message", async () => {
  const u = await t.signup("a@example.com");
  const r = await u.req("POST", "/api/connections/sp-api", { refreshToken: "Atzr|bad-token-xxxxxxxxxxxxxxxx", clientId: "amzn1.app", clientSecret: "secret" });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /Amazon sign-in failed/);
});

test("SP-API: connect, then a sync imports orders, listings, inventory, returns, traffic and health", async () => {
  const u = await t.signup("b@example.com");
  const r = await u.req("POST", "/api/connections/sp-api", { refreshToken: "Atzr|good-token-xxxxxxxxxxxxxxxx", clientId: "amzn1.app", clientSecret: "secret" });
  assert.equal(r.statusCode, 200, r.body);
  const org = (await t.db.one("select org_id from memberships m join users u on u.id=m.user_id where u.email='b@example.com'")).org_id;
  const conn = await t.db.one("select secret_enc from connections where org_id=$1", [org]);
  assert.ok(!conn.secret_enc.includes("good-token"), "refresh token must be stored encrypted");
  const { syncSpApi } = await import("../src/amazon/spapi.js");
  const done = await syncSpApi(org);
  assert.ok(done.length >= 5, done.join("; "));
  const c = await t.db.one("select (select count(*) from order_items where org_id=$1) o, (select count(*) from products where org_id=$1) p, (select count(*) from returns where org_id=$1) r, (select count(*) from account_health where org_id=$1) h, (select count(*) from traffic_daily where org_id=$1) tr", [org]);
  assert.ok(c.o > 100 && c.p === 14 && c.r > 0 && c.h === 1 && c.tr > 0, JSON.stringify(c));
});

test("Ads API: connect picks the India profile, sync saves SP, SB, SD and search terms, and changes are pushed", async () => {
  const u = await t.signup("c@example.com");
  const r = await u.req("POST", "/api/connections/ads-api", { refreshToken: "Atzr|good-token-xxxxxxxxxxxxxxxx", clientId: "amzn1.ads", clientSecret: "secret" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().account, "Annam Foods");
  const org = (await t.db.one("select org_id from memberships m join users u on u.id=m.user_id where u.email='c@example.com'")).org_id;
  const { syncAds, pushCampaign } = await import("../src/amazon/ads.js");
  await syncAds(org);
  const camps = await t.db.many("select campaign_id, ad_type, remote, sku from campaigns where org_id=$1 order by ad_type", [org]);
  assert.deepEqual(camps.map(c => c.ad_type), ["SB", "SD", "SP"]);
  assert.ok(camps.every(c => c.remote));
  assert.equal(camps.find(c => c.ad_type === "SP").sku, "AF-RICE-LG-5");
  assert.ok((await t.db.one("select count(*) n from ad_terms where org_id=$1", [org])).n > 0);
  const res = await pushCampaign(org, { remote: true, ad_type: "SP", campaign_id: "9001" }, { state: "PAUSED" });
  assert.equal(res.pushed, true, res.error);
  assert.ok(mock.calls.includes("PUT /sp/campaigns"));
});
