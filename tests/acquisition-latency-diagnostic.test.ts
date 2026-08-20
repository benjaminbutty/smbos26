import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ACQUISITION_CORRECTION_LATENCY_DIAGNOSTIC_TIMEOUT_MS,
  acquisitionCorrectionLatencyDiagnosticPolicy,
  acquisitionCorrectionLatencyDiagnosticProfiles,
  recommendedAcquisitionTimeoutMs,
  summariseAcquisitionCorrectionLatency,
} from "../src/ai/evaluation/acquisition/correction-latency-diagnostic-live";
import {
  OPENAI_ACQUISITION_CORRECTION_TIMEOUT_MS,
  openAiAcquisitionRequiredIdentityCorrectionPolicy,
} from "../src/ai/policies";
import type { AcquisitionCorrectionLatencyDiagnosticReport } from "../src/ai/evaluation/acquisition/correction-latency-diagnostic-live";

function report(
  providerElapsedMs: number,
  overrides: Partial<AcquisitionCorrectionLatencyDiagnosticReport> = {},
): AcquisitionCorrectionLatencyDiagnosticReport {
  return {
    scenario_id: "bookings",
    repetition: 1,
    status: "success",
    failure_code: null,
    provider_elapsed_ms: providerElapsedMs,
    effective_service_tier: "priority",
    response_returned: true,
    input_tokens: 10,
    output_tokens: 20,
    estimated_cost_microusd: 30,
    quality_passed: true,
    quality_findings: [],
    hard_passed: true,
    hard_findings: [],
    ...overrides,
  };
}

describe("acquisition correction latency diagnostic", () => {
  it("keeps the two frozen candidate profiles exact and changes only the diagnostic ceiling", () => {
    const luna = acquisitionCorrectionLatencyDiagnosticProfiles.luna_max_fast;
    const sol = acquisitionCorrectionLatencyDiagnosticProfiles.sol_medium;

    expect(luna).toMatchObject({
      modelKey: "gpt-5.6-luna",
      reasoningEffort: "max",
      serviceTier: "fast",
    });
    expect(sol).toMatchObject({
      modelKey: "gpt-5.6-sol",
      reasoningEffort: "medium",
      serviceTier: "auto",
    });

    expect(openAiAcquisitionRequiredIdentityCorrectionPolicy.timeoutMs).toBe(
      OPENAI_ACQUISITION_CORRECTION_TIMEOUT_MS,
    );
    expect(openAiAcquisitionRequiredIdentityCorrectionPolicy).toMatchObject({
      modelKey: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
      serviceTier: "fast",
      maxOutputTokens: 8_192,
    });
    expect(acquisitionCorrectionLatencyDiagnosticPolicy(luna).timeoutMs).toBe(
      ACQUISITION_CORRECTION_LATENCY_DIAGNOSTIC_TIMEOUT_MS,
    );
    expect(acquisitionCorrectionLatencyDiagnosticPolicy(sol)).toMatchObject({
      modelKey: "gpt-5.6-sol",
      reasoningEffort: "medium",
      serviceTier: "auto",
      timeoutMs: 45_000,
      maxOutputTokens: 2_500,
    });
    expect(openAiAcquisitionRequiredIdentityCorrectionPolicy.timeoutMs).toBe(
      OPENAI_ACQUISITION_CORRECTION_TIMEOUT_MS,
    );
  });

  it("rounds the observed maximum plus five seconds up to the next five-second boundary", () => {
    expect(recommendedAcquisitionTimeoutMs(26_400)).toBe(35_000);
    expect(recommendedAcquisitionTimeoutMs(33_200)).toBe(40_000);
    expect(recommendedAcquisitionTimeoutMs(40_000)).toBe(45_000);
    expect(recommendedAcquisitionTimeoutMs(44_900)).toBe(45_000);
    expect(recommendedAcquisitionTimeoutMs(null)).toBeNull();
  });

  it("reports successful latency percentiles separately from timeout and other failures", () => {
    const profile =
      acquisitionCorrectionLatencyDiagnosticProfiles.luna_max_fast;
    const reports = [
      report(10_000),
      report(20_000),
      report(30_000),
      report(45_000, {
        status: "timeout",
        failure_code: "ai_timeout",
        effective_service_tier: null,
        response_returned: false,
      }),
      report(40_000, {
        status: "other_failure",
        failure_code: "provider_incomplete",
      }),
    ];
    const summary = summariseAcquisitionCorrectionLatency(profile, reports, 5);

    expect(summary.success_count).toBe(3);
    expect(summary.timeout_count).toBe(1);
    expect(summary.other_failure_count).toBe(1);
    expect(summary.min_successful_latency_ms).toBe(10_000);
    expect(summary.median_successful_latency_ms).toBe(20_000);
    expect(summary.p90_successful_latency_ms).toBe(30_000);
    expect(summary.p95_successful_latency_ms).toBe(30_000);
    expect(summary.max_successful_latency_ms).toBe(30_000);
    expect(summary.min_observed_latency_ms).toBe(10_000);
    expect(summary.median_observed_latency_ms).toBe(30_000);
    expect(summary.p90_observed_latency_ms).toBe(45_000);
    expect(summary.p95_observed_latency_ms).toBe(45_000);
    expect(summary.max_observed_latency_ms).toBe(45_000);
    expect(summary.average_latency_ms).toBe(29_000);
    expect(summary.average_successful_latency_ms).toBe(20_000);
    expect(summary.recommended_timeout_ms).toBe(35_000);
    expect(summary.initial_planning_latency_measured).toBe(false);
    expect(summary.two_call_path_latency_measured).toBe(false);
    expect(summary.effective_service_tier_verified).toBe(false);
  });

  it("accepts auto tier diagnostics without requiring priority", () => {
    const profile = acquisitionCorrectionLatencyDiagnosticProfiles.sol_medium;
    const summary = summariseAcquisitionCorrectionLatency(
      profile,
      [
        report(12_000, { effective_service_tier: "default" }),
        report(14_000, { effective_service_tier: "default" }),
      ],
      2,
    );

    expect(summary.effective_service_tier_distribution).toEqual({
      default: 2,
    });
    expect(summary.effective_service_tier_verified).toBe(true);
  });
});
