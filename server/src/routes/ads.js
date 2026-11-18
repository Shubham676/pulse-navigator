// Campaign changes, negative keywords, trackers and dayparting schedules.
import { z } from "zod";
import { one, many, q } from "../db.js";
import { requireAuth, canEdit, HttpError } from "../lib/auth.js";
import { pushCampaign } from "../amazon/ads.js";

export default async function adsRoutes(app) {
  // Change one campaign: status, daily budget, or a bid adjustment recorded as a plan
  app.post("/api/ads/campaigns/:id", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const b = z.object({ status: z.enum(["Live", "Paused"]).optional(), budget: z.number().positive().max(10_000_000).optional(), bidAdjust: z.number().int().min(-90).max(300).optional(), reason: z.string().max(120).optional() }).parse(req.body);
    const c = await one("select * from campaigns where org_id=$1 and campaign_id=$2", [req.org.id, req.params.id]);
    if (!c) throw new HttpError(404, "Campaign not found.");
    await q(`update campaigns set status=coalesce($3,status), daily_budget=coalesce($4,daily_budget), bid_adjust_pct=coalesce($5,bid_adjust_pct), paused_by_daypart=false, updated_at=now() where org_id=$1 and campaign_id=$2`,
      [req.org.id, c.campaign_id, b.status ?? null, b.budget ?? null, b.bidAdjust ?? null]);
    // Status and budget can go to Amazon; bid adjustments are kept as a plan because Amazon's reports do not tell us each keyword's bid
    const change = {}; if (b.status) change.state = b.status === "Live" ? "ENABLED" : "PAUSED"; if (b.budget) change.budget = b.budget;
    const res = Object.keys(change).length ? await pushCampaign(req.org.id, c, change) : { pushed: false };
    const action = b.reason || (b.status ? (b.status === "Live" ? "Switched on" : "Paused") : b.budget ? `Budget set to ₹${b.budget}` : `Bid change ${b.bidAdjust > 0 ? "+" : ""}${b.bidAdjust}%`);
    await q("insert into ad_changes (org_id, user_id, campaign_id, action, detail, pushed, push_error) values ($1,$2,$3,$4,$5,$6,$7)",
      [req.org.id, req.user.id, c.campaign_id, action, { name: c.name, ...b }, res.pushed, res.error || null]);
    return { ok: true, pushed: res.pushed, error: res.error };
  });

  app.post("/api/ads/negatives", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const b = z.object({ campaignId: z.string(), keywords: z.array(z.string().min(1).max(200)).min(1).max(200) }).parse(req.body);
    const c = await one("select name from campaigns where org_id=$1 and campaign_id=$2", [req.org.id, b.campaignId]);
    if (!c) throw new HttpError(404, "Campaign not found.");
    for (const k of b.keywords) await q("insert into negative_keywords (org_id, campaign_id, keyword) values ($1,$2,$3) on conflict do nothing", [req.org.id, b.campaignId, k.toLowerCase()]);
    await q("insert into ad_changes (org_id, user_id, campaign_id, action, detail) values ($1,$2,$3,$4,$5)", [req.org.id, req.user.id, b.campaignId, `Added ${b.keywords.length} negative keywords`, { name: c.name, keywords: b.keywords }]);
    return { ok: true, pushed: false };
  });

  // Negative keywords as an Amazon bulk-operations sheet (CSV) to upload in the Ads console
  app.get("/api/ads/negatives.csv", { preHandler: requireAuth }, async (req, reply) => {
    canEdit(req);
    const rows = await many("select n.keyword, n.match_type, c.name from negative_keywords n join campaigns c on c.org_id=n.org_id and c.campaign_id=n.campaign_id where n.org_id=$1 order by c.name", [req.org.id]);
    const esc = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="pulse-negative-keywords.csv"');
    return ["Campaign Name,Keyword Text,Match Type", ...rows.map(r => [r.name, r.keyword, "Negative Exact"].map(esc).join(","))].join("\n");
  });

  const tracker = z.object({ name: z.string().trim().min(1).max(80), metric: z.enum(["ROAS", "ACoS", "Spend", "Clicks", "Orders", "CTR"]), op: z.enum([">", "<", "="]), value: z.number() });
  app.post("/api/ads/trackers", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const b = tracker.parse(req.body);
    await q("insert into trackers (org_id, name, metric, op, value, frequency, range_days, level) values ($1,$2,$3,$4,$5,'Daily',31,'Campaigns')", [req.org.id, b.name, b.metric, b.op, b.value]);
    return { ok: true };
  });
  app.patch("/api/ads/trackers/:id", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const b = z.object({ enabled: z.boolean() }).parse(req.body);
    await q("update trackers set enabled=$3 where org_id=$1 and id=$2", [req.org.id, Number(req.params.id), b.enabled]);
    return { ok: true };
  });
  app.delete("/api/ads/trackers/:id", { preHandler: requireAuth }, async req => {
    canEdit(req);
    await q("delete from trackers where org_id=$1 and id=$2", [req.org.id, Number(req.params.id)]);
    return { ok: true };
  });

  app.post("/api/ads/dayparts", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const b = z.object({ campaignId: z.string(), days: z.enum(["Every day", "Weekdays", "Weekends"]), hours: z.array(z.number().int().min(0).max(23)).min(1).max(23) }).parse(req.body);
    if (!await one("select 1 from campaigns where org_id=$1 and campaign_id=$2", [req.org.id, b.campaignId])) throw new HttpError(404, "Campaign not found.");
    await q("insert into dayparts (org_id, campaign_id, days, hours_off) values ($1,$2,$3,$4)", [req.org.id, b.campaignId, b.days, [...new Set(b.hours)].sort((x, y) => x - y)]);
    return { ok: true };
  });
  app.delete("/api/ads/dayparts/:id", { preHandler: requireAuth }, async req => {
    canEdit(req);
    await q("delete from dayparts where org_id=$1 and id=$2", [req.org.id, Number(req.params.id)]);
    return { ok: true };
  });
}

// Run by the worker every few minutes: pauses synced campaigns in their off hours and switches back on
// only the ones Pulse Navigator paused.
export async function runDayparts(log = () => {}) {
  const now = new Date(Date.now() + 330 * 6e4), hour = now.getUTCHours(), dow = now.getUTCDay(), weekend = dow === 0 || dow === 6;
  const rows = await many(`select d.org_id, d.days, d.hours_off, c.* from dayparts d join campaigns c on c.org_id=d.org_id and c.campaign_id=d.campaign_id where c.remote`);
  for (const r of rows) {
    const today = r.days === "Every day" || (r.days === "Weekends") === weekend;
    const off = today && r.hours_off.includes(hour);
    if (off && r.status === "Live") {
      const res = await pushCampaign(r.org_id, r, { state: "PAUSED" });
      if (res.pushed) { await q("update campaigns set status='Paused', paused_by_daypart=true where org_id=$1 and campaign_id=$2", [r.org_id, r.campaign_id]); log(`daypart paused ${r.name}`); }
    } else if (!off && r.status === "Paused" && r.paused_by_daypart) {
      const res = await pushCampaign(r.org_id, r, { state: "ENABLED" });
      if (res.pushed) { await q("update campaigns set status='Live', paused_by_daypart=false where org_id=$1 and campaign_id=$2", [r.org_id, r.campaign_id]); log(`daypart enabled ${r.name}`); }
    }
  }
}
