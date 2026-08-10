"use client";

import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import type { EditorCapabilities, EditorTable } from "../contracts";
import { EditorKernel } from "../editor-kernel";
import type { ProductionConfigurationCurrentness } from "./action-types";
import {
  createProductionTableAdapter,
  type ProductionTableAdapterActions,
} from "./production-table-adapter";

export interface ProductionTableWorkspaceProps {
  table: EditorTable;
  capabilities: EditorCapabilities;
  actions: ProductionTableAdapterActions;
  headerContent?: ReactNode;
  currentness?: ProductionConfigurationCurrentness | undefined;
  creationFallbackHref?: string | undefined;
  newRecordLabel?: string;
  recordCountLabel?: string;
  readOnly?: boolean;
  surface?: "workspace" | "embedded";
}

export function ProductionTableWorkspace({
  actions,
  capabilities,
  creationFallbackHref,
  currentness,
  headerContent,
  newRecordLabel,
  readOnly = false,
  recordCountLabel,
  surface = "workspace",
  table,
}: Readonly<ProductionTableWorkspaceProps>): ReactNode {
  const router = useRouter();
  const adapter = useMemo(
    () => createProductionTableAdapter(table, actions, currentness),
    [actions, currentness, table],
  );

  const footer = (
    <span>
      {readOnly
        ? "Read-only Table · Records are shown without edit controls."
        : "Changes save as you make them."}
      {creationFallbackHref ? (
        <>
          {" "}
          <a href={creationFallbackHref}>Open the configured creation screen</a>
          .
        </>
      ) : null}
    </span>
  );

  return (
    <EditorKernel
      adapter={adapter}
      capabilities={capabilities}
      footer={footer}
      headerContent={headerContent}
      {...(newRecordLabel !== undefined ? { newRecordLabel } : {})}
      onStructureChanged={() => router.refresh()}
      {...(recordCountLabel !== undefined ? { recordCountLabel } : {})}
      readOnly={readOnly}
      variant={surface}
    />
  );
}
