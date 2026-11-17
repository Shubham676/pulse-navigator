// A stand-in for Amazon's LWA, SP-API and Ads API, serving the sample report files. Used by tests only.
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

export function startMockAmazon(sampleDir, port = 0) {
  const reports = new Map(), calls = [];
  const fileFor = { GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL: "All_Orders_Report.txt", GET_MERCHANT_LISTINGS_ALL_DATA: "All_Listings_Report.txt",
    GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA: "Manage_FBA_Inventory.txt", GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA: "FBA_Customer_Returns.txt", GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE: "Seller_Fulfilled_Returns.csv" };
  let n = 0, base;
  const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", c => (body += c)); req.on("end", () => {
      const u = new URL(req.url, "http://x"); calls.push(`${req.method} ${u.pathname}`);
      if (u.pathname === "/auth/o2/token") {
        const p = new URLSearchParams(body);
        if (p.get("refresh_token") === "Atzr|bad-token-xxxxxxxxxxxxxxxx") return json(res, 400, { error: "invalid_grant", error_description: "The request has an invalid grant parameter" });
        return json(res, 200, { access_token: "Atza|mock", expires_in: 3600, refresh_token: "Atzr|from-code-xxxxxxxxxxxxxxxxxx" });
      }
      if (u.pathname === "/sellers/v1/marketplaceParticipations") return json(res, 200, { payload: [{ marketplace: { id: "A21TJRUUN4KGV", countryCode: "IN" }, participation: { isParticipating: true } }] });
      if (u.pathname === "/reports/2021-06-30/reports" && req.method === "POST") {
        const b = JSON.parse(body), id = String(++n); reports.set(id, b.reportType); return json(res, 202, { reportId: id });
      }
      if (u.pathname === "/reports/2021-06-30/reports" && req.method === "GET") return json(res, 200, { reports: [] });
      let m;
      if ((m = u.pathname.match(/^\/reports\/2021-06-30\/reports\/(\d+)$/))) {
        const t = reports.get(m[1]);
        if (t === "GET_V2_SELLER_PERFORMANCE_REPORT" || t === "GET_SALES_AND_TRAFFIC_REPORT" || fileFor[t]) return json(res, 200, { processingStatus: "DONE", reportDocumentId: "doc-" + m[1] });
        return json(res, 200, { processingStatus: "CANCELLED" });
      }
      if ((m = u.pathname.match(/^\/reports\/2021-06-30\/documents\/doc-(\d+)$/))) return json(res, 200, { url: `${base}/download/${m[1]}`, compressionAlgorithm: "GZIP" });
      if ((m = u.pathname.match(/^\/download\/(\d+)$/))) {
        const t = reports.get(m[1]); let buf;
        if (fileFor[t]) buf = fs.readFileSync(path.join(sampleDir, fileFor[t]));
        else if (t === "GET_V2_SELLER_PERFORMANCE_REPORT") buf = Buffer.from(JSON.stringify({ performanceMetrics: [{ lateShipmentRate: { rate: .016 }, preFulfillmentCancellationRate: { rate: .029 }, validTrackingRate: { rate: .984 }, onTimeDeliveryRate: { rate: .942 }, orderDefectRate: { mfn: { rate: .006, claims: { rate: .002 }, chargebacks: { rate: 0 }, negativeFeedback: { rate: .004 } }, afn: { rate: .001 } }, listingPolicyViolations: { defectsCount: 1 }, accountHealthRating: { ahrScore: 240 } }] }));
        else if (t === "GET_SALES_AND_TRAFFIC_REPORT") buf = Buffer.from(JSON.stringify({ salesAndTrafficByDate: [{ date: "2026-11-15", salesByDate: { orderedProductSales: { amount: 9000 }, unitsOrdered: 30 }, trafficByDate: { sessions: 420, pageViews: 600, buyBoxPercentage: 97 } }], salesAndTrafficByAsin: [{ childAsin: "B0TEST", sku: "AF-RICE-LG-1", trafficByAsin: { sessions: 300, pageViews: 410, buyBoxPercentage: 99 } }] }));
        res.writeHead(200); return res.end(zlib.gzipSync(buf));
      }
      // Ads API
      if (u.pathname === "/v2/profiles") return json(res, 200, [{ profileId: 111, countryCode: "IN", accountInfo: { name: "Annam Foods", type: "seller" } }]);
      if (u.pathname === "/reporting/reports" && req.method === "POST") {
        if (req.headers["amazon-advertising-api-scope"] !== "111") return json(res, 401, { code: "UNAUTHORIZED" });
        const b = JSON.parse(body), id = "r" + (++n); reports.set(id, b); return json(res, 200, { reportId: id, status: "PENDING" });
      }
      if ((m = u.pathname.match(/^\/reporting\/reports\/(r\d+)$/))) return json(res, 200, { status: "COMPLETED", url: `${base}/adsfile/${m[1]}` });
      if ((m = u.pathname.match(/^\/adsfile\/(r\d+)$/))) {
        const b = reports.get(m[1]), t = b.configuration.reportTypeId, d = b.startDate;
        const row = { date: d, campaignId: 9001, campaignName: "API | SP Auto | Rice", campaignStatus: "ENABLED", campaignBudgetAmount: 500, impressions: 1000, clicks: 20, cost: 400, sales7d: 1200, purchases7d: 3, unitsSoldClicks7d: 3, sales: 900, purchases: 2, unitsSold: 2 };
        const rows = t === "spSearchTerm" ? [{ ...row, adGroupName: "AG", targeting: "low gi rice", matchType: "EXACT", searchTerm: "low gi rice 5kg" }]
          : t === "spAdvertisedProduct" ? [{ campaignId: 9001, campaignName: row.campaignName, advertisedSku: "AF-RICE-LG-5", advertisedAsin: "B0X", cost: 400 }]
          : b.configuration.groupBy.includes("campaignPlacement") ? [{ ...row, placementClassification: "Top of Search on-Amazon" }]
          : t === "sbCampaigns" ? [{ ...row, campaignId: 9002, campaignName: "API | SB | Brand" }] : t === "sdCampaigns" ? [{ ...row, campaignId: 9003, campaignName: "API | SD | Retarget" }] : [row];
        res.writeHead(200); return res.end(zlib.gzipSync(Buffer.from(JSON.stringify(rows))));
      }
      if (["/sp/campaigns", "/sb/v4/campaigns", "/sd/campaigns"].includes(u.pathname) && req.method === "PUT") return json(res, 207, { campaigns: { success: [{ index: 0 }], error: [] } });
      json(res, 404, { errors: [{ message: "mock: no route " + u.pathname }] });
    });
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; r({ base, calls, close: () => server.close() }); }));
}
