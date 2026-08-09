"use client";

import { useMemo, type ReactNode } from "react";

import { EditorKernel } from "./editor-kernel";
import {
  createMockTableAdapter,
  mockFailureTrigger,
} from "./mock-table-adapter";

export function EditorLab({
  businessName,
}: Readonly<{ businessName: string }>): ReactNode {
  const adapter = useMemo(() => createMockTableAdapter(), []);

  return (
    <EditorKernel
      adapter={adapter}
      footer={
        <span>
          Tip: type <code>{mockFailureTrigger}</code> in a text cell to test
          retry recovery.
        </span>
      }
      marker={
        <p className="editor-lab-kicker">
          Editor lab · mock data · {businessName}
        </p>
      }
      title="Customers"
    />
  );
}
