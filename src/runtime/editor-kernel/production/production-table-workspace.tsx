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
  businessSlug?: string;
  headerContent?: ReactNode;
  currentness?: ProductionConfigurationCurrentness | undefined;
  creationFallbackHref?: string | undefined;
  newRecordLabel?: string;
  recordTypeLabel?: string;
  recordCountLabel?: string;
  fullRecordPath?: string;
  readOnly?: boolean;
  surface?: "workspace" | "embedded";
}

export function ProductionTableWorkspace({
  actions,
  businessSlug,
  capabilities,
  creationFallbackHref,
  currentness,
  headerContent,
  newRecordLabel,
  recordTypeLabel,
  readOnly = false,
  recordCountLabel,
  fullRecordPath,
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
      {...(businessSlug !== undefined ? { businessSlug } : {})}
      footer={footer}
      headerContent={headerContent}
      {...(newRecordLabel !== undefined ? { newRecordLabel } : {})}
      onStructureChanged={() => router.refresh()}
      {...(recordCountLabel !== undefined ? { recordCountLabel } : {})}
      {...(recordTypeLabel !== undefined ? { recordTypeLabel } : {})}
      {...(fullRecordPath !== undefined ? { fullRecordPath } : {})}
      readOnly={readOnly}
      variant={surface}
    />
  );
}
