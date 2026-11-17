// Shared HTTP helpers for Amazon's Login with Amazon (LWA), Selling Partner API and Ads API.
import zlib from "node:zlib";
import { promisify } from "node:util";
const gunzip = promisify(zlib.gunzip);

export class AmazonError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

const tokenCache = new Map(); // key -> { token, exp }

// Exchanges a refresh token for an access token, cached until a minute before it expires
export async function lwaAccessToken({ tokenUrl = "https://api.amazon.com/auth/o2/token", clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret || !refreshToken) throw new AmazonError("Amazon app credentials are missing.", 400);
  const key = tokenUrl + "|" + clientId + "|" + refreshToken.slice(-12);
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.token;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AmazonError(`Amazon sign-in failed: ${body.error_description || body.error || res.status}. Check the refresh token and app credentials.`, res.status, body);
  tokenCache.set(key, { token: body.access_token, exp: Date.now() + (body.expires_in - 60) * 1000 });
  return body.access_token;
}

export async function exchangeCode({ tokenUrl = "https://api.amazon.com/auth/o2/token", clientId, clientSecret, code, redirectUri }) {
  const params = { grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret };
  if (redirectUri) params.redirect_uri = redirectUri;
  const res = await fetch(tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: new URLSearchParams(params) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AmazonError(`Amazon did not accept the sign-in code: ${body.error_description || body.error || res.status}`, res.status, body);
  return body.refresh_token;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// JSON request with retry on throttling (429) and temporary errors (5xx)
export async function amazonRequest(url, { method = "GET", headers = {}, body, tries = 5 } = {}) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    if ((res.status === 429 || res.status >= 500) && i < tries - 1) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || Math.min(60000, 2000 * 2 ** i);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.errors?.[0]?.message || data?.details || data?.message || data?.code || text.slice(0, 200) || res.statusText;
      throw new AmazonError(`Amazon API ${method} ${new URL(url).pathname} failed (${res.status}): ${msg}`, res.status, data);
    }
    return data;
  }
}

// Downloads a report document; handles gzip whether or not Amazon labels it
export async function downloadDocument(url, compression) {
  const res = await fetch(url);
  if (!res.ok) throw new AmazonError(`Report download failed (${res.status})`, res.status);
  let buf = Buffer.from(await res.arrayBuffer());
  if (compression === "GZIP" || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = await gunzip(buf);
  return buf;
}

export { sleep };
export const POLL_MS = Number(process.env.AMAZON_POLL_MS || 15000);
