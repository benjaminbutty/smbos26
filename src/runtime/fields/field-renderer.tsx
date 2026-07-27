import type { ReactNode } from "react";

import type { Json, Tables } from "../../db/supabase/database.types";

interface FieldValueProps {
  field: Tables<"field_definitions">;
  value: Json | undefined;
}

interface FieldInputControlProps {
  field: Tables<"field_definitions">;
  value: Json | undefined;
}

function settingsObject(
  field: Tables<"field_definitions">,
): Record<string, Json | undefined> {
  const settings = field.settings_json;
  return typeof settings === "object" &&
    settings !== null &&
    !Array.isArray(settings)
    ? settings
    : {};
}

export function fieldOptions(field: Tables<"field_definitions">): string[] {
  const options = settingsObject(field).options;
  return Array.isArray(options)
    ? options.filter((option): option is string => typeof option === "string")
    : [];
}

export function getSafeFileUrl(value: Json | undefined): string | null {
  const candidate =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null && !Array.isArray(value)
        ? value.url
        : null;

  return typeof candidate === "string" && /^https?:\/\/\S+$/i.test(candidate)
    ? candidate
    : null;
}

function fileLabel(value: Json | undefined): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const name = value.name;
    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }

  return "View file";
}

function formatDate(value: string, includeTime: boolean): string {
  const date = new Date(includeTime ? value : `${value}T00:00:00.000Z`);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
        }
      : { timeZone: "UTC" }),
  }).format(date);
}

function formatCurrency(
  value: number,
  field: Tables<"field_definitions">,
): string {
  const configuredCurrency = settingsObject(field).currency;
  const currency =
    typeof configuredCurrency === "string" &&
    /^[A-Z]{3}$/.test(configuredCurrency)
      ? configuredCurrency
      : "GBP";

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("en-GB", {
      maximumFractionDigits: 2,
    }).format(value);
  }
}

export function FieldValue({
  field,
  value,
}: Readonly<FieldValueProps>): ReactNode {
  if (value === undefined || value === null || value === "") {
    return <span className="empty-value">—</span>;
  }

  switch (field.field_type) {
    case "currency":
      return typeof value === "number"
        ? formatCurrency(value, field)
        : String(value);
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-GB").format(value)
        : String(value);
    case "boolean":
      return (
        <span className={`boolean-value ${value ? "is-yes" : "is-no"}`}>
          {value ? "Yes" : "No"}
        </span>
      );
    case "date":
      return typeof value === "string"
        ? formatDate(value, false)
        : String(value);
    case "datetime":
      return typeof value === "string"
        ? formatDate(value, true)
        : String(value);
    case "email":
      return typeof value === "string" ? (
        <a href={`mailto:${value}`}>{value}</a>
      ) : (
        String(value)
      );
    case "phone":
      return typeof value === "string" ? (
        <a href={`tel:${value}`}>{value}</a>
      ) : (
        String(value)
      );
    case "url":
      return typeof value === "string" && /^https?:\/\/\S+$/i.test(value) ? (
        <a href={value} rel="noreferrer" target="_blank">
          Open link
        </a>
      ) : (
        <span className="empty-value">Unavailable</span>
      );
    case "select":
      return <span className="choice-value">{String(value)}</span>;
    case "status":
      return <span className="record-status">{String(value)}</span>;
    case "multi_select":
      return Array.isArray(value) ? (
        <span className="choice-list">
          {value.map((item) => (
            <span className="choice-value" key={String(item)}>
              {String(item)}
            </span>
          ))}
        </span>
      ) : (
        String(value)
      );
    case "file": {
      const url = getSafeFileUrl(value);
      return url ? (
        <a href={url} rel="noreferrer" target="_blank">
          {fileLabel(value)}
        </a>
      ) : (
        <span className="empty-value">Unavailable</span>
      );
    }
    case "long_text":
      return <span className="long-value">{String(value)}</span>;
    case "short_text":
      return String(value);
  }
}

function scalarDefault(value: Json | undefined): string | number | undefined {
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

export function FieldInputControl({
  field,
  value,
}: Readonly<FieldInputControlProps>): ReactNode {
  const common = {
    id: `field-${field.key}`,
    name: field.key,
    required: field.required,
  };

  switch (field.field_type) {
    case "long_text":
      return (
        <textarea {...common} defaultValue={scalarDefault(value)} rows={5} />
      );
    case "number":
    case "currency":
      return (
        <input
          {...common}
          defaultValue={scalarDefault(value)}
          inputMode="decimal"
          step={field.field_type === "currency" ? "0.01" : "any"}
          type="number"
        />
      );
    case "boolean":
      return (
        <span className="checkbox-control">
          <input
            id={common.id}
            name={common.name}
            defaultChecked={value === true}
            type="checkbox"
          />
          Yes
        </span>
      );
    case "date":
      return (
        <input {...common} defaultValue={scalarDefault(value)} type="date" />
      );
    case "datetime":
      return (
        <input
          {...common}
          defaultValue={
            typeof value === "string" ? value.slice(0, 16) : undefined
          }
          type="datetime-local"
        />
      );
    case "email":
      return (
        <input
          {...common}
          autoComplete="email"
          defaultValue={scalarDefault(value)}
          type="email"
        />
      );
    case "phone":
      return (
        <input
          {...common}
          autoComplete="tel"
          defaultValue={scalarDefault(value)}
          type="tel"
        />
      );
    case "url":
    case "file":
      return (
        <input
          {...common}
          defaultValue={scalarDefault(value)}
          placeholder="https://"
          type="url"
        />
      );
    case "select":
    case "status":
      return (
        <select {...common} defaultValue={scalarDefault(value) ?? ""}>
          <option value="">Choose…</option>
          {fieldOptions(field).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "multi_select":
      return (
        <select
          {...common}
          defaultValue={
            Array.isArray(value)
              ? value.filter((item): item is string => typeof item === "string")
              : []
          }
          multiple
          size={Math.min(Math.max(fieldOptions(field).length, 3), 6)}
        >
          {fieldOptions(field).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "short_text":
      return (
        <input {...common} defaultValue={scalarDefault(value)} type="text" />
      );
  }
}
