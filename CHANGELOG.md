# Pulse Navigator changelog

Newest first. The version and date also show at the bottom of the app's side menu.

## 1.3.1 (18 Nov 2026)

- Shopify sync no longer fails when the app lacks `read_customers` or protected customer data access: it skips the customer and ship-to fields, saves everything else, and says which scope to add.
- Connection instructions list `read_customers` as an optional scope (used only for repeat customers).

## 1.3.0 (18 Nov 2026)

- New **Connections** menu in the left bar: 32 platforms in one place, grouped as Indian marketplaces, quick commerce, your own store, global marketplaces, shipping and order management, and custom connections. Search by name.
- Amazon and Shopify are marked "Live sync" and open their existing connection page (now called **Account › Amazon and Shopify**).
- Every other platform has its own page to save API credentials (stored encrypted, never shown again in full). "Test connection" checks them against the platform's API for WooCommerce, Flipkart, BigCommerce, Adobe Commerce (Magento), Shiprocket and outgoing webhooks.
- Every connection gets its own webhook address. WooCommerce signatures are verified; other platforms can sign with the connection's signing secret (header X-Pulse-Signature). Events are listed under Connections › Webhook events.
- Incoming webhook (any system) and outgoing webhook (Pulse sends signed events to your URL).
- Logos: add official logo files as web/public/logos/<platform>.svg; until then each platform shows a lettermark.

## 1.2.0 (18 Nov 2026)

- Shopify connection (Account › Connections). Connect with a Shopify Dev Dashboard app's client ID and secret (client credentials grant, token renewed every 24 hours), or an older custom app's `shpat_` token. Read only.
- Syncs every few hours: orders with line items, discounts, shipping, tax, refunds, cancellations and COD or prepaid; all product variants with price, MRP, cost and stock. First sync goes back a year (needs `read_all_orders`, otherwise 60 days); later syncs fetch only changed orders.
- New page Analytics › Own store › Shopify store: net sales, orders, average order, COD share, daily sales, top products, payment mix, discount codes, orders by state, repeat customers, products with days of stock, recent orders.
- Shopify SKUs that match Amazon SKUs are linked in the product master.
- "Amazon connections" renamed "Connections" (renamed "Amazon and Shopify" in 1.3.0).

## 1.1.1 (18 Nov 2026)

- Fixed "Request failed (502)" when signing in after the app had been idle: Render's free server sleeps after 15 minutes, and requests failed while it woke up.
- The Cloudflare Worker now pings the server every 10 minutes so it stays awake, and waits up to 90 seconds (retrying) if it is still waking.
- If the server is starting up, the app now says so instead of showing an error code.

## 1.1.0 (18 Nov 2026)

- Left menu: each icon now shows its name underneath (Copilot, AI agents, Analytics, Ads, Account), replacing the hover pop-up that covered the side menu.
- Version number and update date shown at the bottom of the side menu, and returned by `/healthz`.

## 1.0.0 (18 Nov 2026)

- First live release at www.dumbledo.com/pulse-navigator.
- App server on Render (free plan), database on Supabase (Mumbai), Cloudflare Worker serving the `/pulse-navigator` path; the rest of www.dumbledo.com stays on Shopify.
- App works under a path prefix (relative links, cookies scoped to `/pulse-navigator`).
