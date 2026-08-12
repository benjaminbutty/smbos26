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

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    PREORDER_RATE_LIMIT_SECRET: optionalString,
    ACQUISITION_RATE_LIMIT_SECRET: optionalString,
    BUILDER_OPERATIONAL_CONFIRMATION_SECRET: optionalString,
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      !environment.SUPABASE_SERVICE_ROLE_KEY
    ) {
      context.addIssue({
        code: "custom",
        message:
          "SUPABASE_SERVICE_ROLE_KEY is required for trusted preorder writes in production.",
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      !environment.PREORDER_RATE_LIMIT_SECRET
    ) {
      context.addIssue({
        code: "custom",
        message:
          "PREORDER_RATE_LIMIT_SECRET is required for public-write hashing in production.",
        path: ["PREORDER_RATE_LIMIT_SECRET"],
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      !environment.ACQUISITION_RATE_LIMIT_SECRET
    ) {
      context.addIssue({
        code: "custom",
        message:
          "ACQUISITION_RATE_LIMIT_SECRET is required for public acquisition hashing in production.",
        path: ["ACQUISITION_RATE_LIMIT_SECRET"],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  input: Record<string, string | undefined>,
): Environment {
  return environmentSchema.parse(input);
}

export function getEnvironment(): Environment {
  return parseEnvironment({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    PREORDER_RATE_LIMIT_SECRET: process.env.PREORDER_RATE_LIMIT_SECRET,
    ACQUISITION_RATE_LIMIT_SECRET: process.env.ACQUISITION_RATE_LIMIT_SECRET,
    BUILDER_OPERATIONAL_CONFIRMATION_SECRET:
      process.env.BUILDER_OPERATIONAL_CONFIRMATION_SECRET,
  });
}
