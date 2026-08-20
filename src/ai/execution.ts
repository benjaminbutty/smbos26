import "server-only";

import { z } from "zod";

import {
  aiProviderFailureKindSchema,
  aiReasoningEffortSchema,
  structuredAiProviderResponseSchema,
  StructuredAiProviderError,
  structuredAiUsageSchema,
  type AiExecutionPolicy,
  type AiExecutionPolicyRegistry,
  type RegisteredAiTask,
  type RegisteredAiTaskRegistry,
  type StructuredAiProvider,
  type StructuredAiProviderRegistry,
  type StructuredAiProviderRequest,
  type StructuredAiUsage,
} from "./contracts";
import {
  AiExecutionError,
  type AiExecutionAccounting,
  type AiExecutionErrorCode,
} from "./errors";
import {
  aiExecutionPolicies,
  registeredAiTasks,
  structuredAiProviders,
} from "./registry";

const MAX_AGGREGATE_TOKENS = 5_000_000_000;

const executionPolicySchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_]*$/),
    providerKey: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z][a-z0-9_-]*$/),
    modelKey: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
    reasoningEffort: aiReasoningEffortSchema,
    maxInputBytes: z.number().int().positive().max(1_048_576),
    maxBillableInputTokens: z.number().int().positive().max(10_000_000),
    maxOutputTokens: z.number().int().positive().max(1_000_000),
    timeoutMs: z.number().int().positive().max(120_000),
    maxAttempts: z.number().int().positive().max(5),
    retryDelayMs: z.number().int().nonnegative().max(10_000),
    retryableFailureKinds: z
      .array(aiProviderFailureKindSchema)
      .max(5)
      .readonly(),
    inputMicrousdPerMillion: z.number().int().nonnegative().max(1_000_000_000),
    outputMicrousdPerMillion: z.number().int().nonnegative().max(1_000_000_000),
  })
  .strict();

const taskKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const providerKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_-]*$/);
const purposeLabelSchema = z.string().trim().min(1).max(120);

interface ExecutionDependencies {
  tasks: RegisteredAiTaskRegistry;
  policies: AiExecutionPolicyRegistry;
  providers: StructuredAiProviderRegistry;
  sleep(milliseconds: number): Promise<void>;
}

export interface PreparedAiExecutionDescriptor {
  taskKey: string;
  taskVersion: number;
  purposeLabel: string;
  policy: AiExecutionPolicy;
}

export interface PreparedAiExecution {
  readonly descriptor: PreparedAiExecutionDescriptor;
}

interface InternalPreparedExecution {
  task: RegisteredAiTask;
  input: unknown;
  policy: AiExecutionPolicy;
  provider: StructuredAiProvider;
  request: Readonly<Omit<StructuredAiProviderRequest, "signal">>;
}

interface AiExecutionMetadata {
  taskKey: string;
  taskVersion: number;
  purposeLabel: string;
  providerKey: string;
  modelKey: string;
  attempts: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    complete: boolean;
  };
  requestMetadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AiExecutionResult<TOutput = unknown> {
  output: TOutput;
  metadata: AiExecutionMetadata;
  accounting: AiExecutionAccounting;
}

