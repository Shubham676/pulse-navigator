// Prepaid wallet: Razorpay top-ups with 18% GST, idempotent crediting, GST invoices.
import { z } from "zod";
import { one, many, q, tx } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireOrg, canAdmin, HttpError, audit } from "../lib/auth.js";
import { hmacHex, safeEqual } from "../lib/crypto.js";

const GST = 0.18;
const payEnabled = () => !!(config.razorpay.keyId && config.razorpay.keySecret);
const testCredit = () => !config.isProd && process.env.ALLOW_TEST_CREDIT === "true";

// Marks a payment as paid and credits the wallet once, however many times it is called
async function creditPayment(orderId, paymentId) {
  return tx(async c => {
    const p = (await c.query("select * from payments where order_id=$1 for update", [orderId])).rows[0];
    if (!p) throw new HttpError(404, "Payment not found.");
    if (p.status === "paid") return p;
    const inv = (await c.query("select 'PUL-' || nextval('invoice_seq') as no")).rows[0].no;
    await c.query("update payments set status='paid', payment_id=$2, invoice_no=$3, paid_at=now() where order_id=$1", [orderId, paymentId, inv]);
    await c.query("update orgs set wallet_paise = wallet_paise + $2 where id=$1", [p.org_id, p.credit_paise]);
    await c.query("insert into wallet_ledger (org_id, amount_paise, kind, description, ref) values ($1,$2,'topup',$3,$4) on conflict (ref) do nothing", [p.org_id, p.credit_paise, `Wallet top-up (invoice ${inv})`, "pay:" + paymentId]);
    return { ...p, invoice_no: inv, status: "paid" };
  });
}

