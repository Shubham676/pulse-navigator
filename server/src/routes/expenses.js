// Manual expenses for Profit and loss: one-off or repeating every month.
import { z } from "zod";
import { one } from "../db.js";
import { requireAuth, requireOrg, canEdit, audit, HttpError } from "../lib/auth.js";

export const EXPENSE_CATEGORIES = ["Salaries and wages", "Rent", "Packaging", "Shipping and courier", "Marketing (other)", "Software and subscriptions", "Utilities", "Professional fees", "Samples and photography", "Other"];

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().max(200).optional().default(""),
  amount: z.coerce.number().positive().max(1e10),
  monthly: z.boolean().optional().default(false)
});

export default async function expenseRoutes(app) {
  app.post("/api/expenses", { preHandler: requireAuth }, async req => {
    requireOrg(req); canEdit(req);
    const b = Body.safeParse(req.body || {});
    if (!b.success) throw new HttpError(400, "Enter a date, a category and an amount above zero.");
    const e = b.data;
    const row = await one(`insert into expenses (org_id, spent_on, category, description, amount, monthly, created_by) values ($1,$2,$3,$4,$5,$6,$7)
      returning id, spent_on::text as date, category, description, amount::float8 as amount, monthly`, [req.org.id, e.date, e.category, e.description || null, Math.round(e.amount * 100) / 100, e.monthly, req.user?.id || null]);
    await audit(req, "expense.add", { id: row.id, amount: row.amount });
    return row;
  });
  app.delete("/api/expenses/:id", { preHandler: requireAuth }, async req => {
    requireOrg(req); canEdit(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Expense not found.");
    const row = await one("delete from expenses where org_id=$1 and id=$2 returning id", [req.org.id, id]);
    if (!row) throw new HttpError(404, "Expense not found.");
    await audit(req, "expense.delete", { id });
    return { ok: true };
  });
}
