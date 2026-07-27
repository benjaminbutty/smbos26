import { z } from "zod";

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}

const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(emptyStringToUndefined, z.url().optional());

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
    AI_PROVIDER: optionalString,
    AI_PROVIDER_API_KEY: optionalString,
  })
  .superRefine((environment, context) => {
    const hasSupabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL !== undefined;
    const hasSupabaseKey =
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== undefined;

    if (hasSupabaseUrl !== hasSupabaseKey) {
      context.addIssue({
        code: "custom",
        message:
          "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set together.",
        path: [
          hasSupabaseUrl
            ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
            : "NEXT_PUBLIC_SUPABASE_URL",
        ],
      });
    }

    const hasAiProvider = environment.AI_PROVIDER !== undefined;
    const hasAiProviderKey = environment.AI_PROVIDER_API_KEY !== undefined;

    if (hasAiProvider !== hasAiProviderKey) {
      context.addIssue({
        code: "custom",
        message: "AI_PROVIDER and AI_PROVIDER_API_KEY must be set together.",
        path: [hasAiProvider ? "AI_PROVIDER_API_KEY" : "AI_PROVIDER"],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  input: Record<string, string | undefined>,
): Environment {
  return environmentSchema.parse(input);
}

export const env = parseEnvironment({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_PROVIDER_API_KEY: process.env.AI_PROVIDER_API_KEY,
});
