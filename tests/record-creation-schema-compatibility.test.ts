import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StructuredAiProviderError } from "../src/ai/contracts";
import {
  BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD,
  BUILDER_RECORD_SCHEMA_COMPATIBILITY_BASE_PROBE_IDS,
  BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
  BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
  BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD,
  builderRecordSchemaCompatibilityBaseProbes,
  builderRecordSchemaCompatibilityProbeReportSchema,
  compareBuilderRecordSchemaWithInstalledOpenAiHelper,
  liveBuilderRecordSchemaCompatibilityIsActivated,
  measureBuilderRecordSchemaCompatibilitySchema,
  runLiveBuilderRecordSchemaCompatibility,
} from "../src/ai/evaluation/record-creation-intent/schema-compatibility";
import {
  OpenAiInvalidRequestDiagnostic,
  parseOpenAiSafeSchemaContext,
} from "../src/ai/providers/openai-diagnostics";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const activeEnvironment = {
  RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY: "1",
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "synthetic-server-only-key",
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function accepted(inputTokens = 20, outputTokens = 2) {
  return {
    output: { accepted: true },
    usage: { inputTokens, outputTokens },
  };
}

function schemaRejected(context: "known" | "unknown" = "unknown") {
  const safeSchemaContext =
    context === "known"
      ? ({
          keyword: "anyOf",
          path: ["properties", "result", "anyOf", 0, "properties"],
        } as const)
      : ("unknown" as const);
  return new StructuredAiProviderError(
    "invalid_request",
    "The structured request failed safely.",
    {
      cause: new OpenAiInvalidRequestDiagnostic(
        "provider_schema_rejected",
        safeSchemaContext,
      ),
    },
  );
}

function fileDigest(relativePath: string) {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(repositoryRoot, relativePath)))
    .digest("hex");
}

function objectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  if (typeof value !== "object" || value === null) return [];
  return [...Object.keys(value), ...Object.values(value).flatMap(objectKeys)];
}

