import { describe, expect, it } from "vitest";

import {
  timezoneOptionLabel,
  timezoneOptions,
} from "../src/components/timezone-confirmation";

describe("acquisition timezone selection", () => {
  it("uses owner-readable labels for common browser/server timezone values", () => {
    expect(timezoneOptionLabel("Europe/London")).toBe(
      "United Kingdom / London",
    );
    expect(timezoneOptionLabel("America/Los_Angeles")).toBe(
      "United States / Los Angeles",
    );
    expect(timezoneOptionLabel("Asia/Kathmandu")).toBe("Asia / Kathmandu");
  });

  it("includes the browser-friendly choices without exposing IANA names as labels", () => {
    const options = timezoneOptions();
    const london = options.find((option) => option.value === "Europe/London");
    expect(london).toEqual({
      value: "Europe/London",
      label: "United Kingdom / London",
    });
    expect(options.some((option) => option.value === "UTC")).toBe(true);
    expect(options.every((option) => option.label !== option.value)).toBe(true);
  });
});
