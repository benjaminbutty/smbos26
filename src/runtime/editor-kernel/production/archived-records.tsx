"use client";
import { useRef, useState } from "react";
import {
  listProductionArchivedRecordsAction,
  setProductionTableRecordArchivedAction,
} from "./production-table-actions";

export function ArchivedRecords({
  businessSlug,
  viewKey,
  onChanged,
}: {
  businessSlug: string;
  viewKey: string;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [records, setRecords] = useState<{ id: string; label: string }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(offset: number) {
    setBusy(true);
    setError(null);
    try {
      const result = await listProductionArchivedRecordsAction(
        businessSlug,
        viewKey,
        offset,
      );
      if (result.status === "error") throw new Error(result.message);
      setRecords((current) =>
        offset ? [...current, ...result.value.records] : result.value.records,
      );
      setHasMore(result.value.hasMore);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load archived records.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          dialog.current?.showModal();
          void load(0);
        }}
      >
        Archived records
      </button>
      <dialog
        ref={dialog}
        className="table-archive-dialog"
        aria-labelledby="archive-title"
      >
        <h2 id="archive-title">Archived records</h2>
        <p>
          Restore a record to make it available in this Table again. Saved views
          show it when it matches their filters.
        </p>
        {records.map((record) => (
          <div className="table-archive-row" key={record.id}>
            <span>{record.label}</span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const result = await setProductionTableRecordArchivedAction(
                    businessSlug,
                    viewKey,
                    { recordId: record.id, archived: false },
                  );
                  if (result.status === "error")
                    throw new Error(result.message);
                  onChanged();
                  await load(0);
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not restore record.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore
            </button>
          </div>
        ))}
        {!busy && !records.length && !error ? (
          <p>No archived records.</p>
        ) : null}
        {busy ? <p role="status">Loading…</p> : null}
        {error ? (
          <p role="alert">
            {error}{" "}
            <button type="button" onClick={() => void load(0)}>
              Retry
            </button>
          </p>
        ) : null}
        {hasMore ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void load(records.length)}
          >
            Load more
          </button>
        ) : null}
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
