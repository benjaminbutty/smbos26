"use client";

import type { ReactNode } from "react";

import { walkPageBlocks } from "../../core/experience/page-blocks";
import type { SitePageLayout } from "../../core/experience/schemas";
import {
  siteFormChoiceOptionsForPublication,
  type SiteDraftV1,
  type SiteFormDraft,
} from "../../core/sites/schemas";
import type { ObjectOption } from "./site-composer";

type FormQuestion = SiteFormDraft["questions"][number];
type FormQuestionType = FormQuestion["field_type"];
type Condition = NonNullable<FormQuestion["visible_when"]>;
type SiteBlock = SitePageLayout["blocks"][number];

const questionTypes: Array<{ value: FormQuestionType; label: string }> = [
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Long answer" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "Website" },
  { value: "select", label: "Choices" },
  { value: "multi_select", label: "Multiple choices" },
  { value: "boolean", label: "Yes / No" },
  { value: "status", label: "Status choices" },
  { value: "file", label: "Image or PDF" },
];

const questionTypeLabels = new Map(
  questionTypes.map((questionType) => [questionType.value, questionType.label]),
);

function managedKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function blankQuestion(fieldMode: "existing" | "new" = "new"): FormQuestion {
  return {
    id: crypto.randomUUID(),
    key: managedKey("question"),
    field_mode: fieldMode,
    label: "",
    field_type: "short_text",
    required: false,
  };
}

function blankForm(): SiteFormDraft {
  return {
    id: crypto.randomUUID(),
    key: managedKey("form"),
    name: "",
    object_mode: "new",
    object_key: managedKey("table"),
    singular_label: "",
    plural_label: "",
    view_mode: "new",
    view_key: managedKey("view"),
    view_name: "",
    submit_label: "",
    questions: [blankQuestion("new")],
  };
}

function formBlockExists(draft: SiteDraftV1, formKey: string): boolean {
  return draft.pages.some((page) =>
    walkPageBlocks(page.layout).some(
      (block) =>
        block.type === "public_form" &&
        "form_key" in block &&
        block.form_key === formKey,
    ),
  );
}

function formBlockCount(draft: SiteDraftV1, formKey: string): number {
  return draft.pages.reduce(
    (count, page) =>
      count +
      walkPageBlocks(page.layout).filter(
        (block) =>
          block.type === "public_form" &&
          "form_key" in block &&
          block.form_key === formKey,
      ).length,
    0,
  );
}

function removeFormBlocks(
  blocks: readonly SiteBlock[],
  formKey: string,
): SiteBlock[] {
  return blocks.flatMap((block) => {
    if (
      block.type === "public_form" &&
      "form_key" in block &&
      block.form_key === formKey
    ) {
      return [];
    }
    if (block.type === "collapsible") {
      return [
        {
          ...block,
          blocks: removeFormBlocks(
            block.blocks as readonly SiteBlock[],
            formKey,
          ),
        } as SiteBlock,
      ];
    }
    if (block.type === "section") {
      return [
        {
          ...block,
          columns: block.columns.map((column) => ({
            ...column,
            blocks: removeFormBlocks(
              column.blocks as readonly SiteBlock[],
              formKey,
            ),
          })),
        } as SiteBlock,
      ];
    }
    return [block];
  });
}

function objectLabel(object: ObjectOption): string {
  const plural = object.pluralLabel?.trim();
  const singular = object.singularLabel?.trim();
  if (plural && singular && plural !== singular) {
    return `${plural} (${singular})`;
  }
  return plural || singular || "Existing Table";
}

function questionFieldMode(
  question: FormQuestion,
  objectMode: SiteFormDraft["object_mode"],
): "existing" | "new" {
  return (
    question.field_mode ?? (objectMode === "existing" ? "existing" : "new")
  );
}

function isConditionSource(question: FormQuestion): boolean {
  return (
    question.field_type === "select" ||
    question.field_type === "multi_select" ||
    question.field_type === "boolean" ||
    question.field_type === "status"
  );
}

function conditionSources(
  questions: readonly FormQuestion[],
  questionIndex: number,
): FormQuestion[] {
  return questions
    .slice(0, questionIndex)
    .filter((question) => isConditionSource(question));
}

