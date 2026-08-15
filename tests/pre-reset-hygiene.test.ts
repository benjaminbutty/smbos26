import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ChoiceStatusPicker,
  ConnectionPicker,
} from "../src/runtime/editor-kernel/cell-editors";
import { createEditorColumns } from "../src/runtime/editor-kernel/table-columns";

const startSource = readFileSync(
  new URL("../src/app/start/page.tsx", import.meta.url),
  "utf8",
);
const acquisitionSource = readFileSync(
  new URL("../src/core/acquisition/schemas.ts", import.meta.url),
  "utf8",
);
const tableColumnsSource = readFileSync(
  new URL("../src/runtime/editor-kernel/table-columns.tsx", import.meta.url),
  "utf8",
);
const lenniUiSource = readFileSync(
  new URL("../src/runtime/editor-kernel/lenni-ui.tsx", import.meta.url),
  "utf8",
);
const editorLabSource = readFileSync(
  new URL("../src/runtime/editor-kernel/editor-lab.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

describe("pre-reset Lenni UX hygiene contracts", () => {
  it("uses the approved public acquisition copy and token-backed option layout", () => {
    const normalizedStartSource = startSource.replace(/\s+/g, " ");
    expect(startSource).toContain("Tell Lenni about your business");
    expect(normalizedStartSource).toContain(
      "Describe the work you run and Lenni will suggest a setup to get you started",
    );
    expect(startSource).toContain('submitLabel="Start building"');
    expect(startSource).toContain("Prefer to shape things yourself?");
    expect(acquisitionSource).toContain(
      "Track products and manually maintain stock information.",
    );
    expect(cssSource).toContain(".acquisition-form fieldset");
    expect(cssSource).toContain("gap: var(--space-4);");
    expect(cssSource).toContain("border-radius: var(--radius-lg);");
    expect(cssSource).toContain(".acquisition-manual-route");
    expect(cssSource).toContain("text-align: left;");
  });

  it("keeps table menus in the shared popover with viewport-safe placement", () => {
    expect(tableColumnsSource).toContain("anchorRef={anchorRef}");
    expect(tableColumnsSource).toContain("viewportSafe");
    expect(lenniUiSource).toContain("createPortal(content, document.body)");
    expect(lenniUiSource).toContain('window.addEventListener("resize"');
    expect(cssSource).toContain(
      '.editor-column-menu[data-viewport-safe="true"]',
    );
    expect(cssSource).toContain("position: fixed;");
  });

  it("makes empty Choice/Status values explicit instead of presenting a dead picker", () => {
    const markup = renderToStaticMarkup(
      createElement(ChoiceStatusPicker, {
        column: {
          key: "status",
          label: "Status",
          kind: "status",
          options: [],
          width: 155,
        },
        onCommit: () => undefined,
        value: null,
      }),
    );

    expect(markup).toContain("No options yet");
    expect(markup).not.toContain("Choose…");
    expect(tableColumnsSource).toContain("column.options !== undefined");
    expect(tableColumnsSource).toContain("editor-options-empty-state");
    expect(tableColumnsSource).toContain("!validOptions(options)");
  });

  it("keeps connection quick-create explicit, coral, and disabled until named", () => {
    const markup = renderToStaticMarkup(
      createElement(ConnectionPicker, {
        column: {
          key: "pet",
          label: "Pet",
          kind: "connection",
          connection: {
            relationshipKey: "pet_for_booking",
            direction: "target",
            multiple: false,
            targetObjectKey: "pet",
          },
          width: 220,
        },
        initiallyOpen: true,
        onCommit: () => undefined,
        onCreate: async (primaryValue: string) => ({
          id: primaryValue,
          label: primaryValue,
        }),
        onSearch: async () => [],
        value: [],
      }),
    );

    expect(markup).toContain("Type a name to enable quick-create.");
    expect(markup).toContain('class="editor-connection-create"');
    expect(markup).toContain("disabled");
    expect(cssSource).toContain("background: var(--coral-600);");
    expect(cssSource).toContain("background: var(--surface-subtle);");
    expect(cssSource).toContain("cursor: not-allowed;");
    expect(editorLabSource).toContain("...(adapter.createConnectionTarget");

    const unavailableMarkup = renderToStaticMarkup(
      createElement(ConnectionPicker, {
        column: {
          key: "pet",
          label: "Pet",
          kind: "connection",
          connection: {
            relationshipKey: "pet_for_booking",
            direction: "target",
            multiple: false,
            targetObjectKey: "pet",
          },
          width: 220,
        },
        initiallyOpen: true,
        onCommit: () => undefined,
        onSearch: async () => [],
        value: [],
      }),
    );
    expect(unavailableMarkup).not.toContain("editor-connection-create");
  });

  it("exposes direct drag affordance while retaining the existing reorder callback", () => {
    const [column] = createEditorColumns({
      columnMenuKey: null,
      columns: [
        {
          key: "name",
          label: "Name",
          kind: "text",
          primary: true,
          width: 200,
        },
      ],
      onActivateDraft: () => undefined,
      onOpenColumnMenu: () => undefined,
      onOpenRecord: () => undefined,
      onRenameColumn: async () => true,
      onUpdateColumnOptions: async () => true,
      pendingEdit: null,
    });

    const headerMarkup = renderToStaticMarkup(
      column?.renderHeaderCell?.({} as never) ?? null,
    );

    expect(column?.draggable).toBe(true);
    expect(headerMarkup).toContain('data-reorderable="true"');
    expect(headerMarkup).toContain("editor-column-drag-affordance");
    expect(cssSource).toContain("cursor: grabbing;");
    expect(editorLabSource).toContain("Drag column headings to reorder");
  });
});
