import type { Tables } from "../../db/supabase/database.types";

export function selectDirectTableRecord(
  records: readonly Tables<"records">[],
  recordId: string | null,
): Tables<"records"> | null {
  if (!recordId) return null;
  return records.find((record) => record.id === recordId) ?? null;
}

export function directTableRecordPanelHref(
  tablePath: string,
  recordId: string,
): string {
  return `${tablePath}?record=${encodeURIComponent(recordId)}`;
}

export function directTableFullRecordHref(
  tablePath: string,
  recordId: string,
): string {
  return `${tablePath}/${encodeURIComponent(recordId)}`;
}
