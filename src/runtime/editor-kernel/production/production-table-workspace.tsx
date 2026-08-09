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
}

export function ProductionTableWorkspace({
  actions,
  capabilities,
  creationFallbackHref,
  currentness,
  table,
}: Readonly<ProductionTableWorkspaceProps>): ReactNode {
  const router = useRouter();
  const adapter = useMemo(
    () => createProductionTableAdapter(table, actions, currentness),
    [actions, currentness, table],
  );

  const footer = (
    <span>
      Live operational preview · cell, panel, and direct row edits write real
      Records.
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
      marker={
        <p className="editor-lab-kicker">
          Kernel preview · live Table data · Record edits are operational
        </p>
      }
      onStructureChanged={() => router.refresh()}
    />
  );
}
