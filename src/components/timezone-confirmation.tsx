"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { timezoneOptions } from "./timezone-options";

export { timezoneOptionLabel, timezoneOptions } from "./timezone-options";

export function timezoneHelpText(
  selectedLabel: string,
  selectedManually: boolean,
): string {
  return `${selectedManually ? "Using" : "We suggested"} ${selectedLabel}. This helps Lenni show dates and organise your business day. You can change it here.`;
}

export function TimezoneConfirmation(): ReactNode {
  const options = useMemo(() => timezoneOptions(), []);
  const browserTimezone = useSyncExternalStore(
    () => () => undefined,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    () => "UTC",
  );
  const suggestedTimezone = options.some(
    (option) => option.value === browserTimezone,
  )
    ? browserTimezone
    : "UTC";
  const [selectedTimezone, setSelectedTimezone] = useState<string | null>(null);
  const timezone = selectedTimezone ?? suggestedTimezone;

  const selectedLabel =
    options.find((option) => option.value === timezone)?.label ??
    "your selected timezone";
  const helpText = timezoneHelpText(selectedLabel, selectedTimezone !== null);

  return (
    <div className="acquisition-timezone-field">
      <label>
        Business timezone
        <select
          aria-label="Business timezone"
          name="timezone"
          onChange={(event) => setSelectedTimezone(event.currentTarget.value)}
          required
          value={timezone}
        >
          <option disabled value="">
            Choose a timezone
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <small className="field-help">{helpText}</small>
      </label>
    </div>
  );
}
