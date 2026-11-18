import { z } from "zod";
import { one, many, q } from "../db.js";
import { config } from "../config.js";
import { encrypt, decrypt, randomToken, hmacHex, safeEqual } from "../lib/crypto.js";
import { requireAuth, requireOrg, canAdmin, canEdit, HttpError, audit, basePath } from "../lib/auth.js";
import { spClient, spCredentials } from "../amazon/spapi.js";
import { adsClient, adsCredentials, ADS_TOKEN_URL } from "../amazon/ads.js";
import { exchangeCode } from "../amazon/http.js";
import { enqueue, SYNC_JOB } from "../jobs/worker.js";
import { checkShop, normalizeShop, ShopifyError } from "../shopify/client.js";

const SP_APP_ID = process.env.AMAZON_SP_APP_ID || "";          // set when the public SP-API app is approved
const SP_CONSENT = process.env.AMAZON_SP_CONSENT_URL || "https://sellercentral.amazon.in/apps/authorize/consent";
const ADS_CONSENT = process.env.AMAZON_ADS_CONSENT_URL || "https://eu.account.amazon.com/ap/oa";

function signState(orgId, userId, nonce) {
  const body = `${orgId}.${userId}.${nonce}.${Date.now() + 15 * 6e4}`;
  return body + "." + hmacHex(config.encKey, body).slice(0, 32);
}
function checkState(state, nonce) {
  const parts = String(state || "").split(".");
  if (parts.length !== 5) return null;
  const [orgId, userId, n, exp, sig] = parts;
  if (!safeEqual(sig, hmacHex(config.encKey, parts.slice(0, 4).join(".")).slice(0, 32)) || n !== nonce || Number(exp) < Date.now()) return null;
  return { orgId: Number(orgId), userId: Number(userId) };
}

async function saveConnection(orgId, kind, cfg, secrets) {
  await q(`insert into connections (org_id, kind, config, secret_enc, status, last_error) values ($1,$2,$3,$4,'connected',null)
           on conflict (org_id, kind) do update set config=excluded.config, secret_enc=excluded.secret_enc, status='connected', last_error=null`, [orgId, kind, cfg, encrypt(secrets)]);
  await enqueue(orgId, SYNC_JOB[kind]);
}

async function pickAdsProfile(cred) {
  const profiles = await adsClient(cred).profiles();
  const p = profiles.find(x => x.countryCode === "IN" && x.accountInfo?.type !== "agency") || profiles.find(x => x.countryCode === "IN") || profiles[0];
  if (!p) throw new HttpError(400, "This Amazon Ads login has no advertising profile. Sign in with the account that runs your ads.");
  return p;
}

