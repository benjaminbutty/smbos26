import type { Tables } from "../../db/supabase/database.types";

export const inlineEditViewKey = "__smbos_inline_view_key";
export const inlineEditRecordId = "__smbos_inline_record_id";
export const inlineEditFieldKey = "__smbos_inline_field_key";

export type InlineEditActionState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      recordId?: string;
      fieldKey?: string;
    }
  | {
      status: "success";
      record: Tables<"records">;
      fieldKey: string;
    };

export type InlineEditAction = (
  previousState: InlineEditActionState,
  formData: FormData,
) => Promise<InlineEditActionState>;
