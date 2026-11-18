// Every platform shown under Connections. "access" says how far the connection goes today:
//   live    – full sync built in (Amazon and Shopify; handled on the Account › Amazon and Shopify page)
//   api     – credentials are saved and checked against the platform's API ("Test connection")
//   keys    – credentials are saved securely; data sync for this platform is not built yet
//   partner – the platform gives API access only to approved partners; save seller details, use webhooks meanwhile
//   webhook – webhook-only connection
// Logos: put an official logo file at web/public/logos/<id>.svg (or .png). Without one, a lettermark is shown.

const S = (key, label, extra = {}) => ({ key, label, type: "secret", required: true, ...extra });
const T = (key, label, extra = {}) => ({ key, label, type: "text", required: true, ...extra });
const U = (key, label, extra = {}) => ({ key, label, type: "url", required: true, ...extra });

const partnerFields = [
  T("seller_id", "Seller or partner ID"),
  S("api_key", "API key (if you have one)", { required: false }),
  S("api_secret", "API secret (if you have one)", { required: false })
];
const oauthApp = [T("client_id", "Client ID"), S("client_secret", "Client secret"), S("refresh_token", "Refresh token", { required: false })];
const partner = (id, name, category, color, letters) => ({ id, name, category, color, letters, access: "partner", fields: partnerFields, webhook: "generic",
  note: `${name} gives API access to approved partners. Save your seller details now; until API access is switched on, send ${name} events to the webhook address below.` });

export const CATEGORIES = ["Indian marketplaces", "Quick commerce", "Your own store", "Global marketplaces", "Shipping and order management", "Custom connections"];

export const PLATFORMS = [
  { id: "amazon", name: "Amazon", category: "Indian marketplaces", color: "#FF9900", letters: "a", access: "live", fields: [], webhook: null,
    note: "Seller Central and Amazon Ads sync orders, inventory, returns, payments and ads automatically." },
  { id: "flipkart", name: "Flipkart", category: "Indian marketplaces", color: "#2874F0", letters: "F", access: "api", webhook: "generic",
    fields: [T("app_id", "Application ID"), S("app_secret", "Application secret")],
    note: "Create a self-access application in the Flipkart Seller API portal and paste its ID and secret." },
  partner("meesho", "Meesho", "Indian marketplaces", "#9F2089", "M"),
  partner("myntra", "Myntra", "Indian marketplaces", "#FF3F6C", "My"),
  partner("ajio", "AJIO", "Indian marketplaces", "#2C4152", "AJ"),
  partner("nykaa", "Nykaa", "Indian marketplaces", "#FC2779", "N"),
  partner("firstcry", "FirstCry", "Indian marketplaces", "#F47A20", "FC"),
  partner("jiomart", "JioMart", "Indian marketplaces", "#0078AD", "JM"),
  partner("tatacliq", "Tata CLiQ", "Indian marketplaces", "#2D2D2D", "TC"),
  partner("snapdeal", "Snapdeal", "Indian marketplaces", "#E40046", "S"),

  partner("blinkit", "Blinkit", "Quick commerce", "#F8CB46", "b"),
  partner("zepto", "Zepto", "Quick commerce", "#5A1E96", "Z"),
  partner("instamart", "Swiggy Instamart", "Quick commerce", "#FC8019", "SI"),
  partner("bigbasket", "BigBasket", "Quick commerce", "#84C225", "bb"),

  { id: "shopify", name: "Shopify", category: "Your own store", color: "#5E8E3E", letters: "S", access: "live", fields: [], webhook: null,
    note: "Orders, products, prices and stock sync every few hours, with a Shopify store page under Analytics." },
  { id: "woocommerce", name: "WooCommerce", category: "Your own store", color: "#7F54B3", letters: "Wo", access: "api", webhook: "woocommerce",
    fields: [U("store_url", "Store address", { placeholder: "https://yourstore.com" }), S("consumer_key", "Consumer key", { placeholder: "ck_…" }),
      S("consumer_secret", "Consumer secret", { placeholder: "cs_…" }), S("webhook_secret", "Webhook secret (used to verify webhooks)", { required: false })],
    note: "In WordPress: WooCommerce → Settings → Advanced → REST API → Add key with Read access." },
  { id: "bigcommerce", name: "BigCommerce", category: "Your own store", color: "#121118", letters: "BC", access: "api", webhook: "generic",
    fields: [T("store_hash", "Store hash"), S("access_token", "API access token")], note: "Create a store-level API account in BigCommerce (Settings → API) with read-only scopes." },
  { id: "magento", name: "Adobe Commerce (Magento)", category: "Your own store", color: "#EE672F", letters: "Ma", access: "api", webhook: "generic",
    fields: [U("base_url", "Store address", { placeholder: "https://yourstore.com" }), S("access_token", "Integration access token")], note: "In Magento admin: System → Extensions → Integrations → add an integration and activate it." },
  { id: "wix", name: "Wix", category: "Your own store", color: "#0C6EFC", letters: "W", access: "keys", webhook: "generic", fields: [T("site_id", "Site ID"), S("api_key", "API key")] },
  { id: "squarespace", name: "Squarespace", category: "Your own store", color: "#111111", letters: "Sq", access: "keys", webhook: "generic", fields: [S("api_key", "Commerce API key")] },
  partner("dukaan", "Dukaan", "Your own store", "#146EB4", "D"),
  { id: "zohocommerce", name: "Zoho Commerce", category: "Your own store", color: "#E42527", letters: "ZC", access: "keys", webhook: "generic", fields: oauthApp },

  { id: "ebay", name: "eBay", category: "Global marketplaces", color: "#E53238", letters: "e", access: "keys", webhook: "generic", fields: oauthApp },
  { id: "etsy", name: "Etsy", category: "Global marketplaces", color: "#F1641E", letters: "Et", access: "keys", webhook: "generic", fields: oauthApp },
  { id: "walmart", name: "Walmart Marketplace", category: "Global marketplaces", color: "#0071CE", letters: "Wm", access: "keys", webhook: "generic", fields: oauthApp },
  partner("noon", "noon", "Global marketplaces", "#FEEE00", "n"),

  { id: "shiprocket", name: "Shiprocket", category: "Shipping and order management", color: "#7A3FF2", letters: "SR", access: "api", webhook: "generic",
    fields: [T("email", "API user email"), S("password", "API user password")], note: "In Shiprocket: Settings → API → Configure → create an API user. Use that user here, not your main login." },
  { id: "delhivery", name: "Delhivery", category: "Shipping and order management", color: "#E31E24", letters: "De", access: "keys", webhook: "generic", fields: [S("api_token", "API token")] },
  partner("unicommerce", "Unicommerce", "Shipping and order management", "#1D4ED8", "U"),
  partner("easyecom", "EasyEcom", "Shipping and order management", "#0F9D58", "EE"),

  { id: "webhook_in", name: "Incoming webhook", category: "Custom connections", color: "#2F6F62", letters: "→", access: "webhook", webhook: "generic", fields: [],
    note: "Any system can send events to Pulse Navigator: POST JSON to the address below. Sign the body with the signing secret (header X-Pulse-Signature: sha256=<hex HMAC>) so Pulse Navigator can verify it." },
  { id: "webhook_out", name: "Outgoing webhook", category: "Custom connections", color: "#2F6F62", letters: "←", access: "api", webhook: null,
    fields: [U("url", "Send events to", { placeholder: "https://example.com/pulse-events" })],
    note: "Pulse Navigator sends events to this address, signed with the signing secret below (header X-Pulse-Signature). Use Test connection to send a test event." }
];

export const byId = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));
