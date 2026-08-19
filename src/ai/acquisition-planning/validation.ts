import {
  acquisitionPlanningOutputSchema,
  type AcquisitionPlanningInput,
  type AcquisitionPlanningOutput,
} from "./schemas";

export class AcquisitionPlanningValidationError extends Error {
  constructor(readonly code: string) {
    super("The acquisition plan is not safe to use.");
    this.name = "AcquisitionPlanningValidationError";
  }
}
const fail = (code: string): never => {
  throw new AcquisitionPlanningValidationError(code);
};
function normaliseBusinessIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

export function isAcquisitionLocationIdentity(value: string): boolean {
  const normalised = normaliseBusinessIdentity(value);
  return normalised === "location" || normalised === "locations";
}

export function validateAcquisitionPlanningOutput(
  input: AcquisitionPlanningInput,
  candidate: AcquisitionPlanningOutput,
): AcquisitionPlanningOutput {
  const output = acquisitionPlanningOutputSchema.parse(candidate);
  if (output.state === "needs_more_detail") return output;
  if (
    output.tables.some(
      (table) =>
        isAcquisitionLocationIdentity(table.singular_name) ||
        isAcquisitionLocationIdentity(table.plural_name),
    )
  )
    fail("location_table_forbidden");
  const refs = output.tables.map(({ reference }) => reference);
  if (new Set(refs).size !== refs.length) fail("duplicate_table_reference");
  if (!refs.includes(output.primary_table_reference))
    fail("primary_table_unknown");
  if (
    output.connections.some(
      (item) =>
        !refs.includes(item.source_table_reference) ||
        !refs.includes(item.target_table_reference),
    )
  )
    fail("connection_table_unknown");
  const ownerText = [
    output.understanding,
    output.why,
    ...output.unsupported_requirements,
    ...output.tables.flatMap((table) => [
      table.singular_name,
      table.plural_name,
      table.purpose,
      ...table.fields.map(({ label }) => label),
    ]),
    ...output.connections.flatMap((connection) => [
      connection.source_label,
      connection.target_label,
      connection.explanation,
    ]),
  ].join(" ");
  if (
    /\b(?:schema|uuid|json|database|foreign key|cardinality)\b/i.test(ownerText)
  )
    fail("technical_owner_language");
  for (const table of output.tables)
    for (const field of table.fields) {
      const choice = ["select", "multi_select", "status"].includes(
        field.field_type,
      );
      if (choice !== (field.options !== null)) fail("field_options_invalid");
      if (
        field.field_type === "currency"
          ? !input.grounded_currency ||
            field.currency !== input.grounded_currency
          : field.currency !== null
      )
        fail("currency_not_grounded");
    }
  return output;
}
