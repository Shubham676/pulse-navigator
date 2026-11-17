// Writes a full set of sample Amazon India report files (invented brand "Annam Foods") into a folder.
// They follow Amazon's column layouts, so they test the parsers and can fill a demo brand.
// Usage: node tools/sample-reports.js <output-folder> [days]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.resolve("server/package.json"));
const ExcelJS = require("exceljs");

const out = process.argv[2] || "sample-reports", DAYS = Number(process.argv[3] || 90);
fs.mkdirSync(out, { recursive: true });

let s0 = 20261117;
const rand = () => ((s0 = (s0 * 1103515245 + 12345) % 2147483648) / 2147483648);
const r = (a, b) => a + rand() * (b - a), ri = (a, b) => Math.round(r(a, b)), pick = a => a[Math.floor(rand() * a.length)];

const SKUS = [
  ["AF-ATTA-MG-1", "Annam Multigrain Atta 1 kg | High Fibre | Barley, Chana, Methi", "Atta & flours", 249, 118, 3.2],
  ["AF-ATTA-MG-3", "Annam Multigrain Atta 3 x 1 kg | High Fibre Healthy Atta", "Atta & flours", 699, 335, 1.6],
  ["AF-ATTA-NW-1", "Annam No-Wheat Millet Atta 1 kg | Jowar, Barley, Amaranth", "Atta & flours", 279, 140, 2.8],
  ["AF-ATTA-NW-5", "Annam No-Wheat Millet Atta 5 kg | Family Pack", "Atta & flours", 1199, 610, 0.9],
  ["AF-RICE-LG-1", "Annam Low GI Rice 1 kg | Non-Sticky Grains | Lab Tested", "Rice", 289, 150, 4.1],
  ["AF-RICE-LG-5", "Annam Low GI Rice 5 kg | Family Pack", "Rice", 1149, 590, 1.4],
  ["AF-RICE-LG-2", "Annam Low GI Rice 2 x 1 kg", "Rice", 549, 288, 1.9],
  ["AF-OIL-MUS-1", "Annam Cold Pressed Mustard Oil 1 L | Kachi Ghani", "Pressed oils", 389, 205, 3.6],
  ["AF-OIL-MUS-5", "Annam Cold Pressed Mustard Oil 5 L | Family Pack", "Pressed oils", 1699, 905, 0.7],
  ["AF-OIL-GN-1", "Annam Wood Pressed Groundnut Oil 1 L", "Pressed oils", 449, 248, 2.2],
  ["AF-OIL-COC-1", "Annam Wood Pressed Coconut Oil 1 L", "Pressed oils", 499, 270, 1.5],
  ["AF-GIFT-4", "Annam Festive Kitchen Combo of 4 | Atta, Rice, 2 Oils", "Gift combos", 1499, 760, 1.1],
  ["AF-GIFT-TRIAL", "Annam Trial Kit 3 x 250 g | Atta, Rice, Millet", "Gift combos", 399, 190, 1.3],
  ["AF-OIL-SUN-1", "Annam Cold Pressed Sunflower Oil 1 L", "Pressed oils", 349, 186, 1.8]
].map(([sku, name, cat, price, cogs, daily], i) => ({ sku, name, cat, price, cogs, daily, asin: "B0" + (8100000 + i * 731).toString(36).toUpperCase().padStart(8, "X"), fba: ri(0, 45), fbm: ri(6, 140) }));
const STATES = [["MAHARASHTRA", ["MUMBAI", "PUNE"], .27], ["KARNATAKA", ["BENGALURU"], .16], ["DELHI", ["NEW DELHI"], .13], ["TELANGANA", ["HYDERABAD"], .11], ["TAMIL NADU", ["CHENNAI"], .09], ["WEST BENGAL", ["KOLKATA"], .08], ["GUJARAT", ["AHMEDABAD"], .07], ["KERALA", ["KOCHI"], .05], ["UTTAR PRADESH", ["NOIDA", "LUCKNOW"], .04]];
const REASONS = ["DAMAGED_BY_CARRIER", "DEFECTIVE", "NOT_AS_DESCRIBED", "ORDERED_WRONG_ITEM", "EXPIRED_ITEM", "UNWANTED_ITEM"];
const HOUR_W = [.4, .25, .15, .12, .15, .3, .7, 1.4, 2.6, 3.6, 4.4, 5, 5.4, 5.1, 4.6, 4.4, 4.8, 5.5, 6.4, 7.3, 8, 7.4, 5.1, 2.3];
const now = new Date(); now.setUTCHours(0, 0, 0, 0);
const dayOf = i => new Date(now.getTime() - (DAYS - 1 - i) * 864e5);
const ymd = d => d.toISOString().slice(0, 10);
const inr = n => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tsv = (file, header, rows) => fs.writeFileSync(path.join(out, file), [header.join("\t"), ...rows.map(x => x.join("\t"))].join("\n"));
const csvq = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const csv = (file, header, rows, pre = []) => fs.writeFileSync(path.join(out, file), "﻿" + [...pre, header.map(csvq).join(","), ...rows.map(x => x.map(csvq).join(","))].join("\n"));
async function xlsx(file, header, rows) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Sponsored Product Report");
  ws.addRow(header); rows.forEach(x => ws.addRow(x)); await wb.xlsx.writeFile(path.join(out, file));
}
const pickHour = () => { let x = r(0, HOUR_W.reduce((a, b) => a + b)); for (let h = 0; h < 24; h++) if ((x -= HOUR_W[h]) <= 0) return h; return 20; };
const pickState = () => { let x = rand(); for (const s of STATES) if ((x -= s[2]) <= 0) return s; return STATES[0]; };

