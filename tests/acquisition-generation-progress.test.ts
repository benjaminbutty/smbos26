import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  acquisitionGenerationProgressMessage,
  acquisitionGenerationProgressStages,
} from "../src/components/acquisition-generation-progress";

describe("acquisition generation progress", () => {
  it.each([
    [-1, "Shaping your workspace…"],
    [9_999, "Shaping your workspace…"],
    [10_000, "Designing the parts and how they connect…"],
    [29_999, "Designing the parts and how they connect…"],
    [30_000, "Checking the details and connections…"],
    [44_999, "Checking the details and connections…"],
    [45_000, "Finishing your workspace. This can take up to a minute."],
    [60_000, "Finishing your workspace. This can take up to a minute."],
  ])("uses the truthful bounded message at %d ms", (elapsedMs, expected) => {
    expect(acquisitionGenerationProgressMessage(elapsedMs)).toBe(expected);
  });

  it("keeps the UI timer staged, accessible and percentage-free", () => {
    const component = readFileSync(
      new URL(
        "../src/components/acquisition-generation-submit.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(
      acquisitionGenerationProgressStages.map(({ afterMs }) => afterMs),
    ).toEqual([0, 10_000, 30_000, 45_000]);
    expect(component).toContain('aria-live="polite"');
    expect(component).toContain('role="status"');
    expect(component).toContain("disabled={pending}");
    expect(component).not.toMatch(/percent|%/i);
  });

  it("offers only an owner-triggered retry for an existing fallback", () => {
    const page = readFileSync(
      new URL("../src/app/start/page.tsx", import.meta.url),
      "utf8",
    );
    const actions = readFileSync(
      new URL("../src/app/start/actions.ts", import.meta.url),
      "utf8",
    );

    expect(page).toContain('activeProposal.source === "fallback"');
    expect(page).toContain('label="Try tailoring again"');
    expect(page).toContain("retryAcquisitionTailoringAction");
    expect(actions).toContain("loadAcquisitionSession()");
    expect(actions).toContain('session.payload.proposal.source !== "fallback"');
    expect(actions).toContain(
      "await createOrRegenerateProposal(category.data, request.data)",
    );
    expect(actions).not.toContain("retryAcquisitionTailoringAction(formData");
  });
});
