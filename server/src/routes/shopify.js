// Shopify store page: sales, payment mix, top products, states, stock and recent orders.
import { many, one } from "../db.js";
import { requireAuth, requireOrg } from "../lib/auth.js";

const IST = "Asia/Kolkata";
// An order counts as a sale unless it was cancelled or fully refunded
const LIVE = "o.cancelled_at is null and coalesce(o.financial_status, '') <> 'REFUNDED'";

export default async function shopifyRoutes(app) {
  app.get("/api/shopify", { preHandler: requireAuth }, async (req, reply) => {
    requireOrg(req);
    reply.header("cache-control", "no-store");
    const id = req.org.id, P = (sql, extra = []) => many(sql, [id, ...extra]);
    const conn = await one("select config, status, last_sync_at, last_error from connections where org_id=$1 and kind='shopify'", [id]);
    if (!conn) return { connected: false };
    const [daily, skus, states, stock, recent, repeat, codes] = await Promise.all([
      P(`select (o.created_at at time zone '${IST}')::date as d,
                count(*) filter (where ${LIVE})::int as orders, count(*) filter (where not (${LIVE}))::int as cancelled,
                count(*) filter (where ${LIVE} and o.is_cod)::int as cod,
                coalesce(sum(o.subtotal) filter (where ${LIVE}), 0) as net, coalesce(sum(o.total - o.refunded) filter (where ${LIVE}), 0) as total,
                coalesce(sum(o.discounts) filter (where ${LIVE}), 0) as discounts, coalesce(sum(o.shipping) filter (where ${LIVE}), 0) as shipping
           from shopify_orders o where o.org_id=$1 and o.created_at >= now() - interval '120 days' group by 1 order by 1`),
      P(`select l.sku, max(l.title) as title, sum(l.quantity)::int as units, sum(l.line_total * l.quantity / nullif(l.ordered_qty, 0)) as revenue, count(distinct l.order_id)::int as orders
           from shopify_order_lines l join shopify_orders o on o.org_id = l.org_id and o.order_id = l.order_id
          where l.org_id=$1 and ${LIVE} and o.created_at >= now() - interval '30 days' group by 1 order by 4 desc nulls last limit 50`),
      P(`select coalesce(nullif(o.ship_state, ''), 'Not given') as state, count(*)::int as orders, sum(o.subtotal) as net
           from shopify_orders o where o.org_id=$1 and ${LIVE} and o.created_at >= now() - interval '30 days' group by 1 order by 2 desc`),
      P(`select v.sku, v.product_title as product, v.variant_title as variant, v.status, v.price, v.compare_at, v.inventory,
                coalesce(s.units, 0)::int as units30
           from shopify_variants v left join (
             select l.variant_id, sum(l.quantity) as units from shopify_order_lines l join shopify_orders o on o.org_id = l.org_id and o.order_id = l.order_id
              where l.org_id=$1 and ${LIVE} and o.created_at >= now() - interval '30 days' group by 1) s on s.variant_id = v.variant_id
          where v.org_id=$1 order by coalesce(s.units, 0) desc, v.product_title, v.variant_title`),
      P(`select o.name, o.created_at, o.financial_status, o.fulfillment_status, o.cancelled_at, o.is_cod, o.total, o.refunded, o.discount_codes, o.ship_city, o.ship_state,
                (select string_agg(l.quantity || ' × ' || coalesce(nullif(l.sku, ''), l.title), ', ') from shopify_order_lines l where l.org_id = o.org_id and l.order_id = o.order_id) as items
           from shopify_orders o where o.org_id=$1 order by o.created_at desc limit 60`),
      one(`select count(*)::int as customers, count(*) filter (where n > 1)::int as repeaters from (
             select customer_key, count(*) n from shopify_orders o where o.org_id=$1 and ${LIVE} and customer_key is not null and o.created_at >= now() - interval '365 days' group by 1) x`, [id]),
      P(`select code, count(*)::int as orders, sum(o.discounts) as discount, sum(o.subtotal) as net from shopify_orders o, lateral unnest(string_to_array(o.discount_codes, ', ')) code
          where o.org_id=$1 and ${LIVE} and o.created_at >= now() - interval '30 days' group by 1 order by 2 desc limit 15`)
    ]);
    return { connected: true, store: { name: conn.config.accountName, shop: conn.config.shop, domain: conn.config.domain, status: conn.status, lastSync: conn.last_sync_at, error: conn.last_error },
      daily, skus, states, stock, recent, repeat, codes };
  });
}
