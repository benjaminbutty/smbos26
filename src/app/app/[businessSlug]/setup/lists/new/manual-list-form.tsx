"use client";

import { useRef, useState, type ReactNode } from "react";

type ManualListFieldType =
  | "text"
  | "longer_text"
  | "number"
  | "yes_no"
  | "date"
  | "email"
  | "phone"
  | "choice"
  | "status";

interface InformationRow {
  id: number;
  label: string;
  type: ManualListFieldType;
  required: boolean;
  options: string[];
}

interface ManualListFormProps {
  action: (formData: FormData) => void | Promise<void>;
  expectedBaseVersionId: string;
  expectedHeadRevision: number;
}

const fieldTypes: ReadonlyArray<{
  value: ManualListFieldType;
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "longer_text", label: "Longer text" },
  { value: "number", label: "Number" },
  { value: "yes_no", label: "Yes / No" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "choice", label: "Choice" },
  { value: "status", label: "Status" },
];

function isOptionType(type: ManualListFieldType): boolean {
  return type === "choice" || type === "status";
}

export function normalizeManualListOptionLines(
  lines: ReadonlyArray<string>,
): string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

export function ManualListForm({
  action,
  expectedBaseVersionId,
  expectedHeadRevision,
}: Readonly<ManualListFormProps>): ReactNode {
  const nextId = useRef(0);
  const [information, setInformation] = useState<InformationRow[]>([]);
  const serializedInformation = JSON.stringify(
    information.map(({ label, type, required, options }) => ({
      label,
      type,
      required,
      ...(isOptionType(type)
        ? { options: normalizeManualListOptionLines(options) }
        : {}),
    })),
  );

  function addInformation(): void {
    if (information.length >= 7) {
      return;
    }
    nextId.current += 1;
    setInformation((current) => [
      ...current,
      {
        id: nextId.current,
        label: "",
        type: "text",
        required: false,
        options: [],
      },
    ]);
  }

  function updateInformation(
    id: number,
    update: Partial<Omit<InformationRow, "id">>,
  ): void {
    setInformation((current) =>
      current.map((row) => (row.id === id ? { ...row, ...update } : row)),
    );
  }

  function removeInformation(id: number): void {
    setInformation((current) => current.filter((row) => row.id !== id));
  }

  return (
    <form action={action} className="panel compact-panel stack-form">
      <input
        name="expectedBaseVersionId"
        type="hidden"
        value={expectedBaseVersionId}
      />
      <input
        name="expectedHeadRevision"
        type="hidden"
        value={expectedHeadRevision}
      />
      <input name="information" type="hidden" value={serializedInformation} />

      <label>
        List name
        <input maxLength={120} minLength={1} name="pluralListLabel" required />
        <span className="field-help">For example, Test Items.</span>
      </label>

      <label>
        One item is called
        <input
          maxLength={120}
          minLength={1}
          name="singularItemLabel"
          required
        />
        <span className="field-help">For example, Test Item.</span>
      </label>

      <label>
        Main name
        <input maxLength={120} minLength={1} name="mainNameLabel" required />
        <span className="field-help">The main name shown for each item.</span>
      </label>

      <fieldset className="setup-days">
        <legend>Additional information</legend>
        <p className="field-help">
          Add up to seven more pieces of information. The main name counts as
          one of the eight total pieces.
        </p>

        {information.map((row, index) => (
          <div className="panel compact-panel stack-form" key={row.id}>
            <div className="setup-field-grid">
              <label>
                Information {index + 1}
                <input
                  maxLength={120}
                  minLength={1}
                  onChange={(event) =>
                    updateInformation(row.id, { label: event.target.value })
                  }
                  required
                  value={row.label}
                />
              </label>
              <label>
                Type
                <select
                  onChange={(event) =>
                    updateInformation(row.id, {
                      type: event.target.value as ManualListFieldType,
                      options: isOptionType(
                        event.target.value as ManualListFieldType,
                      )
                        ? row.options
                        : [],
                    })
                  }
                  value={row.type}
                >
                  {fieldTypes.map((fieldType) => (
                    <option key={fieldType.value} value={fieldType.value}>
                      {fieldType.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="checkbox-control">
              <input
                checked={row.required}
                onChange={(event) =>
                  updateInformation(row.id, {
                    required: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Required
            </label>

            {isOptionType(row.type) ? (
              <label>
                Options
                <textarea
                  aria-label={`Options for information ${index + 1}`}
                  onChange={(event) =>
                    updateInformation(row.id, {
                      options: event.target.value.split("\n"),
                    })
                  }
                  placeholder="One option per line"
                  rows={3}
                  value={row.options.join("\n")}
                />
                <span className="field-help">
                  Enter at least two different options, one per line.
                </span>
              </label>
            ) : null}

            <button
              className="button-secondary"
              onClick={() => removeInformation(row.id)}
              type="button"
            >
              Remove information
            </button>
          </div>
        ))}

        <button
          className="button-secondary"
          disabled={information.length >= 7}
          onClick={addInformation}
          type="button"
        >
          Add information
        </button>
      </fieldset>

      <div className="configuration-action-note">
        Preparing a list creates one proposal for review. Nothing becomes live
        until an Owner or Admin deliberately Validates and Applies it.
      </div>
      <div className="form-actions">
        <button type="submit">Prepare list</button>
      </div>
    </form>
  );
}
