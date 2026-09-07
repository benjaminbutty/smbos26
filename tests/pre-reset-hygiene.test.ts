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
    expect(startSource).toContain(
      "Build the system your business actually needs",
    );
    expect(normalizedStartSource).toContain(
      "Describe your business in ordinary language. Lenni will shape a workspace you can explore before you sign up.",
    );
    expect(startSource).toContain('submitLabel="Start with Lenni"');
    expect(startSource).toContain(
      "This cue helps Lenni choose a useful starting point",
    );
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

  it("keeps connection quick-create visible before a name is typed", () => {
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

    expect(markup).toContain("+ Create new Pet");
    expect(markup).toContain('class="editor-connection-create"');
    expect(cssSource).toContain("background: var(--coral-600);");
    expect(cssSource).toContain("editor-connection-create-divider");
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

  it("shows source and insertion feedback while retaining the reorder callback", () => {
    const columns = createEditorColumns({
      columnMenuKey: null,
      columns: [
        {
          key: "name",
          label: "Name",
          kind: "text",
          primary: true,
          width: 200,
        },
        {
          key: "status",
          label: "Status",
          kind: "status",
          options: ["Open", "Done"],
          width: 160,
        },
      ],
      columnDragState: { sourceKey: "name", targetKey: "status" },
      onActivateDraft: () => undefined,
      onColumnDragStateChange: () => undefined,
      onOpenColumnMenu: () => undefined,
      onOpenRecord: () => undefined,
      onReorderColumns: () => undefined,
      onRenameColumn: async () => true,
      onUpdateColumnOptions: async () => true,
      pendingEdit: null,
    });

    const headerMarkup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        ...columns.map(
          (column) => column.renderHeaderCell?.({} as never) ?? null,
        ),
      ),
    );

    expect(columns.every((column) => column.draggable === false)).toBe(true);
    expect(headerMarkup).toContain('data-reorderable="true"');
    expect(headerMarkup).toContain("editor-column-drag-affordance");
    expect(headerMarkup).toContain('aria-label="Drag Name to reorder"');
    expect(headerMarkup).toContain("is-dragging-source");
    expect(headerMarkup).toContain("is-drag-drop-target");
    expect(cssSource).toContain("cursor: grabbing;");
    expect(editorLabSource).toContain("onReorderColumns: handleReorderColumns");
    expect(
      readFileSync(
        new URL(
          "../src/runtime/editor-kernel/table-columns.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toContain("elementFromPoint");
    expect(cssSource).toContain("is-drag-drop-target::before");
    expect(editorLabSource).toContain("Drag column headings to reorder");
  });
});
