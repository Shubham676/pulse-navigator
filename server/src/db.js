import pg from "pg";
import { config } from "./config.js";

// numeric -> JS number (amounts here stay well inside double precision); bigint -> number
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));
// date columns stay as 'YYYY-MM-DD' strings so they never shift with the server time zone
pg.types.setTypeParser(1082, v => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  // Set the time zone on each new connection (not as a startup option): hosted poolers such as Supabase's reject startup options.
  onConnect: client => client.query("set time zone 'Asia/Kolkata'"),
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Insert many rows in chunks with ON CONFLICT handling. cols: column names; rows: arrays in that order.
export async function bulkUpsert(client, table, cols, rows, conflictCols, updateCols) {
  if (!rows.length) return 0;
  const chunk = Math.max(1, Math.floor(30000 / cols.length));
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk), params = [];
    const values = part.map(r => "(" + r.map(v => { params.push(v); return "$" + params.length; }).join(",") + ")").join(",");
    const onConflict = conflictCols
      ? ` on conflict (${conflictCols.join(",")}) ` + (updateCols && updateCols.length ? `do update set ${updateCols.map(c => `${c}=excluded.${c}`).join(",")}` : "do nothing")
      : "";
    const r = await client.query(`insert into ${table} (${cols.join(",")}) values ${values}${onConflict}`, params);
    n += r.rowCount;
  }
  return n;
}
