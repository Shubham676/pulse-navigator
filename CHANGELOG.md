# Pulse Navigator changelog

Newest first. The version and date also show at the bottom of the app's side menu.

## 1.7.0 (18 Nov 2026)

- Profit and loss: new "Product costs" section. For each product enter raw material, packaging and marketing cost per unit. Bundles: pick the products in the bundle with quantities, plus the bundle's own packaging, raw material and marketing. A bundle's cost adds up its products' costs (from this section, or Product master when a product has none here).
- These costs replace the Product master cost for that SKU everywhere, so Profit after COGS and Profit by SKU use them. The Expenses list splits product cost into raw material, packaging, marketing and other.
- The "Edit costs" button on Profit and loss is now "Product costs" and jumps to the new section.
- New table `cost_sheets` (migration 007) and API: PUT /api/costs (add or update by SKU), DELETE /api/costs/:id. Included in /api/data as costSheets.

## 1.6.0 (18 Nov 2026)

- Profit and loss: new "Your expenses" section to enter expenses by hand (date, category, note, amount). Entries can repeat every month. They are added to the expenses list, the "where each rupee goes" bar and profit, grouped by category. Members and admins can add and delete; viewers see them.
- New table `expenses` (migration 006) and API: POST /api/expenses, DELETE /api/expenses/:id. Expenses are included in /api/data.

## 1.5.1 (18 Nov 2026)

- Deals and promotions: Shopify products are listed only when they sell below their MRP (compare-at price) and sold in the last 30 days, shown as "Shopify: N% off MRP". Stores that keep an MRP on every product no longer list every product as a deal.

## 1.5.0 (18 Nov 2026)

- Shopify data now flows into every Sales, Inventory and Business page, alongside Amazon:
  - **Sales:** Shipped orders, Cancellations, Returns (Shopify refunds), Sales analysis, Sales projection and the Overview count Shopify orders, units and revenue. A product sold on both channels is added up on the same row.
  - **Coupons:** Shopify discount codes, with orders, discount given and sales.
  - **Deals and promotions:** Shopify products on sale (price below the compare-at price), with units and revenue in the last 30 days.
  - **Repeat purchase:** Shopify repeat customers per product over the last 12 months.
  - **Inventory dashboard, Inventory projection, Product master:** Shopify products with price, cost and stock (stock counts as own warehouse). For a SKU also on Amazon, Amazon details are kept and Shopify fills in missing cost or stock.
  - **Standard report, Weekly comparison, Time sheet:** include Shopify orders.
  - **Profit and loss:** Shopify sales shown separately, with payment gateway fees estimated at 2% (Amazon fees unchanged).
- States from Shopify (province codes such as KA) are shown by name, so they combine with Amazon states.
- Variants without a SKU appear as SHOP-<variant number>.
- Shopify refunds are dated when the order last changed, because Shopify's refund date is not stored per item.
- Top bar shows "Data to <date>" for Shopify-only brands.

## 1.4.0 (18 Nov 2026)

- New page **Analytics › Sales › All orders**: every Amazon and Shopify order in one list, newest first. Filter by channel, status (open, shipped, cancelled, returned or refunded), period or custom dates (Indian time), and search by order number, SKU, product, city or state. 50 orders per page.
- Totals for the filtered orders: orders, units, sales (excluding cancelled and returned), open, cancelled and returned.
- **View** opens an order's items: prices, tax, shipping and promotions for Amazon (with any returns); line items, discounts, totals, payment and refunds for Shopify.
- **Download CSV** exports every order that matches the filters (up to 100,000).
- The old **Account › Amazon and Shopify** page is removed. Amazon and Shopify are set up from their tiles under **Connections**; old links go to Connections. The Account icon now opens Upload reports.

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
