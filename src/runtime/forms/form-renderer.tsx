import type { ReactNode } from "react";

import type { ExperienceFormBundle } from "../../core/experience/service";
import type { Json, Tables } from "../../db/supabase/database.types";
import { FieldInputControl } from "../fields/field-renderer";

export type FormAction =
  string | ((formData: FormData) => void | Promise<void>);

interface FormRendererCommonProps {
  bundle: ExperienceFormBundle;
  cancelHref?: string;
  cancelLabel?: string;
  record?: Tables<"records">;
  showHeading?: boolean;
}

export type FormRendererProps = FormRendererCommonProps &
  (
    | {
        action: FormAction;
        mode?: "live";
      }
    | {
        action?: never;
        mode: "preview";
      }
  );

function recordData(
  record?: Tables<"records">,
): Record<string, Json | undefined> {
  const data = record?.data_json;
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? data
    : {};
}

export function FormRenderer(props: Readonly<FormRendererProps>): ReactNode {
  const {
    bundle,
    cancelHref,
    cancelLabel = "Cancel",
    record,
    showHeading = true,
  } = props;
  const preview = props.mode === "preview";
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
          <p className="runtime-form-consequence">
            {preview
              ? "This is a preview. Nothing will be saved."
              : bundle.definition.mode === "create"
                ? `Add a new ${bundle.object.singular_label.toLowerCase()} to your workspace.`
                : "Update this record. Your changes save to the business data."}
          </p>
        </div>
      ) : null}

      <form
        className="runtime-form"
        {...(preview ? {} : { action: props.action })}
      >
        <fieldset className="runtime-form-fields" disabled={preview}>
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
                  <FieldInputControl
                    ariaDescribedBy={
                      configuredField.help_text
                        ? `help-${field.key}`
                        : undefined
                    }
                    field={field}
                    isEdit={bundle.definition.mode === "edit"}
                    value={value}
                  />
                </label>
                {configuredField.help_text ? (
                  <p className="field-help" id={`help-${field.key}`}>
                    {configuredField.help_text}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        <div className="form-actions">
          {cancelHref && !preview ? (
            <a className="form-cancel" href={cancelHref}>
              {cancelLabel}
            </a>
          ) : null}
          <button disabled={preview} type="submit">
            {preview
              ? "Disabled in preview"
              : (bundle.config.submit_label ??
                (bundle.definition.mode === "create"
                  ? `Create ${bundle.object.singular_label.toLowerCase()}`
                  : "Save changes"))}
          </button>
        </div>
      </form>
    </section>
  );
}
