import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  acquisitionProductReliabilityScenarios,
  ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS,
} from "../src/ai/evaluation/acquisition/product-reliability";
import {
  acquisitionProductOutcome,
  acquisitionProductHardFindings,
  acquisitionProductReliabilityPassed,
  acquisitionRelatedFieldEquivalenceEvidencePassed,
  assertAcquisitionProductReliabilityCorpus,
  ACQUISITION_PRODUCT_RELIABILITY_EXECUTIONS,
  ACQUISITION_PRODUCT_RELIABILITY_MAX_FALLBACK,
  ACQUISITION_PRODUCT_RELIABILITY_MIN_TAILORED,
  ACQUISITION_PRODUCT_RELIABILITY_MIN_RELATED_FIELD_EQUIVALENCE_RECOVERIES,
  ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT,
  runLiveAcquisitionProductReliability,
} from "../src/ai/evaluation/acquisition/product-reliability-live";

describe("acquisition product-reliability corpus", () => {
  it("keeps a broad frozen corpus separate from the eight-scenario contract", () => {
    expect(ACQUISITION_PRODUCT_RELIABILITY_SCENARIO_COUNT).toBe(32);
    expect(
      new Set(acquisitionProductReliabilityScenarios.map(({ id }) => id)).size,
    ).toBe(acquisitionProductReliabilityScenarios.length);
    expect(ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS).toBe(3);
    expect(ACQUISITION_PRODUCT_RELIABILITY_EXECUTIONS).toBe(96);
    expect(ACQUISITION_PRODUCT_RELIABILITY_MIN_TAILORED).toBe(94);
    expect(ACQUISITION_PRODUCT_RELIABILITY_MAX_FALLBACK).toBe(2);
    expect(
      ACQUISITION_PRODUCT_RELIABILITY_MIN_RELATED_FIELD_EQUIVALENCE_RECOVERIES,
    ).toBe(2);
    expect(acquisitionProductReliabilityScenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "carpenter_jobs_quotes_workers",
          request:
            "I’m a carpenter who needs to be able to track ongoing jobs, quotes handed to customers, which quotes need following up and which workers are working on which job",
        }),
      ]),
    );
    expect(() => assertAcquisitionProductReliabilityCorpus()).not.toThrow();
  });

  it("rejects duplicate request text as well as duplicate scenario IDs", () => {
    const duplicateRequest = acquisitionProductReliabilityScenarios.map(
      (scenario, index) =>
        index === 1
          ? {
              ...scenario,
              request: acquisitionProductReliabilityScenarios[0].request,
            }
          : scenario,
    );
    expect(() =>
      assertAcquisitionProductReliabilityCorpus(duplicateRequest),
    ).toThrow("Acquisition product-reliability corpus preflight failed.");

    const duplicateId = acquisitionProductReliabilityScenarios.map(
      (scenario, index) =>
        index === 1
          ? { ...scenario, id: acquisitionProductReliabilityScenarios[0].id }
          : scenario,
    );
    expect(() =>
      assertAcquisitionProductReliabilityCorpus(duplicateId),
    ).toThrow("Acquisition product-reliability corpus preflight failed.");
  });

  it("never classifies canonicalised tailored output as raw first-pass", () => {
    expect(acquisitionProductOutcome("tailored", [])).toBe(
      "raw_first_pass_tailored",
    );
    expect(
      acquisitionProductOutcome("tailored", [
        "precomposition_canonicalisation_applied",
      ]),
    ).toBe("precomposition_canonicalised_tailored");
    expect(acquisitionProductOutcome("tailored", ["repair_succeeded"])).toBe(
      "postcomposition_recovered_tailored",
    );
    expect(
      acquisitionProductOutcome("tailored", [
        "precomposition_canonicalisation_applied",
        "repair_succeeded",
      ]),
    ).toBe(
      "precomposition_canonicalised_and_postcomposition_recovered_tailored",
    );
    expect(
      acquisitionProductOutcome("fallback", [
        "correction_plan_tailored_success",
        "precomposition_canonicalisation_applied",
      ]),
    ).toBe("final_fallback");
    expect(
      acquisitionProductOutcome("tailored", [
        "precomposition_canonicalisation_applied",
        "repair_succeeded",
        "correction_plan_tailored_success",
      ]),
    ).toBe("correction_plan_tailored");
  });

  it("keeps fallback separate from other product-corpus hard findings", () => {
    expect(
      acquisitionProductHardFindings(["not_tailored", "location_added"]),
    ).toEqual(["location_added"]);
    expect(acquisitionProductHardFindings(["not_tailored"])).toEqual([]);
  });

  it("enforces every product-corpus acceptance threshold", () => {
    const accepted = {
      tailored: 94,
      fallback: 2,
      executionFailures: 0,
      hardContractFailures: 0,
      systematicFailureScenarios: 0,
    };
    expect(acquisitionProductReliabilityPassed(accepted)).toBe(true);
    for (const rejected of [
      { ...accepted, tailored: 93 },
      { ...accepted, fallback: 3 },
      { ...accepted, executionFailures: 1 },
      { ...accepted, hardContractFailures: 1 },
      { ...accepted, systematicFailureScenarios: 1 },
    ]) {
      expect(acquisitionProductReliabilityPassed(rejected)).toBe(false);
    }
  });

  it("requires two safely recovered executions as separate causal evidence", () => {
    expect(acquisitionRelatedFieldEquivalenceEvidencePassed(2)).toBe(true);
    expect(acquisitionRelatedFieldEquivalenceEvidencePassed(1)).toBe(false);
  });

  it("does not run the provider unless the explicit live flag and credentials are present", async () => {
    await expect(
      runLiveAcquisitionProductReliability({
        AI_PROVIDER: "disabled",
      }),
    ).resolves.toEqual({ ran: false, passed: false });
  });
});
