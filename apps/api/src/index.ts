import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import openapi from "../openapi.json";
import { config } from "./config";
import { ApiError } from "./errors";
import { createRateLimiter } from "./rate-limit";
import { search } from "./routes/search";

const limiter = createRateLimiter(config.RATE_LIMIT_MAX);

export const app = new Elysia()
  .use(cors({ origin: config.CORS_ORIGINS, methods: ["GET", "POST"], allowedHeaders: ["content-type", "authorization"] }))
  .onRequest(({ request, server, set }) => {
    // Behind a proxy (Railway, Fly, nginx) the client IP arrives in x-forwarded-for; otherwise use the socket.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      server?.requestIP(request)?.address ||
      "unknown";
    const { allowed, remaining, retryAfterSeconds } = limiter(ip);
    set.headers["x-ratelimit-limit"] = String(config.RATE_LIMIT_MAX);
    set.headers["x-ratelimit-remaining"] = String(remaining);
    if (!allowed) {
      set.status = 429;
      set.headers["retry-after"] = String(retryAfterSeconds);
      return { error: "Too many requests, please slow down" };
    }
  })
  .onError(({ code, error, set }) => {
    if (error instanceof ApiError) {
      if (error.status >= 500) console.error(`[${error.status}] ${error.message}`, error.cause);
      set.status = error.status;
      return { error: error.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (code === "PARSE") {
      set.status = 400;
      return { error: "Request body must be valid JSON" };
    }
    // Full details stay in the server log; the client only ever sees a generic message.
    console.error(error);
    set.status = 500;
    return { error: "Internal server error" };
  })
  .get("/health", () => ({ status: "ok", llmProvider: config.LLM_PROVIDER }))
  // Open WebUI reads this to discover the search tool. `servers` is derived from the request, so the
  // same spec works from inside Docker (http://api:3001) and from a browser (http://localhost:3001).
  .get("/openapi.json", ({ request }) => ({ ...openapi, servers: [{ url: new URL(request.url).origin }] }))
  .use(search);

if (import.meta.main) {
  app.listen(config.PORT);
  console.log(`Roamwise API listening on http://localhost:${config.PORT} (LLM provider: ${config.LLM_PROVIDER})`);
}
