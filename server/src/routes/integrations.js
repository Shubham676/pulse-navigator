// Connections hub: platform catalog, saved connections (credentials encrypted), connection tests and inbound webhooks.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { one, many, q } from "../db.js";
import { config } from "../config.js";
import { encrypt, decrypt, randomToken, hmacHex, safeEqual } from "../lib/crypto.js";
import { requireAuth, requireOrg, canAdmin, canEdit, HttpError, audit } from "../lib/auth.js";
import { PLATFORMS, CATEGORIES, byId } from "../integrations/catalog.js";
import { TESTERS } from "../integrations/testers.js";

const logosDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../web/public/logos");
const MAX_EVENT_TEXT = 64 * 1024, KEEP_EVENTS = 500;

function logoFor(id) {
  for (const ext of ["svg", "png", "webp"]) if (fs.existsSync(path.join(logosDir, `${id}.${ext}`))) return `logos/${id}.${ext}`;
  return null;
}
const webhookUrl = token => `${config.publicUrl}/api/webhooks/in/${token}`;
const mask = v => { const s = String(v || ""); return s.length <= 4 ? "••••" : "••••" + s.slice(-4); };

function platformOr404(id) {
  const p = byId[id];
  if (!p || p.access === "live") throw new HttpError(404, "Unknown platform.");
  return p;
}

// What the browser may see about a saved connection: never the secrets themselves.
function present(row, p, { admin }) {
  const secrets = row.secrets_enc ? decrypt(row.secrets_enc) : {};
  return {
    platform: row.platform, status: row.status, message: row.message, lastTestAt: row.last_test_at, updatedAt: row.updated_at,
    settings: row.settings,
    secrets: Object.fromEntries(p.fields.filter(f => f.type === "secret" && secrets[f.key]).map(f => [f.key, mask(secrets[f.key])])),
    webhookUrl: p.webhook ? webhookUrl(row.webhook_token) : null,
    signingSecret: admin ? decrypt(row.signing_enc).secret : null
  };
}

