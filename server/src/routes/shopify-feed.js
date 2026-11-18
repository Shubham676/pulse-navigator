// Shopify orders, products and stock in the same shape as the Amazon data, so every Sales, Inventory and Business page
// shows both channels. loadData() merges these rows with the Amazon ones.
import { many } from "../db.js";

const IST = "Asia/Kolkata";
// One SKU key per variant: its SKU, or SHOP-<variant number> when the variant has no SKU
const LINE_SKU = `coalesce(nullif(l.sku, ''), case when l.variant_id is not null then 'SHOP-' || regexp_replace(l.variant_id, '\\D', '', 'g') else 'SHOP-' || left(md5(coalesce(l.title, '')), 8) end)`;
const VAR_SKU = `coalesce(nullif(v.sku, ''), 'SHOP-' || regexp_replace(v.variant_id, '\\D', '', 'g'))`;
const LINES = `shopify_order_lines l join shopify_orders o on o.org_id = l.org_id and o.order_id = l.order_id`;
const LIVE = "o.cancelled_at is null";

// Shopify stores Indian states as province codes; Amazon uses names
export const IN_STATES = { AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar", CH: "Chandigarh", CG: "Chhattisgarh", CT: "Chhattisgarh",
  DN: "Dadra and Nagar Haveli and Daman and Diu", DD: "Dadra and Nagar Haveli and Daman and Diu", DH: "Dadra and Nagar Haveli and Daman and Diu", DL: "Delhi", GA: "Goa", GJ: "Gujarat", HR: "Haryana",
  HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand", KA: "Karnataka", KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur",
  ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OR: "Odisha", OD: "Odisha", PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu", TS: "Telangana", TG: "Telangana",
  TR: "Tripura", UP: "Uttar Pradesh", UK: "Uttarakhand", UT: "Uttarakhand", WB: "West Bengal" };
export const stateName = s => { if (!s) return s; const k = String(s).trim().toUpperCase(); return IN_STATES[k] || s; };

