// Amazon Ads API: profile lookup, v3 reports for SP, SB and SD, and pushing campaign changes back.
import { config } from "../config.js";
import { one, q } from "../db.js";
import { decrypt } from "../lib/crypto.js";
import { importRows } from "../lib/importer.js";
import { lwaAccessToken, amazonRequest, downloadDocument, sleep, AmazonError, POLL_MS } from "./http.js";

export const ADS_TOKEN_URL = process.env.AMAZON_ADS_TOKEN_URL || "https://api.amazon.co.uk/auth/o2/token"; // EU region, which serves Amazon.in

export function adsCredentials(conn) {
  const s = decrypt(conn.secret_enc) || {};
  return { tokenUrl: ADS_TOKEN_URL, clientId: s.clientId || config.amazon.adsClientId, clientSecret: s.clientSecret || config.amazon.adsClientSecret, refreshToken: s.refreshToken,
    endpoint: conn.config?.endpoint || config.amazon.adsApiEndpoint, profileId: conn.config?.profileId };
}

export function adsClient(cred) {
  const call = async (method, path, { body, contentType = "application/json", accept = "application/json", profile = true } = {}) => {
    const token = await lwaAccessToken(cred);
    const headers = { authorization: `Bearer ${token}`, "amazon-advertising-api-clientid": cred.clientId, "content-type": contentType, accept };
    if (profile) headers["amazon-advertising-api-scope"] = String(cred.profileId);
    return amazonRequest(cred.endpoint + path, { method, headers, body });
  };
  return {
    profiles: () => call("GET", "/v2/profiles", { profile: false }),
    async report(adProduct, reportTypeId, groupBy, columns, startDate, endDate) {
      const r = await call("POST", "/reporting/reports", {
        contentType: "application/vnd.createasyncreportrequest.v3+json",
        body: { name: `Pulse Navigator ${reportTypeId} ${startDate}`, startDate, endDate, configuration: { adProduct, groupBy, columns, reportTypeId, timeUnit: "DAILY", format: "GZIP_JSON" } }
      });
      const until = Date.now() + 30 * 6e4;
      for (let wait = POLL_MS; Date.now() < until; wait = Math.min(60000, wait * 1.4)) {
        await sleep(wait);
        const s = await call("GET", `/reporting/reports/${r.reportId}`);
        if (s.status === "COMPLETED") return JSON.parse((await downloadDocument(s.url)).toString("utf8"));
        if (s.status === "FAILED") throw new AmazonError(`Ads report ${reportTypeId} failed: ${s.failureReason || "unknown reason"}`, 500);
      }
      throw new AmazonError(`Ads report ${reportTypeId} took too long; it will be tried again on the next sync.`, 504);
    },
    async updateCampaign(adType, campaignId, { state, budget }) {
      const c = { campaignId: String(campaignId) };
      if (state) c.state = state;
      if (adType === "SP") {
        if (budget) c.budget = { budget, budgetType: "DAILY" };
        return call("PUT", "/sp/campaigns", { body: { campaigns: [c] }, contentType: "application/vnd.spCampaign.v3+json", accept: "application/vnd.spCampaign.v3+json" });
      }
      if (adType === "SB") {
        if (budget) c.budget = budget;
        return call("PUT", "/sb/v4/campaigns", { body: { campaigns: [c] }, contentType: "application/vnd.sbcampaignresource.v4+json", accept: "application/vnd.sbcampaignresource.v4+json" });
      }
      if (budget) c.budget = budget;
      return call("PUT", "/sd/campaigns", { body: [c] });
    }
  };
}

const ymd = d => new Date(d.getTime() + 330 * 6e4).toISOString().slice(0, 10);

// Converts Ads API JSON rows to the row shape the upload parsers read
const toRows = (list, extra = () => ({})) => list.map(x => ({
  date: x.date, campaignid: String(x.campaignId), campaignname: x.campaignName, campaignstatus: x.campaignStatus || "", budget: x.campaignBudgetAmount ?? "",
  impressions: x.impressions, clicks: x.clicks, spend: x.cost, sales: x.sales7d ?? x.sales ?? x.sales14d ?? 0, orders: x.purchases7d ?? x.purchases ?? x.purchases14d ?? 0, units: x.unitsSoldClicks7d ?? x.unitsSold ?? 0, ...extra(x)
}));

