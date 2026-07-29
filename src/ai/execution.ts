import "server-only";

import { z } from "zod";

import {
  aiProviderFailureKindSchema,
  structuredAiProviderResponseSchema,
  StructuredAiProviderError,
  type AiExecutionPolicy,
  type AiExecutionPolicyRegistry,
  type RegisteredAiTask,
  type RegisteredAiTaskRegistry,
  type StructuredAiProviderRegistry,
  type StructuredAiProviderRequest,
} from "./contracts";
import { AiExecutionError } from "./errors";
import {
  aiExecutionPolicies,
  registeredAiTasks,
  structuredAiProviders,
} from "./registry";

const executionPolicySchema = z
  .object({
    key: z.string().min(1).max(80),
    providerKey: z.string().min(1).max(80),
    modelKey: z.string().min(1).max(120),
    maxInputBytes: z.number().int().positive().max(1_048_576),
    maxOutputTokens: z.number().int().positive().max(8_192),
    timeoutMs: z.number().int().positive().max(120_000),
    maxAttempts: z.number().int().positive().max(5),
    retryDelayMs: z.number().int().nonnegative().max(10_000),
    retryableFailureKinds: z
      .array(aiProviderFailureKindSchema)
      .max(5)
      .readonly(),
  })
  .strict();

interface ExecutionDependencies {
  tasks: RegisteredAiTaskRegistry;
  policies: AiExecutionPolicyRegistry;
  providers: StructuredAiProviderRegistry;
  sleep(milliseconds: number): Promise<void>;
}

interface AiExecutionMetadata {
  taskKey: string;
  taskVersion: number;
  purposeLabel: string;
  providerKey: string;
  modelKey: string;
  attempts: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  requestMetadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AiExecutionResult<TOutput = unknown> {
  output: TOutput;
  metadata: AiExecutionMetadata;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

class AiAttemptTimeoutError extends Error {
  constructor() {
    super("The structured provider attempt timed out.");
    this.name = "AiAttemptTimeoutError";
  }
}

function stableJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }

  throw new TypeError("AI task input must be JSON serialisable.");
}

function serialisedInputBytes(input: unknown): number {
  const serialised = JSON.stringify(stableJsonValue(input));
  return new TextEncoder().encode(serialised).byteLength;
}

function outputJsonSchema(
  task: RegisteredAiTask,
): Readonly<Record<string, unknown>> {
  return z.toJSONSchema(task.outputSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  }) as Readonly<Record<string, unknown>>;
}

function mapProviderFailure(
  failure: StructuredAiProviderError,
): AiExecutionError {
  switch (failure.kind) {
    case "disabled":
      return new AiExecutionError("ai_disabled", { cause: failure });
    case "rate_limited":
      return new AiExecutionError("ai_rate_limited", { cause: failure });
    case "unavailable":
    case "transient":
      return new AiExecutionError("ai_provider_unavailable", {
        cause: failure,
      });
    case "invalid_request":
      return new AiExecutionError("ai_execution_failed", { cause: failure });
  }
}

