import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let seen;
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c)); req.on("end", () => {
    seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(b) };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: " Sales rose 12%. " } }], usage: { prompt_tokens: 50, completion_tokens: 7 } }));
  });
});
await new Promise(r => srv.listen(0, r));
process.env.ANTHROPIC_API_KEY = "";
process.env.DEEPSEEK_API_KEY = "sk-test";
process.env.AI_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
const { complete, aiEnabled, aiProvider } = await import("../src/lib/ai.js");
after(() => srv.close());

test("DeepSeek: OpenAI-style request with system message, reply and usage mapped", async () => {
  assert.equal(aiEnabled(), true);
  assert.equal(aiProvider(), "deepseek");
  const r = await complete({ system: "You are Copilot.", messages: [{ role: "user", content: "How are sales?" }], maxTokens: 300 });
  assert.equal(seen.url, "/chat/completions");
  assert.equal(seen.auth, "Bearer sk-test");
  assert.equal(seen.body.model, "deepseek-flash");
  assert.deepEqual(seen.body.messages, [{ role: "system", content: "You are Copilot." }, { role: "user", content: "How are sales?" }]);
  assert.equal(r.text, "Sales rose 12%.");
  assert.deepEqual(r.usage, { input_tokens: 50, output_tokens: 7 });
});
