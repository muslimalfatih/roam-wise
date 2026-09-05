import { z } from "zod";

/** Body of POST /api/search. */
export const SearchRequest = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "prompt must be at least 3 characters")
    .max(500, "prompt must be at most 500 characters"),
});
export type SearchRequest = z.infer<typeof SearchRequest>;

/**
 * What the LLM extracts from the prompt. The same schema is handed to Ollama
 * as a JSON Schema, so the model's output is constrained to exactly this shape.
 */
export const SearchIntent = z.object({
  searchQuery: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("What kind of place to look for, including qualifiers, without the location"),
  location: z
    .string()
    .trim()
    .max(200)
    .default("")
    .describe("City, area or landmark to search around. Empty string if the user gave none"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("How many places the user wants; 5 unless they say otherwise"),
  openNow: z.boolean().default(false).describe("True only if the user asks for places open right now"),
});
export type SearchIntent = z.infer<typeof SearchIntent>;

/** One result, with every Google Maps link a client needs. */
export type Place = {
  id: string;
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  latitude: number;
  longitude: number;
  /** The place's page on Google Maps */
  googleMapsUrl: string;
  /** Turn-by-turn directions from the user's current location */
  directionsUrl: string;
  /** Keyless embeddable map centred on the place, ready for an iframe `src` */
  embedUrl: string;
  /** "lat,lng" for clients that build their own embed (e.g. Maps Embed API `q=`) */
  embedQuery: string;
};

export type SearchResponse = {
  prompt: string;
  intent: SearchIntent;
  places: Place[];
  /** Ready-to-display answer: numbered list with links plus an embedded map. */
  markdown: string;
};