export async function syncAds(orgId, log = () => {}) {
  const conn = await one("select * from connections where org_id=$1 and kind='ads_api'", [orgId]);
  if (!conn) throw new Error("Amazon Ads account is not connected.");
  const ads = adsClient(adsCredentials(conn)), first = !conn.last_sync_at, done = [];
  const span = first ? 60 : 14, windows = [];
  for (let s = span; s > 0; s -= 31) windows.push([ymd(new Date(Date.now() - s * 864e5)), ymd(new Date(Date.now() - Math.max(1, s - 30) * 864e5))]);
  const base = ["date", "campaignId", "campaignName", "campaignStatus", "campaignBudgetAmount", "impressions", "clicks", "cost"];
  const save = async (reportId, rows, adType) => {
    if (!rows.length) return;
    const r = await importRows({ orgId, source: "ads_api", reportId, rows, adType });
    done.push(`${r.label} ${adType || ""}: ${r.rowsSaved}`);
  };
  for (const [a, b] of windows) {
    await save("ads_campaigns", toRows(await ads.report("SPONSORED_PRODUCTS", "spCampaigns", ["campaign"], [...base, "sales7d", "purchases7d", "unitsSoldClicks7d"], a, b)), "SP");
    await save("ads_placement", toRows(await ads.report("SPONSORED_PRODUCTS", "spCampaigns", ["campaign", "campaignPlacement"], ["date", "campaignId", "campaignName", "placementClassification", "impressions", "clicks", "cost", "sales7d", "purchases7d"], a, b), x => ({ placement: x.placementClassification })), "SP");
    await save("ads_search_terms", toRows(await ads.report("SPONSORED_PRODUCTS", "spSearchTerm", ["searchTerm"], ["date", "campaignId", "campaignName", "adGroupName", "targeting", "matchType", "searchTerm", "impressions", "clicks", "cost", "sales7d", "purchases7d"], a, b),
      x => ({ adgroupname: x.adGroupName, targeting: x.targeting, matchtype: x.matchType, customersearchterm: x.searchTerm })), "SP");
    await save("ads_campaigns", toRows(await ads.report("SPONSORED_BRANDS", "sbCampaigns", ["campaign"], [...base, "sales", "purchases", "unitsSold"], a, b)), "SB");
    await save("ads_campaigns", toRows(await ads.report("SPONSORED_DISPLAY", "sdCampaigns", ["campaign"], [...base, "sales", "purchases", "unitsSold"], a, b)), "SD");
  }
  const [a, b] = windows[windows.length - 1];
  await save("ads_products", toRows(await ads.report("SPONSORED_PRODUCTS", "spAdvertisedProduct", ["advertiser"], ["campaignId", "campaignName", "advertisedSku", "advertisedAsin", "cost"], a, b), x => ({ advertisedsku: x.advertisedSku, advertisedasin: x.advertisedAsin })), "SP");
  await q("update campaigns set remote=true where org_id=$1 and campaign_id ~ '^[0-9]+$'", [orgId]);
  await q("update connections set last_sync_at=now(), last_error=null, status='connected' where org_id=$1 and kind='ads_api'", [orgId]);
  log(`Ads sync for org ${orgId}: ${done.join("; ")}`);
  return done;
}

// Sends a status or budget change to Amazon when the campaign came from the Ads API. Returns { pushed, error }.
export async function pushCampaign(orgId, campaign, change) {
  if (!campaign.remote) return { pushed: false };
  const conn = await one("select * from connections where org_id=$1 and kind='ads_api'", [orgId]);
  if (!conn) return { pushed: false };
  try {
    await adsClient(adsCredentials(conn)).updateCampaign(campaign.ad_type, campaign.campaign_id, change);
    return { pushed: true };
  } catch (e) { return { pushed: false, error: e.message }; }
}
