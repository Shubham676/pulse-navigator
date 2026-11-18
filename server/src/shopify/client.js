// Shopify GraphQL Admin API: connects a brand's own Shopify store and pulls orders and the catalogue.
//
// Two ways to authenticate, both for a store the brand owns:
//  1. Dev Dashboard app (the current way): client ID + client secret, exchanged for a 24-hour token
//     with the client credentials grant. The app must be in the same Shopify organization as the store.
//  2. Older admin-created custom app: a permanent Admin API access token (starts with shpat_).
import { one, q, tx } from "../db.js";
import { decrypt, sha256 } from "../lib/crypto.js";

export const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-10";
const BASE = process.env.SHOPIFY_BASE_URL || "";          // tests only: e.g. http://127.0.0.1:4567
const FIRST_SYNC_DAYS = Number(process.env.SHOPIFY_FIRST_SYNC_DAYS || 365);

export class ShopifyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// "dumbledo", "e0rpax-nb.myshopify.com", "https://e0rpax-nb.myshopify.com/admin" -> "e0rpax-nb.myshopify.com"
export function normalizeShop(input) {
  let s = String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  const admin = String(input || "").match(/admin\.shopify\.com\/store\/([a-z0-9-]+)/i);
  if (admin) s = admin[1].toLowerCase();
  if (!s.endsWith(".myshopify.com")) s = s.replace(/\.myshopify\.com$/, "") + ".myshopify.com";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) throw new ShopifyError("Enter the store's myshopify.com address, e.g. your-store.myshopify.com (Settings > Domains in Shopify shows it).");
  return s;
}

const base = shop => BASE || `https://${shop}`;
const tokens = new Map();   // shop|clientId -> { token, expiresAt }

async function accessToken(cred, { fresh = false } = {}) {
  if (cred.accessToken) return cred.accessToken;
  const key = `${cred.shop}|${cred.clientId}`, hit = tokens.get(key);
  if (!fresh && hit && hit.expiresAt > Date.now() + 5 * 6e4) return hit.token;
  let res;
  try {
    res = await fetch(`${base(cred.shop)}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cred.clientId, client_secret: cred.clientSecret })
    });
  } catch (e) { throw new ShopifyError(`Could not reach ${cred.shop}. Check the store address.`, 502); }
  const text = await res.text();
  if (!res.ok) {
    if (/shop_not_permitted/i.test(text)) throw new ShopifyError("Shopify refused: this app and the store are in different Shopify organizations. Create the app in the Dev Dashboard of the organization that owns the store.", 400);
    if (res.status === 404) throw new ShopifyError(`No Shopify store at ${cred.shop}. Check the myshopify.com address.`, 400);
    throw new ShopifyError("Shopify sign-in failed. Check the client ID and secret, and that the app is installed on the store.", 400);
  }
  const j = JSON.parse(text);
  tokens.set(key, { token: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 86399) * 1000 });
  return j.access_token;
}

export function shopifyCredentials(conn) {
  const s = decrypt(conn.secret_enc) || {};
  return { shop: conn.config.shop, clientId: s.clientId, clientSecret: s.clientSecret, accessToken: s.accessToken };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function shopifyClient(cred) {
  async function gql(query, variables = {}, attempt = 0) {
    const token = await accessToken(cred, { fresh: attempt > 0 && !cred.accessToken });
    let res;
    try {
      res = await fetch(`${base(cred.shop)}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST", headers: { "content-type": "application/json", "x-shopify-access-token": token }, body: JSON.stringify({ query, variables })
      });
    } catch (e) { if (attempt < 3) { await sleep(2000 * (attempt + 1)); return gql(query, variables, attempt + 1); } throw new ShopifyError(`Could not reach ${cred.shop}.`, 502); }
    if (res.status === 401 && !cred.accessToken && attempt === 0) return gql(query, variables, 1);   // token expired early: get a new one
    if (res.status === 401) throw new ShopifyError("Shopify rejected the access token. Reconnect the store.", 401);
    if (res.status === 402) throw new ShopifyError("This Shopify store is frozen or unpaid.", 402);
    if (res.status === 403) throw new ShopifyError("The Shopify app is missing permissions. Give it read_orders and read_products, release the version, and approve it on the store.", 403);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(Number(res.headers.get("retry-after") || 2) * 1000 * (attempt + 1)); return gql(query, variables, attempt + 1); }
    if (!res.ok) throw new ShopifyError(`Shopify returned ${res.status}.`, res.status);
    const j = await res.json();
    if (j.errors?.length) {
      if (j.errors.some(e => e.extensions?.code === "THROTTLED") && attempt < 6) {
        const t = j.extensions?.cost?.throttleStatus, need = j.extensions?.cost?.requestedQueryCost || 500;
        await sleep(t ? Math.max(1000, ((need - t.currentlyAvailable) / (t.restoreRate || 50)) * 1000) : 2000);
        return gql(query, variables, attempt + 1);
      }
      if (j.errors.some(e => e.extensions?.code === "ACCESS_DENIED")) throw new ShopifyError("The Shopify app is missing permissions. Give it read_orders and read_products, release the version, and approve it on the store.", 403);
      throw new ShopifyError("Shopify error: " + j.errors.map(e => e.message).join("; ").slice(0, 300), 500);
    }
    // Stay well under the cost bucket so a long sync never gets throttled mid-page
    const t = j.extensions?.cost?.throttleStatus;
    if (t && t.currentlyAvailable < 300) await sleep(((300 - t.currentlyAvailable) / (t.restoreRate || 50)) * 1000);
    return j.data;
  }
  return { gql, shop: cred.shop };
}

