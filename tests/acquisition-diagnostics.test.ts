import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { StructuredAiProviderError } from "../src/ai/contracts";
import { AiExecutionError } from "../src/ai/errors";
import { OpenAiIncompleteDiagnostic } from "../src/ai/providers/openai";
import {
  classifyAcquisitionCandidateDiagnostic,
  emitAcquisitionCandidateDiagnostic,
} from "../src/core/acquisition/diagnostics";
import { AcquisitionCandidateQualityError } from "../src/core/acquisition/quality";

const context = {
  category: "appointments" as const,
  source: "tailored" as const,
};

describe("bounded acquisition candidate diagnostics", () => {
  it("classifies quality failures without retaining candidate detail", () => {
    const markers = [
      "owner-request-marker",
      "raw-provider-output-marker",
      "candidate-json-marker",
      "pii-marker@example.test",
    ];
    const diagnostic = classifyAcquisitionCandidateDiagnostic(
      new AcquisitionCandidateQualityError(
        "semantically_redundant_field",
        markers.join(" "),
      ),
      "candidate_quality",
      context,
    );

    expect(diagnostic).toEqual({
      event: "acquisition_candidate_diagnostic",
      stage: "candidate_quality",
      code: "quality_semantically_redundant_field",
      ...context,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(markers.join(" "));
  });

  it("classifies provider failures by finite cause kind", () => {
    const diagnostic = classifyAcquisitionCandidateDiagnostic(
      new AiExecutionError("ai_output_invalid", {
        cause: new StructuredAiProviderError(
          "invalid_response",
          "raw provider response marker",
        ),
      }),
      "candidate_generation",
      context,
    );

    expect(diagnostic).toEqual({
      event: "acquisition_candidate_diagnostic",
      stage: "provider_structured_output",
      code: "provider_structured_output_invalid",
      ...context,
    });
  });

  it("classifies max-output incompleteness without provider detail", () => {
    const diagnostic = classifyAcquisitionCandidateDiagnostic(
      new AiExecutionError("ai_incomplete", {
        cause: new StructuredAiProviderError("incomplete", "safe", {
          cause: new OpenAiIncompleteDiagnostic("max_output_tokens"),
          usage: { inputTokens: 12, outputTokens: 12_288 },
        }),
      }),
      "candidate_generation",
      context,
    );

    expect(diagnostic).toEqual({
      event: "acquisition_candidate_diagnostic",
      stage: "provider_structured_output",
      code: "provider_incomplete_max_output_tokens",
      ...context,
    });
  });

  it("keeps unknown incomplete reasons generic", () => {
    const diagnostic = classifyAcquisitionCandidateDiagnostic(
      new AiExecutionError("ai_incomplete", {
        cause: new StructuredAiProviderError(
          "incomplete",
          "raw-provider-incomplete-marker",
        ),
      }),
      "candidate_generation",
      context,
    );

    expect(diagnostic.code).toBe("provider_incomplete");
    expect(JSON.stringify(diagnostic)).not.toContain(
      "raw-provider-incomplete-marker",
    );
  });

  it("emits no raw error text", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      emitAcquisitionCandidateDiagnostic(
        new Error(
          "owner-request-marker raw-provider-output-marker candidate-json-marker pii@example.test",
        ),
        "candidate_generation",
        context,
      );

      expect(info).toHaveBeenCalledWith(
        JSON.stringify({
          event: "acquisition_candidate_diagnostic",
          stage: "unknown",
          code: "unclassified",
          ...context,
        }),
      );
      expect(JSON.stringify(info.mock.calls)).not.toMatch(
        /owner-request-marker|raw-provider-output-marker|candidate-json-marker|pii@example\.test/,
      );
    } finally {
      info.mockRestore();
    }
  });
});
