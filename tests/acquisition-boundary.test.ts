import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openAiAcquisitionPlanningPolicy } from "../src/ai/policies";
import { acquisitionEvaluationScenarios } from "../src/ai/evaluation/acquisition/scenarios";
import { emitAcquisitionEvent } from "../src/core/acquisition/events";

describe("Phase 5 public AI and telemetry boundary", () => {
  it("keeps the public interpretation inside the acquisition cost envelope", () => {
    expect(openAiAcquisitionPlanningPolicy).toMatchObject({
      maxInputBytes: 8 * 1024,
      maxBillableInputTokens: 4_000,
      maxOutputTokens: 2_500,
      timeoutMs: 25_000,
      maxAttempts: 1,
      retryableFailureKinds: [],
    });
  });

  it("fixes the production acceptance set at exactly eight scenarios", () => {
    expect(acquisitionEvaluationScenarios).toHaveLength(8);
    expect(
      new Set(acquisitionEvaluationScenarios.map(({ id }) => id)).size,
    ).toBe(8);
  });

  it("drops prompt, customer and authoritative payload metadata", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    emitAcquisitionEvent("prompt_submitted", {
      category: "appointments",
      prompt: "A customer name and phone number",
      customer: "Private customer",
      operations: "authoritative operations",
      business_slug: "private-business",
    });
    expect(info).toHaveBeenCalledOnce();
    const event = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(event).toMatchObject({
      event: "prompt_submitted",
      category: "appointments",
    });
    expect(event).not.toHaveProperty("prompt");
    expect(event).not.toHaveProperty("customer");
    expect(event).not.toHaveProperty("operations");
    expect(event).not.toHaveProperty("business_slug");
    info.mockRestore();
  });
});
