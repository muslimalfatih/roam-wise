import { describe, expect, test } from "bun:test";

// The app validates its environment on import, so give it the minimum it needs first.
process.env.LLM_PROVIDER = "ollama";
process.env.GOOGLE_PLACES_API_KEY ||= "test-key"; // ||= because a blank value in ./.env is an empty string, not undefined
process.env.RATE_LIMIT_MAX = "3";
process.env.API_KEY = "test-bearer-token";

const { app } = await import("../src/index");
const { toPlace } = await import("../src/services/google-places");
const { toMarkdown } = await import("../src/routes/search");
const { createRateLimiter } = await import("../src/rate-limit");

const post = (body: unknown, ip: string, headers: Record<string, string> = { authorization: "Bearer test-bearer-token" }) =>
  app.handle(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("POST /api/search validation", () => {
  test("rejects a prompt that is too short", async () => {
    const res = await post({ prompt: "hi" }, "10.0.0.1");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid request",
      details: ["prompt must be at least 3 characters"],
    });
  });

  test("rejects a missing prompt", async () => {
    const res = await post({}, "10.0.0.1");
    expect(res.status).toBe(400);
  });

  test("rejects malformed JSON", async () => {
    const res = await post("{not json", "10.0.0.1");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Request body must be valid JSON" });
  });

  test("requires the bearer token when API_KEY is set", async () => {
    const res = await post({ prompt: "coffee in Canggu" }, "10.0.0.3", {});
    expect(res.status).toBe(401);
  });
});

describe("rate limiting", () => {
  test("returns 429 once a client exceeds RATE_LIMIT_MAX requests", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.handle(
        new Request("http://localhost/health", { headers: { "x-forwarded-for": "10.0.0.2" } }),
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test("counts per key and resets after the window", () => {
    const limit = createRateLimiter(2, 1_000);
    expect(limit("a", 0).allowed).toBe(true);
    expect(limit("a", 1).allowed).toBe(true);
    expect(limit("a", 2).allowed).toBe(false);
    expect(limit("b", 2).allowed).toBe(true);
    expect(limit("a", 1_000).allowed).toBe(true);
  });
});

describe("place mapping", () => {
  const place = toPlace({
    id: "ChIJabc123",
    displayName: { text: "Common Grounds" },
    formattedAddress: "Jl. Pantai Berawa, Canggu",
    location: { latitude: -8.648, longitude: 115.138 },
    rating: 4.6,
    userRatingCount: 1234,
  });
  const intent = { searchQuery: "coffee shops", location: "Canggu, Bali", maxResults: 5, openNow: false };

  test("builds keyless Google Maps, directions and embed URLs", () => {
    expect(place.directionsUrl).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-8.648,115.138&destination_place_id=ChIJabc123",
    );
    expect(place.googleMapsUrl).toContain("query_place_id=ChIJabc123");
    expect(place.embedUrl).toBe("https://maps.google.com/maps?q=-8.648,115.138&z=15&output=embed");
    expect(place.embedQuery).toBe("-8.648,115.138");
  });

  test("renders chat markdown with links and an embedded map", () => {
    const markdown = toMarkdown(intent, [place]);
    expect(markdown).toContain("1. **Common Grounds** · ⭐ 4.6 (1,234 reviews)");
    expect(markdown).toContain(`[Get directions](${place.directionsUrl})`);
    expect(markdown).toContain(`<iframe src="${place.embedUrl}"`);
  });

  test("explains when nothing was found", () => {
    expect(toMarkdown(intent, [])).toContain("couldn't find any places");
  });
});
