// One call that returns everything the Sellers pages need for the current brand.
// Heavy lifting is done in SQL; the browser does the period comparisons and charts.
import { many, one } from "../db.js";
import { requireAuth, requireOrg } from "../lib/auth.js";
import { shopifyFeed, mergeShopify } from "./shopify-feed.js";

const IST = "Asia/Kolkata";

export async function loadData(org) {
  const id = org.id;
  const P = (sql, extra = []) => many(sql, [id, ...extra]);
  const [products, daily, dayOrders, dayReturns, hourly, dowHour, heat7, orders, returns, geo, splits,
    campaigns, adDaily, terms, placements, coupons, deals, health, txBuckets, txSku, repeat, traffic, trafficDay, imports, trackers, dayparts, memory, changes, negatives, links, conns] = await Promise.all([
    P(`select sku, asin, name, category, price, cogs, images, bullets, has_aplus, rating, reviews, status, suppressed_reason, fba_qty, fbm_qty, inventory_as_of, title_length from products where org_id=$1 order by sku`),
    P(`select (oi.purchased_at at time zone '${IST}')::date as d, oi.sku,
              sum(oi.quantity) filter (where oi.status <> 'Cancelled')::int as units,
              sum(case when oi.item_price > 0 then oi.item_price else oi.quantity * coalesce(p.price, 0) end) filter (where oi.status <> 'Cancelled') as rev,
              sum(oi.quantity) filter (where oi.status = 'Cancelled')::int as canc
         from order_items oi left join products p on p.org_id = oi.org_id and p.sku = oi.sku
        where oi.org_id=$1 and oi.purchased_at >= now() - interval '400 days' group by 1, 2`),
    P(`select (purchased_at at time zone '${IST}')::date as d, count(distinct order_id) filter (where status <> 'Cancelled')::int as orders,
              count(distinct order_id) filter (where status = 'Cancelled')::int as cancelled
         from order_items where org_id=$1 and purchased_at >= now() - interval '400 days' group by 1`),
    P(`select returned_at as d, sku, sum(quantity)::int as qty from returns where org_id=$1 and returned_at >= (now() - interval '400 days')::date group by 1, 2`),
    P(`select extract(hour from purchased_at at time zone '${IST}')::int as h, sum(quantity)::int as units from order_items where org_id=$1 and status <> 'Cancelled' and purchased_at >= now() - interval '30 days' group by 1`),
    P(`select extract(isodow from purchased_at at time zone '${IST}')::int as dow, extract(hour from purchased_at at time zone '${IST}')::int as h, count(distinct order_id)::int as orders
         from order_items where org_id=$1 and status <> 'Cancelled' and purchased_at >= now() - interval '60 days' group by 1, 2`),
    P(`select (purchased_at at time zone '${IST}')::date as d, extract(hour from purchased_at at time zone '${IST}')::int as h, sum(quantity)::int as units
         from order_items where org_id=$1 and status <> 'Cancelled' and purchased_at >= date_trunc('day', now() at time zone '${IST}') at time zone '${IST}' - interval '6 days' group by 1, 2`),
    P(`select order_id, sku, purchased_at, status, fulfillment, ship_service, quantity, item_price, item_tax, shipping_price, promo_discount, ship_state, ship_city, is_business
         from order_items where org_id=$1 order by purchased_at desc limit 400`),
    P(`select r.order_id, r.sku, r.returned_at, r.quantity, r.reason, r.status, r.carrier, r.label_paid_by, r.a_to_z,
              coalesce(r.refund_amount, oi.item_price / nullif(oi.quantity, 0) * r.quantity) as refund, oi.ship_state
         from returns r left join order_items oi on oi.org_id = r.org_id and oi.order_id = r.order_id and oi.sku = r.sku
        where r.org_id=$1 and r.returned_at >= (now() - interval '120 days')::date order by r.returned_at desc`),
    P(`select w.days, coalesce(nullif(oi.ship_state, ''), 'Not given') as state, count(distinct oi.order_id)::int as orders, sum(oi.item_price) as rev
         from (values (1), (7), (30), (60)) w(days) join order_items oi on oi.org_id=$1 and oi.status <> 'Cancelled' and oi.purchased_at >= now() - (w.days || ' days')::interval
        group by 1, 2`),
    P(`select w.days, oi.fulfillment, oi.is_business, count(distinct oi.order_id)::int as orders
         from (values (1), (7), (30), (60)) w(days) join order_items oi on oi.org_id=$1 and oi.status <> 'Cancelled' and oi.purchased_at >= now() - (w.days || ' days')::interval
        group by 1, 2, 3`),
    P(`select c.campaign_id as id, c.name, c.ad_type as type, c.sku, c.daily_budget as budget, c.status, c.starts_on as start, c.bid_adjust_pct as "bidAdj", c.remote, c.portfolio,
              coalesce(sum(a.impressions) filter (where a.day > current_date - 31), 0)::int as impressions, coalesce(sum(a.clicks) filter (where a.day > current_date - 31), 0)::int as clicks,
              coalesce(sum(a.spend) filter (where a.day > current_date - 31), 0) as spend, coalesce(sum(a.sales) filter (where a.day > current_date - 31), 0) as sales,
              coalesce(sum(a.orders) filter (where a.day > current_date - 31), 0)::int as orders,
              coalesce(sum(a.spend) filter (where a.day <= current_date - 31), 0) as "prevSpend", coalesce(sum(a.sales) filter (where a.day <= current_date - 31), 0) as "prevSales",
              min(a.day) as "firstDay", max(a.day) as "lastDay"
         from campaigns c left join ad_daily a on a.org_id = c.org_id and a.campaign_id = c.campaign_id and a.day > current_date - 62
        where c.org_id=$1 group by c.campaign_id, c.name, c.ad_type, c.sku, c.daily_budget, c.status, c.starts_on, c.bid_adjust_pct, c.remote, c.portfolio order by c.name`),
    P(`select day as d, sum(impressions)::int as impressions, sum(clicks)::int as clicks, sum(spend) as spend, sum(sales) as sales, sum(orders)::int as orders
         from ad_daily where org_id=$1 and day > current_date - 62 group by 1 order by 1`),
    P(`select campaign_id as camp, ad_group, targeting, match_type as match, search_term as term, sum(impressions)::int as impressions, sum(clicks)::int as clicks, sum(spend) as spend, sum(sales) as sales, sum(orders)::int as orders
         from ad_terms where org_id=$1 and day > current_date - 31 group by 1, 2, 3, 4, 5 order by sum(spend) desc limit 3000`),
    P(`select campaign_id as camp, placement, sum(impressions)::int as impressions, sum(clicks)::int as clicks, sum(spend) as spend, sum(sales) as sales, sum(orders)::int as orders
         from ad_placements where org_id=$1 and day > current_date - 31 group by 1, 2`),
    P(`select coupon_id as id, name, discount_type as type, discount as disc, budget, spent, clips, redemptions, sales, starts_on as start, ends_on as "end" from coupons where org_id=$1 order by ends_on desc nulls last`),
    P(`select deal_id as id, type, sku, starts_at as start, ends_at as "end", glance_views as views, units, revenue as rev, status from deals where org_id=$1 order by starts_at desc nulls last`),
    one(`select as_of, source, metrics from account_health where org_id=$1 order by as_of desc limit 1`, [id]),
    P(`select type, (description ilike '%advertis%') as ads, (type ilike '%storage%' or description ilike '%storage%') as storage,
              sum(product_sales) as product_sales, sum(shipping_credits) as shipping_credits, sum(promo_rebates) as promo_rebates, sum(selling_fees) as selling_fees,
              sum(fba_fees) as fba_fees, sum(other_fees) as other_fees, sum(tax_withheld) as tax_withheld, sum(other) as other, sum(total) as total, count(*)::int as n,
              min(posted_at) as first, max(posted_at) as last
         from transactions where org_id=$1 and posted_at >= now() - interval '30 days' group by 1, 2, 3`),
    P(`select sku, sum(product_sales) filter (where type = 'Order') as sales, sum(product_sales) filter (where type = 'Refund') as refunds,
              sum(selling_fees + fba_fees + other_fees) as fees, sum(quantity) filter (where type = 'Order')::int as units
         from transactions where org_id=$1 and sku is not null and posted_at >= now() - interval '30 days' group by 1`),
    P(`select asin, title, orders, unique_customers, repeat_customers_pct, repeat_revenue, repeat_revenue_pct, period_end from repeat_purchase where org_id=$1 and period_end = (select max(period_end) from repeat_purchase where org_id=$1)`),
    P(`select sku, sum(sessions)::int as sessions, sum(page_views)::int as page_views, avg(buy_box_pct) as buy_box from traffic_daily where org_id=$1 and sku <> '__all__' and day > current_date - 30 group by 1`),
    P(`select day as d, sum(sessions)::int as sessions from traffic_daily where org_id=$1 and day > current_date - 60 and sku = (case when exists (select 1 from traffic_daily where org_id=$1 and sku='__all__') then '__all__' else sku end) group by 1 order by 1`),
    P(`select distinct on (report) report, created_at, source from imports where org_id=$1 and status='done' order by report, id desc`),
    P(`select id, name, metric, op, value as val, frequency as freq, range_days, level, enabled as on from trackers where org_id=$1 order by id`),
    P(`select id, campaign_id as camp, days, hours_off as hours from dayparts where org_id=$1 order by id`),
    P(`select id, fact from copilot_memory where org_id=$1 order by id`),
    P(`select c.created_at as at, c.action, c.detail, c.pushed, c.push_error, u.name as by from ad_changes c left join users u on u.id = c.user_id where c.org_id=$1 order by c.id desc limit 40`),
    P(`select campaign_id as camp, keyword, match_type from negative_keywords where org_id=$1`),
    P(`select sku, marketplace, external_id from product_links where org_id=$1`),
    P(`select kind, status, last_sync_at, last_error, config from connections where org_id=$1`)
  ]);
  const shop = await shopifyFeed(id);
  const orgRow = await one("select name, marketplace, target_acos, fee_rate, wallet_paise, billing_name, billing_gstin, billing_state_code, billing_address from orgs where id=$1", [id]);
  return mergeShopify({
    asOf: new Date().toISOString(),
    org: { id, name: orgRow.name, marketplace: orgRow.marketplace, targetAcos: orgRow.target_acos, feeRate: orgRow.fee_rate, wallet: orgRow.wallet_paise / 100,
      billing: { name: orgRow.billing_name, gstin: orgRow.billing_gstin, stateCode: orgRow.billing_state_code, address: orgRow.billing_address } },
    products, daily, dayOrders, dayReturns, hourly, dowHour, heat7, orders, returns, geo, splits,
    campaigns, adDaily, terms, placements, coupons, deals, health, txBuckets, txSku, repeat, traffic, trafficDay, imports, trackers, dayparts, memory, changes, negatives, links,
    connections: conns.map(c => ({ kind: c.kind, status: c.status, lastSync: c.last_sync_at, error: c.last_error, account: c.config?.accountName || null })),
    channels: { amazon: daily.length > 0 || products.length > 0, shopify: false }
  }, shop);
}

export default async function dataRoutes(app) {
  app.get("/api/data", { preHandler: requireAuth }, async (req, reply) => {
    requireOrg(req);
    reply.header("cache-control", "no-store");
    return loadData(req.org);
  });
}
