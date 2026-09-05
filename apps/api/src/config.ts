import { z } from "zod";

/**
 * Every environment variable the API reads, validated once at startup.
 * A missing or malformed value fails fast with a readable message instead of
 * surfacing as a confusing upstream error on the first request.
 */
const Env = z
  .object({
    PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    /** Optional bearer token for /api/*. Empty means the endpoint is open (fine on localhost). */
    API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),

    LLM_PROVIDER: z.enum(["ollama", "groq"]).default("ollama"),
    OLLAMA_BASE_URL: z
      .url()
      .default("http://localhost:11434")
      .transform((url) => url.replace(/\/+$/, "")),
    OLLAMA_MODEL: z.string().default("qwen2.5:7b"),
    GROQ_API_KEY: z.string().optional(),
    GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),

    GOOGLE_PLACES_API_KEY: z
      .string({ error: "GOOGLE_PLACES_API_KEY is required" })
      .min(1, "GOOGLE_PLACES_API_KEY is required"),
  })
  .refine((env) => env.LLM_PROVIDER !== "groq" || env.GROQ_API_KEY, {
    path: ["GROQ_API_KEY"],
    message: "GROQ_API_KEY is required when LLM_PROVIDER=groq",
  });

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const config = parsed.data;
