import { z } from "zod";
import { config } from "../config";
import { ApiError } from "../errors";
import { SearchIntent } from "../schemas/search";

const SYSTEM_PROMPT = `You turn a user's request for places to go, eat, drink, stay, shop or visit into a JSON search intent.

Return ONLY a JSON object with exactly these fields:
- "searchQuery": the kind of place plus any qualifiers (cuisine, vibe, price, purpose). Never put the location here.
- "location": the city, area or landmark to search around, exactly as the user wrote it. Use "" if none was given.
- "maxResults": integer 1-10. Use 5 unless the user asks for a specific number.
- "openNow": true only if the user asks for places that are open right now.

Example
User: Find quiet coffee shops near Seminyak, Bali, suitable for working
JSON: {"searchQuery":"quiet coffee shops suitable for working","location":"Seminyak, Bali","maxResults":5,"openNow":false}`;

/** Generous because the first call to a cold local model includes loading 4-5 GB of weights. */
const LLM_TIMEOUT_MS = 120_000;

// ponytail: Ollama and Groq both speak the OpenAI chat-completions dialect, so one fetch covers both.
// Ollama receives the full JSON Schema (grammar-constrained decoding); Groq receives plain JSON mode,
// which every Groq model supports.
const provider =
  config.LLM_PROVIDER === "groq"
    ? {
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: config.GROQ_API_KEY,
        model: config.GROQ_MODEL,
        responseFormat: { type: "json_object" },
      }
    : {
        url: `${config.OLLAMA_BASE_URL}/v1/chat/completions`,
        apiKey: undefined,
        model: config.OLLAMA_MODEL,
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "search_intent", schema: z.toJSONSchema(SearchIntent) },
        },
      };

const ChatCompletion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

/** Ask the LLM to extract a structured search intent from free text. */
export async function parseIntent(prompt: string): Promise<SearchIntent> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;

  const res = await fetch(provider.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      response_format: provider.responseFormat,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  }).catch((cause: unknown) => {
    throw new ApiError(503, `The ${config.LLM_PROVIDER} LLM is not reachable`, { cause });
  });

  if (!res.ok) {
    throw new ApiError(502, "The LLM request failed", { cause: await res.text() });
  }

  const completion = ChatCompletion.safeParse(await res.json());
  if (!completion.success) {
    throw new ApiError(502, "Unexpected response from the LLM", { cause: completion.error });
  }

  const content = completion.data.choices[0]!.message.content ?? "";
  // Models in plain JSON mode occasionally wrap the object in a ```json fence.
  const json = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ApiError(502, "The LLM returned malformed JSON", { cause: content });
  }

  const intent = SearchIntent.safeParse(raw);
  if (!intent.success) {
    throw new ApiError(
      422,
      'Could not understand that as a request for places. Try something like "good ramen near Shinjuku, Tokyo".',
      { cause: intent.error },
    );
  }
  return intent.data;
}