export default async function walletRoutes(app) {
  app.get("/api/wallet", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const [o, ledger, invoices] = await Promise.all([
      one("select wallet_paise from orgs where id=$1", [req.org.id]),
      many("select amount_paise, kind, description, created_at from wallet_ledger where org_id=$1 order by id desc limit 200", [req.org.id]),
      many("select invoice_no, amount_paise, credit_paise, paid_at from payments where org_id=$1 and status='paid' order by paid_at desc", [req.org.id])
    ]);
    return { balance: o.wallet_paise / 100, ledger, invoices, payments: payEnabled() || testCredit() };
  });

  app.post("/api/wallet/topup", { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async req => {
    canAdmin(req);
    const b = z.object({ amount: z.number().int().min(100, "The smallest top-up is ₹100.").max(100000) }).parse(req.body);
    const credit = b.amount * 100, total = Math.round(credit * (1 + GST));
    if (!payEnabled()) {
      if (!testCredit()) throw new HttpError(400, "Online payments are not set up yet. Ask the Pulse team to add Razorpay keys.");
      const id = "test_" + Date.now();
      await q("insert into payments (order_id, org_id, amount_paise, credit_paise) values ($1,$2,$3,$4)", [id, req.org.id, total, credit]);
      await creditPayment(id, id);
      await audit(req, "wallet.test_credit", { amount: b.amount });
      return { credited: true };
    }
    const auth = "Basic " + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", { method: "POST", headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ amount: total, currency: "INR", receipt: `org${req.org.id}-${Date.now()}`, notes: { org_id: String(req.org.id), credit_paise: String(credit) } }) });
    const o = await res.json().catch(() => ({}));
    if (!res.ok) { req.log.error(o); throw new HttpError(502, "The payment provider did not respond. Try again in a minute."); }
    await q("insert into payments (order_id, org_id, amount_paise, credit_paise) values ($1,$2,$3,$4)", [o.id, req.org.id, total, credit]);
    return { orderId: o.id, amountPaise: total, keyId: config.razorpay.keyId };
  });

  // Called by the browser after Razorpay checkout succeeds
  app.post("/api/wallet/verify", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const b = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).parse(req.body);
    const expected = hmacHex(config.razorpay.keySecret, `${b.razorpay_order_id}|${b.razorpay_payment_id}`);
    if (!safeEqual(expected, b.razorpay_signature)) throw new HttpError(400, "Payment could not be verified. If money was taken, it will be credited automatically within a few minutes.");
    const p = await one("select org_id from payments where order_id=$1", [b.razorpay_order_id]);
    if (!p || p.org_id !== req.org.id) throw new HttpError(404, "Payment not found.");
    const r = await creditPayment(b.razorpay_order_id, b.razorpay_payment_id);
    return { ok: true, invoiceNo: r.invoice_no };
  });

  // Razorpay webhook (payment.captured / order.paid): credits even if the browser closed before verify
  app.register(async scoped => {
    scoped.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      req.rawBody = body;
      try { done(null, JSON.parse(body)); } catch (e) { done(e); }
    });
    scoped.post("/api/webhooks/razorpay", async (req, reply) => {
      if (!config.razorpay.webhookSecret) return reply.status(404).send({ error: "Not configured" });
      const sig = req.headers["x-razorpay-signature"] || "";
      if (!safeEqual(hmacHex(config.razorpay.webhookSecret, req.rawBody || ""), sig)) return reply.status(400).send({ error: "Bad signature" });
      const pay = req.body?.payload?.payment?.entity;
      if (["payment.captured", "order.paid"].includes(req.body?.event) && pay?.order_id && await one("select 1 from payments where order_id=$1", [pay.order_id])) await creditPayment(pay.order_id, pay.id);
      return { ok: true };
    });
  });

  // Printable GST invoice
  app.get("/api/wallet/invoices/:no", { preHandler: requireAuth }, async (req, reply) => {
    requireOrg(req);
    const p = await one("select p.*, o.name, o.billing_name, o.billing_gstin, o.billing_state_code, o.billing_address from payments p join orgs o on o.id=p.org_id where p.invoice_no=$1 and p.org_id=$2", [req.params.no, req.org.id]);
    if (!p) throw new HttpError(404, "Invoice not found.");
    const C = config.company, intra = C.stateCode && p.billing_state_code && C.stateCode === p.billing_state_code;
    const taxable = p.credit_paise / 100, tax = (p.amount_paise - p.credit_paise) / 100, r = n => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const e = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    reply.header("content-type", "text/html; charset=utf-8");
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${e(p.invoice_no)}</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#1b1f1e;max-width:760px;margin:32px auto;padding:0 16px}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}td.r,th.r{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}small{color:#666}</style></head><body>
      <h1>Tax invoice</h1><small>Invoice ${e(p.invoice_no)} · ${new Date(p.paid_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} · Payment ${e(p.payment_id)}</small>
      <div class="grid" style="margin-top:18px"><div><b>From</b><br>${e(C.name)}<br>${e(C.address)}<br>GSTIN: ${e(C.gstin || "not set")}</div><div><b>To</b><br>${e(p.billing_name || p.name)}<br>${e(p.billing_address || "")}<br>GSTIN: ${e(p.billing_gstin || "unregistered")}</div></div>
      <table><thead><tr><th>Description</th><th>SAC</th><th class="r">Amount</th></tr></thead><tbody><tr><td>Pulse wallet credit for AI agent runs</td><td>${e(process.env.COMPANY_SAC || "998314")}</td><td class="r">${r(taxable)}</td></tr>
      ${intra ? `<tr><td>CGST 9%</td><td></td><td class="r">${r(tax / 2)}</td></tr><tr><td>SGST 9%</td><td></td><td class="r">${r(tax / 2)}</td></tr>` : `<tr><td>IGST 18%</td><td></td><td class="r">${r(tax)}</td></tr>`}
      <tr><th>Total paid</th><th></th><th class="r">${r(p.amount_paise / 100)}</th></tr></tbody></table><small>Use your browser's print option to save this invoice as a PDF.</small></body></html>`;
  });
}