// ---- orders ----
const orders = [];
for (let i = 0; i < DAYS; i++) {
  const d = dayOf(i), fest = i > DAYS - 30 && i < DAYS - 14 ? 1.6 : 1, wk = [1.25, .9, .95, 1, 1, 1.05, 1.2][d.getUTCDay()];
  for (const s of SKUS) {
    const n = Math.max(0, Math.round(s.daily * fest * wk * r(.4, 1.6)));
    for (let k = 0; k < n; k++) {
      const qty = rand() < .12 ? 2 : 1, st = pickState(), h = pickHour(), at = new Date(d.getTime() + (h * 60 + ri(0, 59)) * 6e4 - 330 * 6e4);
      const status = i >= DAYS - 2 && rand() < .5 ? "Pending" : rand() < .03 ? "Cancelled" : "Shipped";
      const price = status === "Pending" ? "" : (s.price * qty * r(.93, 1)).toFixed(2);
      orders.push({ id: `40${ri(2, 8)}-${String(ri(1e6, 9999999))}-${String(ri(1e6, 9999999))}`, at, status, s, qty, price, fba: rand() < .35, st, city: pick(st[1]), promo: rand() < .15 ? (s.price * .07 * qty).toFixed(2) : "0.00", biz: rand() < .06 });
    }
  }
}
tsv("All_Orders_Report.txt", ["amazon-order-id", "merchant-order-id", "purchase-date", "last-updated-date", "order-status", "fulfillment-channel", "sales-channel", "order-channel", "url", "ship-service-level", "product-name", "sku", "asin", "item-status", "quantity", "currency", "item-price", "item-tax", "shipping-price", "shipping-tax", "gift-wrap-price", "gift-wrap-tax", "item-promotion-discount", "ship-promotion-discount", "ship-city", "ship-state", "ship-postal-code", "ship-country", "promotion-ids", "is-business-order", "purchase-order-number", "price-designation"],
  orders.map(o => [o.id, "", o.at.toISOString().replace(".000Z", "+00:00"), o.at.toISOString().replace(".000Z", "+00:00"), o.status, o.fba ? "Amazon" : "Merchant", "Amazon.in", "", "", o.fba ? "Expedited" : "Standard", o.s.name, o.s.sku, o.s.asin, o.status === "Cancelled" ? "Cancelled" : "Shipped", o.qty, "INR", o.price, o.price ? (o.price * .05 / 1.05).toFixed(2) : "", "0.00", "0.00", "", "", o.promo, "0.00", o.city, o.st[0], "4" + ri(10000, 99999), "IN", o.promo !== "0.00" ? "CPN-7OFF-FAM" : "", o.biz ? "true" : "false", "", ""]));