export default async function connectionRoutes(app) {
  app.get("/api/connections", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const rows = await many("select kind, config, status, last_sync_at, last_error from connections where org_id=$1", [req.org.id]);
    const jobs = await many("select kind, state, updated_at, result from jobs where org_id=$1 and kind in ('sp_sync','ads_sync','shopify_sync') order by id desc limit 9", [req.org.id]);
    const health = await one("select as_of, source, metrics from account_health where org_id=$1 order by as_of desc limit 1", [req.org.id]);
    return { connections: rows, jobs, health, oauth: { sp: !!SP_APP_ID && !!config.amazon.lwaClientId, ads: !!config.amazon.adsClientId }, appConfigured: !!config.amazon.lwaClientId };
  });

  // Private developer route: the seller pastes the refresh token from their own SP-API app (and that app's client id and secret)
  app.post("/api/connections/sp-api", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const b = z.object({ refreshToken: z.string().trim().min(20, "Paste the full refresh token (it starts with Atzr|)."), clientId: z.string().trim().optional(), clientSecret: z.string().trim().optional() }).parse(req.body);
    const secrets = { refreshToken: b.refreshToken, clientId: b.clientId || undefined, clientSecret: b.clientSecret || undefined };
    const cred = spCredentials({ secret_enc: encrypt(secrets), config: {} });
    if (!cred.clientId || !cred.clientSecret) throw new HttpError(400, "Enter the LWA client ID and client secret of your SP-API app.");
    let mp;
    try { mp = await spClient(cred).marketplaces(); } catch (e) { throw new HttpError(400, e.message); }
    const india = (mp.payload || []).find(p => p.marketplace?.id === config.amazon.marketplaceId);
    await saveConnection(req.org.id, "sp_api", { marketplaceId: config.amazon.marketplaceId, sellerName: india?.participation ? "connected" : "not selling on Amazon.in" }, secrets);
    await audit(req, "connect.sp_api");
    return { ok: true, sellingOnIndia: !!india };
  });

  app.post("/api/connections/ads-api", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const b = z.object({ refreshToken: z.string().trim().min(20, "Paste the full refresh token."), clientId: z.string().trim().optional(), clientSecret: z.string().trim().optional() }).parse(req.body);
    const secrets = { refreshToken: b.refreshToken, clientId: b.clientId || undefined, clientSecret: b.clientSecret || undefined };
    const cred = adsCredentials({ secret_enc: encrypt(secrets), config: {} });
    if (!cred.clientId || !cred.clientSecret) throw new HttpError(400, "Enter the client ID and client secret of your Amazon Ads API app.");
    let p; try { p = await pickAdsProfile(cred); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
    await saveConnection(req.org.id, "ads_api", { profileId: p.profileId, accountName: p.accountInfo?.name || "", countryCode: p.countryCode }, secrets);
    await audit(req, "connect.ads_api");
    return { ok: true, account: p.accountInfo?.name || p.profileId };
  });

  // Shopify: a Dev Dashboard app in the brand's own Shopify organization (client ID + secret),
  // or an older admin-created custom app's Admin API access token (shpat_…)
  app.post("/api/connections/shopify", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const b = z.object({ shop: z.string().trim().min(3, "Enter your store's myshopify.com address."), clientId: z.string().trim().optional(), clientSecret: z.string().trim().optional(), accessToken: z.string().trim().optional() }).parse(req.body);
    let shop; try { shop = normalizeShop(b.shop); } catch (e) { throw new HttpError(400, e.message); }
    const secrets = b.accessToken ? { accessToken: b.accessToken } : { clientId: b.clientId, clientSecret: b.clientSecret };
    if (!b.accessToken && (!b.clientId || !b.clientSecret)) throw new HttpError(400, "Enter the app's client ID and client secret from the Shopify Dev Dashboard (or an Admin API access token).");
    let info;
    try { info = await checkShop({ shop, ...secrets }); } catch (e) { throw new HttpError(e instanceof ShopifyError && e.status < 500 ? 400 : 502, e.message); }
    await saveConnection(req.org.id, "shopify", { shop: info.myshopifyDomain || shop, accountName: info.name, domain: info.primaryDomain?.host || null, currency: info.currencyCode }, secrets);
    await audit(req, "connect.shopify", { shop });
    return { ok: true, account: info.name, domain: info.primaryDomain?.host || shop };
  });

  // OAuth: public app flows, used once our apps are approved by Amazon
  app.get("/api/connections/:kind/oauth/start", { preHandler: requireAuth }, async (req, reply) => {
    canAdmin(req);
    const kind = req.params.kind, nonce = randomToken(12), state = signState(req.org.id, req.user.id, nonce);
    reply.setCookie("pulse_oauth", nonce, { path: basePath(req) + "/api/connections", httpOnly: true, sameSite: "lax", secure: config.isProd, maxAge: 900 });
    if (kind === "sp-api") {
      if (!SP_APP_ID) throw new HttpError(400, "The Pulse Navigator Amazon app is not approved yet. Use the private developer option.");
      return reply.redirect(`${SP_CONSENT}?${new URLSearchParams({ application_id: SP_APP_ID, state, redirect_uri: `${config.publicUrl}/api/connections/sp-api/oauth/callback` })}`);
    }
    if (kind === "ads-api") {
      if (!config.amazon.adsClientId) throw new HttpError(400, "The Pulse Navigator Amazon Ads app is not configured yet.");
      return reply.redirect(`${ADS_CONSENT}?${new URLSearchParams({ client_id: config.amazon.adsClientId, scope: "advertising::campaign_management", response_type: "code", state, redirect_uri: `${config.publicUrl}/api/connections/ads-api/oauth/callback` })}`);
    }
    throw new HttpError(404, "Unknown connection.");
  });

  app.get("/api/connections/:kind/oauth/callback", async (req, reply) => {
    const s = checkState(req.query.state, req.cookies.pulse_oauth);
    reply.clearCookie("pulse_oauth", { path: basePath(req) + "/api/connections" });
    if (!s) return reply.redirect(basePath(req) + "/#connections-amazon?error=expired");
    if (!await one("select 1 from memberships where org_id=$1 and user_id=$2 and role in ('owner','admin')", [s.orgId, s.userId])) return reply.redirect(basePath(req) + "/#connections-amazon");
    try {
      if (req.params.kind === "sp-api") {
        const refreshToken = await exchangeCode({ clientId: config.amazon.lwaClientId, clientSecret: config.amazon.lwaClientSecret, code: req.query.spapi_oauth_code, redirectUri: `${config.publicUrl}/api/connections/sp-api/oauth/callback` });
        await saveConnection(s.orgId, "sp_api", { marketplaceId: config.amazon.marketplaceId, sellerId: req.query.selling_partner_id || null }, { refreshToken });
      } else {
        const refreshToken = await exchangeCode({ tokenUrl: ADS_TOKEN_URL, clientId: config.amazon.adsClientId, clientSecret: config.amazon.adsClientSecret, code: req.query.code, redirectUri: `${config.publicUrl}/api/connections/ads-api/oauth/callback` });
        const p = await pickAdsProfile(adsCredentials({ secret_enc: encrypt({ refreshToken }), config: {} }));
        await saveConnection(s.orgId, "ads_api", { profileId: p.profileId, accountName: p.accountInfo?.name || "", countryCode: p.countryCode }, { refreshToken });
      }
      return reply.redirect(basePath(req) + "/#connections-amazon");
    } catch (e) {
      req.log.error(e);
      return reply.redirect(basePath(req) + "/#connections-amazon");
    }
  });

  app.post("/api/connections/:kind/sync", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const kind = { "sp-api": "sp_sync", "ads-api": "ads_sync", "shopify": "shopify_sync" }[req.params.kind];
    if (!kind) throw new HttpError(404, "Unknown connection.");
    if (!await one("select 1 from connections where org_id=$1 and kind=$2", [req.org.id, req.params.kind.replace("-", "_")])) throw new HttpError(400, "Connect the account first.");
    const queued = await enqueue(req.org.id, kind);
    return { ok: true, queued };
  });

  app.delete("/api/connections/:kind", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    await q("delete from connections where org_id=$1 and kind=$2", [req.org.id, req.params.kind.replace("-", "_")]);
    await audit(req, "disconnect." + req.params.kind);
    return { ok: true };
  });

  // Account health entered by hand when the API is not connected
  app.put("/api/account-health", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const n = z.number().min(0).max(100).nullable();
    const b = z.object({ lateShipment: n, preCancel: n, validTracking: n, onTime: n, odr: n, policyViolations: z.number().int().min(0).nullable(), ahr: z.number().int().min(0).max(1000).nullable() }).parse(req.body);
    const metrics = {
      shipping: [["Late shipment rate", b.lateShipment, "<", 4], ["Pre-fulfilment cancel rate", b.preCancel, "<", 2.5], ["Valid tracking rate", b.validTracking, ">", 95], ["On-time delivery rate", b.onTime, ">", 90]].filter(x => x[1] !== null),
      policy: b.policyViolations === null ? [] : [["Policy violations", b.policyViolations]],
      service: b.odr === null ? [] : [["Order defect rate", b.odr, null]],
      accountHealthRating: b.ahr
    };
    const day = new Date(Date.now() + 330 * 6e4).toISOString().slice(0, 10);
    await q("insert into account_health (org_id, as_of, source, metrics) values ($1,$2,'manual',$3) on conflict (org_id, as_of) do update set metrics=excluded.metrics, source='manual'", [req.org.id, day, metrics]);
    return { ok: true };
  });
}

export { decrypt };
