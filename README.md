# Roamwise

Ask a local LLM where to eat, drink or go, and get real places back with Google Maps links, directions and an embedded map, inside the chat.

Roamwise is a small API that turns a chat prompt into a Google Places search and exposes it to Open WebUI as a tool. A local model extracts what the user is looking for and where, Google Places returns the venues, and the tool hands the chat model a finished answer with links and a map.

- Chat UI: [Open WebUI](https://github.com/open-webui/open-webui)
- LLM: [Ollama](https://ollama.com) running Qwen 2.5 7B locally. One environment variable switches to [Groq](https://console.groq.com) for hosted inference.
- Backend: [Bun](https://bun.sh), [Elysia](https://elysiajs.com) and [Zod](https://zod.dev), in TypeScript
- Places data: [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/text-search), Text Search

## Features

- The same local model chats with the user in Open WebUI and extracts the search intent inside the API. Only the Places request leaves your machine.
- The model decides what to search for and where. Google Places supplies the venues, so the answer never contains made-up places.
- Every result carries an "Open in Google Maps" link, a "Get directions" link and an embeddable map URL. The tool also returns ready-made Markdown with an `html` block that Open WebUI renders as an embedded map.
- Open WebUI discovers the tool from an OpenAPI 3.1 document served by the API.
- The Google key stays on the server and is restricted to one API. Field masks limit what is requested and billed. The API rate-limits clients, validates every input and never forwards upstream error details.
- Zod validates the environment, the request body, the LLM output (constrained to a JSON schema on Ollama) and Google's response.
- Docker Compose starts the whole stack, including the model download, with one command.
- Unit tests run with `bun test` and need no network access.

## How it works

```
 You ──▶ Open WebUI (localhost:3000)
             │  chats with qwen2.5:7b, which decides to call the `search_places` tool
             ▼
        Roamwise API  ·  Bun + Elysia  ·  localhost:3001        POST /api/search { prompt }
             │
             ├─▶ 1. LLM (Ollama locally, Groq when hosted)
             │      "quiet coffee shops near Seminyak for working"
             │        ──▶ { searchQuery, location, maxResults, openNow }     JSON-schema constrained
             │
             └─▶ 2. Google Places API (New) · Text Search · field mask · server-side key
                      ──▶ name, address, rating, coordinates, Google Maps URI
             │
             ▼
        { prompt, intent, places[], markdown }
             │      each place: googleMapsUrl · directionsUrl · embedUrl · embedQuery
             ▼
        The model relays `markdown`: numbered list + links + embedded map
```

For hosted inference, set `LLM_PROVIDER=groq`. The intent-extraction call then goes to Groq's API, and the backend runs on any container host such as Railway, Fly.io or Render. Open WebUI, or any other frontend, keeps calling the same `/api/search`.

## Requirements

- Docker Desktop, or Docker Engine with Compose v2. Give the Docker VM at least 8 GB of RAM for the 7B model.
- A Google Cloud account with Places API (New) enabled and an API key. New accounts get free Maps Platform credit.
- For running without Docker: Bun 1.2 or later and Ollama.

## Quick start

```bash
git clone https://github.com/muslimalfatih/roam-wise.git
cd roam-wise
cp .env.example .env            # add your key to GOOGLE_PLACES_API_KEY
docker compose up --build
```

The first run downloads the Open WebUI image (about 4 GB) and the `qwen2.5:7b` model (about 4.7 GB). The API starts once the model is present. Then:

1. Open http://localhost:3000. Authentication is disabled in the local stack, so the chat opens directly.
2. Connect the tool (next section).
3. Ask: "Find good coffee shops in Canggu, Bali".

The first answer is slow while the model loads into memory. Later answers take a few seconds on a GPU or Apple Silicon, and longer on CPU.

### Using Ollama on the host

Docker containers cannot use the GPU on macOS, so the containerised model runs on CPU. For faster answers, run Ollama natively and point the containers at it:

```bash
brew install ollama && ollama pull qwen2.5:7b     # Ollama serves on :11434
docker compose -f docker-compose.yml -f docker-compose.host-ollama.yml up --build open-webui api
```

## Connect the tool in Open WebUI

Open WebUI (v0.6 or later) calls external tools described by an OpenAPI document. The API serves its document at `GET /openapi.json`.

1. Open **Settings → Admin → Integrations** and click **+** in the **Tools** section to add a global tool server. Global tool servers are called from the Open WebUI backend, so use the Docker-network address:
   - URL: `http://api:3001`
   - OpenAPI spec path: `openapi.json` (the default)
   - Auth: None, or Bearer with your `API_KEY` if you set one
2. Save. Open WebUI fetches the document and lists one tool, `search_places`.
3. Global tools are hidden until enabled per chat. Click the **Integrations** button at the bottom left of the message box (next to **+**), open **Tools**, and turn on Roamwise Places Search.
4. Ask a question. Function calling defaults to Native, which Qwen 2.5 supports. If a model struggles with native tool calls, switch **Chat Controls → Advanced Params → Function Calling** to Legacy, which injects the tool definitions into the prompt instead.

You can also add the server under your personal **Settings → Integrations → Tools**. Those connections are made from your browser, so use `http://localhost:3001`; CORS already allows `http://localhost:3000`. Personal tool servers appear in the message input automatically.

## Usage

Prompts that work well:

- Find good coffee shops in Canggu, Bali
- Where can I eat ramen in Shinjuku, Tokyo right now? Give me 3 options
- Quiet cafes near Seminyak suitable for working
- Cheap hotels near Gare du Nord, Paris
- Cari tempat makan seafood enak di Jimbaran (other languages work too; Google handles the query)

What the model answers, using the tool's `markdown` field:

````markdown
Here are 5 results for **coffee shops** in Canggu, Bali:

1. **Common Grounds** · ⭐ 4.6 (1,234 reviews)
   Jl. Pantai Berawa, Canggu
   [Open in Google Maps](https://maps.google.com/?cid=…) · [Get directions](https://www.google.com/maps/dir/?api=1&destination=-8.648,115.138&destination_place_id=ChIJ…)

2. **Sea Circus** · ⭐ 4.5 (892 reviews)
   Jl. Raya Canggu
   [Open in Google Maps](…) · [Get directions](…)

Map of the top result, Common Grounds. Use "Get directions" for turn-by-turn navigation:

```html
<iframe src="https://maps.google.com/maps?q=-8.648,115.138&z=15&output=embed" width="100%" height="450" style="border:0" loading="lazy" allowfullscreen></iframe>
```
````

Open WebUI renders the `html` block as an artifact, so the embedded map appears next to the chat. "Get directions" opens Google Maps with the place as the destination and the user's current location as the origin.

## API

### `POST /api/search`

```bash
curl -s http://localhost:3001/api/search \
  -H 'content-type: application/json' \
  -d '{"prompt":"Find good coffee shops in Canggu, Bali"}'
```

```json
{
  "prompt": "Find good coffee shops in Canggu, Bali",
  "intent": { "searchQuery": "good coffee shops", "location": "Canggu, Bali", "maxResults": 5, "openNow": false },
  "places": [
    {
      "id": "ChIJ…",
      "name": "Common Grounds",
      "address": "Jl. Pantai Berawa, Canggu",
      "rating": 4.6,
      "reviewCount": 1234,
      "latitude": -8.648,
      "longitude": 115.138,
      "googleMapsUrl": "https://maps.google.com/?cid=…",
      "directionsUrl": "https://www.google.com/maps/dir/?api=1&destination=-8.648,115.138&destination_place_id=ChIJ…",
      "embedUrl": "https://maps.google.com/maps?q=-8.648,115.138&z=15&output=embed",
      "embedQuery": "-8.648,115.138"
    }
  ],
  "markdown": "Here are 5 results for **good coffee shops** in Canggu, Bali: …"
}
```

| Status | Meaning |
|---|---|
| 400 | Invalid body: `prompt` must be a string of 3 to 500 characters, sent as JSON |
| 401 | `API_KEY` is configured and the bearer token is missing or wrong |
| 422 | The LLM could not read the prompt as a request for places |
| 429 | Rate limit exceeded; the `Retry-After` header says when to retry |
| 502 | The LLM or Google Places returned an error (details only in the server log) |
| 503 | The LLM or Google Places is unreachable, or the Google quota is exhausted |

### `GET /openapi.json`

The OpenAPI 3.1 document for Open WebUI. Its `servers` entry is filled from the request host, so the same document is correct from inside Docker (`http://api:3001`) and from a browser (`http://localhost:3001`). The source file is [`apps/api/openapi.json`](apps/api/openapi.json).

### `GET /health`

Returns `{"status":"ok","llmProvider":"ollama"}` for container and platform health checks.

### Google Places integration

[`google-places.ts`](apps/api/src/services/google-places.ts) follows the [Text Search (New) reference](https://developers.google.com/maps/documentation/places/web-service/text-search):

- `POST https://places.googleapis.com/v1/places:searchText` with the key in the `X-Goog-Api-Key` header rather than the URL.
- `X-Goog-FieldMask` lists exactly the seven fields used, which is also what the call is billed on.
- The body uses `textQuery`, `pageSize` (1 to 20; `maxResultCount` is deprecated) and `openNow`.
- The response is validated with Zod before use (`displayName.text`, `location.latitude/longitude`, optional `rating`). An absent `places` array means no results, not an error.
- Google's error body is logged server-side and mapped to 502, or 503 for quota exhaustion. The client never sees Google's message.
- Links are built with the keyless [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started): `dir/?api=1&destination=lat,lng&destination_place_id=…` for directions and `search/?api=1&query=…&query_place_id=…` as a fallback place link.

To run it live: create a Google Cloud project, enable Places API (New), create an API key restricted to that API, and put it in `.env` as `GOOGLE_PLACES_API_KEY`. Without a key the server refuses to start. With an invalid key the API answers 502 and the log shows Google's reason.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` or `groq` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama address. Compose overrides it to `http://ollama:11434` |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Model for intent extraction; also what Compose pulls |
| `GROQ_API_KEY` | | Required when `LLM_PROVIDER=groq` |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq chat model |
| `GOOGLE_PLACES_API_KEY` | required | Server-side Places API (New) key |
| `PORT` | `3001` | Listening port |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed to call the API |
| `RATE_LIMIT_MAX` | `30` | Requests per minute per client IP |
| `API_KEY` | | Optional bearer token required on `/api/*` |

## Deployment

1. Switch the LLM to Groq. Set `LLM_PROVIDER=groq`, `GROQ_API_KEY=<key>` and optionally `GROQ_MODEL` (default `openai/gpt-oss-120b`; any Groq chat model with JSON mode works). Ollama is no longer needed.
2. Deploy the API container to Railway, Fly.io or Render using [`docker/api/Dockerfile`](docker/api/Dockerfile) with the repository root as the build context. Set `GOOGLE_PLACES_API_KEY`, `CORS_ORIGINS=https://your-open-webui.example.com`, `API_KEY=<random token>`, and `PORT` if the platform assigns one. Point the platform health check at `/health`.
3. Restrict the Google key to the platform's egress IP addresses.
4. Point Open WebUI at the API. Add `https://your-api.example.com` as a tool server with Bearer auth using the same `API_KEY`. The `servers` field in the document follows the request host, so nothing else changes.

## Security

### Restrict the key

In the Cloud Console, enable only Places API (New), not the legacy Places API, then create an API key and restrict it:

- API restrictions: Places API (New) only. A leaked key cannot be used for Geocoding, Directions or anything else.
- Application restrictions: the public IP addresses of your server in production. Leave it unrestricted for local development, and use a separate key per environment.

### Keep the key on the server

Only the backend calls Google, and the key lives in an environment variable; [`config.ts`](apps/api/src/config.ts) refuses to start without it. Everything the user clicks (the Maps page, the directions link and the embedded map) uses keyless Google Maps URLs, so there is no client-side key to restrict or rotate. `.env` is ignored by git, and `.env.example` ships without values.

### Request only the fields you use

The Places request asks for exactly seven fields ([`google-places.ts`](apps/api/src/services/google-places.ts)). Google bills Text Search at the most expensive SKU among the requested fields: `id` alone is Essentials (IDs Only); `displayName`, `formattedAddress`, `location` and `googleMapsUri` are Pro; `rating` and `userRatingCount` lift the call to Enterprise. Remove those two lines from the mask to pay the lower tier.

### Cap usage in Google Cloud

Under APIs & Services → Places API (New) → Quotas, lower "Text Search requests per day" to what the deployment needs (a few hundred for a demo). Under Billing → Budgets & alerts, create a budget with alerts at 50, 90 and 100 percent, so free credit cannot turn into an unexpected invoice.

### Cap usage in the API

The API rate-limits each client IP to `RATE_LIMIT_MAX` requests per minute (default 30) and answers 429 with a `Retry-After` header. Prompts are capped at 500 characters and `maxResults` at 10, so one request maps to exactly one Google call. Setting `API_KEY` requires a bearer token on `/api/*`, which keeps a public deployment from becoming an open Places proxy.

### Handle upstream errors without leaking them

Google's error bodies (invalid key, API not enabled, quota exceeded) are written to the server log; the client receives a generic 502 or 503. A Google 429 becomes a 503 so callers back off.

## Development

```bash
bun install
ollama pull qwen2.5:7b           # Ollama must be running on localhost:11434
cp .env.example .env             # add GOOGLE_PLACES_API_KEY
bun run dev                      # API on http://localhost:3001 with hot reload
bun run typecheck
bun test
```

`bun test` covers request validation, the bearer check, the rate limiter, Google Maps URL construction and the Markdown rendering. It needs no network: `GOOGLE_PLACES_API_KEY` is stubbed and the LLM is never called.

Manual checks for a running stack:

| Check | How | Expected |
|---|---|---|
| Happy path | "Find good coffee shops in Canggu, Bali" | Numbered list, links open Google Maps, map artifact renders |
| Count and open now | "3 ramen places in Shinjuku open now" | `maxResults: 3`, `openNow: true`, three results |
| No location | "cheap hotels" | `location: ""`, Google still returns results |
| Other language | "Cari tempat makan seafood enak di Jimbaran" | Results in Jimbaran |
| Prompt too short | `{"prompt":"hi"}` | 400 with a `details` message |
| Malformed JSON | `curl -d '{' …` | 400 |
| Rate limit | 31 requests within a minute from one IP | 429 with `Retry-After` |
| Wrong Google key | Edit `GOOGLE_PLACES_API_KEY` | 502 to the client, Google's reason in `docker compose logs api` |
| LLM down | `docker compose stop ollama` | 503 "not reachable" |
| Unknown route | `GET /nope` | 404 JSON |
| CORS | Preflight from an origin not in `CORS_ORIGINS` | No `Access-Control-Allow-Origin` header |

## Design decisions and limitations

- Prompts should name a location. Prompts without one still work, since Google searches without a location bias, but results may be anywhere in the world.
- The LLM extracts intent, not venues. It maps free text to `{ searchQuery, location, maxResults, openNow }` and Google decides which places match. This is what keeps made-up restaurants out of the answer.
- Navigation is left to Google Maps. "Get directions" opens Google Maps with the destination filled in; Google supplies the origin (the user's location) and the routing. The embedded map shows the top result's location through Google's keyless embed endpoint. Showing all results on one map would need the Maps Embed API, whose key must be shipped to the browser; `embedQuery` is provided for clients that choose to do that with a referrer-restricted key.
- One Google call per prompt. Text Search returns up to 10 results in a single request, and there is no pagination.
- Rate limiting is per API instance and per IP. Open WebUI's backend is one IP, so behind it the limit is effectively global. Multiple replicas or per-user limits need a shared store such as Redis.
- The Groq default is `openai/gpt-oss-120b`. Groq deprecated `llama-3.3-70b-versatile` in June 2026; any Groq chat model with JSON mode can be set through `GROQ_MODEL`.
- The local stack sets `WEBUI_AUTH=false`, which skips Open WebUI's sign-up screen, and leaves `API_KEY` empty. Both are meant for localhost only.

## Project structure

```
roam-wise/
├── apps/api/
│   ├── openapi.json              OpenAPI 3.1 document served at /openapi.json
│   ├── src/
│   │   ├── index.ts              Elysia app: CORS, rate limiting, error mapping, routes
│   │   ├── config.ts             Environment validation (Zod)
│   │   ├── errors.ts             ApiError: client-safe message, private cause
│   │   ├── rate-limit.ts         Fixed-window in-memory limiter
│   │   ├── routes/search.ts      POST /api/search, optional bearer auth, Markdown rendering
│   │   ├── schemas/search.ts     Zod schemas and response types
│   │   └── services/
│   │       ├── llm.ts            Ollama / Groq intent extraction (OpenAI-compatible)
│   │       └── google-places.ts  Places API (New) Text Search + Maps URLs
│   └── test/api.test.ts
├── docker/api/Dockerfile
├── docker-compose.yml            ollama + model pull + open-webui + api
├── docker-compose.host-ollama.yml  override: use Ollama running on the host
├── .env.example
└── package.json                  Bun workspace
```