// ---- inventory and listings ----
tsv("Manage_FBA_Inventory.txt", ["sku", "fnsku", "asin", "product-name", "condition", "your-price", "mfn-listing-exists", "mfn-fulfillable-quantity", "afn-listing-exists", "afn-warehouse-quantity", "afn-fulfillable-quantity", "afn-unsellable-quantity", "afn-reserved-quantity", "afn-total-quantity", "per-unit-volume", "afn-inbound-working-quantity", "afn-inbound-shipped-quantity", "afn-inbound-receiving-quantity"],
  SKUS.map(s => [s.sku, "X00" + s.asin.slice(3), s.asin, s.name, "New", s.price.toFixed(2), "Yes", s.fbm, "Yes", s.fba + 2, s.fba, 1, 1, s.fba + 2, "0.01", 0, 0, 0]));
tsv("All_Listings_Report.txt", ["item-name", "item-description", "listing-id", "seller-sku", "price", "quantity", "open-date", "image-url", "item-is-marketplace", "product-id-type", "zshop-shipping-fee", "item-note", "item-condition", "zshop-category1", "zshop-browse-path", "zshop-storefront-feature", "asin1", "asin2", "asin3", "will-ship-internationally", "expedited-shipping", "zshop-boldface", "product-id", "bid-for-featured-placement", "add-delete", "pending-quantity", "fulfillment-channel", "merchant-shipping-group", "status"],
  SKUS.map((s, i) => [s.name, "", "1101" + i, s.sku, s.price.toFixed(2), s.fbm, "2025-08-01 10:00:00 IST", "", "y", "1", "", "", "11", "", "", "", s.asin, "", "", "", "", "", s.asin, "", "", 0, "DEFAULT", "Migrated Template", "Active"]));
csv("Category_Listings_Report.csv", ["item_sku", "item_name", "external_product_id", "feed_product_type", "product_description", "bullet_point1", "bullet_point2", "bullet_point3", "bullet_point4", "bullet_point5", "main_image_url", "other_image_url1", "other_image_url2", "other_image_url3", "other_image_url4", "other_image_url5", "other_image_url6"],
  SKUS.map((s, i) => { const b = 3 + (i % 3), im = 2 + (i * 5) % 7; return [s.sku, s.name, s.asin, s.cat, "A healthy everyday staple from Annam Foods. ".repeat(1 + i % 4), ...[1, 2, 3, 4, 5].map(k => k <= b ? "Benefit " + k : ""), "https://example.com/m.jpg", ...[1, 2, 3, 4, 5, 6].map(k => k < im ? "https://example.com/" + k + ".jpg" : "")]; }));

// ---- returns ----
const shipped = orders.filter(o => o.status === "Shipped");
const fbaRet = shipped.filter(o => o.fba && rand() < .04), mfnRet = shipped.filter(o => !o.fba && rand() < .03);
tsv("FBA_Customer_Returns.txt", ["return-date", "order-id", "sku", "asin", "fnsku", "product-name", "quantity", "fulfillment-center-id", "detailed-disposition", "reason", "status", "license-plate-number", "customer-comments"],
  fbaRet.map(o => [new Date(Math.min(Date.now() - 36e5, o.at.getTime() + ri(3, 9) * 864e5)).toISOString().replace(".000Z", "+00:00"), o.id, o.s.sku, o.s.asin, "X00", o.s.name, 1, "BOM5", pick(["SELLABLE", "CUSTOMER_DAMAGED", "DEFECTIVE"]), pick(REASONS), "Unit returned to inventory", "LPN" + ri(1e6, 9e6), ""]));
csv("Seller_Fulfilled_Returns.csv", ["Order ID", "Order date", "Return request date", "Return request status", "Amazon RMA ID", "Seller RMA ID", "Label type", "Label cost", "Currency code", "Return carrier", "Tracking ID", "Label to be paid by", "A-to-Z Claim", "Is prime", "ASIN", "Merchant SKU", "Item Name", "Return quantity", "Return Reason", "In policy", "Return type", "Resolution", "Invoice number", "Return delivery date", "Order Amount", "Order quantity", "Refunded Amount"],
  mfnRet.map(o => { const rd = new Date(Math.min(Date.now() - 36e5, o.at.getTime() + ri(3, 9) * 864e5)); return [o.id, o.at.toUTCString().slice(5, 16), rd.toUTCString().slice(5, 16), pick(["Approved", "Closed", "Approved"]), "D" + ri(1e6, 9e6), "", "AmazonPrePaidLabel", "60.00", "INR", pick(["Delhivery", "Amazon Shipping", "Ekart"]), "TRK" + ri(1e6, 9e6), pick(["Seller", "Customer"]), rand() < .1 ? "Y" : "N", "N", o.s.asin, o.s.sku, o.s.name, 1, pick(["Item damaged in transit", "Leaking bottle", "Item not as described", "Ordered wrong item"]), "Y", "C-Returns", "StandardRefund", "INV" + ri(1e5, 9e5), "", o.price, o.qty, (o.price * .96).toFixed(2)]; }));
