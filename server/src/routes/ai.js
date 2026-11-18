// Copilot chat, copilot memory and pay-per-run AI agents.
import { z } from "zod";
import { one, many, q, tx } from "../db.js";
import { requireAuth, requireOrg, canEdit, HttpError } from "../lib/auth.js";
import { aiEnabled, complete, completeJson } from "../lib/ai.js";

export const AGENTS = [
  { id: "aplus", group: "Visual", name: "A+ content creator", cost: 15, desc: "Compliant A+ modules: comparison chart, feature tiles and brand story.", input: "image", kind: "image" },
  { id: "life", group: "Visual", name: "Lifestyle image creator", cost: 15, desc: "Turn a white-background photo into a kitchen or table scene.", input: "image", kind: "image" },
  { id: "info", group: "Visual", name: "Infographic creator", cost: 15, desc: "Feature callouts, nutrition facts and pack-size panels on one image.", input: "image", kind: "image" },
  { id: "optim", group: "Listing", name: "Listing optimizer", cost: 20, desc: "Scores a listing against Amazon's content rules and your search terms, then rewrites title, bullets and description.", input: "sku", kind: "text" },
  { id: "banner", group: "Visual", name: "Banner creator", cost: 15, desc: "Store and ad banners from your product shots and offer text.", input: "image", kind: "image" },
  { id: "colour", group: "Visual", name: "Colour variant creator", cost: 10, desc: "Matching images for each pack colour or flavour.", input: "image", kind: "image" },
  { id: "video", group: "Visual", name: "Product video creator", cost: 75, desc: "A 15-second video from a template, your images and key claims.", input: "image", kind: "image" },
  { id: "bg", group: "Visual", name: "Background remover", cost: 10, desc: "Clean white background that meets Amazon's main image rules.", input: "image", kind: "image" },
  { id: "create", group: "Listing", name: "AI listing creator", cost: 75, desc: "A complete new listing: title, bullets, description and backend search terms.", input: "brief", kind: "text" },
  { id: "kw", group: "Market", name: "Keyword intelligence", cost: 5, desc: "Keyword ideas for a product, ranked using your own search term results.", input: "keyword", kind: "text" }
];
const IMAGE_READY = !!process.env.IMAGE_PROVIDER;   // set when an image-generation service is integrated

const COPILOT_SYSTEM = `You are Pulse Navigator Copilot, an assistant for Indian sellers on Amazon. You answer from the seller's data summary below and their saved facts.
Rules: be short and specific (under 160 words unless asked for more). Use rupees with Indian digit grouping. Lead with the answer, then up to three numbered actions.
Only use numbers that are in the data summary; if something is not in it, say which report would provide it. Never invent figures.
Do not give legal or tax advice beyond pointing to the report or a CA. Match the user's language (English, Hinglish or Hindi).`;

