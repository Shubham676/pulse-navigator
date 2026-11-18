import { VERSION, RELEASED } from "../version.js";
import { z } from "zod";
import { one, many, q, tx } from "../db.js";
import { config } from "../config.js";
import { randomToken } from "../lib/crypto.js";
import { DUMMY_HASH, HttpError, hashPassword, checkPassword, createSession, destroySession, requireAuth, canAdmin, requireOrg, audit } from "../lib/auth.js";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(10, "Use at least 10 characters for the password.").max(200);
const name = z.string().trim().min(1, "Enter your name.").max(120);
const brand = z.string().trim().min(1, "Enter the brand name.").max(120);

const DEFAULT_MEMORY = ["Target ACoS is 30%", "Reply in simple English"];

async function newOrg(client, userId, orgName) {
  const o = (await client.query("insert into orgs (name) values ($1) returning id", [orgName])).rows[0];
  await client.query("insert into memberships (org_id, user_id, role) values ($1,$2,'owner')", [o.id, userId]);
  for (const f of DEFAULT_MEMORY) await client.query("insert into copilot_memory (org_id, fact) values ($1,$2)", [o.id, f]);
  return o.id;
}

export default async function authRoutes(app) {
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } };

  app.post("/api/auth/signup", authLimit, async (req, reply) => {
    if (!config.allowSignup) throw new HttpError(403, "Sign-up is closed. Ask an existing user for an invite.");
    const b = z.object({ name, email, password, brand }).parse(req.body);
    if (await one("select 1 from users where email=$1", [b.email])) throw new HttpError(409, "An account with this email already exists. Sign in instead.");
    const hash = await hashPassword(b.password);
    const { userId, orgId } = await tx(async c => {
      const u = (await c.query("insert into users (email, name, password_hash) values ($1,$2,$3) returning id", [b.email, b.name, hash])).rows[0];
      return { userId: u.id, orgId: await newOrg(c, u.id, b.brand) };
    });
    await createSession(reply, userId, orgId);
    return { ok: true };
  });

  app.post("/api/auth/login", authLimit, async (req, reply) => {
    const b = z.object({ email, password: z.string().min(1, "Enter your password.") }).parse(req.body);
    const u = await one("select id, password_hash from users where email=$1", [b.email]);
    // compare against a dummy hash when the user does not exist, so timing does not reveal registered emails
    const ok = await checkPassword(b.password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, "Email or password is wrong.");
    await createSession(reply, u.id, null);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => { await destroySession(req, reply); return { ok: true }; });

  app.get("/api/me", { preHandler: requireAuth }, async req => {
    const orgs = await many("select o.id, o.name, m.role from memberships m join orgs o on o.id=m.org_id where m.user_id=$1 order by o.name", [req.user.id]);
    return { user: req.user, org: req.org, orgs, features: { ai: !!config.ai.apiKey, payments: !!config.razorpay.keyId, amazonApp: !!config.amazon.lwaClientId }, app: { version: VERSION, released: RELEASED } };
  });

  app.post("/api/orgs", { preHandler: requireAuth }, async req => {
    const b = z.object({ name: brand }).parse(req.body);
    const id = await tx(c => newOrg(c, req.user.id, b.name));
    await q("update sessions set org_id=$1 where token_hash=$2", [id, req.sessionHash]);
    return { id };
  });

  app.post("/api/orgs/switch", { preHandler: requireAuth }, async req => {
    const b = z.object({ orgId: z.number().int() }).parse(req.body);
    if (!await one("select 1 from memberships where org_id=$1 and user_id=$2", [b.orgId, req.user.id])) throw new HttpError(404, "You are not part of that brand.");
    await q("update sessions set org_id=$1 where token_hash=$2", [b.orgId, req.sessionHash]);
    return { ok: true };
  });

  app.patch("/api/org", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const b = z.object({ name: brand.optional(), targetAcos: z.number().min(1, "Target ACoS must be at least 1%.").max(200).optional(), feeRate: z.number().min(0).max(0.6, "Fee rate cannot be above 60%.").optional(), marketplace: z.string().max(40).optional(),
      billing: z.object({ name: z.string().max(200), gstin: z.string().regex(/^$|^[0-9]{2}[A-Z0-9]{13}$/, "GSTIN should be 15 characters, starting with the state code."), stateCode: z.string().regex(/^$|^[0-9]{2}$/, "State code is two digits."), address: z.string().max(400) }).optional() }).parse(req.body);
    await q(`update orgs set name=coalesce($2,name), target_acos=coalesce($3,target_acos), fee_rate=coalesce($4,fee_rate), marketplace=coalesce($5,marketplace) where id=$1`,
      [req.org.id, b.name ?? null, b.targetAcos ?? null, b.feeRate ?? null, b.marketplace ?? null]);
    if (b.billing) await q("update orgs set billing_name=nullif($2,''), billing_gstin=nullif($3,''), billing_state_code=nullif($4,''), billing_address=nullif($5,'') where id=$1", [req.org.id, b.billing.name, b.billing.gstin, b.billing.stateCode, b.billing.address]);
    await audit(req, "org.update", b);
    return { ok: true };
  });

  // Team
  app.get("/api/team", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const members = await many("select u.id, u.name, u.email, m.role from memberships m join users u on u.id=m.user_id where m.org_id=$1 order by u.name", [req.org.id]);
    const invites = await many("select email, role, created_at from invites where org_id=$1 and accepted_at is null order by created_at desc", [req.org.id]);
    return { members, invites };
  });

  app.post("/api/team/invite", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const b = z.object({ email, role: z.enum(["admin", "member", "viewer"]) }).parse(req.body);
    const token = randomToken(24);
    await q("insert into invites (token, org_id, email, role, invited_by) values ($1,$2,$3,$4,$5)", [token, req.org.id, b.email, b.role, req.user.id]);
    await audit(req, "team.invite", { email: b.email, role: b.role });
    return { link: `${config.publicUrl}/#invite=${token}` };
  });

  app.delete("/api/team/:userId", { preHandler: requireAuth }, async req => {
    canAdmin(req);
    const id = Number(req.params.userId);
    const m = await one("select role from memberships where org_id=$1 and user_id=$2", [req.org.id, id]);
    if (!m) throw new HttpError(404, "That person is not on this brand.");
    if (m.role === "owner") throw new HttpError(400, "The owner cannot be removed.");
    await q("delete from memberships where org_id=$1 and user_id=$2", [req.org.id, id]);
    await audit(req, "team.remove", { userId: id });
    return { ok: true };
  });

  // Accept an invite: signed-in users join directly; new people create an account at the same time.
  app.post("/api/invites/accept", authLimit, async (req, reply) => {
    const b = z.object({ token: z.string().min(10), name: name.optional(), password: password.optional() }).parse(req.body);
    const inv = await one("select * from invites where token=$1 and accepted_at is null and created_at > now() - interval '14 days'", [b.token]);
    if (!inv) throw new HttpError(404, "This invite link has expired or was already used.");
    let userId = (await one("select id from users where email=$1", [inv.email]))?.id;
    if (!userId) {
      if (!b.name || !b.password) throw new HttpError(400, "Enter your name and a password to create your account.", "needs_account");
      userId = (await one("insert into users (email, name, password_hash) values ($1,$2,$3) returning id", [inv.email, b.name, await hashPassword(b.password)])).id;
    } else if (b.password) {
      const u = await one("select password_hash from users where id=$1", [userId]);
      if (!await checkPassword(b.password, u.password_hash)) throw new HttpError(401, "Password is wrong for this email.");
    } else throw new HttpError(400, `Sign in as ${inv.email} to accept.`, "needs_login");
    await q("insert into memberships (org_id, user_id, role) values ($1,$2,$3) on conflict do nothing", [inv.org_id, userId, inv.role]);
    await q("update invites set accepted_at=now() where token=$1", [b.token]);
    await createSession(reply, userId, inv.org_id);
    return { ok: true };
  });
}