csv("Suppressed_Listings.csv", ["Status", "SKU", "ASIN", "Product name", "Condition", "Status Change Date", "Issue Description", "Field name"],
  SKUS.filter((_, i) => i === 4 || i === 12).map(s => ["Search Suppressed", s.sku, s.asin, s.name, "New", ymd(dayOf(DAYS - 4)), "Main image does not meet the 1000 pixel minimum", "main_image_url"]));

// ---- business report, last 30 days ----
csv("BusinessReport_Child_Item.csv", ["(Parent) ASIN", "(Child) ASIN", "Title", "SKU", "Sessions - Total", "Sessions - Total - B2B", "Session Percentage - Total", "Session Percentage - Total - B2B", "Page Views - Total", "Page Views - Total - B2B", "Page Views Percentage - Total", "Page Views Percentage - Total - B2B", "Featured Offer (Buy Box) Percentage", "Featured Offer (Buy Box) Percentage - B2B", "Units Ordered", "Units Ordered - B2B", "Unit Session Percentage", "Unit Session Percentage - B2B", "Ordered Product Sales", "Ordered Product Sales - B2B", "Total Order Items", "Total Order Items - B2B"],
  SKUS.map(s => { const u = Math.round(s.daily * 30), ses = Math.round(u / r(.06, .14)); return [s.asin, s.asin, s.name, s.sku, ses.toLocaleString("en-IN"), 12, "4.10%", "0%", Math.round(ses * 1.4).toLocaleString("en-IN"), 15, "4.0%", "0%", r(92, 100).toFixed(2) + "%", "100%", u, 2, (u / ses * 100).toFixed(2) + "%", "0%", inr(u * s.price), inr(s.price * 2), u, 2]; }));

// ---- ads ----
const CAMPS = [["SP Auto | Low GI Rice | Discovery", "SP", 4, 300, 1.6], ["SP Exact | Rice big packs", "SP", 5, 150, 2.4], ["SP Auto | Big packs 5 kg-5 L", "SP", 8, 800, .45], ["SP Manual | Atta exact (low GI)", "SP", 1, 200, 6.5],
  ["SP Phrase | Rice + oil", "SP", 6, 500, 1.1], ["SP | Competitor ASIN | Atta", "SP", 2, 150, 0], ["SP | Brand defence | Exact", "SP", 0, 100, 9.2], ["SP Auto | Oils discovery", "SP", 9, 250, 1.9],
  ["SP Manual | Festive combos", "SP", 11, 400, 3.1], ["SP Exact | Coconut oil", "SP", 10, 150, 3.6], ["SB | Brand video | Annam", "SB", 11, 300, 1.4], ["SB | Store spotlight | Oils", "SB", 7, 200, .8],
  ["SD | Retargeting | Viewers 14d", "SD", 4, 250, 2.7], ["SD | Audiences | Health shoppers", "SD", 3, 200, .3]].map(([name, type, si, budget, roas], i) => ({ id: String(300000000000000 + i * 7919), name, type, s: SKUS[si], budget, roas, status: i === 3 || i === 13 ? "PAUSED" : "ENABLED", ctr: r(.0018, .006), cpc: r(9, 38) }));
