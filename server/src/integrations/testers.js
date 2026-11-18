// "Test connection": one cheap, read-only call per platform to prove the saved credentials work.
// Each tester returns a short message for the user, or throws an Error with a plain-language reason.
import net from "node:net";
import { hmacHex } from "../lib/crypto.js";

const TIMEOUT_MS = 15000;
const testMode = () => process.env.NODE_ENV === "test";

// Only call public https addresses the user gave us (never the server's own network).
export function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error("That address is not a valid web address."); }
  if (testMode()) return u;
  if (u.protocol !== "https:") throw new Error("The address must start with https://");
  const h = u.hostname.toLowerCase();
  const privateIp = net.isIP(h) && (/^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80"));
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || privateIp) throw new Error("That address is not reachable from the internet.");
  return u;
}

async function call(url, init = {}, what = "the platform") {
  let res;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" }); }
  catch (e) { throw new Error(e.name === "TimeoutError" ? `${what} did not answer within 15 seconds.` : `Could not reach ${what}. Check the address.`); }
  if (res.status === 401 || res.status === 403) throw new Error(`${what} refused the credentials (${res.status}). Check that they are correct and have read access.`);
  if (res.status === 404) throw new Error(`${what} answered "not found". Check the store address or ID.`);
  if (res.status >= 300) throw new Error(`${what} answered with an error (${res.status}).`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return {}; }
}
const basic = (a, b) => "Basic " + Buffer.from(`${a}:${b}`).toString("base64");

export const TESTERS = {
  async shopify(f) {
    const shop = String(f.shop || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!testMode() && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) throw new Error("Use your store's myshopify.com address, for example yourstore.myshopify.com.");
    const base = testMode() && process.env.SHOPIFY_TEST_BASE ? process.env.SHOPIFY_TEST_BASE : `https://${shop}`;
    const d = await call(`${base}/admin/api/2025-10/shop.json`, { headers: { "X-Shopify-Access-Token": f.access_token, accept: "application/json" } }, "Shopify");
    return `Connected to ${d.shop?.name || shop}.`;
  },
  async woocommerce(f) {
    const u = safeUrl(f.store_url);
    const d = await call(new URL("/wp-json/wc/v3/system_status", u), { headers: { authorization: basic(f.consumer_key, f.consumer_secret), accept: "application/json" } }, "WooCommerce");
    return `Connected to ${d.environment?.site_url || u.host}.`;
  },
  async flipkart(f) {
    const d = await call("https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api", { headers: { authorization: basic(f.app_id, f.app_secret) } }, "Flipkart");
    if (!d.access_token) throw new Error("Flipkart did not issue an access token. Check the application ID and secret.");
    return "Flipkart accepted the application credentials.";
  },
  async bigcommerce(f) {
    const d = await call(`https://api.bigcommerce.com/stores/${encodeURIComponent(f.store_hash)}/v2/store`, { headers: { "X-Auth-Token": f.access_token, accept: "application/json" } }, "BigCommerce");
    return `Connected to ${d.name || "your BigCommerce store"}.`;
  },
  async magento(f) {
    const u = safeUrl(f.base_url);
    await call(new URL("/rest/V1/store/storeConfigs", u), { headers: { authorization: `Bearer ${f.access_token}`, accept: "application/json" } }, "Magento");
    return `Connected to ${u.host}.`;
  },
  async shiprocket(f) {
    const d = await call("https://apiv2.shiprocket.in/v1/external/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.email, password: f.password }) }, "Shiprocket");
    if (!d.token) throw new Error("Shiprocket did not accept this API user.");
    return `Shiprocket accepted the API user${d.company_id ? ` (company ${d.company_id})` : ""}.`;
  },
  async webhook_out(f, ctx) {
    const u = safeUrl(f.url);
    const body = JSON.stringify({ event: "pulse.test", sentAt: new Date().toISOString(), brand: ctx.orgName, message: "Test event from Pulse Navigator" });
    await call(u, { method: "POST", headers: { "content-type": "application/json", "user-agent": "PulseNavigator-Webhook/1", "x-pulse-event": "pulse.test", "x-pulse-signature": "sha256=" + hmacHex(ctx.signingSecret, body) }, body }, "Your endpoint");
    return `Test event delivered to ${u.host}.`;
  }
};
