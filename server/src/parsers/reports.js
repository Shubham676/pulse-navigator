// Every report Pulse Navigator understands: how to recognise it from its column headers, and how to save it.
// The same save functions are used for manual uploads and for files pulled through the Amazon APIs.
import { bulkUpsert } from "../db.js";
import { money, int, parseDate, istDay, yes, hash, pick, pickRe } from "./util.js";

const has = (h, ...cols) => cols.every(c => h.has(c));
const any = (h, ...cols) => cols.some(c => h.has(c));
const today = () => istDay(new Date());
const span = days => days.length ? { from: days.reduce((a, b) => (a < b ? a : b)), to: days.reduce((a, b) => (a > b ? a : b)) } : {};

async function touchProducts(c, orgId, list) {
  // list: [{sku, asin, name}] ; fills blanks, never overwrites a name the seller already has
  const m = new Map();
  for (const p of list) if (p.sku) m.set(p.sku, { ...m.get(p.sku), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) });
  const rows = [...m.values()].map(p => [orgId, p.sku, p.asin || null, (p.name || "").slice(0, 500)]);
  if (!rows.length) return;
  const chunk = 2000;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk), params = [];
    const vals = part.map(r => "(" + r.map(v => { params.push(v); return "$" + params.length; }).join(",") + ")").join(",");
    await c.query(`insert into products (org_id, sku, asin, name) values ${vals}
      on conflict (org_id, sku) do update set asin = coalesce(products.asin, excluded.asin),
        name = case when products.name = '' then excluded.name else products.name end, updated_at = now()`, params);
  }
}

const orderStatus = s => { s = String(s || "").toLowerCase(); return s.includes("cancel") ? "Cancelled" : s.startsWith("shipped") || s === "shipping" ? "Shipped" : s.includes("pending") ? "Pending" : s.includes("unshipped") ? "Unshipped" : s ? s[0].toUpperCase() + s.slice(1) : "Unknown"; };
const reasonText = r => { r = String(r || "").trim(); if (!r) return "Not given"; if (/^[A-Z_]+$/.test(r)) { r = r.replace(/_/g, " ").toLowerCase(); r = r[0].toUpperCase() + r.slice(1); } return r; };

function adTypeOf(opts, headers) {
  if (opts.adType && ["SP", "SB", "SD"].includes(opts.adType)) return opts.adType;
  const f = (opts.filename || "").toLowerCase();
  if (/sponsored[_ -]?brands|\bsb[_ -]|_sb_|headline/.test(f)) return "SB";
  if (/sponsored[_ -]?display|\bsd[_ -]|_sd_/.test(f)) return "SD";
  if (headers.has("tactic") || headers.has("costtype") || headers.has("bidoptimization")) return "SD";
  if (headers.has("adformat") || headers.has("14daydetailpageviewsdpv") && !headers.has("7daytotalsales")) return "SB";
  return "SP";
}
const adSales = r => money(pickRe(r, /^\d+daytotalsales/) || pick(r, "sales", "totalsales", "attributedsales"));
const adOrders = r => int(pickRe(r, /^\d+daytotalorders/) || pick(r, "orders", "totalorders", "purchases"));
const adUnits = r => int(pickRe(r, /^\d+daytotalunits/) || pick(r, "units", "unitssold"));
const campId = r => String(pick(r, "campaignid") || "") || "n:" + hash(String(pick(r, "campaignname")).toLowerCase());
function adDay(r, opts) {
  const d = parseDate(pick(r, "date", "day", "enddate", "startdate"));
  return d ? istDay(d) : opts.periodEnd || today();
}
async function upsertCampaigns(c, orgId, rows, type, opts) {
  const m = new Map();
  for (const r of rows) {
    const name = String(pick(r, "campaignname")).trim(); if (!name) continue;
    const id = campId(r), st = String(pick(r, "campaignstatus", "status", "state")).toLowerCase();
    const prev = m.get(id) || {};
    m.set(id, { id, name, type, portfolio: pick(r, "portfolioname") || prev.portfolio || null,
      status: st ? (/(paused|archived|ended|incomplete)/.test(st) ? "Paused" : "Live") : prev.status || null,
      budget: money(pick(r, "budget", "budgetamount", "campaignbudgetamount", "dailybudget")) || prev.budget || null,
      start: (parseDate(pick(r, "campaignstartdate")) ? istDay(parseDate(pick(r, "campaignstartdate"))) : null) || prev.start || null });
  }
  for (const v of m.values()) {
    await c.query(`insert into campaigns (org_id, campaign_id, name, ad_type, status, daily_budget, starts_on, portfolio)
      values ($1,$2,$3,$4,coalesce($5,'Live'),$6,$7,$8)
      on conflict (org_id, campaign_id) do update set name=excluded.name, ad_type=excluded.ad_type,
        status=coalesce($5, campaigns.status), daily_budget=coalesce($6, campaigns.daily_budget),
        starts_on=coalesce(campaigns.starts_on, $7), portfolio=coalesce($8, campaigns.portfolio), updated_at=now()`,
      [orgId, v.id, v.name, v.type, v.status, v.budget, v.start, v.portfolio]);
  }
  return m.size;
}

