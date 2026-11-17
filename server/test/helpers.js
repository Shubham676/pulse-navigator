// Test setup: points the app at the pulse_test database and a mock Amazon, and resets data between test files.
export async function setup({ mockBase } = {}) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://pulse@localhost:5433/pulse_test?host=/tmp";
  process.env.AMAZON_POLL_MS = "20";
  if (mockBase) {
    Object.assign(process.env, { AMAZON_LWA_TOKEN_URL: mockBase + "/auth/o2/token", AMAZON_ADS_TOKEN_URL: mockBase + "/auth/o2/token", AMAZON_SP_API_ENDPOINT: mockBase, AMAZON_ADS_API_ENDPOINT: mockBase });
  }
  const { migrate } = await import("../src/migrate.js");
  const db = await import("../src/db.js");
  await migrate(() => {});
  await db.q("truncate users, orgs, jobs, imports restart identity cascade");
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp({ logger: false });
  const H = { "content-type": "application/json", "x-pulse": "1" };
  async function signup(email = "owner@example.com", brand = "Test Brand") {
    const r = await app.inject({ method: "POST", url: "/api/auth/signup", headers: H, payload: { name: "Owner", email, password: "a-long-password-1", brand } });
    if (r.statusCode !== 200) throw new Error(r.body);
    const cookie = r.headers["set-cookie"].split(";")[0];
    return { cookie, req: (method, url, payload) => app.inject({ method, url, headers: { ...H, cookie }, payload }) };
  }
  return { app, db, signup, close: async () => { await app.close(); await db.pool.end(); } };
}
