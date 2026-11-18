// All settings come from environment variables. See .env.example for the full list.
import crypto from "node:crypto";

const env = process.env;
const isProd = env.NODE_ENV === "production";

function required(name, devDefault) {
  const v = env[name];
  if (v) return v;
  if (!isProd && devDefault !== undefined) return devDefault;
  throw new Error(`Missing required environment variable ${name}`);
}

const appSecret = required("APP_SECRET", "dev-only-secret-change-me-dev-only-secret");
if (appSecret.length < 32) throw new Error("APP_SECRET must be at least 32 characters");

export const config = {
  isProd,
  port: Number(env.PORT || 8080),
  host: env.HOST || "0.0.0.0",
  publicUrl: (env.PUBLIC_URL || "http://localhost:8080").replace(/\/$/, ""),
  databaseUrl: required("DATABASE_URL", "postgres://pulse@localhost:5433/pulse?host=/tmp"),
  // 32-byte key derived from APP_SECRET, used to encrypt marketplace credentials at rest
  encKey: crypto.createHash("sha256").update(appSecret + ":enc").digest(),
  sessionDays: Number(env.SESSION_DAYS || 30),
  allowSignup: env.ALLOW_SIGNUP !== "false",
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 40),

  // AI provider: Claude (ANTHROPIC_API_KEY) or DeepSeek (DEEPSEEK_API_KEY). AI_PROVIDER picks one when both keys are set.
  ai: (() => {
    const provider = env.AI_PROVIDER === "deepseek" || (env.AI_PROVIDER !== "anthropic" && !env.ANTHROPIC_API_KEY && env.DEEPSEEK_API_KEY) ? "deepseek" : "anthropic";
    return provider === "deepseek"
      ? { provider, apiKey: env.DEEPSEEK_API_KEY || "", model: env.AI_MODEL || "deepseek-flash", baseUrl: env.AI_BASE_URL || "https://api.deepseek.com", maxTokens: Number(env.AI_MAX_TOKENS || 900) }
      : { provider, apiKey: env.ANTHROPIC_API_KEY || "", model: env.AI_MODEL || "claude-haiku-5-5", baseUrl: env.AI_BASE_URL || "https://api.anthropic.com", maxTokens: Number(env.AI_MAX_TOKENS || 900) };
  })(),
  amazon: {
    // Credentials of OUR registered SP-API / Ads API application (from Seller Central Developer Console and Amazon Ads)
    lwaTokenUrl: env.AMAZON_LWA_TOKEN_URL || "https://api.amazon.com/auth/o2/token",
    lwaClientId: env.AMAZON_LWA_CLIENT_ID || "",
    lwaClientSecret: env.AMAZON_LWA_CLIENT_SECRET || "",
    spApiEndpoint: env.AMAZON_SP_API_ENDPOINT || "https://sellingpartnerapi-eu.amazon.com",
    adsApiEndpoint: env.AMAZON_ADS_API_ENDPOINT || "https://advertising-api-eu.amazon.com",
    adsClientId: env.AMAZON_ADS_CLIENT_ID || env.AMAZON_LWA_CLIENT_ID || "",
    adsClientSecret: env.AMAZON_ADS_CLIENT_SECRET || env.AMAZON_LWA_CLIENT_SECRET || "",
    marketplaceId: env.AMAZON_MARKETPLACE_ID || "A21TJRUUN4KGV"   // Amazon.in
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || "",
    keySecret: env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || ""
  },
  company: {
    name: env.COMPANY_NAME || "Pulse Navigator",
    gstin: env.COMPANY_GSTIN || "",
    address: env.COMPANY_ADDRESS || "",
    stateCode: env.COMPANY_STATE_CODE || ""
  },
  syncEveryHours: Number(env.SYNC_EVERY_HOURS || 6)
};