const KW = ["low gi rice", "diabetic rice", "multigrain atta", "atta for diabetes", "millet atta", "gluten free atta", "cold pressed mustard oil", "kachi ghani oil", "groundnut oil 5 litre", "wood pressed oil", "coconut oil for cooking", "healthy rice", "high fibre atta", "diwali gift hamper food", "organic atta", "jowar atta", "sunflower oil cold pressed", "rice 5kg"];
const AD_DAYS = Math.min(DAYS, 60), camp = [], st = [], pl = [], ap = [];
for (let i = DAYS - AD_DAYS; i < DAYS; i++) {
  const d = dayOf(i);
  for (const c of CAMPS) {
    if (c.status === "PAUSED" && i > DAYS - 20) continue;
    const imp = ri(c.budget * 2, c.budget * 9), clk = Math.max(0, Math.round(imp * c.ctr * r(.7, 1.3))), spend = +(clk * c.cpc * r(.85, 1.15)).toFixed(2);
    const sales = +(spend * c.roas * r(.5, 1.5)).toFixed(2), ord = Math.round(sales / (c.s.price * 1.05)), units = ord + (rand() < .1 ? 1 : 0);
    camp.push({ d, c, imp, clk, spend, sales, ord, units });
    if (c.type === "SP") {
      const terms = [0, 1, 2, 3].map(j => KW[(c.id.length + j * 5 + CAMPS.indexOf(c) * 3) % KW.length]);
      let left = { imp, clk, spend, sales, ord };
      terms.forEach((t, j) => {
        const w = j === 3 ? 1 : r(.15, .4), conv = (CAMPS.indexOf(c) + j) % 3 === 0 ? 0 : 1;
        const row = { imp: Math.round(left.imp * w), clk: Math.round(left.clk * w), spend: +(left.spend * w).toFixed(2), sales: conv ? +(left.sales * w).toFixed(2) : 0, ord: conv ? Math.round(left.ord * w) : 0 };
        left = { imp: left.imp - row.imp, clk: left.clk - row.clk, spend: +(left.spend - row.spend).toFixed(2), sales: +(left.sales - row.sales).toFixed(2), ord: left.ord - row.ord };
        st.push([d, c, t, ["EXACT", "PHRASE", "BROAD", "-"][j], row]);
      });
      const top = r(.3, .5), rest = r(.2, .35);
      [["Top of Search on-Amazon", top, 1.3], ["Other on-Amazon", rest, .9], ["Detail Page on-Amazon", 1 - top - rest, .7]].forEach(([p, w, q]) => pl.push([d, c, p, w, q, { imp, clk, spend, sales, ord }]));
    }
  }
}
const spHeader = ["Date", "Portfolio name", "Currency", "Campaign Name", "Status", "Budget Amount", "Impressions", "Clicks", "Click-Thru Rate (CTR)", "Cost Per Click (CPC)", "Spend", "7 Day Total Sales (₹)", "Total Advertising Cost of Sales (ACOS) ", "Total Return on Advertising Spend (ROAS)", "7 Day Total Orders (#)", "7 Day Total Units (#)", "7 Day Conversion Rate"];
const spRow = x => [x.d, "Annam", "INR", x.c.name, x.c.status, x.c.budget, x.imp, x.clk, x.imp ? x.clk / x.imp : 0, x.clk ? +(x.spend / x.clk).toFixed(2) : 0, x.spend, x.sales, x.sales ? x.spend / x.sales : 0, x.spend ? x.sales / x.spend : 0, x.ord, x.units, x.clk ? x.ord / x.clk : 0];
await xlsx("Sponsored_Products_Campaign_report.xlsx", spHeader, camp.filter(x => x.c.type === "SP").map(spRow));
csv("Sponsored_Brands_Campaign_report.csv", ["Date", "Portfolio name", "Currency", "Campaign Name", "Impressions", "Clicks", "Click-Thru Rate (CTR)", "Cost Per Click (CPC)", "Spend", "14 Day Total Sales (₹)", "Total Advertising Cost of Sales (ACOS) ", "Total Return on Advertising Spend (ROAS)", "14 Day Total Orders (#)", "14 Day Total Units (#)"],
  camp.filter(x => x.c.type === "SB").map(x => [x.d.toUTCString().slice(8, 11) + " " + x.d.getUTCDate() + ", " + x.d.getUTCFullYear(), "Annam", "INR", x.c.name, x.imp, x.clk, "0.4%", (x.spend / Math.max(1, x.clk)).toFixed(2), x.spend.toFixed(2), x.sales.toFixed(2), "", "", x.ord, x.units]));
