import { z } from "zod";
import { config } from "../config";
import { ApiError } from "../errors";
import type { Place, SearchIntent } from "../schemas/search";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

/**
 * The field mask is both the only data we receive and the only data we are
 * billed for (Google charges the highest SKU among the requested fields):
 * id is "Essentials"; displayName, formattedAddress, location and googleMapsUri
 * are "Pro"; rating and userRatingCount lift the call to "Enterprise".
 * Drop those two lines to pay the lower tier.
 */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
].join(",");

const RawPlace = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  googleMapsUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
});
export type RawPlace = z.infer<typeof RawPlace>;

const TextSearchResponse = z.object({ places: z.array(RawPlace).default([]) });

/** Places API (New) Text Search for the given intent. Resolves to [] when Google finds nothing. */
export async function searchPlaces(intent: SearchIntent): Promise<Place[]> {
  const textQuery = intent.location ? `${intent.searchQuery} in ${intent.location}` : intent.searchQuery;

  const res = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": config.GOOGLE_PLACES_API_KEY,
      "x-goog-fieldmask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, pageSize: intent.maxResults, openNow: intent.openNow }),
    signal: AbortSignal.timeout(10_000),
  }).catch((cause: unknown) => {
    throw new ApiError(503, "Google Places is not reachable", { cause });
  });

  if (!res.ok) {
    // Google's body names the real problem (bad key, API not enabled, quota). Log it, never forward it.
    const cause = await res.text();
    if (res.status === 429) {
      throw new ApiError(503, "Google Places quota exceeded, please retry in a moment", { cause });
    }
    throw new ApiError(502, "Google Places lookup failed", { cause });
  }

  const parsed = TextSearchResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new ApiError(502, "Unexpected response from Google Places", { cause: parsed.error });
  }
  return parsed.data.places.map(toPlace);
}

/** Map a raw Places API object to our shape, adding the Google Maps URLs the user will click. */
export function toPlace(raw: RawPlace): Place {
  const { latitude, longitude } = raw.location;
  const coords = `${latitude},${longitude}`;
  return {
    id: raw.id,
    name: raw.displayName?.text ?? "Unnamed place",
    address: raw.formattedAddress ?? "",
    rating: raw.rating ?? null,
    reviewCount: raw.userRatingCount ?? 0,
    latitude,
    longitude,
    // Maps URLs (developers.google.com/maps/documentation/urls) and the classic embed need no API key,
    // so nothing secret ever reaches the browser.
    googleMapsUrl:
      raw.googleMapsUri ??
      `https://www.google.com/maps/search/?api=1&query=${coords}&query_place_id=${raw.id}`,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${coords}&destination_place_id=${raw.id}`,
    embedUrl: `https://maps.google.com/maps?q=${coords}&z=15&output=embed`,
    embedQuery: coords,
  };
}