// Checks the credentials and returns the shop's details for the connection card
export async function checkShop(cred) {
  const d = await shopifyClient(cred).gql(`{ shop { name myshopifyDomain currencyCode primaryDomain { host } } }`);
  return d.shop;
}

const money = x => Number(x?.shopMoney?.amount ?? 0);
const isCod = gateways => gateways.some(g => /cash on delivery|\bcod\b/i.test(g));

const ORDER_FIELDS = `id name createdAt updatedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus sourceName paymentGatewayNames discountCodes
  customer { id } shippingAddress { city provinceCode zip }
  currentSubtotalPriceSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount } } totalShippingPriceSet { shopMoney { amount } }
  currentTotalTaxSet { shopMoney { amount } } currentTotalDiscountsSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }`;
const LINE_FIELDS = `pageInfo { hasNextPage endCursor } nodes { id sku name quantity currentQuantity variant { id product { id } }
  originalUnitPriceSet { shopMoney { amount } } discountedTotalSet { shopMoney { amount } } totalDiscountSet { shopMoney { amount } } taxLines { priceSet { shopMoney { amount } } } }`;
const ORDERS_Q = `query($q: String!, $after: String) { orders(first: 25, after: $after, sortKey: UPDATED_AT, query: $q) {
  pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} lineItems(first: 30) { ${LINE_FIELDS} } } } }`;
const MORE_LINES_Q = `query($id: ID!, $after: String) { order(id: $id) { lineItems(first: 100, after: $after) { ${LINE_FIELDS} } } }`;
const VARIANTS_Q = `query($after: String) { productVariants(first: 100, after: $after) { pageInfo { hasNextPage endCursor }
  nodes { id sku title price compareAtPrice inventoryQuantity product { id title status productType handle } inventoryItem { unitCost { amount } } } } }`;