csv("Sponsored_Display_Campaign_report.csv", ["Date", "Currency", "Campaign Name", "Status", "Budget Amount", "Cost type", "Impressions", "Clicks", "Spend", "14 Day Total Sales (₹)", "14 Day Total Orders (#)", "14 Day Total Units (#)"],
  camp.filter(x => x.c.type === "SD").map(x => [ymd(x.d), "INR", x.c.name, x.c.status, x.c.budget, "CPC", x.imp, x.clk, x.spend.toFixed(2), x.sales.toFixed(2), x.ord, x.units]));
await xlsx("Sponsored_Products_Search_term_report.xlsx", ["Date", "Portfolio name", "Currency", "Campaign Name", "Ad Group Name", "Targeting", "Match Type", "Customer Search Term", "Impressions", "Clicks", "Click-Thru Rate (CTR)", "Cost Per Click (CPC)", "Spend", "7 Day Total Sales (₹)", "Total Advertising Cost of Sales (ACOS) ", "Total Return on Advertising Spend (ROAS)", "7 Day Total Orders (#)", "7 Day Total Units (#)", "7 Day Conversion Rate"],
  st.map(([d, c, t, m, x]) => [d, "Annam", "INR", c.name, "Ad group 1", m === "-" ? "*" : t, m, t, x.imp, x.clk, x.imp ? x.clk / x.imp : 0, x.clk ? x.spend / x.clk : 0, x.spend, x.sales, x.sales ? x.spend / x.sales : 0, x.spend ? x.sales / x.spend : 0, x.ord, x.ord, x.clk ? x.ord / x.clk : 0]));
csv("Sponsored_Products_Placement_report.csv", ["Date", "Currency", "Campaign Name", "Bidding strategy", "Placement", "Impressions", "Clicks", "Spend", "7 Day Total Sales (₹)", "7 Day Total Orders (#)"],
  pl.map(([d, c, p, w, q, x]) => [ymd(d), "INR", c.name, "Dynamic bids - down only", p, Math.round(x.imp * w), Math.round(x.clk * w), (x.spend * w).toFixed(2), (x.sales * w * q).toFixed(2), Math.round(x.ord * w * q)]));
csv("Sponsored_Products_Advertised_product_report.csv", ["Date", "Currency", "Campaign Name", "Ad Group Name", "Advertised SKU", "Advertised ASIN", "Impressions", "Clicks", "Spend", "7 Day Total Sales (₹)"],
  CAMPS.filter(c => c.type === "SP").map(c => [ymd(dayOf(DAYS - 1)), "INR", c.name, "Ad group 1", c.s.sku, c.s.asin, 100, 5, "50.00", "120.00"]));

