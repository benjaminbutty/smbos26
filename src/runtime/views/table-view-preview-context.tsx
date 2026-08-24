"use client";

import { createContext, useContext } from "react";

import type { EditorTablePreview } from "../editor-kernel/contracts";

interface TableViewPreviewContextValue {
  setPreview: (preview: EditorTablePreview | null) => void;
}

const TableViewPreviewContext = createContext<TableViewPreviewContextValue>({
  setPreview: () => undefined,
});

export const TableViewPreviewProvider = TableViewPreviewContext.Provider;

export function useTableViewPreview(): TableViewPreviewContextValue {
  return useContext(TableViewPreviewContext);
}
