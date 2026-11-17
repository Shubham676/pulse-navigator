// Minimal client for the Anthropic Messages API (https://platform.claude.com/docs/en/api/overview).
import { config } from "../config.js";

export const aiEnabled = () => !!config.ai.apiKey;

export async function complete({ system, messages, maxTokens = config.ai.maxTokens, temperature = 0.3, timeoutMs = 45000 }) {
  if (!aiEnabled()) throw new Error("AI is not configured");
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch((process.env.AI_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": config.ai.apiKey, "anthropic-version": process.env.AI_API_VERSION || "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: config.ai.model, max_tokens: maxTokens, temperature, system, messages })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`AI request failed (${res.status}): ${body?.error?.message || "unknown error"}`);
    return { text: (body.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim(), usage: body.usage || {} };
  } finally { clearTimeout(timer); }
}

// Asks for JSON and parses the first JSON object in the reply
export async function completeJson(opts) {
  const r = await complete(opts);
  const m = r.text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The AI reply was not in the expected format.");
  return { data: JSON.parse(m[0]), usage: r.usage };
}
