import crypto from "node:crypto";
import { config } from "../config.js";

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

// AES-256-GCM for marketplace credentials stored in the database
export function encrypt(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", config.encKey, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString("base64")).join(".");
}
export function decrypt(str) {
  if (!str) return null;
  const [iv, tag, data] = str.split(".").map(s => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", config.encKey, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
}

export function hmacHex(secret, payload) { return crypto.createHmac("sha256", secret).update(payload).digest("hex"); }
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