export const REPORTS = [
  {
    id: "orders", label: "All Orders report", group: "Sales",
    how: "Seller Central > Reports > Fulfilment > All Orders. Pick 'Order date', the last 30 to 90 days, and download.",
    detect: h => has(h, "amazonorderid", "sku", "purchasedate") && any(h, "itemprice", "quantity"),
    async save(c, orgId, rows) {
      const agg = new Map(), prods = [];
      for (const r of rows) {
        const id = pick(r, "amazonorderid"), sku = pick(r, "sku"), at = parseDate(pick(r, "purchasedate"));
        if (!id || !sku || !at) continue;
        const k = id + "\u0000" + sku, p = agg.get(k);
        const v = { quantity: int(pick(r, "quantity", "quantitypurchased")), price: money(pick(r, "itemprice")), tax: money(pick(r, "itemtax")), ship: money(pick(r, "shippingprice")), promo: Math.abs(money(pick(r, "itempromotiondiscount"))) };
        if (p) { p.quantity += v.quantity; p.price += v.price; p.tax += v.tax; p.ship += v.ship; p.promo += v.promo; continue; }
        agg.set(k, { id, sku, at, status: orderStatus(pick(r, "orderstatus", "itemstatus")), fulfillment: /amazon|afn/i.test(pick(r, "fulfillmentchannel")) ? "Amazon" : "Merchant",
          shipService: pick(r, "shipservicelevel"), ...v, city: pick(r, "shipcity"), state: titleCase(pick(r, "shipstate")), postal: pick(r, "shippostalcode"),
          business: yes(pick(r, "isbusinessorder")), promos: pick(r, "promotionids") || null });
        prods.push({ sku, asin: pick(r, "asin"), name: pick(r, "productname") });
      }
      await touchProducts(c, orgId, prods);
      const out = [...agg.values()];
      const n = await bulkUpsert(c, "order_items",
        ["org_id", "order_id", "sku", "purchased_at", "status", "fulfillment", "ship_service", "quantity", "item_price", "item_tax", "shipping_price", "promo_discount", "ship_city", "ship_state", "ship_postal", "is_business", "promotion_ids"],
        out.map(o => [orgId, o.id, o.sku, o.at, o.status, o.fulfillment, o.shipService, o.quantity, o.price, o.tax, o.ship, o.promo, o.city, o.state, o.postal, o.business, o.promos]),
        ["org_id", "order_id", "sku"], ["purchased_at", "status", "fulfillment", "ship_service", "quantity", "item_price", "item_tax", "shipping_price", "promo_discount", "ship_city", "ship_state", "ship_postal", "is_business", "promotion_ids"]);
      return { saved: n, ...span(out.map(o => istDay(o.at))) };
    }
  },
  {
    id: "fba_inventory", label: "FBA inventory report", group: "Inventory",
    how: "Seller Central > Reports > Fulfilment > Manage FBA Inventory. Download as a text file.",
    detect: h => has(h, "sku") && any(h, "afnfulfillablequantity", "afnwarehousequantity"),
    async save(c, orgId, rows) {
      const prods = rows.filter(r => pick(r, "sku")).map(r => ({ sku: pick(r, "sku"), asin: pick(r, "asin"), name: pick(r, "productname") }));
      await touchProducts(c, orgId, prods);
      let n = 0;
      for (const r of rows) {
        const sku = pick(r, "sku"); if (!sku) continue;
        const fbm = yes(pick(r, "mfnlistingexists")) ? int(pick(r, "mfnfulfillablequantity")) : null;
        await c.query(`update products set fba_qty=$3, fbm_qty=coalesce($4, fbm_qty), price=coalesce(nullif($5,0)::numeric, price), inventory_as_of=$6, updated_at=now() where org_id=$1 and sku=$2`,
          [orgId, sku, int(pick(r, "afnfulfillablequantity")), fbm, money(pick(r, "yourprice")), today()]);
        n++;
      }
      return { saved: n };
    }
  },
  {
    id: "listings", label: "All Listings report", group: "Inventory",
    how: "Seller Central > Inventory > Inventory Reports > All Listings Report. Request it and download when ready.",
    detect: h => has(h, "sellersku") && any(h, "itemname", "productname") && any(h, "asin1", "asin", "productid") && !any(h, "bulletpoint1"),
    async save(c, orgId, rows) {
      await touchProducts(c, orgId, rows.map(r => ({ sku: pick(r, "sellersku"), asin: pick(r, "asin1", "asin", "productid"), name: pick(r, "itemname", "productname") })));
      let n = 0;
      for (const r of rows) {
        const sku = pick(r, "sellersku"); if (!sku) continue;
        const merchant = !/amazon|afn/i.test(pick(r, "fulfillmentchannel")), st = pick(r, "status");
        await c.query(`update products set price=coalesce(nullif($3,0)::numeric, price), fbm_qty=case when $4 then $5 else fbm_qty end,
            status=case when status='Suppressed' then status when $6<>'' then $6 else status end, title_length=$7, updated_at=now() where org_id=$1 and sku=$2`,
          [orgId, sku, money(pick(r, "price")), merchant, int(pick(r, "quantity")), st ? titleCase(st) : "", String(pick(r, "itemname", "productname")).length]);
        n++;
      }
      return { saved: n };
    }
  },
  {
    id: "catalog", label: "Category listings report (listing content)", group: "Inventory",
    how: "Seller Central > Inventory > Inventory Reports > Category Listings Report. Gives titles, bullets and images, used for listing scores.",
    detect: h => any(h, "bulletpoint1", "mainimageurl") && any(h, "itemsku", "sellersku", "sku"),
    async save(c, orgId, rows) {
      await touchProducts(c, orgId, rows.map(r => ({ sku: pick(r, "itemsku", "sellersku", "sku"), asin: pick(r, "asin", "externalproductid"), name: pick(r, "itemname", "productname", "title") })));
      let n = 0;
      for (const r of rows) {
        const sku = pick(r, "itemsku", "sellersku", "sku"); if (!sku) continue;
        const bullets = [1, 2, 3, 4, 5, 6].filter(i => pick(r, "bulletpoint" + i)).length;
        const images = (pick(r, "mainimageurl") ? 1 : 0) + [1, 2, 3, 4, 5, 6, 7, 8].filter(i => pick(r, "otherimageurl" + i, "otherimageurl" + i + "1")).length;
        await c.query(`update products set bullets=$3, images=$4, title_length=$5, description_length=$6, category=coalesce(category, nullif($7,'')), updated_at=now() where org_id=$1 and sku=$2`,
          [orgId, sku, bullets, images, String(pick(r, "itemname", "productname", "title")).length, String(pick(r, "productdescription", "description")).length, pick(r, "itemtype", "producttype", "feedproducttype")]);
        n++;
      }
      return { saved: n };
    }
  },
  {
    id: "fba_returns", label: "FBA customer returns report", group: "Returns",
    how: "Seller Central > Reports > Fulfilment > Customer Returns (under Customer Concessions).",
    detect: h => has(h, "returndate", "orderid", "sku") && any(h, "detaileddisposition", "fulfillmentcenterid"),
    async save(c, orgId, rows) {
      const out = new Map();
      for (const r of rows) {
        const d = parseDate(pick(r, "returndate")), id = pick(r, "orderid"), sku = pick(r, "sku");
        if (!d || !id || !sku) continue;
        const k = [id, sku, istDay(d)].join("|"), p = out.get(k);
        if (p) { p[4] += int(pick(r, "quantity")) || 1; continue; }
        out.set(k, [orgId, id, sku, istDay(d), int(pick(r, "quantity")) || 1, null, reasonText(pick(r, "reason")), titleCase(pick(r, "status")), null, null, null]);
      }
      const n = await bulkUpsert(c, "returns", ["org_id", "order_id", "sku", "returned_at", "quantity", "refund_amount", "reason", "status", "carrier", "label_paid_by", "a_to_z"], [...out.values()],
        ["org_id", "order_id", "sku", "returned_at"], ["quantity", "reason", "status"]);
      return { saved: n, ...span([...out.values()].map(r => r[3])) };
    }
  },
  {
    id: "mfn_returns", label: "Seller-fulfilled returns report", group: "Returns",
    how: "Seller Central > Orders > Manage Returns > Download returns report (or Reports > Return Reports).",
    detect: h => has(h, "orderid", "returnrequestdate") && any(h, "merchantsku", "sku"),
    async save(c, orgId, rows) {
      const out = new Map();
      for (const r of rows) {
        const d = parseDate(pick(r, "returnrequestdate")), id = pick(r, "orderid"), sku = pick(r, "merchantsku", "sku");
        if (!d || !id || !sku) continue;
        out.set([id, sku, istDay(d)].join("|"), [orgId, id, sku, istDay(d), int(pick(r, "returnquantity")) || 1, money(pick(r, "refundedamount")) || null,
          reasonText(pick(r, "returnreason")), titleCase(pick(r, "returnrequeststatus")), pick(r, "returncarrier") || null, pick(r, "labeltobepaidby") || null, yes(pick(r, "atozclaim"))]);
      }
      const n = await bulkUpsert(c, "returns", ["org_id", "order_id", "sku", "returned_at", "quantity", "refund_amount", "reason", "status", "carrier", "label_paid_by", "a_to_z"], [...out.values()],
        ["org_id", "order_id", "sku", "returned_at"], ["quantity", "refund_amount", "reason", "status", "carrier", "label_paid_by", "a_to_z"]);
      return { saved: n, ...span([...out.values()].map(r => r[3])) };
    }
  },
  {
    id: "suppressed", label: "Suppressed listings", group: "Inventory",
    how: "Seller Central > Inventory > Manage All Inventory > Suppressed tab > Download. This file replaces the previous suppressed list.",
    detect: h => any(h, "sku", "sellersku") && any(h, "issuedescription", "suppressionreason", "alertname", "issue", "reasonforsuppression"),
    async save(c, orgId, rows) {
      await c.query("update products set status=null, suppressed_reason=null where org_id=$1 and status='Suppressed'", [orgId]);
      await touchProducts(c, orgId, rows.map(r => ({ sku: pick(r, "sku", "sellersku"), asin: pick(r, "asin"), name: pick(r, "productname", "itemname", "title") })));
      let n = 0;
      for (const r of rows) {
        const sku = pick(r, "sku", "sellersku"); if (!sku) continue;
        await c.query("update products set status='Suppressed', suppressed_reason=$3, updated_at=now() where org_id=$1 and sku=$2",
          [orgId, sku, String(pick(r, "issuedescription", "suppressionreason", "alertname", "issue", "reasonforsuppression")).slice(0, 400)]);
        n++;
      }
      return { saved: n };
    }
  },
  {
    id: "business_child", label: "Business Report: sales and traffic by child item", group: "Traffic",
    how: "Seller Central > Reports > Business Reports > Detail Page Sales and Traffic By Child Item. Choose the date range, then enter the same range here.",
    needsPeriod: true,
    detect: h => any(h, "childasin") && any(h, "sessionstotal", "sessions"),
    async save(c, orgId, rows, opts) {
      await touchProducts(c, orgId, rows.map(r => ({ sku: pick(r, "sku"), asin: pick(r, "childasin"), name: pick(r, "title") })));
      const days = dayRange(opts.periodStart, opts.periodEnd), out = [];
      for (const r of rows) {
        const sku = pick(r, "sku") || pick(r, "childasin"); if (!sku) continue;
        const s = int(pick(r, "sessionstotal", "sessions")), pv = int(pick(r, "pageviewstotal", "pageviews")), bb = money(pick(r, "featuredofferbuyboxpercentage", "buyboxpercentage")) || null;
        // A range report has no daily split, so the totals are spread evenly over the days in the range
        days.forEach((d, i) => out.push([orgId, d, sku, share(s, days.length, i), share(pv, days.length, i), bb]));
      }
      const n = await bulkUpsert(c, "traffic_daily", ["org_id", "day", "sku", "sessions", "page_views", "buy_box_pct"], out, ["org_id", "day", "sku"], ["sessions", "page_views", "buy_box_pct"]);
      return { saved: n, from: days[0], to: days[days.length - 1], message: days.length > 1 ? "Sessions are spread evenly across the days of the range." : undefined };
    }
  },
  {
    id: "business_date", label: "Business Report: sales and traffic by date", group: "Traffic",
    how: "Seller Central > Reports > Business Reports > Sales and Traffic (By Date), daily view.",
    detect: h => has(h, "date") && any(h, "sessionstotal", "sessions") && any(h, "orderedproductsales", "unitsordered") && !any(h, "sku", "childasin"),
    async save(c, orgId, rows) {
      const out = [];
      for (const r of rows) { const d = parseDate(pick(r, "date")); if (!d) continue; out.push([orgId, istDay(d), "__all__", int(pick(r, "sessionstotal", "sessions")), int(pick(r, "pageviewstotal", "pageviews")), money(pick(r, "averageofferbuyboxpercentage", "featuredofferbuyboxpercentage", "buyboxpercentage")) || null]); }
      const n = await bulkUpsert(c, "traffic_daily", ["org_id", "day", "sku", "sessions", "page_views", "buy_box_pct"], out, ["org_id", "day", "sku"], ["sessions", "page_views", "buy_box_pct"]);
      return { saved: n, ...span(out.map(r => r[1])) };
    }
  },
  {
    id: "ads_search_terms", label: "Ads: search term report", group: "Advertising",
    how: "Amazon Ads console > Measurement & Reporting > Sponsored ads reports > Search term, time unit Daily.",
    detect: h => has(h, "campaignname", "impressions", "clicks") && any(h, "customersearchterm", "searchterm"),
    async save(c, orgId, rows, opts) {
      const type = adTypeOf(opts, opts.headers);
      await upsertCampaigns(c, orgId, rows, type, opts);
      const out = new Map();
      for (const r of rows) {
        const name = pick(r, "campaignname"); if (!name) continue;
        const key = [campId(r), pick(r, "adgroupname"), pick(r, "targeting", "keyword", "keywordtext"), pick(r, "customersearchterm", "searchterm").toLowerCase(), adDay(r, opts)];
        const p = out.get(key.join("|")), v = [int(pick(r, "impressions")), int(pick(r, "clicks")), money(pick(r, "spend", "cost")), adSales(r), adOrders(r)];
        if (p) { for (let i = 0; i < 5; i++) p[8 + i] += v[i]; continue; }
        out.set(key.join("|"), [orgId, key[0], key[1], key[2], String(pick(r, "matchtype")).toLowerCase(), key[3], key[4], null, ...v]);
      }
      const rowsOut = [...out.values()].map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], ...r.slice(8)]);
      const n = await bulkUpsert(c, "ad_terms", ["org_id", "campaign_id", "ad_group", "targeting", "match_type", "search_term", "day", "impressions", "clicks", "spend", "sales", "orders"], rowsOut,
        ["org_id", "campaign_id", "ad_group", "targeting", "search_term", "day"], ["match_type", "impressions", "clicks", "spend", "sales", "orders"]);
      return { saved: n, ...span(rowsOut.map(r => r[6])) };
    }
  },
  {
    id: "ads_placement", label: "Ads: placement report", group: "Advertising",
    how: "Amazon Ads console > Sponsored ads reports > Campaign report with Placement selected, time unit Daily.",
    detect: h => has(h, "campaignname", "impressions", "placement") && !any(h, "customersearchterm"),
    async save(c, orgId, rows, opts) {
      const type = adTypeOf(opts, opts.headers);
      await upsertCampaigns(c, orgId, rows, type, opts);
      const out = new Map();
      for (const r of rows) {
        if (!pick(r, "campaignname")) continue;
        const k = [campId(r), pick(r, "placement"), adDay(r, opts)], p = out.get(k.join("|")), v = [int(pick(r, "impressions")), int(pick(r, "clicks")), money(pick(r, "spend", "cost")), adSales(r), adOrders(r)];
        if (p) { for (let i = 0; i < 5; i++) p[4 + i] += v[i]; continue; }
        out.set(k.join("|"), [orgId, ...k, ...v]);
      }
      const n = await bulkUpsert(c, "ad_placements", ["org_id", "campaign_id", "placement", "day", "impressions", "clicks", "spend", "sales", "orders"], [...out.values()],
        ["org_id", "campaign_id", "placement", "day"], ["impressions", "clicks", "spend", "sales", "orders"]);
      return { saved: n, ...span([...out.values()].map(r => r[3])) };
    }
  },
  {
    id: "ads_products", label: "Ads: advertised product report", group: "Advertising",
    how: "Amazon Ads console > Sponsored ads reports > Advertised product. Tells Pulse Navigator which product each campaign promotes.",
    detect: h => has(h, "campaignname") && any(h, "advertisedsku", "advertisedasin"),
    async save(c, orgId, rows, opts) {
      const type = adTypeOf(opts, opts.headers);
      await upsertCampaigns(c, orgId, rows, type, opts);
      const best = new Map();
      for (const r of rows) {
        const id = campId(r), sku = pick(r, "advertisedsku") || pick(r, "advertisedasin"), sp = money(pick(r, "spend", "cost"));
        if (!sku) continue;
        const m = best.get(id) || new Map(); m.set(sku, (m.get(sku) || 0) + sp); best.set(id, m);
      }
      let n = 0;
      for (const [id, m] of best) { const sku = [...m].sort((a, b) => b[1] - a[1])[0][0]; await c.query("update campaigns set sku=$3 where org_id=$1 and campaign_id=$2", [orgId, id, sku]); n++; }
      return { saved: n };
    }
  },
  {
    id: "ads_campaigns", label: "Ads: campaign report", group: "Advertising",
    how: "Amazon Ads console > Sponsored ads reports > Campaign, time unit Daily. Download one for each ad type you run (Products, Brands, Display).",
    detect: h => has(h, "campaignname", "impressions", "clicks") && any(h, "spend", "cost") && !any(h, "customersearchterm", "searchterm", "placement", "advertisedsku", "advertisedasin", "targeting", "keyword"),
    async save(c, orgId, rows, opts) {
      const type = adTypeOf(opts, opts.headers);
      const campaigns = await upsertCampaigns(c, orgId, rows, type, opts);
      const out = new Map();
      for (const r of rows) {
        if (!pick(r, "campaignname")) continue;
        const k = [campId(r), adDay(r, opts)], p = out.get(k.join("|")), v = [int(pick(r, "impressions")), int(pick(r, "clicks")), money(pick(r, "spend", "cost")), adSales(r), adOrders(r), adUnits(r)];
        if (p) { for (let i = 0; i < 6; i++) p[3 + i] += v[i]; continue; }
        out.set(k.join("|"), [orgId, ...k, ...v]);
      }
      const n = await bulkUpsert(c, "ad_daily", ["org_id", "campaign_id", "day", "impressions", "clicks", "spend", "sales", "orders", "units"], [...out.values()],
        ["org_id", "campaign_id", "day"], ["impressions", "clicks", "spend", "sales", "orders", "units"]);
      return { saved: n, campaigns, adType: type, ...span([...out.values()].map(r => r[2])) };
    }
  },
  {
    id: "ads_targeting", label: "Ads: targeting report", group: "Advertising",
    how: "Amazon Ads console > Sponsored ads reports > Targeting, time unit Daily.",
    detect: h => has(h, "campaignname", "impressions") && any(h, "targeting", "keyword") && !any(h, "customersearchterm", "searchterm"),
    async save(c, orgId, rows, opts) {
      // stored with the target itself as the search term, so bid analysis covers keywords and product targets
      const mapped = rows.map(r => ({ ...r, customersearchterm: pick(r, "targeting", "keyword") }));
      return REPORTS.find(x => x.id === "ads_search_terms").save(c, orgId, mapped, opts);
    }
  },
  {
    id: "transactions", label: "Payments: date range transaction report", group: "Payments",
    how: "Seller Central > Payments > Reports Repository > Transaction, date range report as CSV. Used for profit and loss.",
    detect: h => any(h, "datetime", "postedate", "dateandtime") && has(h, "type", "total") && any(h, "settlementid", "productsales"),
    async save(c, orgId, rows) {
      const seen = new Map(), out = [];
      for (const r of rows) {
        const at = parseDate(pick(r, "datetime", "postedate", "dateandtime")); if (!at) continue;
        const raw = Object.values(r).join("\u0001"), nth = (seen.get(raw) || 0) + 1; seen.set(raw, nth);
        const tax = ["tcscgst", "tcssgst", "tcsigst", "tdssection194o", "tds"].reduce((a, k) => a + money(r[k]), 0);
        out.push([orgId, at, pick(r, "type") || "Other", pick(r, "orderid") || null, pick(r, "sku") || null, String(pick(r, "description")).slice(0, 300), int(pick(r, "quantity")) || null,
          money(pick(r, "productsales")), money(pick(r, "shippingcredits")) + money(pick(r, "giftwrapcredits")), money(pick(r, "promotionalrebates")),
          money(pick(r, "sellingfees")), money(pick(r, "fbafees")), money(pick(r, "othertransactionfees")), tax, money(pick(r, "other")), money(pick(r, "total")), hash(raw + "#" + nth)]);
      }
      const n = await bulkUpsert(c, "transactions", ["org_id", "posted_at", "type", "order_id", "sku", "description", "quantity", "product_sales", "shipping_credits", "promo_rebates", "selling_fees", "fba_fees", "other_fees", "tax_withheld", "other", "total", "row_key"], out,
        ["org_id", "row_key"], null);
      return { saved: n, ...span(out.map(r => istDay(r[1]))), message: n < out.length ? `${out.length - n} rows were already imported and were skipped.` : undefined };
    }
  },
  {
    id: "settlement_v2", label: "Payments: settlement report (flat file V2)", group: "Payments",
    how: "Seller Central > Payments > All Statements > Download flat file V2 for a settlement period. Also pulled automatically through the Amazon API.",
    detect: h => has(h, "settlementid", "amounttype", "amountdescription", "amount") && any(h, "posteddate", "posteddatetime"),
    async save(c, orgId, rows) {
      const seen = new Map(), out = [];
      const bucket = (type, desc) => {
        const d = (type + " " + desc).toLowerCase();
        if (/tcs|tds|tax ?withheld/.test(d)) return "tax";
        if (/promotion|rebate|discount/.test(d)) return "promo";
        if (/principal/.test(d) || /itemprice.*product|product ?tax|^itemprice tax/.test(d)) return "sales";
        if (/shipping(?!.*chargeback)|giftwrap/.test(d) && /itemprice/.test(d)) return "ship";
        if (/commission|closing ?fee|referral|refundcommission/.test(d)) return "selling";
        if (/fba|fulfil|pick|pack|weight|easy ?ship|shippingchargeback|storage|removal|inbound/.test(d)) return "fba";
        if (/cost ?of ?advertising|advertis/.test(d)) return "other";
        if (/fee/.test(d)) return "otherfee";
        return "other";
      };
      for (const r of rows) {
        const at = parseDate(pick(r, "posteddatetime", "posteddate")); const amt = money(pick(r, "amount"));
        if (!at || !amt) continue;
        const raw = Object.values(r).join("\u0001"), nth = (seen.get(raw) || 0) + 1; seen.set(raw, nth);
        const b = bucket(pick(r, "amounttype"), pick(r, "amountdescription")), v = { sales: 0, ship: 0, promo: 0, selling: 0, fba: 0, otherfee: 0, tax: 0, other: 0 }; v[b] = amt;
        const type = pick(r, "transactiontype") || "Other";
        out.push([orgId, at, /refund/i.test(type) ? "Refund" : /order/i.test(type) ? "Order" : type, pick(r, "orderid") || null, pick(r, "sku") || null, String(pick(r, "amountdescription")).slice(0, 300),
          int(pick(r, "quantitypurchased")) || null, v.sales, v.ship, v.promo, v.selling, v.fba, v.otherfee, v.tax, v.other, amt, hash(raw + "#" + nth)]);
      }
      const n = await bulkUpsert(c, "transactions", ["org_id", "posted_at", "type", "order_id", "sku", "description", "quantity", "product_sales", "shipping_credits", "promo_rebates", "selling_fees", "fba_fees", "other_fees", "tax_withheld", "other", "total", "row_key"], out, ["org_id", "row_key"], null);
      return { saved: n, ...span(out.map(r => istDay(r[1]))) };
    }
  },
  {
    id: "coupons", label: "Coupons export", group: "Promotions",
    how: "Seller Central > Advertising > Coupons > select coupons > Download, or any sheet with coupon ID, name, budget, spend, clips, redemptions and sales.",
    detect: h => any(h, "couponid", "couponname", "coupontitle") && any(h, "budget", "redemptions", "clips"),
    async save(c, orgId, rows) {
      const out = rows.filter(r => pick(r, "couponid", "couponname", "coupontitle")).map(r => {
        const sd = parseDate(pick(r, "startdate")), ed = parseDate(pick(r, "enddate"));
        return [orgId, String(pick(r, "couponid") || "c:" + hash(pick(r, "couponname", "coupontitle"))), pick(r, "couponname", "coupontitle", "name") || null, pick(r, "discounttype") || null,
          money(pick(r, "discount", "discountamount", "discountamt")) || null, money(pick(r, "budget")) || null, money(pick(r, "budgetspent", "spend", "budgetused")), int(pick(r, "clips")), int(pick(r, "redemptions")),
          money(pick(r, "sales", "salesgenerated")), sd ? istDay(sd) : null, ed ? istDay(ed) : null];
      });
      const n = await bulkUpsert(c, "coupons", ["org_id", "coupon_id", "name", "discount_type", "discount", "budget", "spent", "clips", "redemptions", "sales", "starts_on", "ends_on"], out,
        ["org_id", "coupon_id"], ["name", "discount_type", "discount", "budget", "spent", "clips", "redemptions", "sales", "starts_on", "ends_on"]);
      return { saved: n };
    }
  },
  {
    id: "deals", label: "Deals export", group: "Promotions",
    how: "Seller Central > Advertising > Deals > Download, or any sheet with deal ID or type, SKU/ASIN, start, glance views, units and revenue.",
    detect: h => any(h, "dealid", "dealtype") && any(h, "glanceviews", "unitssold", "revenue"),
    async save(c, orgId, rows) {
      const out = rows.map(r => {
        const s = parseDate(pick(r, "starttime", "startdate", "dealstarttime")), e = parseDate(pick(r, "endtime", "enddate"));
        return [orgId, String(pick(r, "dealid") || "d:" + hash(Object.values(r).join("|"))), pick(r, "dealtype", "type") || null, pick(r, "sku", "asin") || null, s, e,
          int(pick(r, "glanceviews")), int(pick(r, "unitssold", "units")), money(pick(r, "revenue", "sales")), pick(r, "dealstatus", "status") || null];
      });
      const n = await bulkUpsert(c, "deals", ["org_id", "deal_id", "type", "sku", "starts_at", "ends_at", "glance_views", "units", "revenue", "status"], out,
        ["org_id", "deal_id"], ["type", "sku", "starts_at", "ends_at", "glance_views", "units", "revenue", "status"]);
      return { saved: n };
    }
  },
  {
    id: "repeat", label: "Brand Analytics: repeat purchase behaviour", group: "Customers",
    how: "Seller Central > Brands > Brand Analytics > Repeat Purchase Behaviour (brand-registered sellers). Enter the period end date.",
    needsPeriod: true,
    detect: h => has(h, "asin") && any(h, "uniquecustomers") && [...h].some(k => k.startsWith("repeat")),
    async save(c, orgId, rows, opts) {
      const end = opts.periodEnd || today();
      const out = rows.filter(r => pick(r, "asin")).map(r => [orgId, end, pick(r, "asin"), pick(r, "producttitle", "title") || null, int(pick(r, "orders")), int(pick(r, "uniquecustomers")),
        money(pickRe(r, /^repeatcustomers/)), money(pickRe(r, /^repeatpurchaserevenue$|^repeatpurchaserevenueinr|^repeatrevenue/)), money(pickRe(r, /^repeatpurchaserevenue.*total|^repeatrevenue.*total/))]);
      const n = await bulkUpsert(c, "repeat_purchase", ["org_id", "period_end", "asin", "title", "orders", "unique_customers", "repeat_customers_pct", "repeat_revenue", "repeat_revenue_pct"], out,
        ["org_id", "period_end", "asin"], ["title", "orders", "unique_customers", "repeat_customers_pct", "repeat_revenue", "repeat_revenue_pct"]);
      return { saved: n, to: end };
    }
  },
  {
    id: "product_costs", label: "Product costs and details (Pulse Navigator template)", group: "Your data",
    how: "Download the Pulse Navigator template, fill in cost per unit for each SKU (and category, rating, reviews or stock if you like), and upload it.",
    detect: h => any(h, "sku", "sellersku") && any(h, "cogs", "costperunit", "unitcost", "landedcost", "cost"),
    async save(c, orgId, rows) {
      await touchProducts(c, orgId, rows.map(r => ({ sku: pick(r, "sku", "sellersku"), name: pick(r, "name", "productname", "title") })));
      let n = 0;
      for (const r of rows) {
        const sku = pick(r, "sku", "sellersku"); if (!sku) continue;
        const num = k => { const v = pick(r, ...k); return v === "" ? null : money(v); };
        const a = pick(r, "aplus", "hasaplus", "apluscontent");
        await c.query(`update products set cogs=coalesce($3,cogs), category=coalesce(nullif($4,''),category), price=coalesce($5,price), rating=coalesce($6,rating), reviews=coalesce($7,reviews),
            fbm_qty=coalesce($8,fbm_qty), images=coalesce($9,images), bullets=coalesce($10,bullets), has_aplus=coalesce($11,has_aplus), updated_at=now() where org_id=$1 and sku=$2`,
          [orgId, sku, num(["cogs", "costperunit", "unitcost", "landedcost", "cost"]), pick(r, "category"), num(["price", "sellingprice"]), num(["rating"]), num(["reviews", "ratingscount"]),
           num(["stock", "ownstock", "fbmstock"]), num(["images"]), num(["bullets"]), a === "" ? null : yes(a)]);
        n++;
      }
      return { saved: n };
    }
  }
];

