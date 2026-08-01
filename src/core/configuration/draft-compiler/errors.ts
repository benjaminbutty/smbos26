export const configurationDraftCompilerErrorCodes = [
  "configuration_draft_compile_input_invalid",
  "configuration_draft_compile_snapshot_invalid",
  "configuration_draft_compile_snapshot_inconsistent",
  "configuration_draft_compile_existing_reference_missing",
  "configuration_draft_compile_existing_reference_inactive",
  "configuration_draft_compile_existing_reference_mismatch",
  "configuration_draft_compile_object_label_conflict",
  "configuration_draft_compile_field_label_conflict",
  "configuration_draft_compile_key_unavailable",
  "configuration_draft_compile_slug_unavailable",
  "configuration_draft_compile_position_unavailable",
  "configuration_draft_compile_operations_invalid",
] as const;

export type ConfigurationDraftCompilerErrorCode =
  (typeof configurationDraftCompilerErrorCodes)[number];

const compilerErrorMessages: Readonly<
  Record<ConfigurationDraftCompilerErrorCode, string>
> = {
  configuration_draft_compile_input_invalid:
    "The configuration draft compiler input was invalid.",
  configuration_draft_compile_snapshot_invalid:
    "The configuration snapshot was invalid.",
  configuration_draft_compile_snapshot_inconsistent:
    "The configuration snapshot was internally inconsistent.",
  configuration_draft_compile_existing_reference_missing:
    "An existing configuration reference was not available.",
  configuration_draft_compile_existing_reference_inactive:
    "An existing configuration reference was inactive.",
  configuration_draft_compile_existing_reference_mismatch:
    "An existing configuration reference was incompatible.",
  configuration_draft_compile_object_label_conflict:
    "A new Object label conflicted with existing configuration.",
  configuration_draft_compile_field_label_conflict:
    "A new Field label conflicted with existing configuration.",
  configuration_draft_compile_key_unavailable:
    "A deterministic configuration key could not be allocated.",
  configuration_draft_compile_slug_unavailable:
    "A deterministic Page slug could not be allocated.",
  configuration_draft_compile_position_unavailable:
    "A deterministic Field position could not be allocated.",
  configuration_draft_compile_operations_invalid:
    "The compiled configuration operations were invalid.",
};

/**
 * Finite, owner-safe diagnostics for the pure compiler boundary.
 *
 * The class intentionally accepts only a code. Raw input, Zod paths, snapshot
 * rows and internal causes never become part of the public error payload.
 */
export class ConfigurationDraftCompilerError extends Error {
  readonly code: ConfigurationDraftCompilerErrorCode;
  readonly diagnosticCode: ConfigurationDraftCompilerErrorCode;

  constructor(code: ConfigurationDraftCompilerErrorCode) {
    super(compilerErrorMessages[code]);
    this.name = "ConfigurationDraftCompilerError";
    this.code = code;
    this.diagnosticCode = code;
  }
}
