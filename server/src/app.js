import { VERSION, RELEASED } from "./version.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import { ZodError } from "zod";
import { config } from "./config.js";
import { HttpError } from "./lib/auth.js";
import authRoutes from "./routes/auth.js";
import dataRoutes from "./routes/data.js";
import importRoutes from "./routes/imports.js";
import adsRoutes from "./routes/ads.js";
import aiRoutes from "./routes/ai.js";
import walletRoutes from "./routes/wallet.js";
import connectionRoutes from "./routes/connections.js";

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "public");

export async function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger: logger && { level: config.isProd ? "info" : "warn" }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://checkout.razorpay.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://api.razorpay.com", "https://lumberjack.razorpay.com"],
        frameSrc: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 } });

  // Cross-site request protection: every state-changing API call must carry this header,
  // which a form on another site cannot set without a CORS preflight we never allow.
  app.addHook("onRequest", async req => {
    if (req.url.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !req.url.startsWith("/api/webhooks/")) {
      if (req.headers["x-pulse"] !== "1") throw new HttpError(403, "Request blocked.", "csrf");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ error: first?.message || "Some details are missing or invalid.", field: first?.path?.join(".") });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, code: err.code });
    if (err.statusCode === 429) return reply.status(429).send({ error: "Too many attempts. Wait a few minutes and try again." });
    if (err.code === "FST_REQ_FILE_TOO_LARGE") return reply.status(413).send({ error: `That file is over ${config.maxUploadMb} MB. Upload a shorter date range.` });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: "Something went wrong on our side. Try again; if it keeps happening, tell support what you were doing." });
  });

  app.get("/healthz", async () => ({ ok: true, version: VERSION, released: RELEASED }));
  await app.register(authRoutes);
  await app.register(dataRoutes);
  await app.register(importRoutes);
  await app.register(adsRoutes);
  await app.register(aiRoutes);
  await app.register(walletRoutes);
  await app.register(connectionRoutes);

  await app.register(fstatic, { root: webDir, prefix: "/", index: ["index.html"], cacheControl: false });
  app.addHook("onSend", async (req, reply, payload) => {
    if (!req.url.startsWith("/api/") && !reply.hasHeader("cache-control")) reply.header("cache-control", /\.(js|css|svg|png)$/.test(req.url.split("?")[0]) ? "public, max-age=300" : "no-store");
    return payload;
  });
  app.setNotFoundHandler((req, reply) => req.url.startsWith("/api/") ? reply.status(404).send({ error: "Not found." }) : reply.sendFile("index.html"));
  return app;
}