export default async function aiRoutes(app) {
  /* ---------- copilot ---------- */
  app.get("/api/copilot/chats", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    return { chats: await many("select id, title, created_at from chats where org_id=$1 and user_id=$2 order by id desc limit 50", [req.org.id, req.user.id]) };
  });
  app.get("/api/copilot/chats/:id", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const c = await one("select id from chats where id=$1 and org_id=$2 and user_id=$3", [Number(req.params.id), req.org.id, req.user.id]);
    if (!c) throw new HttpError(404, "Chat not found.");
    return { messages: await many("select role, content, meta from chat_messages where chat_id=$1 order by id", [c.id]) };
  });
  app.post("/api/copilot", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async req => {
    requireOrg(req);
    const b = z.object({ chatId: z.number().int().nullable().optional(), message: z.string().trim().min(1).max(2000), facts: z.string().max(12000), language: z.string().max(20).optional(),
      fallback: z.object({ text: z.string().max(4000), think: z.array(z.string().max(300)).max(10), acts: z.array(z.tuple([z.string().max(60), z.string().max(80)])).max(4) }) }).parse(req.body);
    let chatId = b.chatId;
    if (chatId) { if (!await one("select 1 from chats where id=$1 and org_id=$2 and user_id=$3", [chatId, req.org.id, req.user.id])) chatId = null; }
    if (!chatId) chatId = (await one("insert into chats (org_id, user_id, title) values ($1,$2,$3) returning id", [req.org.id, req.user.id, b.message.slice(0, 60)])).id;
    const history = await many("select role, content from chat_messages where chat_id=$1 order by id desc limit 8", [chatId]);
    await q("insert into chat_messages (chat_id, role, content) values ($1,'user',$2)", [chatId, b.message]);
    let message;
    if (aiEnabled()) {
      try {
        const memory = (await many("select fact from copilot_memory where org_id=$1 order by id", [req.org.id])).map(m => "- " + m.fact).join("\n");
        const r = await complete({ system: `${COPILOT_SYSTEM}\n\nSaved facts about this business:\n${memory || "- none"}\n\nData summary (computed by Pulse Navigator just now):\n${b.facts}\n\nPreferred language: ${b.language || "English"}`,
          messages: [...history.reverse().map(h => ({ role: h.role, content: h.content })), { role: "user", content: b.message }] });
        message = { role: "assistant", content: r.text, meta: { source: "ai", acts: b.fallback.acts, think: ["Read your latest sales, ads, stock and returns summary", "Applied your saved facts"] } };
      } catch (e) { req.log.warn(e.message); }
    }
    if (!message) message = { role: "assistant", content: b.fallback.text, meta: { source: "rules", think: b.fallback.think, acts: b.fallback.acts } };
    await q("insert into chat_messages (chat_id, role, content, meta) values ($1,'assistant',$2,$3)", [chatId, message.content, message.meta]);
    return { chatId, message };
  });

  /* ---------- memory ---------- */
  app.post("/api/memory", { preHandler: requireAuth }, async req => {
    canEdit(req);
    const b = z.object({ fact: z.string().trim().min(3).max(300) }).parse(req.body);
    if ((await one("select count(*)::int n from copilot_memory where org_id=$1", [req.org.id])).n >= 40) throw new HttpError(400, "Memory is full (40 facts). Remove one first.");
    await q("insert into copilot_memory (org_id, fact) values ($1,$2)", [req.org.id, b.fact]);
    return { ok: true };
  });
  app.delete("/api/memory/:id", { preHandler: requireAuth }, async req => {
    canEdit(req);
    await q("delete from copilot_memory where org_id=$1 and id=$2", [req.org.id, Number(req.params.id)]);
    return { ok: true };
  });

  /* ---------- agents ---------- */
  app.get("/api/agents", { preHandler: requireAuth }, async req => {
    requireOrg(req);
    const agents = AGENTS.map(a => ({ id: a.id, group: a.group, name: a.name, cost: a.cost, desc: a.desc, input: a.input,
      available: a.kind === "image" ? IMAGE_READY : aiEnabled(), unavailable: a.kind === "image" ? "Coming soon: image generation is not connected yet" : "Needs the AI model to be set up on the server" }));
    const runs = await many("select id, agent, input, output, cost_paise, status, created_at from agent_runs where org_id=$1 order by id desc limit 100", [req.org.id]);
    return { agents, runs: runs.map(r => ({ ...r, agent_name: AGENTS.find(a => a.id === r.agent)?.name || r.agent })) };
  });

  app.post("/api/agents/run", { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async req => {
    canEdit(req);
    const b = z.object({ agent: z.string(), sku: z.string().max(100).optional(), keyword: z.string().max(100).optional(), brief: z.string().max(1500).optional() }).parse(req.body);
    const a = AGENTS.find(x => x.id === b.agent);
    if (!a) throw new HttpError(404, "Unknown agent.");
    if (a.kind === "image" && !IMAGE_READY) throw new HttpError(400, "Image agents are not available yet.");
    if (a.kind === "text" && !aiEnabled()) throw new HttpError(400, "The AI model is not set up on this server yet.");
    const p = b.sku ? await one("select * from products where org_id=$1 and sku=$2", [req.org.id, b.sku]) : null;
    if (!p) throw new HttpError(400, "Choose a product.");
    const cost = a.cost * 100;

    // Reserve the money first so two quick runs cannot overspend the wallet
    const runId = await tx(async c => {
      const o = (await c.query("update orgs set wallet_paise = wallet_paise - $2 where id=$1 and wallet_paise >= $2 returning wallet_paise", [req.org.id, cost])).rows[0];
      if (!o) throw new HttpError(402, `Not enough balance: this run needs ₹${a.cost}.`, "low_balance");
      const r = (await c.query("insert into agent_runs (org_id, user_id, agent, input, cost_paise, status) values ($1,$2,$3,$4,$5,'running') returning id", [req.org.id, req.user.id, a.id, { sku: b.sku, keyword: b.keyword }, cost])).rows[0];
      await c.query("insert into wallet_ledger (org_id, amount_paise, kind, description, ref) values ($1,$2,'agent',$3,$4)", [req.org.id, -cost, `${a.name} · ${b.sku}`, "run:" + r.id]);
      return r.id;
    });
    try {
      const output = await runTextAgent(a, p, b, req.org.id);
      await q("update agent_runs set status='done', output=$2 where id=$1", [runId, output]);
      const bal = await one("select wallet_paise from orgs where id=$1", [req.org.id]);
      return { output, balance: bal.wallet_paise / 100 };
    } catch (e) {
      req.log.warn(`agent ${a.id} failed: ${e.message}`);
      await tx(async c => {
        await c.query("update orgs set wallet_paise = wallet_paise + $2 where id=$1", [req.org.id, cost]);
        await c.query("insert into wallet_ledger (org_id, amount_paise, kind, description, ref) values ($1,$2,'refund',$3,$4)", [req.org.id, cost, `Refund: ${a.name} did not finish`, "refund:" + runId]);
        await c.query("update agent_runs set status='refunded', output=$2 where id=$1", [runId, { error: e.message }]);
      });
      throw new HttpError(502, `${a.name} did not finish, so your ₹${a.cost} was refunded. Try again in a minute.`);
    }
  });
}