export async function shopifyFeed(id) {
  const P = sql => many(sql, [id]);
  const has = await P("select 1 from shopify_orders where org_id = $1 union all select 1 from shopify_variants where org_id = $1 limit 1");
  if (!has.length) return null;
  const [products, daily, dayOrders, dayReturns, hourly, dowHour, heat7, orders, returns, geo, splits, coupons, deals, repeat] = await Promise.all([
    P(`select ${VAR_SKU} as sku, null::text as asin,
              v.product_title || case when coalesce(v.variant_title, '') in ('', 'Default Title') then '' else ' – ' || v.variant_title end as name,
              coalesce(nullif(v.product_type, ''), 'Shopify') as category, v.price, v.cost as cogs, null::int as images, null::int as bullets, null::boolean as has_aplus,
              null::numeric as rating, null::int as reviews, case when v.status = 'ACTIVE' then 'Active' else 'Inactive' end as status, null::text as suppressed_reason,
              0 as fba_qty, greatest(coalesce(v.inventory, 0), 0) as fbm_qty, v.updated_at as inventory_as_of, length(v.product_title) as title_length, v.variant_id, v.compare_at
         from shopify_variants v where v.org_id = $1 order by 1`),
    P(`select (o.created_at at time zone '${IST}')::date as d, ${LINE_SKU} as sku,
              coalesce(sum(l.ordered_qty) filter (where ${LIVE}), 0)::int as units, coalesce(sum(l.line_total) filter (where ${LIVE}), 0) as rev,
              coalesce(sum(l.ordered_qty) filter (where not ${LIVE}), 0)::int as canc
         from ${LINES} where l.org_id = $1 and o.created_at >= now() - interval '400 days' group by 1, 2`),
    P(`select (o.created_at at time zone '${IST}')::date as d, count(*) filter (where ${LIVE})::int as orders, count(*) filter (where not ${LIVE})::int as cancelled
         from shopify_orders o where o.org_id = $1 and o.created_at >= now() - interval '400 days' group by 1`),
    // Refund dates are not stored per line, so refunded units are dated when the order last changed
    P(`select (o.updated_at at time zone '${IST}')::date as d, ${LINE_SKU} as sku, sum(l.ordered_qty - l.quantity)::int as qty
         from ${LINES} where l.org_id = $1 and ${LIVE} and l.ordered_qty > l.quantity and o.updated_at >= now() - interval '400 days' group by 1, 2`),
    P(`select extract(hour from o.created_at at time zone '${IST}')::int as h, sum(l.ordered_qty)::int as units from ${LINES}
        where l.org_id = $1 and ${LIVE} and o.created_at >= now() - interval '30 days' group by 1`),
    P(`select extract(isodow from o.created_at at time zone '${IST}')::int as dow, extract(hour from o.created_at at time zone '${IST}')::int as h, count(*)::int as orders
         from shopify_orders o where o.org_id = $1 and ${LIVE} and o.created_at >= now() - interval '60 days' group by 1, 2`),
    P(`select (o.created_at at time zone '${IST}')::date as d, extract(hour from o.created_at at time zone '${IST}')::int as h, sum(l.ordered_qty)::int as units
         from ${LINES} where l.org_id = $1 and ${LIVE} and o.created_at >= date_trunc('day', now() at time zone '${IST}') at time zone '${IST}' - interval '6 days' group by 1, 2`),
    P(`select o.name as order_id, ${LINE_SKU} as sku, o.created_at as purchased_at,
              case when o.cancelled_at is not null then 'Cancelled' when o.fulfillment_status = 'FULFILLED' then 'Shipped' else 'Pending' end as status,
              'Shopify' as fulfillment, null::text as ship_service, l.ordered_qty as quantity, l.line_total as item_price, l.tax as item_tax, 0::numeric as shipping_price,
              l.discount as promo_discount, o.ship_state, o.ship_city, false as is_business
         from ${LINES} where l.org_id = $1 order by o.created_at desc limit 400`),
    P(`select o.name as order_id, ${LINE_SKU} as sku, (o.updated_at at time zone '${IST}')::date as returned_at, (l.ordered_qty - l.quantity)::int as quantity,
              'Refunded on Shopify' as reason, 'Refunded' as status, null::text as carrier, null::text as label_paid_by, false as a_to_z,
              round(l.line_total / nullif(l.ordered_qty, 0) * (l.ordered_qty - l.quantity), 2) as refund, o.ship_state
         from ${LINES} where l.org_id = $1 and ${LIVE} and l.ordered_qty > l.quantity and o.updated_at >= now() - interval '120 days' order by o.updated_at desc`),
    P(`select w.days, coalesce(nullif(o.ship_state, ''), 'Not given') as state, count(*)::int as orders, sum(o.subtotal) as rev
         from (values (1), (7), (30), (60)) w(days) join shopify_orders o on o.org_id = $1 and ${LIVE} and o.created_at >= now() - (w.days || ' days')::interval group by 1, 2`),
    P(`select w.days, 'Shopify' as fulfillment, false as is_business, count(*)::int as orders
         from (values (1), (7), (30), (60)) w(days) join shopify_orders o on o.org_id = $1 and ${LIVE} and o.created_at >= now() - (w.days || ' days')::interval group by 1`),
    // Discount codes used in the last year, shown alongside Amazon coupons
    P(`select code as id, code as name, 'Shopify discount code' as type, null::numeric as disc, null::numeric as budget, sum(o.discounts) as spent, null::int as clips,
              count(*)::int as redemptions, sum(o.subtotal) as sales, min(o.created_at at time zone '${IST}')::date as start,
              case when max(o.created_at) >= now() - interval '30 days' then null else max(o.created_at at time zone '${IST}')::date end as "end"
         from shopify_orders o, lateral unnest(string_to_array(o.discount_codes, ', ')) code
        where o.org_id = $1 and ${LIVE} and coalesce(o.discount_codes, '') <> '' and o.created_at >= now() - interval '365 days' group by code order by count(*) desc`),
    // Products on sale (price below the compare-at price), with their last 30 days of sales
    P(`select 'sale-' || regexp_replace(v.variant_id, '\\D', '', 'g') as id, 'Sale price on Shopify' as type, ${VAR_SKU} as sku, null::timestamptz as start, null::timestamptz as "end",
              null::int as views, coalesce(s.units, 0)::int as units, coalesce(s.rev, 0) as rev, 'Live' as status
         from shopify_variants v
         left join lateral (select sum(l.ordered_qty) as units, sum(l.line_total) as rev from ${LINES}
                            where l.org_id = v.org_id and l.variant_id = v.variant_id and ${LIVE} and o.created_at >= now() - interval '30 days') s on true
        where v.org_id = $1 and v.status = 'ACTIVE' and v.compare_at is not null and v.price is not null and v.compare_at > v.price`),
    // Repeat customers per product over the last year (customer IDs are stored hashed)
    P(`with x as (select ${LINE_SKU} as sku, l.title, o.customer_key as ck, o.order_id, l.line_total as rev,
                         row_number() over (partition by ${LINE_SKU}, o.customer_key order by o.created_at) as nth
                    from ${LINES} where l.org_id = $1 and ${LIVE} and o.customer_key is not null and o.created_at >= now() - interval '365 days'),
            c as (select sku, ck, count(distinct order_id) as n from x group by 1, 2)
       select x.sku, null::text as asin, max(x.title) as title, count(distinct x.order_id)::int as orders, count(distinct x.ck)::int as unique_customers,
              round(100.0 * count(distinct x.ck) filter (where c.n > 1) / nullif(count(distinct x.ck), 0), 2) as repeat_customers_pct,
              coalesce(sum(x.rev) filter (where x.nth > 1), 0) as repeat_revenue,
              round(100.0 * coalesce(sum(x.rev) filter (where x.nth > 1), 0) / nullif(sum(x.rev), 0), 2) as repeat_revenue_pct, current_date as period_end
         from x join c on c.sku = x.sku and c.ck = x.ck group by x.sku order by 4 desc`)
  ]);
  const st = r => ({ ...r, ship_state: stateName(r.ship_state) });
  return { products, daily, dayOrders, dayReturns, hourly, dowHour, heat7, orders: orders.map(st), returns: returns.map(st),
    geo: geo.map(g => ({ ...g, state: stateName(g.state) })), splits, coupons, deals, repeat };
}

