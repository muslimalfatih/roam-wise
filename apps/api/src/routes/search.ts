import { Elysia } from "elysia";
import { config } from "../config";
import { type Place, type SearchIntent, SearchRequest, type SearchResponse } from "../schemas/search";
import { searchPlaces } from "../services/google-places";
import { parseIntent } from "../services/llm";

export const search = new Elysia({ prefix: "/api" })
  // Optional bearer token so a public deployment cannot be used by strangers to burn Google quota.
  .onBeforeHandle(({ request, set }) => {
    if (config.API_KEY && request.headers.get("authorization") !== `Bearer ${config.API_KEY}`) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
  })
  .post("/search", async ({ body, set }) => {
    const request = SearchRequest.safeParse(body);
    if (!request.success) {
      set.status = 400;
      return { error: "Invalid request", details: request.error.issues.map((issue) => issue.message) };
    }

    const { prompt } = request.data;
    const intent = await parseIntent(prompt);
    const places = await searchPlaces(intent);
    console.info(JSON.stringify({ event: "search", intent, results: places.length }));

    const response: SearchResponse = { prompt, intent, places, markdown: toMarkdown(intent, places) };
    return response;
  });

/**
 * Chat-ready answer. Small local models are unreliable at rebuilding long URLs
 * from JSON, so the tool hands them the finished text to relay instead.
 */
export function toMarkdown(intent: SearchIntent, places: Place[]): string {
  const where = intent.location ? ` in ${intent.location}` : "";
  if (places.length === 0) {
    return `I couldn't find any places for "${intent.searchQuery}"${where}. Try a nearby area or a broader description.`;
  }

  const list = places
    .map((place, index) => {
      const rating =
        place.rating === null
          ? "no ratings yet"
          : `⭐ ${place.rating} (${place.reviewCount.toLocaleString("en-US")} reviews)`;
      return [
        `${index + 1}. **${place.name}** · ${rating}`,
        `   ${place.address}`,
        `   [Open in Google Maps](${place.googleMapsUrl}) · [Get directions](${place.directionsUrl})`,
      ].join("\n");
    })
    .join("\n\n");

  // Open WebUI renders ```html blocks as an artifact, which gives the user an embedded map in the chat.
  const top = places[0]!;
  const map = [
    "```html",
    `<iframe src="${top.embedUrl}" width="100%" height="450" style="border:0" loading="lazy" allowfullscreen></iframe>`,
    "```",
  ].join("\n");

  return [
    `Here are ${places.length} results for **${intent.searchQuery}**${where}:`,
    list,
    `Map of the top result, ${top.name}. Use "Get directions" for turn-by-turn navigation:`,
    map,
  ].join("\n\n");
}
