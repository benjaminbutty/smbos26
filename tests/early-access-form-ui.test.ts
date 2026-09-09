import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EarlyAccessFormState } from "../src/components/early-access-form-state";

const formHarness = vi.hoisted(() => ({
  pending: false,
  state: { status: "idle" } as EarlyAccessFormState,
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();

  return {
    ...react,
    useActionState: () => [formHarness.state, vi.fn(), formHarness.pending],
  };
});

vi.mock("../src/app/actions/marketing", () => ({
  joinEarlyAccess: vi.fn(),
}));

import { EarlyAccessForm } from "../src/components/early-access-form";

function renderForm(state: EarlyAccessFormState, pending = false): string {
  formHarness.state = state;
  formHarness.pending = pending;
  return renderToStaticMarkup(createElement(EarlyAccessForm));
}

describe("EarlyAccessForm UI states", () => {
  it("shows the pending submit state without exposing an extra submission", () => {
    const markup = renderForm({ status: "idle" }, true);

    expect(markup).toContain("Joining…");
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain(">Join early access");
  });

  it("renders the existing safe error state", () => {
    const markup = renderForm({
      status: "error",
      message: "We couldn’t add you right now. Please try again.",
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(
      "We couldn’t add you right now. Please try again.",
    );
  });

  it("replaces the form with the existing success state", () => {
    const markup = renderForm({
      status: "success",
      message: "You’re on the list.",
    });

    expect(markup).toContain('class="early-access-success"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("on the list.");
    expect(markup).not.toContain("early-access-email");
  });
});
