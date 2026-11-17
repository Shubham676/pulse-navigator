import bcrypt from "bcryptjs";
import { one, q } from "../db.js";
import { config } from "../config.js";
import { randomToken, sha256 } from "./crypto.js";

export const COOKIE = "pulse_session";
const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };

export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 11);
export const hashPassword = pw => bcrypt.hash(pw, 11);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export async function createSession(reply, userId, orgId) {
  const token = randomToken(32), expires = new Date(Date.now() + config.sessionDays * 864e5);
  await q("insert into sessions (token_hash, user_id, org_id, expires_at) values ($1,$2,$3,$4)", [sha256(token), userId, orgId, expires]);
  reply.setCookie(COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure: config.isProd, expires });
}

export async function destroySession(req, reply) {
  const t = req.cookies[COOKIE];
  if (t) await q("delete from sessions where token_hash=$1", [sha256(t)]);
  reply.clearCookie(COOKIE, { path: "/" });
}

// Fastify preHandler: loads the user, the current org and the user's role in it.
export async function requireAuth(req) {
  const t = req.cookies[COOKIE];
  if (!t) throw new HttpError(401, "Please sign in.", "auth");
  const s = await one(
    `select s.token_hash, s.org_id, u.id as user_id, u.email, u.name
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`, [sha256(t)]);
  if (!s) throw new HttpError(401, "Your session has ended. Please sign in again.", "auth");
  req.user = { id: s.user_id, email: s.email, name: s.name };
  req.sessionHash = s.token_hash;
  let m = s.org_id ? await one("select m.role, o.* from memberships m join orgs o on o.id=m.org_id where m.user_id=$1 and m.org_id=$2", [s.user_id, s.org_id]) : null;
  if (!m) { // fall back to any org the user belongs to
    m = await one("select m.role, o.* from memberships m join orgs o on o.id=m.org_id where m.user_id=$1 order by o.id limit 1", [s.user_id]);
    if (m) await q("update sessions set org_id=$1 where token_hash=$2", [m.id, s.token_hash]);
  }
  req.org = m ? { id: m.id, name: m.name, role: m.role, marketplace: m.marketplace, targetAcos: m.target_acos, feeRate: m.fee_rate, walletPaise: m.wallet_paise } : null;
}

export function requireOrg(req) { if (!req.org) throw new HttpError(403, "Create or join a brand first.", "no_org"); }
export function requireRole(req, min) {
  requireOrg(req);
  if (ROLE_RANK[req.org.role] < ROLE_RANK[min]) throw new HttpError(403, `This needs ${min} access. Ask the brand owner.`, "role");
}
export const canEdit = req => requireRole(req, "member");
export const canAdmin = req => requireRole(req, "admin");

export async function audit(req, action, detail = {}) {
  await q("insert into audit_log (org_id, user_id, action, detail) values ($1,$2,$3,$4)", [req.org?.id || null, req.user?.id || null, action, detail]);
}