describe("OpenAI Record-schema compatibility gate", () => {
  it("requires the exact three-part activation and constructs no provider while inactive", async () => {
    const loadDependencies = vi.fn();
    const inactiveEnvironments = [
      {},
      { OPENAI_API_KEY: "key" },
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "key" },
      {
        RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY: "1",
        AI_PROVIDER: "disabled",
        OPENAI_API_KEY: "key",
      },
      {
        RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY: "1",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "   ",
      },
    ];
    for (const environment of inactiveEnvironments) {
      expect(liveBuilderRecordSchemaCompatibilityIsActivated(environment)).toBe(
        false,
      );
      await expect(
        runLiveBuilderRecordSchemaCompatibility(environment, {
          loadDependencies,
        }),
      ).resolves.toMatchObject({ ran: false, passed: false });
    }
    expect(loadDependencies).not.toHaveBeenCalled();
    expect(
      liveBuilderRecordSchemaCompatibilityIsActivated(activeEnvironment),
    ).toBe(true);
  });

  it("freezes the ordered 20-probe matrix and emits only bounded reports", async () => {
    const calls: string[] = [];
    const emitted: unknown[] = [];
    const result = await runLiveBuilderRecordSchemaCompatibility(
      activeEnvironment,
      {
        now: () => 10,
        emit: (value) => emitted.push(value),
        execute: async (probe) => {
          calls.push(probe.id);
          return accepted();
        },
      },
    );

    expect(result).toMatchObject({ ran: true, passed: true });
    if (!result.ran) throw new Error("The compatibility gate did not run.");
    expect(calls).toEqual(BUILDER_RECORD_SCHEMA_COMPATIBILITY_BASE_PROBE_IDS);
    expect(result.reports).toHaveLength(20);
    expect(result.aggregate).toMatchObject({
      probes_executed: 20,
      accepted_probes: 20,
      rejected_probes: 0,
      stop_reason: "completed",
      exact_schema_accepted: true,
    });
    expect(emitted).toHaveLength(22);

    for (const report of result.reports) {
      expect(
        builderRecordSchemaCompatibilityProbeReportSchema.parse(report),
      ).toStrictEqual(report);
      expect(Object.keys(report).sort()).toEqual([
        "accepted",
        "attempts",
        "elapsed_ms",
        "estimated_microusd",
        "input_tokens",
        "output_tokens",
        "probe_id",
        "provider_reason_code",
        "result_class",
        "safe_schema_context",
        "schema_digest",
        "schema_metrics",
        "schema_version",
        "usage_complete",
      ]);
      expect(objectKeys(report)).not.toContain("schema");
      expect(objectKeys(report)).not.toContain("input");
      expect(JSON.stringify(report)).not.toContain("synthetic-server-only-key");
    }
  });

  it("continues through schema rejection and retains a finite safe context", async () => {
    const calls: string[] = [];
    const result = await runLiveBuilderRecordSchemaCompatibility(
      activeEnvironment,
      {
        now: () => 5,
        emit: () => {},
        execute: async (probe) => {
          calls.push(probe.id);
          if (probe.id === "a_transport_baseline") {
            throw schemaRejected("known");
          }
          return accepted();
        },
      },
    );

    if (!result.ran) throw new Error("The compatibility gate did not run.");
    expect(calls.slice(0, 20)).toEqual(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_BASE_PROBE_IDS,
    );
    expect(calls).toHaveLength(27);
    expect(result.reports[0]).toMatchObject({
      accepted: false,
      result_class: "schema_rejected",
      provider_reason_code: "provider_schema_rejected",
      safe_schema_context: {
        keyword: "anyOf",
        path: ["properties", "result", "anyOf", 0, "properties"],
      },
    });
    expect(result.aggregate.stop_reason).toBe("completed");
  });

  it("stops immediately on a non-schema provider failure", async () => {
    const calls: string[] = [];
    const result = await runLiveBuilderRecordSchemaCompatibility(
      activeEnvironment,
      {
        now: () => 5,
        emit: () => {},
        execute: async (probe) => {
          calls.push(probe.id);
          if (probe.id === "b_state_union") {
            throw new StructuredAiProviderError(
              "unavailable",
              "The provider is unavailable.",
            );
          }
          return accepted();
        },
      },
    );

    if (!result.ran) throw new Error("The compatibility gate did not run.");
    expect(calls).toEqual(["a_transport_baseline", "b_state_union"]);
    expect(result.aggregate).toMatchObject({
      probes_executed: 2,
      stop_reason: "provider_unavailable",
      exact_schema_accepted: false,
    });
  });

  it("reports adaptive family isolation when individuals pass but a family union fails", async () => {
    const result = await runLiveBuilderRecordSchemaCompatibility(
      activeEnvironment,
      {
        now: () => 5,
        emit: () => {},
        execute: async (probe) => {
          if (probe.id === "d_text_like_cumulative") throw schemaRejected();
          return accepted();
        },
      },
    );

    if (!result.ran) throw new Error("The compatibility gate did not run.");
    expect(result.aggregate.family_findings).toContainEqual({
      family: "text_like",
      conclusion: "combination_or_union_size_rejected",
    });
    expect(result.reports.map(({ probe_id }) => probe_id)).toContain(
      "keyword_without_string_bounds",
    );
  });

  it("bisects a failing complete union within the fixed five-probe adaptive maximum", async () => {
    const result = await runLiveBuilderRecordSchemaCompatibility(
      activeEnvironment,
      {
        now: () => 5,
        emit: () => {},
        execute: async (probe) => {
          if (probe.id === "g_complete_field_union") throw schemaRejected();
          if (
            probe.id.startsWith("adaptive_union_") &&
            probe.fieldTypes.length >= 6
          ) {
            throw schemaRejected();
          }
          return accepted();
        },
      },
    );

    if (!result.ran) throw new Error("The compatibility gate did not run.");
    expect(result.aggregate.union_isolation).toEqual({
      outcome: "branch_count",
      smallest_failing_branch_count: 6,
      specific_branch_combination_required: false,
      probes_used: 5,
    });
    expect(result.reports).toHaveLength(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_MAX_PROBE_COUNT,
    );
    expect(result.aggregate.stop_reason).toBe("completed");
  });

  it("enforces the aggregate actual-cost ceiling after the first over-ceiling report", async () => {
    const calls = vi.fn();
    const result = await runLiveBuilderRecordSchemaCompatibility(
      activeEnvironment,
      {
        now: () => 5,
        emit: () => {},
        execute: async () => {
          calls();
          return accepted(600_000, 0);
        },
      },
    );

    if (!result.ran) throw new Error("The compatibility gate did not run.");
    expect(calls).toHaveBeenCalledOnce();
    expect(result.aggregate.stop_reason).toBe("cost_ceiling_exceeded");
    expect(result.aggregate.total_estimated_microusd).toBeGreaterThan(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD,
    );
    expect(result.aggregate.probes_executed).toBe(1);
  });

  it("parses only allow-listed provider schema context tokens", () => {
    expect(
      parseOpenAiSafeSchemaContext({
        message:
          "Invalid schema in context=('properties','result','anyOf',0,'properties','field_values','items','anyOf',12): 'pattern' is not permitted.",
      }),
    ).toEqual({
      keyword: "pattern",
      path: [
        "properties",
        "result",
        "anyOf",
        0,
        "properties",
        "field_values",
        "items",
        "anyOf",
        12,
      ],
    });
    expect(
      parseOpenAiSafeSchemaContext({
        message:
          "Invalid schema in context=('properties','owner-secret-marker'): 'pattern' is not permitted.",
      }),
    ).toBe("unknown");
    expect(
      JSON.stringify(
        parseOpenAiSafeSchemaContext({
          message:
            "Invalid schema in context=('properties','owner-secret-marker'): provider-body-secret-marker.",
        }),
      ),
    ).not.toMatch(/owner-secret-marker|provider-body-secret-marker/);
  });

  it("produces deterministic metrics and a schema-free installed-SDK comparison", () => {
    const probe = builderRecordSchemaCompatibilityBaseProbes[0]!;
    expect(
      measureBuilderRecordSchemaCompatibilitySchema(probe.transportSchema!),
    ).toEqual(probe.schemaMetrics);
    const first = compareBuilderRecordSchemaWithInstalledOpenAiHelper();
    const second = compareBuilderRecordSchemaWithInstalledOpenAiHelper();
    expect(first).toEqual(second);
    expect(first.helper_generation_succeeded).toBe(true);
    expect(Object.keys(first).sort()).toEqual([
      "difference_categories",
      "helper_generation_succeeded",
      "helper_schema_digest",
      "helper_schema_metrics",
      "schema_version",
      "smbos_schema_digest",
      "smbos_schema_metrics",
    ]);
    expect(objectKeys(first)).not.toContain("schema");
  });

  it("freezes the cost envelope, ordinary live commands, and accepted Record subject files", () => {
    expect(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_PER_PROBE_RESERVATION_MICROUSD,
    ).toBe(41_920);
    expect(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD,
    ).toBe(1_341_440);
    expect(BUILDER_RECORD_SCHEMA_COMPATIBILITY_HARD_CEILING_MICROUSD).toBe(
      1_350_000,
    );
    expect(
      BUILDER_RECORD_SCHEMA_COMPATIBILITY_AGGREGATE_RESERVATION_MICROUSD,
    ).toBeLessThan(4_183_040);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(
      packageJson.scripts[
        "eval:builder-record-creation-terra-qualification-live"
      ],
    ).toBe(
      "vite-node --config vitest.builder-evaluation-live.config.ts evaluations/builder-record-creation.terra-qualification.live.eval.ts",
    );
    expect(
      packageJson.scripts[
        "eval:builder-record-creation-terra-reliability-live"
      ],
    ).toBe(
      "vite-node --config vitest.builder-evaluation-live.config.ts evaluations/builder-record-creation.terra-reliability.live.eval.ts",
    );

    expect(fileDigest("src/ai/record-creation-intent/task.ts")).toBe(
      "cc617d94cacaf4e9d301cc769a959ffeaa8516b481999ae189747584a8178757",
    );
    expect(fileDigest("src/ai/record-creation-intent/schemas.ts")).toBe(
      "9aeab1ab9214cc95181fbc576e5004abf0688125d74f654ccc349f7df5e03360",
    );
    expect(fileDigest("src/ai/record-creation-intent/validation.ts")).toBe(
      "977aa28a9f04a0eabfddce921b031da3c4999bdcd3313f1e22be80cd30cb966e",
    );
    expect(
      fileDigest("src/ai/evaluation/record-creation-intent/scenarios.ts"),
    ).toBe("42d27e0f0fe0045c23cde8dcdce6c055a9228222548c068ae34ca07bd85741a6");
  });
});