function sourceSupportsCondition(
  source: FormQuestion | undefined,
  condition: Condition,
): boolean {
  if (!source || !isConditionSource(source)) return false;
  if (source.field_type === "multi_select") {
    return condition.operator === "includes";
  }
  if (source.field_type === "boolean") {
    return (
      condition.operator === "equals" || condition.operator === "not_equals"
    );
  }
  return (
    (condition.operator === "equals" || condition.operator === "not_equals") &&
    typeof condition.value === "string"
  );
}

function conditionValueIsValid(
  source: FormQuestion | undefined,
  condition: Condition,
): boolean {
  if (!sourceSupportsCondition(source, condition)) return false;
  if (!source) return false;
  if (source?.field_type === "boolean")
    return typeof condition.value === "boolean";
  if (typeof condition.value !== "string" || !condition.value.trim())
    return false;
  return siteFormChoiceOptionsForPublication(source.options).includes(
    condition.value,
  );
}

export function siteFormDraftBlockers(
  form: SiteFormDraft,
  objectOptions: readonly ObjectOption[],
): string[] {
  const blockers: string[] = [];
  const destination = objectOptions.find(
    (object) => object.key === form.object_key,
  );
  if (!form.name.trim()) blockers.push("Give the Form a name.");
  if (form.object_mode === "new") {
    if (!form.singular_label?.trim() || !form.plural_label?.trim()) {
      blockers.push("Name the new Table in singular and plural.");
    }
  } else if (!destination) {
    blockers.push("Choose an existing Table.");
  }
  if (form.object_mode === "new" && form.view_mode !== "new") {
    blockers.push("Create a Table View for this new Table.");
  } else if (form.view_mode === "new" && !form.view_name?.trim()) {
    blockers.push("Name the new Table View.");
  } else if (
    form.view_mode === "existing" &&
    (!destination ||
      !form.view_key ||
      !destination.viewOptions.some((view) => view.key === form.view_key))
  ) {
    blockers.push("Choose an existing Table View.");
  }
  if (form.questions.length === 0) blockers.push("Add at least one question.");

  const keys = new Set<string>();
  form.questions.forEach((question, index) => {
    if (!question.key.trim() || !question.label.trim()) {
      blockers.push(`Complete question ${index + 1}.`);
    }
    if (question.key && keys.has(question.key)) {
      blockers.push(`Question ${index + 1} uses a property twice.`);
    }
    keys.add(question.key);

    const mode = questionFieldMode(question, form.object_mode);
    if (form.object_mode === "new" && mode !== "new") {
      blockers.push(
        `Question ${index + 1} needs a new property in this Table.`,
      );
    }

    const needsChoices =
      question.field_type === "select" ||
      question.field_type === "multi_select" ||
      question.field_type === "status";
    const normalizedOptions = siteFormChoiceOptionsForPublication(
      question.options,
    );
    if (
      needsChoices &&
      (normalizedOptions.length === 0 ||
        new Set(normalizedOptions).size !== normalizedOptions.length)
    ) {
      blockers.push(
        normalizedOptions.length === 0
          ? `Add choices for ${question.label || `question ${index + 1}`}.`
          : `Remove duplicate choices for ${question.label || `question ${index + 1}`}.`,
      );
    }
    if (question.field_type === "file" && !question.upload_kind) {
      blockers.push(
        `Choose image or PDF for ${question.label || `question ${index + 1}`}.`,
      );
    }
    const selectedField =
      form.object_mode === "existing" && mode === "existing" && destination
        ? destination.fieldOptions.find((field) => field.key === question.key)
        : undefined;
    if (form.object_mode === "existing" && mode === "existing" && destination) {
      if (!selectedField) {
        blockers.push(`Choose an existing property for question ${index + 1}.`);
      } else if (selectedField.fieldType !== question.field_type) {
        blockers.push(
          `Question ${index + 1} needs the existing property's answer type.`,
        );
      }
    }

    if (question.visible_when) {
      if (
        selectedField?.required &&
        (selectedField.defaultValue === undefined ||
          selectedField.defaultValue === null)
      ) {
        blockers.push(
          `${question.label || `Question ${index + 1}`} hides a required property without a default answer.`,
        );
      }
      const source = form.questions.find(
        (candidate) => candidate.key === question.visible_when?.field,
      );
      const sourceIndex = source ? form.questions.indexOf(source) : -1;
      if (sourceIndex < 0 || sourceIndex >= index) {
        blockers.push(
          `Condition for ${question.label || `question ${index + 1}`} must use an earlier choice.`,
        );
      } else if (!conditionValueIsValid(source, question.visible_when)) {
        blockers.push(
          `Choose a valid answer for the condition on ${question.label || `question ${index + 1}`}.`,
        );
      }
    }
  });
  if (form.object_mode === "existing" && destination) {
    const selectedExistingKeys = new Set(
      form.questions
        .filter(
          (question) =>
            questionFieldMode(question, form.object_mode) === "existing",
        )
        .map((question) => question.key),
    );
    for (const field of destination.fieldOptions) {
      if (
        !field.required ||
        selectedExistingKeys.has(field.key) ||
        (field.defaultValue !== undefined && field.defaultValue !== null)
      )
        continue;
      blockers.push(
        `Include the required property ${field.label || "from the selected Table"}.`,
      );
    }
  }
  return [...new Set(blockers)];
}

