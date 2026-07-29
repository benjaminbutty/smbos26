import "server-only";

import { z } from "zod";

export const aiProviderFailureKindSchema = z.enum([
  "disabled",
  "unavailable",
  "rate_limited",
  "transient",
  "invalid_request",
]);

export type AiProviderFailureKind = z.infer<typeof aiProviderFailureKindSchema>;

export class StructuredAiProviderError extends Error {
  readonly kind: AiProviderFailureKind;
  override readonly cause: unknown;

  constructor(
    kind: AiProviderFailureKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "StructuredAiProviderError";
    this.kind = kind;
    this.cause = options?.cause;
  }
}

const providerMetadataValueSchema = z.union([
  z.string().max(200),
  z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.boolean(),
]);

export const structuredAiProviderResponseSchema = z
  .object({
    output: z.unknown(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().max(1_000_000_000),
        outputTokens: z.number().int().nonnegative().max(1_000_000_000),
      })
      .strict()
      .optional(),
    requestMetadata: z
      .record(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z][a-z0-9_.-]*$/),
        providerMetadataValueSchema,
      )
      .superRefine((metadata, context) => {
        if (Object.keys(metadata).length > 20) {
          context.addIssue({
            code: "custom",
            message: "Provider request metadata exceeds the entry limit.",
          });
        }
      })
      .optional(),
  })
  .strict();

export interface StructuredAiProviderRequest {
  providerKey: string;
  modelKey: string;
  instruction: string;
  input: unknown;
  outputContract: {
    name: string;
    version: number;
    jsonSchema: Readonly<Record<string, unknown>>;
  };
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface StructuredAiProviderResponse {
  output: unknown;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  requestMetadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface StructuredAiProvider {
  generateStructured(
    request: StructuredAiProviderRequest,
  ): Promise<StructuredAiProviderResponse>;
}

export interface RegisteredAiTask<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  key: string;
  version: number;
  purposeLabel: string;
  policyKey: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  buildInstruction(input: z.output<TInputSchema>): string;
}

export type RegisteredAiTaskRegistry = Readonly<
  Record<string, RegisteredAiTask>
>;

export interface AiExecutionPolicy {
  key: string;
  providerKey: string;
  modelKey: string;
  maxInputBytes: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  retryableFailureKinds: readonly AiProviderFailureKind[];
}

export type AiExecutionPolicyRegistry = Readonly<
  Record<string, AiExecutionPolicy>
>;

export type StructuredAiProviderRegistry = Readonly<
  Record<string, StructuredAiProvider>
>;