// ---- payments: date range transaction report, last 45 days ----
const tx = [], fmtT = d => `${d.getUTCDate()} ${d.toUTCString().slice(8, 11)} ${d.getUTCFullYear()} ${((d.getUTCHours() + 11) % 12) + 1}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} ${d.getUTCHours() < 12 ? "am" : "pm"} UTC`;
for (const o of shipped.filter(o => o.at > dayOf(DAYS - 45))) {
  const sale = Number(o.price), sell = -(sale * .089).toFixed(2), fee = o.fba ? -(sale * .06 + 30).toFixed(2) : 0, closing = -(o.s.price > 500 ? 51 : 26), ship = o.fba ? 0 : -(55 + o.qty * 10);
  tx.push([fmtT(new Date(Math.min(Date.now() - 36e5, o.at.getTime() + 2 * 864e5))), "1234567890", "Order", o.id, o.s.sku, o.s.name, o.qty, "amazon.in", "Standard Orders", o.fba ? "Amazon" : "Seller", o.city, o.st[0], "", sale.toFixed(2), "0", "0", (-Number(o.promo)).toFixed(2), (sale * .05 / 1.05).toFixed(2), (-sale * .0025).toFixed(2), (-sale * .0025).toFixed(2), "0", (-sale * .001).toFixed(2), (sell + closing).toFixed(2), (fee + ship).toFixed(2), "0", "0", (sale - Number(o.promo) + sell + closing + fee + ship - sale * .006).toFixed(2)]);
}
for (const o of fbaRet.concat(mfnRet).filter(o => o.at > dayOf(DAYS - 45))) tx.push([fmtT(new Date(Math.min(Date.now() - 36e5, o.at.getTime() + 8 * 864e5))), "1234567890", "Refund", o.id, o.s.sku, o.s.name, 1, "amazon.in", "Standard Orders", o.fba ? "Amazon" : "Seller", o.city, o.st[0], "", (-o.price).toFixed(2), "0", "0", "0", "0", "0", "0", "0", "0", (o.price * .05).toFixed(2), "0", "0", "0", (-o.price * .95).toFixed(2)]);
for (let w = 0; w < 6; w++) {
  const d = dayOf(DAYS - 1 - w * 7), adCost = camp.filter(x => x.d <= d && x.d > new Date(d.getTime() - 7 * 864e5)).reduce((a, x) => a + x.spend, 0);
  tx.push([fmtT(d), "1234567890", "Service Fee", "", "", "Cost of Advertising", "", "amazon.in", "Standard Orders", "", "", "", "", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", (-adCost).toFixed(2), (-adCost).toFixed(2)]);
  tx.push([fmtT(d), "1234567890", "FBA Inventory Fee", "", "", "FBA storage fee", "", "amazon.in", "Standard Orders", "", "", "", "", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", (-r(150, 400)).toFixed(2), "0", "0", "0"]);
}
csv("Date_Range_Transaction_report.csv", ["date/time", "settlement id", "type", "order id", "Sku", "description", "quantity", "marketplace", "account type", "fulfillment", "order city", "order state", "order postal", "product sales", "shipping credits", "gift wrap credits", "promotional rebates", "Total sales tax liable(GST before adjusting TCS)", "TCS-CGST", "TCS-SGST", "TCS-IGST", "TDS (Section 194-O)", "selling fees", "fba fees", "other transaction fees", "other", "total"], tx,
  ['"Includes Amazon Marketplace, Fulfillment by Amazon (FBA), and Amazon Webstore transactions"', '"All amounts in INR, unless specified"']);

// ---- promotions, costs, repeat purchase ----
const dd = o => ymd(new Date(now.getTime() + o * 864e5));
csv("Coupons.csv", ["Coupon ID", "Coupon name", "Discount type", "Discount", "Budget", "Budget spent", "Clips", "Redemptions", "Sales", "Start date", "End date"],
  [["CPN-7OFF-FAM", "Save 7% on family packs", "Percent off", 7, 3000, 1640, 412, 58, 41200, dd(-28), dd(6)], ["CPN-50-OIL", "₹50 off pressed oils", "Amount off", 50, 2500, 2290, 380, 46, 19800, dd(-20), dd(2)],
   ["CPN-10-FIRST", "10% off first order", "Percent off", 10, 4000, 610, 190, 12, 7400, dd(-12), dd(18)], ["CPN-GIFT-100", "₹100 off festive combos", "Amount off", 100, 5000, 4100, 520, 41, 61500, dd(-35), dd(-1)]]);
csv("Deals.csv", ["Deal ID", "Deal type", "SKU", "Start date", "End date", "Glance views", "Units sold", "Revenue", "Status"],
  [["DL-1001", "Lightning deal", "AF-GIFT-4", dd(-9), dd(-9), 6400, 88, 118000, "Ended"], ["DL-1002", "7-day deal", "AF-RICE-LG-5", dd(-4), dd(3), 5200, 61, 66500, "Running"], ["DL-1003", "Lightning deal", "AF-OIL-MUS-5", dd(3), dd(3), 0, 0, 0, "Upcoming"]]);
csv("Pulse_Product_Costs.csv", ["sku", "name", "category", "price", "cogs", "rating", "reviews", "aplus"],
  SKUS.map((s, i) => [s.sku, "", s.cat, "", s.cogs, r(3.7, 4.6).toFixed(1), ri(12, 980), i % 3 ? "yes" : "no"]));
csv("Repeat_Purchase_Behavior.csv", ["ASIN", "Product Title", "Orders", "Unique Customers", "Repeat Customers % Total", "Repeat Purchase Revenue", "Repeat Purchase Revenue % Total"],
  SKUS.map(s => { const o = Math.round(s.daily * 30), u = Math.round(o * .9); return [s.asin, s.name, o, u, (r(12, 26)).toFixed(2) + "%", inr(o * s.price * r(.12, .26)), (r(12, 26)).toFixed(2) + "%"]; }));

console.log(`Wrote ${fs.readdirSync(out).length} files to ${out}: ${orders.length} order lines, ${camp.length} ad-days, ${st.length} search-term rows, ${tx.length} transactions`);
