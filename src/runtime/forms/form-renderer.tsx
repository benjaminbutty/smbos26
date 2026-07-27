import type { ReactNode } from "react";

import type { ExperienceFormBundle } from "../../core/experience/service";
import type { Json, Tables } from "../../db/supabase/database.types";
import { FieldInputControl } from "../fields/field-renderer";

interface FormRendererProps {
  bundle: ExperienceFormBundle;
  action: string | ((formData: FormData) => void | Promise<void>);
  record?: Tables<"records">;
  showHeading?: boolean;
}

function recordData(
  record?: Tables<"records">,
): Record<string, Json | undefined> {
  const data = record?.data_json;
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? data
    : {};
}

export function FormRenderer({
  bundle,
  action,
  record,
  showHeading = true,
}: Readonly<FormRendererProps>): ReactNode {
  const fieldsByKey = new Map(bundle.fields.map((field) => [field.key, field]));
  const values = recordData(record);

  return (
    <section className="runtime-form-panel">
      {showHeading ? (
        <div className="runtime-heading">
          <p className="eyebrow">
            {bundle.definition.mode === "create" ? "New" : "Edit"}{" "}
            {bundle.object.singular_label}
          </p>
          <h1 className="runtime-title">{bundle.definition.name}</h1>
        </div>
      ) : null}

      <form action={action} className="runtime-form">
        {bundle.config.fields.map((configuredField) => {
          const field = fieldsByKey.get(configuredField.field);
          if (!field || configuredField.hidden) {
            return null;
          }

          const value =
            values[field.key] ??
            configuredField.default_value ??
            field.default_value ??
            undefined;
          const label = configuredField.label ?? field.label;

          return (
            <div className="form-field" key={field.key}>
              <label htmlFor={`field-${field.key}`}>
                <span>
                  {label}
                  {field.required ? (
                    <span aria-label="required" className="required-mark">
                      *
                    </span>
                  ) : null}
                </span>
                <FieldInputControl field={field} value={value} />
              </label>
              {configuredField.help_text ? (
                <p className="field-help">{configuredField.help_text}</p>
              ) : null}
            </div>
          );
        })}

        <div className="form-actions">
          <button type="submit">
            {bundle.config.submit_label ??
              (bundle.definition.mode === "create"
                ? `Create ${bundle.object.singular_label.toLowerCase()}`
                : "Save changes")}
          </button>
        </div>
      </form>
    </section>
  );
}
