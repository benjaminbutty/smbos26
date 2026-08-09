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
  currentness?: ProductionConfigurationCurrentness | undefined;
  creationFallbackHref?: string | undefined;
  readOnly?: boolean;
  surface?: "workspace" | "embedded";
}

export function ProductionTableWorkspace({
  actions,
  capabilities,
  creationFallbackHref,
  currentness,
  readOnly = false,
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
        : "Live Table · cell, panel, and direct row edits write real Records."}
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
      onStructureChanged={() => router.refresh()}
      readOnly={readOnly}
      variant={surface}
    />
  );
}