export const KNOWN_HEADERS = new Set(["amazonorderid", "sku", "purchasedate", "itemprice", "quantity", "afnfulfillablequantity", "sellersku", "itemname", "asin1", "returndate", "orderid", "returnrequestdate",
  "merchantsku", "issuedescription", "childasin", "sessionstotal", "sessions", "date", "orderedproductsales", "campaignname", "impressions", "clicks", "spend", "customersearchterm", "placement",
  "advertisedsku", "targeting", "datetime", "settlementid", "type", "total", "couponid", "couponname", "budget", "dealid", "glanceviews", "asin", "uniquecustomers", "cogs", "costperunit",
  "bulletpoint1", "mainimageurl", "amounttype", "amountdescription", "posteddate", "itemsku", "productname", "status", "reason", "matchtype", "adgroupname", "portfolioname", "startdate", "enddate", "productsales", "sellingfees", "fbafees"]);

export function detectReport(headers) {
  const h = new Set(headers);
  return REPORTS.find(r => r.detect(h)) || null;
}

function titleCase(s) { s = String(s || "").trim(); return s ? s.toLowerCase().replace(/\b[a-z]/g, m => m.toUpperCase()) : null; }
function share(total, n, i) { const base = Math.floor(total / n); return base + (i < total - base * n ? 1 : 0); }
function dayRange(start, end) {
  const e = end || today(), s = start || e, out = [];
  for (let d = new Date(s + "T00:00:00Z"); d <= new Date(e + "T00:00:00Z") && out.length < 400; d = new Date(d.getTime() + 864e5)) out.push(d.toISOString().slice(0, 10));
  return out.length ? out : [e];
}
