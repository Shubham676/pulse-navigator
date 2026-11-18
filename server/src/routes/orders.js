// All orders: Amazon (order report / SP-API) and Shopify orders in one list, newest first.
// Status is normalised to: open, shipped, cancelled, returned (Amazon return or Shopify refund).
import { z } from "zod";
import { one, many } from "../db.js";
import { requireAuth, requireOrg, HttpError } from "../lib/auth.js";

const Q = z.object({
  channel: z.enum(["all", "amazon", "shopify"]).default("all"),
  status: z.enum(["all", "open", "shipped", "cancelled", "returned"]).default("all"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce.number().int().min(10).max(200).default(50),
  format: z.enum(["json", "csv"]).default("json")
});

// One row per order from each channel; $1 org, $2 from date, $3 to date (IST calendar days, inclusive)
const ORDERS = `
with amz as (
  select 'amazon'::text as channel, oi.order_id as id, oi.order_id as order_no, min(oi.purchased_at) as placed_at,
    case when bool_and(oi.status = 'Cancelled') then 'cancelled'
         when exists (select 1 from returns r where r.org_id = oi.org_id and r.order_id = oi.order_id) then 'returned'
         when bool_or(oi.status in ('Shipped', 'Shipping', 'Delivered')) then 'shipped'
         else 'open' end as status,
    string_agg(distinct oi.status, ', ') as detail,
    max(oi.fulfillment) as fulfillment, null::text as payment,
    sum(oi.quantity)::int as units, sum(oi.item_price) as amount,
    string_agg(oi.sku, ', ' order by oi.sku) as items,
    max(oi.ship_city) as city, max(oi.ship_state) as state
  from order_items oi
  where oi.org_id = $1 and ($2::date is null or oi.purchased_at >= ($2::date::timestamp at time zone 'Asia/Kolkata'))
    and ($3::date is null or oi.purchased_at < (($3::date + 1)::timestamp at time zone 'Asia/Kolkata'))
  group by oi.org_id, oi.order_id
),
shp as (
  select 'shopify'::text, o.order_id, o.name, o.created_at,
    case when o.cancelled_at is not null then 'cancelled'
         when coalesce(o.financial_status, '') = 'REFUNDED' or (o.refunded > 0 and o.refunded >= o.total) then 'returned'
         when o.fulfillment_status = 'FULFILLED' then 'shipped'
         else 'open' end,
    concat_ws(' · ', initcap(replace(lower(o.financial_status), '_', ' ')), initcap(replace(lower(o.fulfillment_status), '_', ' '))),
    null::text, case when o.is_cod then 'COD' else 'Prepaid' end,
    coalesce(l.units, 0), o.total, l.items, o.ship_city, o.ship_state
  from shopify_orders o
  left join lateral (select sum(x.quantity)::int as units, string_agg(coalesce(nullif(x.sku, ''), x.title), ', ' order by x.sku) as items
                     from shopify_order_lines x where x.org_id = o.org_id and x.order_id = o.order_id) l on true
  where o.org_id = $1 and ($2::date is null or o.created_at >= ($2::date::timestamp at time zone 'Asia/Kolkata'))
    and ($3::date is null or o.created_at < (($3::date + 1)::timestamp at time zone 'Asia/Kolkata'))
),
allo as (select * from amz union all select * from shp)
select * from allo
where ($4::text = 'all' or channel = $4) and ($5::text = 'all' or status = $5)
  and ($6::text is null or order_no ilike $6 or items ilike $6 or city ilike $6 or state ilike $6)`;

const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default async function orderRoutes(app) {
  app.get("/api/orders", { preHandler: requireAuth }, async (req, reply) => {
    requireOrg(req);
    const f = Q.parse(req.query || {});
    if (f.from && f.to && f.from > f.to) throw new HttpError(400, "The start date is after the end date.");
    const args = [req.org.id, f.from || null, f.to || null, f.channel, f.status, f.q ? `%${f.q.replace(/[\\%_]/g, m => "\\" + m)}%` : null];

    if (f.format === "csv") {
      const rows = await many(`${ORDERS} order by placed_at desc limit 100000`, args);
      const head = ["Channel", "Order", "Placed (IST)", "Status", "Channel status", "Fulfilment", "Payment", "Units", "Amount (INR)", "Items", "City", "State"];
      const ist = d => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
      const body = [head, ...rows.map(r => [r.channel === "amazon" ? "Amazon" : "Shopify", r.order_no, ist(r.placed_at), r.status, r.detail, r.fulfillment, r.payment, r.units, Number(r.amount || 0).toFixed(2), r.items, r.city, r.state])]
        .map(r => r.map(csvCell).join(",")).join("\n");
      reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="orders-${f.from || "all"}-to-${f.to || "today"}.csv"`);
      return "﻿" + body;
    }

    const [rows, sum, channels] = await Promise.all([
      many(`${ORDERS} order by placed_at desc, order_no limit ${f.size} offset ${(f.page - 1) * f.size}`, args),
      one(`select count(*)::int as orders, coalesce(sum(units), 0)::int as units,
              coalesce(sum(amount) filter (where status not in ('cancelled', 'returned')), 0) as amount,
              count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'shipped')::int as shipped,
              count(*) filter (where status = 'cancelled')::int as cancelled, count(*) filter (where status = 'returned')::int as returned,
              count(*) filter (where channel = 'amazon')::int as amazon, count(*) filter (where channel = 'shopify')::int as shopify
            from (${ORDERS}) t`, args),
      one(`select exists (select 1 from order_items where org_id = $1) as amazon, exists (select 1 from shopify_orders where org_id = $1) as shopify`, [req.org.id])
    ]);
    return { orders: rows, page: f.page, size: f.size, total: sum.orders, summary: sum, channels };
  });

  // The items in one order
  app.get("/api/orders/:channel/:id", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const { channel, id } = req.params;
    if (channel === "amazon") {
      const lines = await many(`select oi.sku, coalesce(p.name, '') as title, oi.quantity, oi.item_price as amount, oi.item_tax as tax, oi.shipping_price as shipping,
          oi.promo_discount as discount, oi.status, oi.fulfillment, oi.ship_service, oi.purchased_at
        from order_items oi left join products p on p.org_id = oi.org_id and p.sku = oi.sku
        where oi.org_id = $1 and oi.order_id = $2 order by oi.sku`, [req.org.id, id]);
      if (!lines.length) throw new HttpError(404, "Order not found.");
      const returns = await many("select sku, returned_at, quantity, refund_amount, reason from returns where org_id = $1 and order_id = $2 order by returned_at", [req.org.id, id]);
      return { channel, orderNo: id, lines, returns };
    }
    if (channel === "shopify") {
      const o = await one(`select name, created_at, financial_status, fulfillment_status, cancelled_at, payment, is_cod, subtotal, shipping, tax, discounts, total, refunded,
          discount_codes, ship_city, ship_state, ship_postal from shopify_orders where org_id = $1 and order_id = $2`, [req.org.id, id]);
      if (!o) throw new HttpError(404, "Order not found.");
      const lines = await many(`select sku, title, quantity, ordered_qty, unit_price, line_total as amount, discount, tax
        from shopify_order_lines where org_id = $1 and order_id = $2 order by sku`, [req.org.id, id]);
      return { channel, orderNo: o.name, order: o, lines };
    }
    throw new HttpError(404, "Unknown channel.");
  });
}
