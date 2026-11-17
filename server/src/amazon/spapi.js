// Selling Partner API: requests Amazon reports, waits for them, downloads them and saves them
// through the same parsers as manual uploads.
import { config } from "../config.js";
import { one, q } from "../db.js";
import { decrypt } from "../lib/crypto.js";
import { importBuffer, importRows } from "../lib/importer.js";
import { lwaAccessToken, amazonRequest, downloadDocument, sleep, AmazonError, POLL_MS } from "./http.js";

export function spCredentials(conn) {
  const s = decrypt(conn.secret_enc) || {};
  return { tokenUrl: config.amazon.lwaTokenUrl, clientId: s.clientId || config.amazon.lwaClientId, clientSecret: s.clientSecret || config.amazon.lwaClientSecret, refreshToken: s.refreshToken,
    endpoint: conn.config?.endpoint || config.amazon.spApiEndpoint, marketplaceId: conn.config?.marketplaceId || config.amazon.marketplaceId };
}

export function spClient(cred) {
  const call = async (method, path, { query, body } = {}) => {
    const token = await lwaAccessToken(cred);
    const url = cred.endpoint + path + (query ? "?" + new URLSearchParams(query) : "");
    return amazonRequest(url, { method, body, headers: { "x-amz-access-token": token, "content-type": "application/json", "user-agent": "Pulse/0.1 (Language=JavaScript)" } });
  };
  return {
    call,
    marketplaces: () => call("GET", "/sellers/v1/marketplaceParticipations"),
    async report(reportType, { start, end, options, timeoutMin = 20 } = {}) {
      const body = { reportType, marketplaceIds: [cred.marketplaceId] };
      if (start) body.dataStartTime = start.toISOString();
      if (end) body.dataEndTime = end.toISOString();
      if (options) body.reportOptions = options;
      const { reportId } = await call("POST", "/reports/2021-06-30/reports", { body });
      const until = Date.now() + timeoutMin * 6e4;
      for (let wait = POLL_MS; Date.now() < until; wait = Math.min(60000, wait * 1.5)) {
        await sleep(wait);
        const r = await call("GET", `/reports/2021-06-30/reports/${reportId}`);
        if (r.processingStatus === "DONE") {
          const doc = await call("GET", `/reports/2021-06-30/documents/${r.reportDocumentId}`);
          return downloadDocument(doc.url, doc.compressionAlgorithm);
        }
        if (r.processingStatus === "CANCELLED") return null;   // Amazon cancels when there is no data for the range
        if (r.processingStatus === "FATAL") throw new AmazonError(`Amazon could not build ${reportType}.`, 500);
      }
      throw new AmazonError(`${reportType} took too long; it will be tried again on the next sync.`, 504);
    },
    async latestSettlements(since) {
      const r = await call("GET", "/reports/2021-06-30/reports", { query: { reportTypes: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2", processingStatuses: "DONE", pageSize: "20", createdSince: since.toISOString() } });
      return r.reports || [];
    },
    async document(reportDocumentId) {
      const doc = await call("GET", `/reports/2021-06-30/documents/${reportDocumentId}`);
      return downloadDocument(doc.url, doc.compressionAlgorithm);
    }
  };
}

const daysAgo = n => new Date(Date.now() - n * 864e5);
function chunks(fromDays, maxDays) { const out = []; for (let s = fromDays; s > 0; s -= maxDays) out.push([daysAgo(s), s - maxDays > 0 ? daysAgo(s - maxDays) : new Date(Date.now() - 5 * 6e4)]); return out; }

// Full sync. First run pulls 90 days of orders; later runs pull the last 14 days to catch status changes.
export async function syncSpApi(orgId, log = () => {}) {
  const conn = await one("select * from connections where org_id=$1 and kind='sp_api'", [orgId]);
  if (!conn) throw new Error("Amazon seller account is not connected.");
  const sp = spClient(spCredentials(conn)), first = !conn.last_sync_at, done = [];
  const save = async (name, buf, opts = {}) => { if (!buf) return; const r = await importBuffer({ orgId, source: "sp_api", buf, filename: name, ...opts }); done.push(`${r.label}: ${r.rowsSaved}`); };

  for (const [s, e] of chunks(first ? 90 : 14, 30)) await save("orders.txt", await sp.report("GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL", { start: s, end: e }), { reportId: "orders" });
  await save("listings.txt", await sp.report("GET_MERCHANT_LISTINGS_ALL_DATA"), { reportId: "listings" });
  await save("fba-inventory.txt", await sp.report("GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA").catch(e => { if (e.status === 403) return null; throw e; }), { reportId: "fba_inventory" });
  await save("fba-returns.txt", await sp.report("GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA", { start: daysAgo(first ? 90 : 30), end: new Date() }).catch(e => { if (e.status === 403) return null; throw e; }), { reportId: "fba_returns" });
  await save("mfn-returns.csv", await sp.report("GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE", { start: daysAgo(first ? 60 : 30), end: new Date() }), { reportId: "mfn_returns" });

  // Sales and traffic (Business Report) arrives as JSON
  const st = await sp.report("GET_SALES_AND_TRAFFIC_REPORT", { start: daysAgo(30), end: daysAgo(1), options: { dateGranularity: "DAY", asinGranularity: "CHILD" } });
  if (st) {
    const j = JSON.parse(st.toString("utf8")), end = new Date(Date.now() - 864e5 + 330 * 6e4).toISOString().slice(0, 10), start = new Date(Date.now() - 30 * 864e5 + 330 * 6e4).toISOString().slice(0, 10);
    const byDate = (j.salesAndTrafficByDate || []).map(d => ({ date: d.date, sessionstotal: d.trafficByDate?.sessions ?? d.trafficByDate?.browserSessions ?? 0, pageviewstotal: d.trafficByDate?.pageViews ?? 0,
      averageofferbuyboxpercentage: d.trafficByDate?.buyBoxPercentage ?? "", orderedproductsales: d.salesByDate?.orderedProductSales?.amount ?? 0, unitsordered: d.salesByDate?.unitsOrdered ?? 0 }));
    const byAsin = (j.salesAndTrafficByAsin || []).map(a => ({ childasin: a.childAsin, sku: a.sku || "", sessionstotal: a.trafficByAsin?.sessions ?? 0, pageviewstotal: a.trafficByAsin?.pageViews ?? 0, featuredofferbuyboxpercentage: a.trafficByAsin?.buyBoxPercentage ?? "" }));
    if (byDate.length) done.push(`Traffic by date: ${(await importRows({ orgId, source: "sp_api", reportId: "business_date", rows: byDate })).rowsSaved}`);
    if (byAsin.length) done.push(`Traffic by product: ${(await importRows({ orgId, source: "sp_api", reportId: "business_child", rows: byAsin, periodStart: start, periodEnd: end })).rowsSaved}`);
  }

  // Settlement reports are generated by Amazon every two weeks; import any new ones
  for (const r of await sp.latestSettlements(daysAgo(first ? 90 : 30))) {
    const already = await one("select 1 from imports where org_id=$1 and filename=$2 and status='done'", [orgId, "settlement-" + r.reportId]);
    if (!already) await save("settlement-" + r.reportId, await sp.document(r.reportDocumentId), { reportId: "settlement_v2" });
  }

  // Account health
  const perf = await sp.report("GET_V2_SELLER_PERFORMANCE_REPORT").catch(() => null);
  if (perf) { await saveHealth(orgId, JSON.parse(perf.toString("utf8"))); done.push("Account health"); }

  await q("update connections set last_sync_at=now(), last_error=null, status='connected' where org_id=$1 and kind='sp_api'", [orgId]);
  log(`SP-API sync for org ${orgId}: ${done.join("; ")}`);
  return done;
}

// Maps the seller performance JSON into the metrics shown on the overview page
async function saveHealth(orgId, j) {
  const m = (j.performanceMetrics || [])[0] || {}, pctOf = x => x && x.rate !== undefined ? +(x.rate * 100).toFixed(2) : null;
  const metrics = {
    shipping: [["Late shipment rate", pctOf(m.lateShipmentRate), "<", 4], ["Pre-fulfilment cancel rate", pctOf(m.preFulfillmentCancellationRate), "<", 2.5],
      ["Valid tracking rate", pctOf(m.validTrackingRate), ">", 95], ["On-time delivery rate", pctOf(m.onTimeDeliveryRate), ">", 90]].filter(x => x[1] !== null),
    policy: [["Listing policy violations", m.listingPolicyViolations?.defectsCount ?? null], ["Product authenticity complaints", m.productAuthenticityCustomerComplaints?.defectsCount ?? null],
      ["Product safety complaints", m.productSafetyCustomerComplaints?.defectsCount ?? null], ["Intellectual property complaints", m.intellectualPropertyComplaints?.defectsCount ?? null],
      ["Restricted product violations", m.restrictedProductPolicyViolations?.defectsCount ?? null]].filter(x => x[1] !== null),
    service: [["Order defect rate", pctOf(m.orderDefectRate?.mfn), pctOf(m.orderDefectRate?.afn)], ["Negative feedback", pctOf(m.orderDefectRate?.mfn?.negativeFeedback), pctOf(m.orderDefectRate?.afn?.negativeFeedback)],
      ["A-to-Z guarantee claims", pctOf(m.orderDefectRate?.mfn?.claims), pctOf(m.orderDefectRate?.afn?.claims)], ["Chargeback claims", pctOf(m.orderDefectRate?.mfn?.chargebacks), pctOf(m.orderDefectRate?.afn?.chargebacks)]],
    accountHealthRating: m.accountHealthRating?.ahrScore ?? null
  };
  const day = new Date(Date.now() + 330 * 6e4).toISOString().slice(0, 10);
  await q("insert into account_health (org_id, as_of, source, metrics) values ($1,$2,'api',$3) on conflict (org_id, as_of) do update set metrics=excluded.metrics, source='api'", [orgId, day, metrics]);
}
