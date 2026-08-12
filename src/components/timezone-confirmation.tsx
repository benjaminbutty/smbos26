"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

export interface TimezoneOption {
  value: string;
  label: string;
}

const commonTimezoneValues = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

const friendlyTimezoneNames: Readonly<Record<string, string>> = {
  UTC: "Coordinated Universal Time",
  "Europe/London": "United Kingdom / London",
  "Europe/Dublin": "Ireland / Dublin",
  "Europe/Paris": "France / Paris",
  "Europe/Berlin": "Germany / Berlin",
  "Europe/Madrid": "Spain / Madrid",
  "Europe/Rome": "Italy / Rome",
  "Europe/Amsterdam": "Netherlands / Amsterdam",
  "America/New_York": "United States / New York",
  "America/Chicago": "United States / Chicago",
  "America/Denver": "United States / Denver",
  "America/Los_Angeles": "United States / Los Angeles",
  "America/Toronto": "Canada / Toronto",
  "America/Vancouver": "Canada / Vancouver",
  "America/Sao_Paulo": "Brazil / São Paulo",
  "Asia/Kolkata": "India / Kolkata",
  "Asia/Singapore": "Singapore",
  "Asia/Tokyo": "Japan / Tokyo",
  "Asia/Shanghai": "China / Shanghai",
  "Australia/Sydney": "Australia / Sydney",
  "Pacific/Auckland": "New Zealand / Auckland",
};

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((part) =>
      part.length > 0 ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part,
    )
    .join(" ");
}

export function timezoneOptionLabel(value: string): string {
  const friendly = friendlyTimezoneNames[value];
  if (friendly) return friendly;
  const parts = value.split("/").filter(Boolean);
  if (parts.length === 0) return "Other timezone";
  return parts.map(titleCase).join(" / ");
}

export function timezoneOptions(): readonly TimezoneOption[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return [...new Set(["UTC", ...commonTimezoneValues, ...supported])]
    .map((value) => ({ value, label: timezoneOptionLabel(value) }))
    .sort((left, right) => left.label.localeCompare(right.label, "en"));
}

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
