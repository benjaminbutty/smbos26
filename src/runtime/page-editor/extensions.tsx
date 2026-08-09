"use client";

import { Extension, mergeAttributes, Node as TiptapNode } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ExperienceViewBundle } from "../../core/experience/service";
import type {
  EditorCapabilities,
  EditorTable,
} from "../editor-kernel/contracts";
import {
  ProductionTableWorkspace,
  type ProductionTableWorkspaceProps,
} from "../editor-kernel/production/production-table-workspace";
import type { ProductionTableAdapterActions } from "../editor-kernel/production/production-table-adapter";
import type { ProductionConfigurationCurrentness } from "../editor-kernel/production/action-types";
import { experienceKeyToPath } from "../routing";
import { ViewRenderer } from "../views/view-renderer";
import { pageEditorNodeNames } from "./page-translator";

export interface PageEditorTableEmbed {
  table: EditorTable;
  actions: ProductionTableAdapterActions;
  capabilities: EditorCapabilities;
  currentness?: ProductionConfigurationCurrentness;
}

export interface PageEditorViewEmbed {
  bundle: ExperienceViewBundle;
  table?: PageEditorTableEmbed;
}

export interface PageEditorExtensionOptions {
  businessSlug: string;
  views: Readonly<Record<string, PageEditorViewEmbed>>;
}

function extensionOptions(
  extension: ReactNodeViewProps["extension"],
): PageEditorExtensionOptions {
  const options = (
    extension as unknown as { options?: PageEditorExtensionOptions }
  ).options;
  return options ?? { businessSlug: "", views: {} };
}

function CalloutNodeView({
  node,
  updateAttributes,
}: ReactNodeViewProps): React.ReactNode {
  return (
    <NodeViewWrapper className="page-editor-callout-node">
      <textarea
        aria-label="Callout text"
        className={`page-editor-callout-input page-editor-callout-${String(
          node.attrs.tone ?? "info",
        )}`}
        contentEditable={false}
        maxLength={1_000}
        onChange={(event) =>
          updateAttributes({ text: event.currentTarget.value })
        }
        rows={2}
        value={String(node.attrs.text ?? "")}
      />
    </NodeViewWrapper>
  );
}

function LegacyNodeView({ node }: ReactNodeViewProps): React.ReactNode {
  return (
    <NodeViewWrapper className="page-editor-legacy-node">
      <div aria-label="Legacy Page block" contentEditable={false}>
        <strong>{String(node.attrs.blockType ?? "Legacy block")}</strong>
        <span>Read-only block retained from an earlier Page version.</span>
      </div>
    </NodeViewWrapper>
  );
}

function PageViewNodeView({
  node,
  extension,
}: ReactNodeViewProps): React.ReactNode {
  const options = extensionOptions(extension);
  const viewKey = String(node.attrs.viewKey ?? "");
  const embed = options.views[viewKey];
  const readOnly = node.attrs.readOnly === true;

  if (!embed) {
    return (
      <NodeViewWrapper className="page-editor-missing-view">
        <div contentEditable={false}>
          This View is not available in the current workspace.
        </div>
      </NodeViewWrapper>
    );
  }

  if (embed.table) {
    const capabilities: EditorCapabilities = {
      ...embed.table.capabilities,
      canAddColumns: false,
      canRenameColumns: false,
      canUpdateColumnOptions: false,
      canReorderColumns: false,
      canResizeColumns: false,
      canRenameTable: false,
      ...(readOnly
        ? {
            rowCreation: "unavailable" as const,
            rowCreationMessage: "This Table is read-only on this Page.",
          }
        : {}),
    };
    const props: ProductionTableWorkspaceProps = {
      actions: embed.table.actions,
      capabilities,
      currentness: embed.table.currentness,
      readOnly,
      surface: "embedded",
      table: embed.table.table,
    };
    const tableHref = `/app/${encodeURIComponent(
      options.businessSlug,
    )}/workspace/${experienceKeyToPath(viewKey)}`;
    return (
      <NodeViewWrapper className="page-editor-view-node">
        <div contentEditable={false}>
          <div className="page-editor-view-header">
            <div>
              <p className="eyebrow">Table</p>
              <strong>{embed.bundle.definition.name}</strong>
              {readOnly ? (
                <span className="page-editor-view-readonly">Read-only</span>
              ) : null}
            </div>
            <a
              className="button button-secondary button-small"
              href={tableHref}
            >
              Open table
            </a>
          </div>
          <ProductionTableWorkspace {...props} />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="page-editor-view-node">
      <div contentEditable={false}>
        <ViewRenderer
          bundle={embed.bundle}
          businessSlug={options.businessSlug}
          preview
          readOnly={readOnly}
          showHeading={false}
        />
      </div>
    </NodeViewWrapper>
  );
}

const PageDocument = TiptapNode.create({
  name: "doc",
  topNode: true,
  content: "block*",
});

const PageBlockAttributes = Extension.create({
  name: "pageBlockAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["heading", "paragraph"],
        attributes: {
          blockId: {
            default: null,
          },
        },
      },
    ];
  },
});

const PageDivider = TiptapNode.create({
  name: pageEditorNodeNames.divider,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { blockId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "hr[data-page-divider]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "hr",
      mergeAttributes(HTMLAttributes, { "data-page-divider": "true" }),
    ];
  },
});

const PageCallout = TiptapNode.create({
  name: pageEditorNodeNames.callout,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      blockId: { default: null },
      text: { default: "" },
      tone: { default: "info" },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-page-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { "data-page-callout": "true" }),
      HTMLAttributes.text ?? "",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },
});

const PageView = TiptapNode.create<PageEditorExtensionOptions>({
  name: pageEditorNodeNames.view,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { businessSlug: "", views: {} };
  },
  addAttributes() {
    return {
      blockId: { default: null },
      viewKey: { default: "" },
      readOnly: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-page-view]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-page-view": "true" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageViewNodeView);
  },
});

const PageLegacy = TiptapNode.create({
  name: pageEditorNodeNames.legacy,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      blockId: { default: null },
      blockType: { default: "legacy" },
      blockJson: { default: "{}" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-page-legacy]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-page-legacy": "true" }),
      `Read-only ${HTMLAttributes.blockType ?? "legacy"} block`,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LegacyNodeView);
  },
});

export function createPageEditorExtensions(
  options: PageEditorExtensionOptions,
) {
  return [
    PageDocument,
    StarterKit.configure({
      blockquote: false,
      bold: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      document: false,
      hardBreak: false,
      italic: false,
      link: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
      strike: false,
      underline: false,
      horizontalRule: false,
      heading: { levels: [1, 2, 3] },
    }),
    PageBlockAttributes,
    PageDivider,
    PageCallout,
    PageView.configure(options),
    PageLegacy,
  ];
}