async function saveOrder(orgId, o, lines) {
  const gw = o.paymentGatewayNames || [];
  await tx(async c => {
    await c.query(`insert into shopify_orders (org_id, order_id, name, created_at, updated_at, cancelled_at, financial_status, fulfillment_status, source, payment, is_cod,
        subtotal, shipping, tax, discounts, total, refunded, discount_codes, ship_city, ship_state, ship_postal, customer_key)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      on conflict (org_id, order_id) do update set name=excluded.name, updated_at=excluded.updated_at, cancelled_at=excluded.cancelled_at, financial_status=excluded.financial_status,
        fulfillment_status=excluded.fulfillment_status, source=excluded.source, payment=excluded.payment, is_cod=excluded.is_cod, subtotal=excluded.subtotal, shipping=excluded.shipping,
        tax=excluded.tax, discounts=excluded.discounts, total=excluded.total, refunded=excluded.refunded, discount_codes=excluded.discount_codes,
        ship_city=excluded.ship_city, ship_state=excluded.ship_state, ship_postal=excluded.ship_postal, customer_key=excluded.customer_key`,
      [orgId, o.id, o.name, o.createdAt, o.updatedAt, o.cancelledAt, o.displayFinancialStatus, o.displayFulfillmentStatus, o.sourceName, gw.join(", ").slice(0, 300), isCod(gw),
        money(o.currentSubtotalPriceSet), money(o.totalShippingPriceSet), money(o.currentTotalTaxSet), money(o.currentTotalDiscountsSet), money(o.currentTotalPriceSet), money(o.totalRefundedSet),
        (o.discountCodes || []).join(", ") || null, o.shippingAddress?.city || null, o.shippingAddress?.provinceCode || null, o.shippingAddress?.zip || null,
        o.customer?.id ? sha256(`${orgId}:${o.customer.id}`).slice(0, 32) : null]);
    await c.query("delete from shopify_order_lines where org_id=$1 and order_id=$2", [orgId, o.id]);
    for (const l of lines) {
      await c.query(`insert into shopify_order_lines (org_id, line_id, order_id, sku, title, product_id, variant_id, quantity, ordered_qty, unit_price, line_total, discount, tax)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [orgId, l.id, o.id, l.sku || "", l.name, l.variant?.product?.id || null, l.variant?.id || null, l.currentQuantity ?? l.quantity, l.quantity,
          money(l.originalUnitPriceSet), money(l.discountedTotalSet), money(l.totalDiscountSet), (l.taxLines || []).reduce((s, t) => s + money(t.priceSet), 0)]);
    }
  });
}

// Pulls orders changed since the last sync (the first sync goes back FIRST_SYNC_DAYS; without the
// read_all_orders scope Shopify only returns the last 60 days) and the full variant catalogue.
export async function syncShopify(orgId, log = () => {}) {
  const conn = await one("select * from connections where org_id=$1 and kind='shopify'", [orgId]);
  if (!conn) throw new Error("Shopify store is not connected.");
  const sh = shopifyClient(shopifyCredentials(conn));
  const since = conn.last_sync_at ? new Date(new Date(conn.last_sync_at).getTime() - 864e5) : new Date(Date.now() - FIRST_SYNC_DAYS * 864e5);
  const query = `${conn.last_sync_at ? "updated_at" : "created_at"}:>='${since.toISOString()}'`;

  let after = null, orders = 0, lines = 0;
  do {
    const d = await sh.gql(ORDERS_Q, { q: query, after });
    for (const o of d.orders.nodes) {
      if (o.test) continue;
      const ls = [...o.lineItems.nodes];
      for (let li = o.lineItems.pageInfo; li.hasNextPage;) {
        const more = (await sh.gql(MORE_LINES_Q, { id: o.id, after: li.endCursor })).order.lineItems;
        ls.push(...more.nodes); li = more.pageInfo;
      }
      await saveOrder(orgId, o, ls); orders++; lines += ls.length;
    }
    after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (after);

  let variants = 0; after = null;
  const seen = [];
  do {
    const d = await sh.gql(VARIANTS_Q, { after });
    for (const v of d.productVariants.nodes) {
      seen.push(v.id);
      await q(`insert into shopify_variants (org_id, variant_id, product_id, sku, product_title, variant_title, product_type, handle, status, price, compare_at, cost, inventory, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
        on conflict (org_id, variant_id) do update set product_id=excluded.product_id, sku=excluded.sku, product_title=excluded.product_title, variant_title=excluded.variant_title,
          product_type=excluded.product_type, handle=excluded.handle, status=excluded.status, price=excluded.price, compare_at=excluded.compare_at, cost=excluded.cost,
          inventory=excluded.inventory, updated_at=now()`,
        [orgId, v.id, v.product.id, v.sku || "", v.product.title, v.title === "Default Title" ? null : v.title, v.product.productType || null, v.product.handle, v.product.status,
          v.price === null ? null : Number(v.price), v.compareAtPrice === null ? null : Number(v.compareAtPrice), v.inventoryItem?.unitCost ? Number(v.inventoryItem.unitCost.amount) : null, v.inventoryQuantity]);
      variants++;
    }
    after = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
  } while (after);
  // Variants deleted in Shopify disappear here too
  await q("delete from shopify_variants where org_id=$1 and not (variant_id = any($2))", [orgId, seen]);
  // Product master: when a Shopify SKU matches an Amazon SKU, record the Shopify listing against it
  await q(`insert into product_links (org_id, sku, marketplace, external_id)
           select v.org_id, v.sku, 'Shopify', min(v.variant_id) from shopify_variants v join products p on p.org_id = v.org_id and p.sku = v.sku
            where v.org_id=$1 and v.sku <> '' group by v.org_id, v.sku
           on conflict (org_id, sku, marketplace) do update set external_id=excluded.external_id`, [orgId]);

  await q("update connections set last_sync_at=now(), last_error=null, status='connected' where org_id=$1 and kind='shopify'", [orgId]);
  const done = [`Shopify orders: ${orders} (${lines} items)`, `Shopify variants: ${variants}`];
  log(`Shopify sync for org ${orgId}: ${done.join("; ")}`);
  return done;
}