// Add Shopify rows to the Amazon data. Rows for the same day and SKU are summed so each page sees one row.
export function mergeShopify(D, S) {
  if (!S) return D;
  const sumBy = (a, b, keyOf, fields) => {
    const m = new Map(a.map(r => [keyOf(r), { ...r }]));
    for (const r of b) { const k = keyOf(r), x = m.get(k); if (!x) m.set(k, { ...r }); else for (const f of fields) x[f] = Number(x[f] || 0) + Number(r[f] || 0); }
    return [...m.values()];
  };
  const day = r => String(r.d instanceof Date ? r.d.toISOString().slice(0, 10) : r.d);
  const shopRev = new Map();
  for (const r of S.daily) shopRev.set(day(r), (shopRev.get(day(r)) || 0) + Number(r.rev || 0));

  const amazonSkus = new Map(D.products.map(p => [p.sku, p]));
  const products = D.products.map(p => ({ ...p, channel: "amazon" }));
  for (const v of S.products) {
    const a = amazonSkus.get(v.sku);
    if (a) {   // same SKU on both: keep Amazon details, fill gaps from Shopify
      const x = products.find(p => p.sku === v.sku);
      if (!x.fbm_qty && v.fbm_qty) x.fbm_qty = v.fbm_qty;
      if (x.cogs == null && v.cogs != null) x.cogs = v.cogs;
      if (x.price == null && v.price != null) x.price = v.price;
      x.channel = "both";
    } else {
      const { variant_id, compare_at, ...p } = v;
      products.push({ ...p, channel: "shopify" });
    }
  }
  const byTime = (a, b) => new Date(b.purchased_at) - new Date(a.purchased_at);
  return {
    ...D,
    products: products.sort((a, b) => a.sku.localeCompare(b.sku)),
    daily: sumBy(D.daily, S.daily, r => day(r) + "|" + r.sku, ["units", "rev", "canc"]),
    dayOrders: sumBy(D.dayOrders, S.dayOrders, day, ["orders", "cancelled"]).map(r => ({ ...r, shopRev: shopRev.get(day(r)) || 0 })),
    dayReturns: sumBy(D.dayReturns, S.dayReturns, r => day(r) + "|" + r.sku, ["qty"]),
    hourly: sumBy(D.hourly, S.hourly, r => r.h, ["units"]),
    dowHour: sumBy(D.dowHour, S.dowHour, r => r.dow + "|" + r.h, ["orders"]),
    heat7: sumBy(D.heat7, S.heat7, r => day(r) + "|" + r.h, ["units"]),
    orders: [...D.orders, ...S.orders].sort(byTime).slice(0, 400),
    returns: [...D.returns, ...S.returns].sort((a, b) => String(b.returned_at).localeCompare(String(a.returned_at))),
    geo: sumBy(D.geo, S.geo, r => r.days + "|" + r.state, ["orders", "rev"]),
    splits: [...D.splits, ...S.splits],
    coupons: [...D.coupons, ...S.coupons],
    deals: [...D.deals, ...S.deals],
    repeat: [...D.repeat, ...S.repeat],
    links: [...D.links, ...S.products.map(v => ({ sku: v.sku, marketplace: "Shopify", external_id: v.variant_id }))],
    channels: { amazon: D.daily.length > 0 || D.products.length > 0, shopify: true }
  };
}
