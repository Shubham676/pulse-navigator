// Minimal AI client. Two providers:
// - Claude, Anthropic Messages API (https://platform.claude.com/docs/en/api/overview), key ANTHROPIC_API_KEY
// - DeepSeek, OpenAI-style chat completions (https://api-docs.deepseek.com), key DEEPSEEK_API_KEY
// Both return { text, usage: { input_tokens, output_tokens } }.
import { config } from "../config.js";

export const aiEnabled = () => !!config.ai.apiKey;
export const aiProvider = () => config.ai.provider;

async function post(url, headers, body, ctrl) {
  const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${json?.error?.message || json?.message || "unknown error"}`);
  return json;
}

export async function complete({ system, messages, maxTokens = config.ai.maxTokens, temperature = 0.3, timeoutMs = 60000 }) {
  if (!aiEnabled()) throw new Error("AI is not configured");
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (config.ai.provider === "deepseek") {
      const msgs = [...(system ? [{ role: "system", content: system }] : []), ...messages.map(m => ({ role: m.role, content: typeof m.content === "string" ? m.content : (m.content || []).map(c => c.text || "").join("\n") }))];
      const body = await post(config.ai.baseUrl.replace(/\/$/, "") + "/chat/completions", { authorization: `Bearer ${config.ai.apiKey}` },
        { model: config.ai.model, messages: msgs, max_tokens: maxTokens, temperature, stream: false }, ctrl);
      const text = (body.choices?.[0]?.message?.content || "").trim();
      if (!text) throw new Error("The AI reply was empty. Try again.");
      return { text, usage: { input_tokens: body.usage?.prompt_tokens || 0, output_tokens: body.usage?.completion_tokens || 0 } };
    }
    const body = await post(config.ai.baseUrl.replace(/\/$/, "") + "/v1/messages",
      { "x-api-key": config.ai.apiKey, "anthropic-version": process.env.AI_API_VERSION || "2023-06-01" },
      { model: config.ai.model, max_tokens: maxTokens, temperature, system, messages }, ctrl);
    return { text: (body.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim(), usage: body.usage || {} };
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The AI took too long to answer. Try again.");
    throw e;
  } finally { clearTimeout(timer); }
}

// Asks for JSON and parses the first JSON object in the reply
export async function completeJson(opts) {
  const r = await complete(opts);
  const m = r.text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The AI reply was not in the expected format.");
  return { data: JSON.parse(m[0]), usage: r.usage };
}