export default async function integrationRoutes(app) {
  // The platform list, with logos found on disk
  app.get("/api/integrations/catalog", { preHandler: requireAuth }, async () => ({
    categories: CATEGORIES,
    platforms: PLATFORMS.map(p => ({ id: p.id, name: p.name, category: p.category, color: p.color, letters: p.letters, access: p.access, note: p.note || "",
      webhook: p.webhook, testable: !!TESTERS[p.id], logo: logoFor(p.id),
      fields: p.fields.map(({ key, label, type, required, placeholder }) => ({ key, label, type, required, placeholder: placeholder || "" })) }))
  }));

  app.get("/api/integrations", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const admin = ["owner", "admin"].includes(req.org.role);
    const rows = await many("select * from integrations where org_id=$1 order by platform", [req.org.id]);
    const counts = await many("select integration_id, count(*)::int n, max(received_at) last from webhook_events where org_id=$1 group by integration_id", [req.org.id]);
    const byInt = Object.fromEntries(counts.map(c => [c.integration_id, c]));
    return { integrations: rows.filter(r => byId[r.platform]).map(r => ({ ...present(r, byId[r.platform], { admin }), events: byInt[r.id]?.n || 0, lastEventAt: byInt[r.id]?.last || null })) };
  });

  async function runTest(req, row, p) {
    const tester = TESTERS[p.id];
    if (!tester) {
      const msg = p.access === "partner" ? "Saved. API sync starts once the platform gives partner API access." : p.access === "webhook" ? "Ready to receive webhooks." : "Saved securely. Data sync for this platform is not built yet.";
      await q("update integrations set status='saved', message=$2, updated_at=now() where id=$1", [row.id, msg]);
      return { ok: true, status: "saved", message: msg };
    }
    const fields = { ...row.settings, ...(row.secrets_enc ? decrypt(row.secrets_enc) : {}) };
    try {
      const msg = await tester(fields, { orgName: req.org.name, signingSecret: decrypt(row.signing_enc).secret });
      await q("update integrations set status='connected', message=$2, last_test_at=now(), updated_at=now() where id=$1", [row.id, msg]);
      return { ok: true, status: "connected", message: msg };
    } catch (e) {
      const msg = String(e.message || e).slice(0, 300);
      await q("update integrations set status='error', message=$2, last_test_at=now(), updated_at=now() where id=$1", [row.id, msg]);
      return { ok: false, status: "error", message: msg };
    }
  }

  // Save credentials (blank secret fields keep the saved value), then test
  app.put("/api/integrations/:platform", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const p = platformOr404(req.params.platform);
    const input = z.object({ fields: z.record(z.string(), z.string().max(4000)).default({}) }).parse(req.body || {}).fields;
    const existing = await one("select * from integrations where org_id=$1 and platform=$2", [req.org.id, p.id]);
    const oldSecrets = existing?.secrets_enc ? decrypt(existing.secrets_enc) : {};
    const settings = {}, secrets = {};
    for (const f of p.fields) {
      const v = (input[f.key] ?? "").trim();
      if (f.type === "secret") { if (v) secrets[f.key] = v; else if (oldSecrets[f.key]) secrets[f.key] = oldSecrets[f.key]; }
      else if (v) settings[f.key] = v;
      if (f.required && !(f.type === "secret" ? secrets[f.key] : settings[f.key])) throw new HttpError(400, `Enter ${f.label.toLowerCase()}.`);
    }
    const secretsEnc = Object.keys(secrets).length ? encrypt(secrets) : null;
    const row = existing
      ? await one("update integrations set settings=$2, secrets_enc=$3, updated_at=now() where id=$1 returning *", [existing.id, settings, secretsEnc])
      : await one(`insert into integrations (org_id, platform, settings, secrets_enc, webhook_token, signing_enc, created_by)
                   values ($1,$2,$3,$4,$5,$6,$7) returning *`, [req.org.id, p.id, settings, secretsEnc, randomToken(24), encrypt({ secret: "whsec_" + randomToken(24) }), req.user.id]);
    await audit(req, "integration.save", { platform: p.id });
    const result = await runTest(req, row, p);
    const fresh = await one("select * from integrations where id=$1", [row.id]);
    return { ...result, integration: present(fresh, p, { admin: true }) };
  });

  app.post("/api/integrations/:platform/test", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const p = platformOr404(req.params.platform);
    const row = await one("select * from integrations where org_id=$1 and platform=$2", [req.org.id, p.id]);
    if (!row) throw new HttpError(404, "Save the connection first.");
    return runTest(req, row, p);
  });

  // New webhook address and signing secret (the old address stops working)
  app.post("/api/integrations/:platform/rotate", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const p = platformOr404(req.params.platform);
    const row = await one("update integrations set webhook_token=$3, signing_enc=$4, updated_at=now() where org_id=$1 and platform=$2 returning *",
      [req.org.id, p.id, randomToken(24), encrypt({ secret: "whsec_" + randomToken(24) })]);
    if (!row) throw new HttpError(404, "Save the connection first.");
    await audit(req, "integration.rotate", { platform: p.id });
    return { integration: present(row, p, { admin: true }) };
  });

  app.delete("/api/integrations/:platform", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const p = platformOr404(req.params.platform);
    await q("delete from integrations where org_id=$1 and platform=$2", [req.org.id, p.id]);
    await audit(req, "integration.delete", { platform: p.id });
    return { ok: true };
  });

  // Recent webhook events (may contain customer details, so members and above only)
  app.get("/api/integrations/events", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const platform = typeof req.query.platform === "string" ? req.query.platform : null;
    const rows = await many(`select id, platform, topic, verified, body, body_text, received_at from webhook_events
      where org_id=$1 and ($2::text is null or platform=$2) order by id desc limit 50`, [req.org.id, platform]);
    return { events: rows };
  });

  // Public inbound webhook: /api/webhooks/in/<token>. Keeps the raw body to check signatures.
  app.register(async scoped => {
    const keepRaw = (req, body, done) => { req.rawBody = body; done(null, body); };
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser("*", { parseAs: "string" }, keepRaw);
    scoped.post("/api/webhooks/in/:token", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
      const row = await one("select * from integrations where webhook_token=$1", [String(req.params.token)]);
      const p = row && byId[row.platform];
      if (!row || !p?.webhook) return reply.status(404).send({ error: "Unknown webhook address." });
      const raw = typeof req.rawBody === "string" ? req.rawBody : "";
      const secrets = row.secrets_enc ? decrypt(row.secrets_enc) : {};
      const h = req.headers;
      const b64 = s => crypto.createHmac("sha256", s).update(raw).digest("base64");
      let verified = false, topic = null;
      if (p.webhook === "shopify") {
        topic = h["x-shopify-topic"] || null;
        if (secrets.api_secret) { if (!safeEqual(b64(secrets.api_secret), h["x-shopify-hmac-sha256"] || "")) return reply.status(401).send({ error: "Bad signature." }); verified = true; }
      } else if (p.webhook === "woocommerce") {
        topic = h["x-wc-webhook-topic"] || (raw.startsWith("webhook_id=") ? "ping" : null);
        if (secrets.webhook_secret && h["x-wc-webhook-signature"]) { if (!safeEqual(b64(secrets.webhook_secret), h["x-wc-webhook-signature"])) return reply.status(401).send({ error: "Bad signature." }); verified = true; }
      } else {
        const sig = String(h["x-pulse-signature"] || "");
        if (sig) { if (!safeEqual("sha256=" + hmacHex(decrypt(row.signing_enc).secret, raw), sig)) return reply.status(401).send({ error: "Bad signature." }); verified = true; }
        topic = h["x-event-type"] || h["x-topic"] || null;
      }
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
      if (!topic && body && typeof body === "object") topic = body.event || body.topic || body.type || null;
      const ins = await one(`insert into webhook_events (org_id, integration_id, platform, topic, verified, body, body_text) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [row.org_id, row.id, row.platform, topic ? String(topic).slice(0, 200) : null, verified, body && typeof body === "object" ? body : null, body && typeof body === "object" ? null : raw.slice(0, MAX_EVENT_TEXT)]);
      await q(`delete from webhook_events where integration_id=$1 and id < (select id from webhook_events where integration_id=$1 order by id desc offset ${KEEP_EVENTS} limit 1)`, [row.id]);
      return { ok: true, id: Number(ins.id) };
    });
  });
}
