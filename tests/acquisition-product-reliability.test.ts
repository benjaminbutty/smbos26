import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  acquisitionProductReliabilityScenarios,
  ACQUISITION_PRODUCT_RELIABILITY_REPETITIONS,
} from "../src/ai/evaluation/acquisition/product-reliability";
import {
  ACQUISITION_PRODUCT_RELIABILITY_EXECUTIONS,
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
    expect(acquisitionProductReliabilityScenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "carpenter_jobs_quotes_workers",
          request:
            "I’m a carpenter who needs to be able to track ongoing jobs, quotes handed to customers, which quotes need following up and which workers are working on which job",
        }),
      ]),
    );
  });

  it("does not run the provider unless the explicit live flag and credentials are present", async () => {
    await expect(
      runLiveAcquisitionProductReliability({
        AI_PROVIDER: "disabled",
      }),
    ).resolves.toEqual({ ran: false, passed: false });
  });
});