async function invokeWithTimeout(
  provider: StructuredAiProviderRegistry[string],
  request: Omit<StructuredAiProviderRequest, "signal">,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new AiAttemptTimeoutError());
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      provider.generateStructured({
        ...request,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export function createAiExecutionService(
  overrides: Partial<ExecutionDependencies> = {},
) {
  const dependencies: ExecutionDependencies = {
    tasks: overrides.tasks ?? registeredAiTasks,
    policies: overrides.policies ?? aiExecutionPolicies,
    providers: overrides.providers ?? structuredAiProviders,
    sleep: overrides.sleep ?? defaultSleep,
  };

  return Object.freeze({
    async execute(taskKey: string, input: unknown): Promise<AiExecutionResult> {
      const task = dependencies.tasks[taskKey];
      if (
        !task ||
        task.key !== taskKey ||
        !Number.isInteger(task.version) ||
        task.version < 1
      ) {
        throw new AiExecutionError("ai_task_not_found");
      }

      const parsedInput = task.inputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new AiExecutionError("ai_input_invalid", {
          cause: parsedInput.error,
        });
      }

      const policyValue = dependencies.policies[task.policyKey];
      if (!policyValue) {
        throw new AiExecutionError("ai_execution_failed", {
          cause: new Error("The registered AI policy was not found."),
        });
      }

      let policy: AiExecutionPolicy;
      try {
        policy = executionPolicySchema.parse(policyValue);
      } catch (cause) {
        throw new AiExecutionError("ai_execution_failed", { cause });
      }

      let inputBytes: number;
      try {
        inputBytes = serialisedInputBytes(parsedInput.data);
      } catch (cause) {
        throw new AiExecutionError("ai_input_invalid", { cause });
      }
      if (inputBytes > policy.maxInputBytes) {
        throw new AiExecutionError("ai_input_too_large");
      }

      const provider = dependencies.providers[policy.providerKey];
      if (!provider) {
        throw new AiExecutionError("ai_provider_unavailable", {
          cause: new Error("The registered structured provider was not found."),
        });
      }

      let instruction: string;
      let jsonSchema: Readonly<Record<string, unknown>>;
      try {
        instruction = task.buildInstruction(parsedInput.data);
        jsonSchema = outputJsonSchema(task);
      } catch (cause) {
        throw new AiExecutionError("ai_execution_failed", { cause });
      }

      const request = Object.freeze({
        providerKey: policy.providerKey,
        modelKey: policy.modelKey,
        instruction,
        input: parsedInput.data,
        outputContract: Object.freeze({
          name: task.key,
          version: task.version,
          jsonSchema,
        }),
        maxOutputTokens: policy.maxOutputTokens,
      });

      for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
        try {
          const rawResponse = await invokeWithTimeout(
            provider,
            request,
            policy.timeoutMs,
          );
          const response =
            structuredAiProviderResponseSchema.safeParse(rawResponse);
          if (!response.success) {
            throw new AiExecutionError("ai_output_invalid", {
              cause: response.error,
            });
          }

          const parsedOutput = task.outputSchema.safeParse(
            response.data.output,
          );
          if (!parsedOutput.success) {
            throw new AiExecutionError("ai_output_invalid", {
              cause: parsedOutput.error,
            });
          }

          return Object.freeze({
            output: parsedOutput.data,
            metadata: Object.freeze({
              taskKey: task.key,
              taskVersion: task.version,
              purposeLabel: task.purposeLabel,
              providerKey: policy.providerKey,
              modelKey: policy.modelKey,
              attempts: attempt,
              ...(response.data.usage
                ? { usage: Object.freeze(response.data.usage) }
                : {}),
              ...(response.data.requestMetadata
                ? {
                    requestMetadata: Object.freeze(
                      response.data.requestMetadata,
                    ),
                  }
                : {}),
            }),
          });
        } catch (cause) {
          if (cause instanceof AiExecutionError) {
            throw cause;
          }
          if (cause instanceof AiAttemptTimeoutError) {
            throw new AiExecutionError("ai_timeout", { cause });
          }
          if (cause instanceof StructuredAiProviderError) {
            const retryable = policy.retryableFailureKinds.includes(cause.kind);
            if (retryable && attempt < policy.maxAttempts) {
              try {
                await dependencies.sleep(policy.retryDelayMs);
              } catch (sleepCause) {
                throw new AiExecutionError("ai_execution_failed", {
                  cause: sleepCause,
                });
              }
              continue;
            }
            if (retryable) {
              throw new AiExecutionError("ai_attempts_exhausted", {
                cause,
              });
            }
            throw mapProviderFailure(cause);
          }
          throw new AiExecutionError("ai_execution_failed", { cause });
        }
      }

      throw new AiExecutionError("ai_execution_failed", {
        cause: new Error("The AI attempt loop ended unexpectedly."),
      });
    },
  });
}

export const aiExecutionService = createAiExecutionService();