function fieldTypeAsQuestionType(fieldType: string): FormQuestionType {
  return questionTypes.some((questionType) => questionType.value === fieldType)
    ? (fieldType as FormQuestionType)
    : "short_text";
}

function conditionDefault(source: FormQuestion): Condition {
  if (source.field_type === "boolean") {
    return { field: source.key, operator: "equals", value: true };
  }
  return {
    field: source.key,
    operator: source.field_type === "multi_select" ? "includes" : "equals",
    value: siteFormChoiceOptionsForPublication(source.options)[0] ?? "",
  };
}

export function SiteFormComposer({
  draft,
  objectOptions,
  onAddToPage,
  onChange,
}: Readonly<{
  draft: SiteDraftV1;
  objectOptions: readonly ObjectOption[];
  onAddToPage: (formKey: string, pageId: string) => void;
  onChange: (draft: SiteDraftV1) => void;
}>): ReactNode {
  const forms = draft.forms ?? [];

  function updateForm(
    formId: string,
    update: (form: SiteFormDraft) => void,
  ): void {
    const next = structuredClone(draft);
    const form = (next.forms ?? []).find(
      (candidate) => candidate.id === formId,
    );
    if (!form) return;
    update(form);
    onChange(next);
  }

  function addForm(): void {
    const next = structuredClone(draft);
    next.forms = [...(next.forms ?? []), blankForm()];
    onChange(next);
  }

  function removeForm(formId: string): void {
    const next = structuredClone(draft);
    const form = (next.forms ?? []).find(
      (candidate) => candidate.id === formId,
    );
    if (!form) return;
    next.pages.forEach((page) => {
      page.layout.blocks = removeFormBlocks(page.layout.blocks, form.key);
    });
    next.forms = (next.forms ?? []).filter(
      (candidate) => candidate.id !== formId,
    );
    onChange(next);
  }

  function moveQuestion(
    formId: string,
    questionId: string,
    direction: -1 | 1,
  ): void {
    updateForm(formId, (form) => {
      const index = form.questions.findIndex(
        (question) => question.id === questionId,
      );
      const target = index + direction;
      if (index < 0 || target < 0 || target >= form.questions.length) {
        return;
      }
      const [question] = form.questions.splice(index, 1);
      if (!question) return;
      form.questions.splice(target, 0, question);
    });
  }

  function updateQuestion(
    formId: string,
    questionId: string,
    update: (question: FormQuestion) => void,
  ): void {
    updateForm(formId, (form) => {
      const question = form.questions.find(
        (candidate) => candidate.id === questionId,
      );
      if (question) update(question);
    });
  }

  return (
    <section className="site-form-composer panel" aria-label="Forms">
      <div className="site-form-composer-heading">
        <div>
          <p className="eyebrow">Capture enquiries</p>
          <h2>Forms</h2>
          <p className="muted">
            Build a Form from your Tables. Changes save with this Site and
            become workspace data only when you publish.
          </p>
        </div>
        <button className="button-secondary" onClick={addForm} type="button">
          Add a Form
        </button>
      </div>

      {forms.length === 0 ? (
        <div className="site-form-empty">
          <p>
            Start with a Form for a new Table, or collect responses in an
            existing Table.
          </p>
          <button onClick={addForm} type="button">
            Start with a Form
          </button>
        </div>
      ) : null}

      <div className="site-form-list">
        {forms.map((form, formIndex) => {
          const blockers = siteFormDraftBlockers(form, objectOptions);
          const placed = formBlockCount(draft, form.key);
          const destination = objectOptions.find(
            (object) => object.key === form.object_key,
          );
          return (
            <article className="site-form-card" key={form.id}>
              <div className="site-form-card-heading">
                <div>
                  <p className="eyebrow">Form {formIndex + 1}</p>
                  <h3>{form.name || "Unnamed Form"}</h3>
                </div>
                <button
                  className="button-secondary"
                  onClick={() => removeForm(form.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>

              <div className="site-form-grid">
                <label>
                  Form name
                  <input
                    onChange={(event) =>
                      updateForm(form.id, (value) => {
                        value.name = event.target.value;
                      })
                    }
                    value={form.name}
                  />
                </label>
                <label>
                  Save responses in
                  <select
                    onChange={(event) =>
                      updateForm(form.id, (value) => {
                        value.object_mode = event.target
                          .value as SiteFormDraft["object_mode"];
                        if (value.object_mode === "existing") {
                          value.questions.forEach((question) => {
                            question.field_mode = "existing";
                          });
                        } else {
                          if (
                            !value.object_key ||
                            objectOptions.some(
                              (object) => object.key === value.object_key,
                            )
                          ) {
                            value.object_key = managedKey("table");
                          }
                          value.questions.forEach((question) => {
                            question.field_mode = "new";
                          });
                        }
                      })
                    }
                    value={form.object_mode}
                  >
                    <option value="new">A new Table</option>
                    <option value="existing">An existing Table</option>
                  </select>
                </label>
                {form.object_mode === "existing" ? (
                  <label>
                    Table
                    <select
                      onChange={(event) =>
                        updateForm(form.id, (value) => {
                          value.object_key = event.target.value;
                          value.questions.forEach((question) => {
                            if (question.field_mode === undefined) {
                              question.field_mode = "existing";
                            }
                          });
                          if (value.view_mode === "existing") {
                            const selectedObject = objectOptions.find(
                              (object) => object.key === value.object_key,
                            );
                            if (
                              !value.view_key ||
                              !selectedObject?.viewOptions.some(
                                (view) => view.key === value.view_key,
                              )
                            ) {
                              value.view_key =
                                selectedObject?.viewOptions[0]?.key ?? "";
                            }
                          }
                        })
                      }
                      value={form.object_key}
                    >
                      <option value="">Choose a Table</option>
                      {objectOptions.map((object) => (
                        <option key={object.key} value={object.key}>
                          {objectLabel(object)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="site-form-field-note">
                    <strong>New Table</strong>
                    <span className="muted">
                      A workspace Table will be created automatically when you
                      publish.
                    </span>
                  </div>
                )}
                {form.object_mode === "new" ? (
                  <>
                    <label>
                      Table name (singular)
                      <input
                        onChange={(event) =>
                          updateForm(form.id, (value) => {
                            value.singular_label = event.target.value;
                          })
                        }
                        value={form.singular_label ?? ""}
                      />
                    </label>
                    <label>
                      Table name (plural)
                      <input
                        onChange={(event) =>
                          updateForm(form.id, (value) => {
                            value.plural_label = event.target.value;
                          })
                        }
                        value={form.plural_label ?? ""}
                      />
                    </label>
                  </>
                ) : null}
                <label>
                  Table View
                  <select
                    onChange={(event) =>
                      updateForm(form.id, (value) => {
                        value.view_mode = event.target
                          .value as SiteFormDraft["view_mode"];
                        if (value.view_mode === "existing") {
                          const selectedObject = objectOptions.find(
                            (object) => object.key === value.object_key,
                          );
                          if (
                            !value.view_key ||
                            !selectedObject?.viewOptions.some(
                              (view) => view.key === value.view_key,
                            )
                          ) {
                            value.view_key =
                              selectedObject?.viewOptions[0]?.key ?? "";
                          }
                        } else if (
                          !value.view_key ||
                          objectOptions.some((object) =>
                            object.viewOptions.some(
                              (view) => view.key === value.view_key,
                            ),
                          )
                        ) {
                          value.view_key = managedKey("view");
                        }
                      })
                    }
                    value={form.view_mode}
                  >
                    <option value="new">Create a Table View</option>
                    {form.object_mode === "existing" ||
                    form.view_mode === "existing" ? (
                      <option value="existing">
                        Use an existing Table View
                      </option>
                    ) : null}
                  </select>
                </label>
                {form.view_mode === "new" ? (
                  <label>
                    View name
                    <input
                      onChange={(event) =>
                        updateForm(form.id, (value) => {
                          value.view_name = event.target.value;
                        })
                      }
                      value={form.view_name ?? ""}
                    />
                  </label>
                ) : (
                  <label>
                    Existing Table View
                    <select
                      onChange={(event) =>
                        updateForm(form.id, (value) => {
                          value.view_key = event.target.value;
                        })
                      }
                      value={form.view_key ?? ""}
                    >
                      <option value="">Choose a Table View</option>
                      {(destination?.viewOptions ?? []).map((view) => (
                        <option key={view.key} value={view.key}>
                          {view.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Button label
                  <input
                    onChange={(event) =>
                      updateForm(form.id, (value) => {
                        value.submit_label = event.target.value;
                      })
                    }
                    value={form.submit_label ?? ""}
                  />
                </label>
                {form.object_mode === "existing" && destination ? (
                  <div className="site-form-field-note">
                    <strong>{objectLabel(destination)}</strong>
                    <span className="muted">
                      Choose existing properties or add new ones below. New
                      properties are added to this Table when you publish.
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="site-form-questions">
                <div className="site-form-subheading">
                  <h4>Questions</h4>
                  <button
                    className="button-secondary"
                    onClick={() =>
                      updateForm(form.id, (value) => {
                        value.questions.push(
                          blankQuestion(
                            value.object_mode === "existing"
                              ? "existing"
                              : "new",
                          ),
                        );
                      })
                    }
                    type="button"
                  >
                    Add question
                  </button>
                </div>
                {form.questions.map((question, questionIndex) => {
                  const sources = conditionSources(
                    form.questions,
                    questionIndex,
                  );
                  const selectedSourceIndex = sources.findIndex(
                    (source) => source.key === question.visible_when?.field,
                  );
                  const selectedSource =
                    selectedSourceIndex >= 0
                      ? sources[selectedSourceIndex]
                      : undefined;
                  const currentFieldMode = questionFieldMode(
                    question,
                    form.object_mode,
                  );
                  const selectedField =
                    currentFieldMode === "existing"
                      ? destination?.fieldOptions.find(
                          (field) => field.key === question.key,
                        )
                      : undefined;
                  return (
                    <div className="site-form-question" key={question.id}>
                      <div className="site-form-question-heading">
                        <strong>Question {questionIndex + 1}</strong>
                        <div className="site-form-question-actions">
                          <button
                            aria-label={`Move question ${questionIndex + 1} up`}
                            className="button-secondary"
                            disabled={questionIndex === 0}
                            onClick={() =>
                              moveQuestion(form.id, question.id, -1)
                            }
                            type="button"
                          >
                            Move up
                          </button>
                          <button
                            aria-label={`Move question ${questionIndex + 1} down`}
                            className="button-secondary"
                            disabled={
                              questionIndex === form.questions.length - 1
                            }
                            onClick={() =>
                              moveQuestion(form.id, question.id, 1)
                            }
                            type="button"
                          >
                            Move down
                          </button>
                          {form.questions.length > 1 ? (
                            <button
                              className="button-secondary"
                              onClick={() =>
                                updateForm(form.id, (value) => {
                                  value.questions = value.questions.filter(
                                    (candidate) => candidate.id !== question.id,
                                  );
                                  value.questions.forEach((candidate) => {
                                    if (
                                      candidate.visible_when?.field ===
                                      question.key
                                    ) {
                                      candidate.visible_when = undefined;
                                    }
                                  });
                                })
                              }
                              type="button"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="site-form-grid">
                        <label>
                          Question
                          <input
                            onChange={(event) =>
                              updateQuestion(form.id, question.id, (value) => {
                                value.label = event.target.value;
                              })
                            }
                            value={question.label}
                          />
                        </label>
                        {form.object_mode === "existing" ? (
                          <>
                            <label>
                              Property source
                              <select
                                onChange={(event) =>
                                  updateQuestion(
                                    form.id,
                                    question.id,
                                    (value) => {
                                      const nextMode = event.target.value as
                                        "existing" | "new";
                                      value.field_mode = nextMode;
                                      if (nextMode === "new") {
                                        if (
                                          !value.key ||
                                          destination?.fieldOptions.some(
                                            (field) => field.key === value.key,
                                          )
                                        ) {
                                          value.key = managedKey("property");
                                        }
                                      } else if (
                                        destination?.fieldOptions.some(
                                          (field) => field.key === value.key,
                                        )
                                      ) {
                                        const field =
                                          destination.fieldOptions.find(
                                            (candidate) =>
                                              candidate.key === value.key,
                                          );
                                        if (field) {
                                          value.label =
                                            field.label ?? value.label;
                                          value.field_type =
                                            fieldTypeAsQuestionType(
                                              field.fieldType,
                                            );
                                          value.required =
                                            field.required || value.required;
                                          value.options =
                                            field.options?.slice();
                                        }
                                      }
                                    },
                                  )
                                }
                                value={currentFieldMode}
                              >
                                <option value="existing">
                                  Use an existing property
                                </option>
                                <option value="new">Add a new property</option>
                              </select>
                            </label>
                            {currentFieldMode === "existing" ? (
                              <label>
                                Existing property
                                <select
                                  onChange={(event) =>
                                    updateQuestion(
                                      form.id,
                                      question.id,
                                      (value) => {
                                        const field =
                                          destination?.fieldOptions.find(
                                            (candidate) =>
                                              candidate.key ===
                                              event.target.value,
                                          );
                                        if (!field) {
                                          value.key = "";
                                          return;
                                        }
                                        value.field_mode = "existing";
                                        value.key = field.key;
                                        value.label =
                                          field.label ?? value.label;
                                        value.field_type =
                                          fieldTypeAsQuestionType(
                                            field.fieldType,
                                          );
                                        value.required =
                                          field.required || value.required;
                                        value.options = field.options?.slice();
                                        value.upload_kind = undefined;
                                        value.upload_count = undefined;
                                      },
                                    )
                                  }
                                  value={selectedField?.key ?? ""}
                                >
                                  <option value="">Choose a property</option>
                                  {(destination?.fieldOptions ?? []).map(
                                    (field) => (
                                      <option key={field.key} value={field.key}>
                                        {field.label || "Existing property"} (
                                        {questionTypeLabels.get(
                                          fieldTypeAsQuestionType(
                                            field.fieldType,
                                          ),
                                        )}
                                        )
                                      </option>
                                    ),
                                  )}
                                </select>
                              </label>
                            ) : (
                              <div className="site-form-field-note">
                                <strong>New property</strong>
                                <span className="muted">
                                  This property will be added to the selected
                                  Table when you publish.
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="site-form-field-note">
                            <strong>New property</strong>
                            <span className="muted">
                              This property will be named automatically from the
                              question.
                            </span>
                          </div>
                        )}
                        <label>
                          Answer type
                          <select
                            disabled={
                              form.object_mode === "existing" &&
                              Boolean(selectedField)
                            }
                            onChange={(event) =>
                              updateQuestion(form.id, question.id, (value) => {
                                value.field_type = event.target
                                  .value as FormQuestionType;
                              })
                            }
                            value={question.field_type}
                          >
                            {questionTypes.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="site-form-checkbox">
                          <input
                            checked={
                              question.required ||
                              Boolean(selectedField?.required)
                            }
                            disabled={Boolean(selectedField?.required)}
                            onChange={(event) =>
                              updateQuestion(form.id, question.id, (value) => {
                                value.required = event.target.checked;
                              })
                            }
                            type="checkbox"
                          />
                          Required answer
                        </label>
                        <label>
                          Help for visitors
                          <input
                            onChange={(event) =>
                              updateQuestion(form.id, question.id, (value) => {
                                value.help_text =
                                  event.target.value || undefined;
                              })
                            }
                            value={question.help_text ?? ""}
                          />
                        </label>
                        {question.field_type === "select" ||
                        question.field_type === "multi_select" ||
                        question.field_type === "status" ? (
                          <label>
                            Choices (one per line)
                            <textarea
                              onChange={(event) =>
                                updateQuestion(
                                  form.id,
                                  question.id,
                                  (value) => {
                                    // Keep blank and trailing lines in the
                                    // durable draft. Prepare normalizes the
                                    // choices after the owner finishes typing.
                                    value.options =
                                      event.target.value.split("\n");
                                  },
                                )
                              }
                              value={(question.options ?? []).join("\n")}
                            />
                          </label>
                        ) : null}
                        {question.field_type === "file" ? (
                          <>
                            <label>
                              File kind
                              <select
                                onChange={(event) =>
                                  updateQuestion(
                                    form.id,
                                    question.id,
                                    (value) => {
                                      value.upload_kind = event.target.value as
                                        "image" | "pdf";
                                    },
                                  )
                                }
                                value={question.upload_kind ?? ""}
                              >
                                <option value="">Choose a kind</option>
                                <option value="image">Image</option>
                                <option value="pdf">PDF</option>
                              </select>
                            </label>
                            <label>
                              Maximum files
                              <input
                                min={1}
                                max={5}
                                onChange={(event) =>
                                  updateQuestion(
                                    form.id,
                                    question.id,
                                    (value) => {
                                      value.upload_count = event.target.value
                                        ? Number(event.target.value)
                                        : undefined;
                                    },
                                  )
                                }
                                type="number"
                                value={question.upload_count ?? 1}
                              />
                            </label>
                          </>
                        ) : null}
                        {sources.length ? (
                          <label>
                            Show when earlier answer is
                            <select
                              onChange={(event) =>
                                updateQuestion(
                                  form.id,
                                  question.id,
                                  (value) => {
                                    const sourceIndex =
                                      event.target.value === ""
                                        ? -1
                                        : Number(event.target.value);
                                    const source =
                                      Number.isInteger(sourceIndex) &&
                                      sourceIndex >= 0 &&
                                      sourceIndex < sources.length
                                        ? sources[sourceIndex]
                                        : undefined;
                                    value.visible_when = source
                                      ? conditionDefault(source)
                                      : undefined;
                                  },
                                )
                              }
                              value={
                                selectedSourceIndex >= 0
                                  ? selectedSourceIndex
                                  : ""
                              }
                            >
                              <option value="">Always show</option>
                              {sources.map((source, sourceIndex) => (
                                <option key={source.id} value={sourceIndex}>
                                  {source.label ||
                                    `Question ${form.questions.indexOf(source) + 1}`}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {question.visible_when && selectedSource ? (
                          <>
                            {selectedSource.field_type !== "multi_select" ? (
                              <label>
                                Rule
                                <select
                                  onChange={(event) =>
                                    updateQuestion(
                                      form.id,
                                      question.id,
                                      (value) => {
                                        if (value.visible_when) {
                                          value.visible_when.operator = event
                                            .target.value as
                                            "equals" | "not_equals";
                                        }
                                      },
                                    )
                                  }
                                  value={question.visible_when.operator}
                                >
                                  <option value="equals">is</option>
                                  <option value="not_equals">is not</option>
                                </select>
                              </label>
                            ) : null}
                            <label>
                              Answer
                              {selectedSource.field_type === "boolean" ? (
                                <select
                                  onChange={(event) =>
                                    updateQuestion(
                                      form.id,
                                      question.id,
                                      (value) => {
                                        if (value.visible_when)
                                          value.visible_when.value =
                                            event.target.value === "true";
                                      },
                                    )
                                  }
                                  value={String(question.visible_when.value)}
                                >
                                  <option value="true">Yes</option>
                                  <option value="false">No</option>
                                </select>
                              ) : (
                                <select
                                  onChange={(event) =>
                                    updateQuestion(
                                      form.id,
                                      question.id,
                                      (value) => {
                                        if (value.visible_when)
                                          value.visible_when.value =
                                            event.target.value;
                                      },
                                    )
                                  }
                                  value={String(question.visible_when.value)}
                                >
                                  <option value="">Choose an answer</option>
                                  {siteFormChoiceOptionsForPublication(
                                    selectedSource.options,
                                  ).map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </label>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {blockers.length ? (
                <aside className="site-form-blockers" role="status">
                  <strong>Finish this Form before publishing</strong>
                  <ul>
                    {blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </aside>
              ) : (
                <div className="site-form-ready">
                  <span>Ready to publish</span>
                  {draft.pages
                    .filter((page) => page.is_included)
                    .map((page) => (
                      <button
                        className="button-secondary"
                        key={page.id}
                        onClick={() => onAddToPage(form.key, page.id)}
                        type="button"
                      >
                        {formBlockExists(draft, form.key)
                          ? `Add another copy to ${page.title || "Page"}`
                          : `Add to ${page.title || "Page"}`}
                      </button>
                    ))}
                  {placed ? (
                    <span className="muted">
                      Placed on {placed} Page block{placed === 1 ? "" : "s"}.
                    </span>
                  ) : null}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
