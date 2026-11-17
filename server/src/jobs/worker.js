// A small Postgres-backed job queue. Runs inside the web process; safe with several instances
// because jobs are claimed with FOR UPDATE SKIP LOCKED.
import { q, one, many } from "../db.js";
import { config } from "../config.js";

const HANDLERS = {
  sp_sync: async (job, log) => (await import("../amazon/spapi.js")).syncSpApi(job.org_id, log),
  ads_sync: async (job, log) => (await import("../amazon/ads.js")).syncAds(job.org_id, log)
};

export async function enqueue(orgId, kind, payload = {}, delayMs = 0) {
  const pending = await one("select id from jobs where org_id=$1 and kind=$2 and state in ('queued','running')", [orgId, kind]);
  if (pending) return false;
  await q("insert into jobs (org_id, kind, payload, run_after) values ($1,$2,$3, now() + ($4 || ' milliseconds')::interval)", [orgId, kind, payload, String(delayMs)]);
  return true;
}

async function claim() {
  return one(`update jobs set state='running', attempts=attempts+1, updated_at=now()
               where id = (select id from jobs where state='queued' and run_after <= now() order by id for update skip locked limit 1)
               returning *`);
}

async function runOne(log) {
  const job = await claim();
  if (!job) return false;
  const conn = job.kind === "sp_sync" ? "sp_api" : job.kind === "ads_sync" ? "ads_api" : null;
  try {
    const out = await HANDLERS[job.kind](job, m => log.info(m));
    await q("update jobs set state='done', result=$2, updated_at=now() where id=$1", [job.id, Array.isArray(out) ? out.join("; ").slice(0, 2000) : "done"]);
  } catch (e) {
    const retry = job.attempts < 3;
    log.warn(`job ${job.id} ${job.kind} failed: ${e.message}`);
    await q(`update jobs set state=$2, result=$3, run_after=now() + ($4 || ' minutes')::interval, updated_at=now() where id=$1`,
      [job.id, retry ? "queued" : "failed", e.message.slice(0, 1000), String(10 * job.attempts)]);
    if (conn) await q("update connections set last_error=$3, status=$4 where org_id=$1 and kind=$2", [job.org_id, conn, e.message.slice(0, 500), e.status === 401 || e.status === 403 ? "needs_attention" : "connected"]);
  }
  return true;
}

// Queues a sync for every connection whose last sync is older than SYNC_EVERY_HOURS
async function schedule() {
  const due = await many(`select org_id, kind from connections where status <> 'disabled' and (last_sync_at is null or last_sync_at < now() - ($1 || ' hours')::interval)`, [String(config.syncEveryHours)]);
  for (const c of due) await enqueue(c.org_id, c.kind === "sp_api" ? "sp_sync" : "ads_sync");
  // a job left 'running' by a crashed process is released after an hour
  await q("update jobs set state='queued', updated_at=now() where state='running' and updated_at < now() - interval '1 hour'");
}

export function startWorker(log = console) {
  let stopped = false, busy = false;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try { while (!stopped && await runOne(log)); } catch (e) { log.error(e); } finally { busy = false; }
  };
  const t1 = setInterval(tick, 5000), t2 = setInterval(() => schedule().catch(e => log.error(e)), 10 * 6e4);
  // Dayparting runs every 5 minutes so campaigns switch close to the hour
  const t3 = setInterval(() => import("../routes/ads.js").then(m => m.runDayparts(x => log.info(x))).catch(e => log.error(e)), 5 * 6e4);
  schedule().catch(e => log.error(e));
  return () => { stopped = true; clearInterval(t1); clearInterval(t2); clearInterval(t3); };
}