interface MutableAccounting {
  attemptsStarted: number;
  inputTokens: number;
  outputTokens: number;
  usageReported: boolean;
  usageComplete: boolean;
  providerInvocationStarted: boolean;
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

function snapshotAccounting(
  accounting: MutableAccounting,
): AiExecutionAccounting {
  return Object.freeze({
    attemptsStarted: accounting.attemptsStarted,
    inputTokens: accounting.inputTokens,
    outputTokens: accounting.outputTokens,
    usageReported: accounting.usageReported,
    usageComplete: accounting.usageComplete,
    providerInvocationStarted: accounting.providerInvocationStarted,
    failureBeforeProviderInvocation: !accounting.providerInvocationStarted,
  });
}

function addUsage(
  accounting: MutableAccounting,
  usage: StructuredAiUsage | undefined,
): void {
  if (!usage) {
    accounting.usageComplete = false;
    return;
  }
  const parsed = structuredAiUsageSchema.parse(usage);
  accounting.usageReported = true;
  const inputTotal = accounting.inputTokens + parsed.inputTokens;
  const outputTotal = accounting.outputTokens + parsed.outputTokens;
  if (
    !Number.isSafeInteger(inputTotal) ||
    !Number.isSafeInteger(outputTotal) ||
    inputTotal > MAX_AGGREGATE_TOKENS ||
    outputTotal > MAX_AGGREGATE_TOKENS
  ) {
    accounting.usageComplete = false;
    throw new RangeError("Aggregate AI usage exceeds safe accounting bounds.");
  }
  accounting.inputTokens = inputTotal;
  accounting.outputTokens = outputTotal;
}

function executionError(
  code: AiExecutionErrorCode,
  accounting: MutableAccounting,
  cause?: unknown,
): AiExecutionError {
  return new AiExecutionError(code, {
    accounting: snapshotAccounting(accounting),
    cause,
  });
}

function providerFailureCode(
  failure: StructuredAiProviderError,
): AiExecutionErrorCode {
  switch (failure.kind) {
    case "disabled":
      return "ai_disabled";
    case "rate_limited":
      return "ai_rate_limited";
    case "unavailable":
    case "transient":
      return "ai_provider_unavailable";
    case "invalid_request":
      return "ai_execution_failed";
    case "invalid_response":
      return "ai_output_invalid";
    case "refused":
      return "ai_refused";
    case "incomplete":
      return "ai_incomplete";
    case "content_filtered":
      return "ai_content_filtered";
  }
}

async function invokeWithTimeout(
  provider: StructuredAiProvider,
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
  const preparedExecutions = new WeakMap<
    PreparedAiExecution,
    InternalPreparedExecution
  >();

  function prepare(taskKey: string, input: unknown): PreparedAiExecution {
    const task = dependencies.tasks[taskKey];
    if (!task) {
      throw new AiExecutionError("ai_task_not_found");
    }

    try {
      taskKeySchema.parse(taskKey);
      if (
        task.key !== taskKey ||
        !Number.isInteger(task.version) ||
        task.version < 1
      ) {
        throw new Error("The registered AI task identity is invalid.");
      }
      purposeLabelSchema.parse(task.purposeLabel);
      taskKeySchema.parse(task.policyKey);
    } catch (cause) {
      throw new AiExecutionError("ai_execution_failed", { cause });
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
      if (policy.key !== task.policyKey) {
        throw new Error("The registered AI policy key does not match.");
      }
    } catch (cause) {
      throw new AiExecutionError("ai_execution_failed", { cause });
    }

    const provider = dependencies.providers[policy.providerKey];
    if (!provider) {
      throw new AiExecutionError("ai_execution_failed", {
        cause: new Error("The registered structured provider was not found."),
      });
    }
    try {
      const providerKey = providerKeySchema.parse(provider.key);
      if (providerKey !== policy.providerKey) {
        throw new Error(
          "The registered structured provider key does not match.",
        );
      }
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

    let instruction: string;
    let jsonSchema: Readonly<Record<string, unknown>>;
    try {
      instruction = task.buildInstruction(parsedInput.data);
      if (instruction.length < 1 || instruction.length > 20_000) {
        throw new Error("The server-owned AI instruction is invalid.");
      }
      jsonSchema = outputJsonSchema(task);
    } catch (cause) {
      throw new AiExecutionError("ai_execution_failed", { cause });
    }

    const descriptor = Object.freeze({
      taskKey: task.key,
      taskVersion: task.version,
      purposeLabel: task.purposeLabel,
      policy: Object.freeze({ ...policy }),
    });
    const prepared = Object.freeze({ descriptor });
    preparedExecutions.set(prepared, {
      task,
      input: parsedInput.data,
      policy,
      provider,
      request: Object.freeze({
        providerKey: policy.providerKey,
        modelKey: policy.modelKey,
        reasoningEffort: policy.reasoningEffort,
        instruction,
        input: parsedInput.data,
        outputContract: Object.freeze({
          name: task.key,
          version: task.version,
          jsonSchema,
        }),
        maxOutputTokens: policy.maxOutputTokens,
      }),
    });
    return prepared;
  }

  async function executePrepared(
    prepared: PreparedAiExecution,
  ): Promise<AiExecutionResult> {
    const internal = preparedExecutions.get(prepared);
    if (!internal) {
      throw new AiExecutionError("ai_execution_failed", {
        cause: new Error("The prepared AI execution is not trusted."),
      });
    }

    const { task, input, policy, provider, request } = internal;
    const accounting: MutableAccounting = {
      attemptsStarted: 0,
      inputTokens: 0,
      outputTokens: 0,
      usageReported: false,
      usageComplete: true,
      providerInvocationStarted: false,
    };

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      accounting.attemptsStarted += 1;
      accounting.providerInvocationStarted = true;
      try {
        const rawResponse = await invokeWithTimeout(
          provider,
          request,
          policy.timeoutMs,
        );
        const response =
          structuredAiProviderResponseSchema.safeParse(rawResponse);
        if (!response.success) {
          accounting.usageComplete = false;
          throw executionError("ai_output_invalid", accounting, response.error);
        }

        try {
          addUsage(accounting, response.data.usage);
        } catch (cause) {
          throw executionError("ai_execution_failed", accounting, cause);
        }

        const parsedOutput = task.outputSchema.safeParse(response.data.output);
        if (!parsedOutput.success) {
          throw executionError(
            "ai_output_invalid",
            accounting,
            parsedOutput.error,
          );
        }

        let validatedOutput: unknown;
        try {
          validatedOutput = task.validateOutput
            ? task.validateOutput(input, parsedOutput.data)
            : parsedOutput.data;
          validatedOutput = task.outputSchema.parse(validatedOutput);
        } catch (cause) {
          throw executionError("ai_output_invalid", accounting, cause);
        }

        const finalAccounting = snapshotAccounting(accounting);
        return Object.freeze({
          output: validatedOutput,
          accounting: finalAccounting,
          metadata: Object.freeze({
            taskKey: task.key,
            taskVersion: task.version,
            purposeLabel: task.purposeLabel,
            providerKey: policy.providerKey,
            modelKey: policy.modelKey,
            attempts: attempt,
            usage: Object.freeze({
              inputTokens: finalAccounting.inputTokens,
              outputTokens: finalAccounting.outputTokens,
              complete: finalAccounting.usageComplete,
            }),
            ...(response.data.requestMetadata
              ? {
                  requestMetadata: Object.freeze(response.data.requestMetadata),
                }
              : {}),
          }),
        });
      } catch (cause) {
        if (cause instanceof AiExecutionError) {
          throw cause;
        }
        if (cause instanceof AiAttemptTimeoutError) {
          accounting.usageComplete = false;
          throw executionError("ai_timeout", accounting, cause);
        }
        if (cause instanceof StructuredAiProviderError) {
          try {
            addUsage(accounting, cause.usage);
          } catch (usageCause) {
            throw executionError("ai_execution_failed", accounting, usageCause);
          }
          const retryable = policy.retryableFailureKinds.includes(cause.kind);
          if (retryable && attempt < policy.maxAttempts) {
            try {
              await dependencies.sleep(policy.retryDelayMs);
            } catch (sleepCause) {
              throw executionError(
                "ai_execution_failed",
                accounting,
                sleepCause,
              );
            }
            continue;
          }
          if (retryable) {
            throw executionError("ai_attempts_exhausted", accounting, cause);
          }
          throw executionError(providerFailureCode(cause), accounting, cause);
        }
        accounting.usageComplete = false;
        throw executionError("ai_execution_failed", accounting, cause);
      }
    }

    accounting.usageComplete = false;
    throw executionError(
      "ai_execution_failed",
      accounting,
      new Error("The AI attempt loop ended unexpectedly."),
    );
  }

  return Object.freeze({
    prepare,
    executePrepared,
    async execute(taskKey: string, input: unknown): Promise<AiExecutionResult> {
      return executePrepared(prepare(taskKey, input));
    },
  });
}

export const aiExecutionService = createAiExecutionService();