async function runTextAgent(a, p, b, orgId) {
  const terms = await many(`select search_term, sum(clicks)::int clicks, sum(orders)::int orders, sum(impressions)::int impressions from ad_terms t join campaigns c on c.org_id=t.org_id and c.campaign_id=t.campaign_id
                             where t.org_id=$1 and (c.sku=$2 or $2 is null) and t.day > current_date - 60 group by 1 order by sum(orders) desc, sum(clicks) desc limit 40`, [orgId, p.sku]);
  const product = `Product: ${p.name}\nSKU: ${p.sku}\nASIN: ${p.asin || "unknown"}\nCategory: ${p.category || "unknown"}\nPrice: ₹${p.price ?? "unknown"}\nImages: ${p.images ?? "unknown"}, bullets: ${p.bullets ?? "unknown"}, A+: ${p.has_aplus == null ? "unknown" : p.has_aplus ? "yes" : "no"}\nRating: ${p.rating ?? "unknown"} from ${p.reviews ?? "unknown"} reviews`;
  const termText = terms.length ? terms.map(t => `${t.search_term}: ${t.impressions} impressions, ${t.clicks} clicks, ${t.orders} orders`).join("\n") : "No search term data for this product.";
  const sys = "You write Amazon India listing content. Follow Amazon's style rules: title under 200 characters, no promotional words (best, offer, sale, #1), no unverifiable health claims (cure, treat, guaranteed), no emoji or ALL CAPS. Reply with JSON only.";
  if (a.id === "kw") {
    const { data } = await completeJson({ system: sys, maxTokens: 900, messages: [{ role: "user", content: `${product}\nSeed keyword: ${b.keyword || "none"}\n\nSearch terms from this seller's ads (last 60 days):\n${termText}\n\nSuggest 12 keywords a shopper in India would type for this product. Prefer terms proven in the data; add new ideas too. Return {"keywords":[{"keyword":"...","reason":"one short line","evidence":"e.g. 14 orders in your ads, or New idea"}]}` }] });
    return { keywords: (data.keywords || []).slice(0, 15), note: "Search volumes are not shown: Amazon shares them only through Brand Analytics." };
  }
  const brief = a.id === "create" ? `\nSeller's notes on what makes it different: ${b.brief || "none"}` : "";
  const ask = a.id === "optim"
    ? `Score the current listing from 0 to 100 on Amazon content quality using the details given, list the main issues, then write an improved version. Return {"score":n,"scoreAfter":n,"issues":["..."],"title":"...","bullets":["5 bullets"],"description":"...","searchTerms":"space-separated, under 250 bytes, no words already in the title"}`
    : `Write a complete new listing. Return {"title":"...","bullets":["5 bullets"],"description":"...","searchTerms":"space-separated, under 250 bytes"}`;
  const { data } = await completeJson({ system: sys, maxTokens: 1400, messages: [{ role: "user", content: `${product}${brief}\n\nSearch terms that brought shoppers to this product's ads:\n${termText}\n\n${ask}` }] });
  return { score: data.score ?? null, scoreAfter: data.scoreAfter ?? null, issues: data.issues || [], title: String(data.title || "").slice(0, 250), bullets: (data.bullets || []).slice(0, 6), description: data.description || "", searchTerms: data.searchTerms || "" };
}
