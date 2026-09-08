"use client";

import { Extension, mergeAttributes, Node as TiptapNode } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createContext, useContext, useEffect, useRef, useState } from "react";
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
import type {
  ProductionConfigurationCurrentness,
  ProductionBulkUpdateAction,
  ProductionScopedContextualRecordCreateAction,
  ProductionScopedContextualRecordCreateStateAction,
  ProductionRecordPanelContextAction,
  ProductionScopedCellEditAction,
  ProductionScopedConnectionCreateAction,
  ProductionScopedConnectionEditAction,
  ProductionScopedConnectionSearchAction,
  ProductionTablePageAction,
} from "../editor-kernel/production/action-types";
import { experienceKeyToPath } from "../routing";
import { ViewRenderer } from "../views/view-renderer";
import { pageEditorNodeNames } from "./page-translator";
import { ChecklistWorkspace } from "./checklist-workspace";
import type {
  PageChecklistCellAction,
  PageChecklistRowAction,
} from "./checklist-workspace";
import type { PageViewOption } from "./view-chooser";

export interface PageEditorTableEmbed {
  table: EditorTable;
  instanceId?: string;
  actions: ProductionTableAdapterActions;
  capabilities: EditorCapabilities;
  currentness?: ProductionConfigurationCurrentness;
  creationFallbackHref?: string | undefined;
  recordTypeLabel?: string;
  recordCountLabel?: string;
  fullRecordPath?: string;
  readConnectedRecord?: ProductionRecordPanelContextAction;
  updateConnectedRecordCell?: ProductionScopedCellEditAction;
  updateConnectedRecordConnection?: ProductionScopedConnectionEditAction;
  searchConnectedRecordTargets?: ProductionScopedConnectionSearchAction;
  createConnectedRecordTarget?: ProductionScopedConnectionCreateAction;
  loadTablePage?: ProductionTablePageAction;
  bulkUpdate?: ProductionBulkUpdateAction;
  initialSearch?: string;
  initialTotalCount?: number;
  initialHasMore?: boolean;
  connectionSource?: ProductionTableWorkspaceProps["connectionSource"];
  connectionTargets?: ProductionTableWorkspaceProps["connectionTargets"];
  existingConnections?: ProductionTableWorkspaceProps["existingConnections"];
  loadContextualRecordCreateState?: ProductionScopedContextualRecordCreateStateAction;
  createContextualRecord?: ProductionScopedContextualRecordCreateAction;
  checklistUpdateCell?: PageChecklistCellAction;
  checklistCreateRow?: PageChecklistRowAction;
}

export interface PageEditorViewEmbed {
  bundle: ExperienceViewBundle;
  table?: PageEditorTableEmbed;
}

export interface PageEditorExtensionOptions {
  businessSlug: string;
  pageKey?: string;
  availableViews?: readonly PageViewOption[];
  views: Readonly<Record<string, PageEditorViewEmbed>>;
  uploadImage?: (
    file: File,
    signal: AbortSignal,
  ) => Promise<{
    assetId: string;
    src: string;
    width: number;
    height: number;
  }>;
  cancelUpload?: (token: string) => void;
  retryUpload?: (token: string) => void;
  onPendingUploadsChange?: (count: number) => void;
}

/**
 * Tiptap keeps its extension instances stable while a route refresh resolves
 * a newly referenced View. The live server supplied embeds also flow through
 * React context so an existing NodeView can update without replacing the
 * document, caret or pending edits.
 */
export interface PageEditorRuntimeContextValue {
  availableViews: readonly PageViewOption[];
  views: Readonly<Record<string, PageEditorViewEmbed>>;
}

export const PageEditorRuntimeContext = createContext<
  PageEditorRuntimeContextValue | undefined
>(undefined);

export const PAGE_EDITOR_RETRY_UPLOAD_EVENT = "smbos-page-editor-retry-upload";

function extensionOptions(
  extension: ReactNodeViewProps["extension"],
): PageEditorExtensionOptions {
  const options = (
    extension as unknown as { options?: PageEditorExtensionOptions }
  ).options;
  return options ?? { businessSlug: "", views: {} };
}

function CalloutNodeView({
  editor,
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
        readOnly={!editor.isEditable}
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
  editor,
  getPos,
  node,
  extension,
  updateAttributes,
}: ReactNodeViewProps): React.ReactNode {
  const options = extensionOptions(extension);
  const runtime = useContext(PageEditorRuntimeContext);
  const viewKey = String(node.attrs.viewKey ?? "");
  const embed = runtime?.views[viewKey] ?? options.views[viewKey];
  const readOnly = node.attrs.readOnly === true;
  const checklist =
    node.attrs.checklist && typeof node.attrs.checklist === "object"
      ? (node.attrs.checklist as {
          label_field?: unknown;
          completed_field?: unknown;
        })
      : null;
  const blockId =
    typeof node.attrs.blockId === "string" ? node.attrs.blockId : undefined;
  const instanceId =
    blockId ??
    `page-view-${viewKey}-${typeof getPos === "function" ? getPos() : "unknown"}`;
  const viewOptions = runtime?.availableViews ?? options.availableViews ?? [];

  if (!embed) {
    const availableView = viewOptions.find(
      (candidate) => candidate.key === viewKey,
    );
    return (
      <NodeViewWrapper className="page-editor-missing-view">
        <div
          aria-live="polite"
          contentEditable={false}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {availableView
            ? `Loading ${availableView.name}…`
            : "This View is not available in the current workspace."}
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
      instanceId,
      businessSlug: options.businessSlug,
      capabilities,
      currentness: embed.table.currentness,
      creationFallbackHref: embed.table.creationFallbackHref,
      ...(embed.table.fullRecordPath
        ? { fullRecordPath: embed.table.fullRecordPath }
        : {}),
      ...(embed.table.recordCountLabel
        ? { recordCountLabel: embed.table.recordCountLabel }
        : {}),
      ...(embed.table.recordTypeLabel
        ? { recordTypeLabel: embed.table.recordTypeLabel }
        : {}),
      ...(embed.table.readConnectedRecord
        ? { readConnectedRecord: embed.table.readConnectedRecord }
        : {}),
      ...(embed.table.updateConnectedRecordCell
        ? { updateConnectedRecordCell: embed.table.updateConnectedRecordCell }
        : {}),
      ...(embed.table.updateConnectedRecordConnection
        ? {
            updateConnectedRecordConnection:
              embed.table.updateConnectedRecordConnection,
          }
        : {}),
      ...(embed.table.searchConnectedRecordTargets
        ? {
            searchConnectedRecordTargets:
              embed.table.searchConnectedRecordTargets,
          }
        : {}),
      ...(embed.table.createConnectedRecordTarget
        ? {
            createConnectedRecordTarget:
              embed.table.createConnectedRecordTarget,
          }
        : {}),
      ...(embed.table.bulkUpdate ? { bulkUpdate: embed.table.bulkUpdate } : {}),
      ...(embed.table.connectionSource
        ? { connectionSource: embed.table.connectionSource }
        : {}),
      ...(embed.table.connectionTargets
        ? { connectionTargets: embed.table.connectionTargets }
        : {}),
      ...(embed.table.existingConnections
        ? { existingConnections: embed.table.existingConnections }
        : {}),
      ...(embed.table.initialHasMore !== undefined
        ? { initialHasMore: embed.table.initialHasMore }
        : {}),
      ...(embed.table.initialSearch !== undefined
        ? { initialSearch: embed.table.initialSearch }
        : {}),
      ...(embed.table.initialTotalCount !== undefined
        ? { initialTotalCount: embed.table.initialTotalCount }
        : {}),
      ...(embed.table.loadTablePage
        ? { loadTablePage: embed.table.loadTablePage }
        : {}),
      ...(embed.table.loadContextualRecordCreateState
        ? {
            loadContextualRecordCreateState:
              embed.table.loadContextualRecordCreateState,
          }
        : {}),
      ...(embed.table.createContextualRecord
        ? { createContextualRecord: embed.table.createContextualRecord }
        : {}),
      readOnly,
      surface: "embedded",
      table: embed.table.table,
    };
    const tableHref =
      embed.table.fullRecordPath ??
      `/app/${encodeURIComponent(
        options.businessSlug,
      )}/workspace/${experienceKeyToPath(viewKey)}`;
    return (
      <NodeViewWrapper
        className={`page-editor-view-node${checklist ? " page-editor-checklist-node" : ""}`}
      >
        <div contentEditable={false}>
          <div className="page-editor-view-header">
            <div>
              <p className="eyebrow">Table</p>
              <strong>{embed.bundle.definition.name}</strong>
              {readOnly ? (
                <span className="page-editor-view-readonly">Read-only</span>
              ) : null}
            </div>
            {editor.isEditable ? (
              <div className="page-editor-view-controls">
                <label>
                  <span className="editor-sr-only">Replace saved View</span>
                  <select
                    aria-label="Replace saved View"
                    onChange={(event) =>
                      updateAttributes({
                        checklist: null,
                        viewKey: event.currentTarget.value,
                      })
                    }
                    value={viewKey}
                  >
                    {viewOptions.map((candidate) => (
                      <option key={candidate.key} value={candidate.key}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary button-small"
                  onClick={() => updateAttributes({ readOnly: !readOnly })}
                  type="button"
                >
                  {readOnly ? "Allow edits" : "Make read-only"}
                </button>
              </div>
            ) : null}
            <a
              className="button button-secondary button-small"
              href={tableHref}
            >
              Open table
            </a>
          </div>
          {checklist &&
          typeof checklist.label_field === "string" &&
          typeof checklist.completed_field === "string" ? (
            <ChecklistWorkspace
              actions={embed.table.actions}
              {...(blockId ? { blockId } : {})}
              businessSlug={options.businessSlug}
              canCreate={embed.table.capabilities.rowCreation === "direct"}
              completedField={checklist.completed_field}
              {...(embed.table.creationFallbackHref
                ? { creationFallbackHref: embed.table.creationFallbackHref }
                : {})}
              {...(embed.table.initialHasMore !== undefined
                ? { initialHasMore: embed.table.initialHasMore }
                : {})}
              {...(embed.table.initialSearch !== undefined
                ? { initialSearch: embed.table.initialSearch }
                : {})}
              {...(embed.table.initialTotalCount !== undefined
                ? { initialTotalCount: embed.table.initialTotalCount }
                : {})}
              labelField={checklist.label_field}
              {...(embed.table.loadTablePage
                ? { loadTablePage: embed.table.loadTablePage }
                : {})}
              {...(embed.table.checklistUpdateCell
                ? { pageAwareUpdateCell: embed.table.checklistUpdateCell }
                : {})}
              {...(embed.table.checklistCreateRow
                ? { pageAwareCreateRow: embed.table.checklistCreateRow }
                : {})}
              readOnly={readOnly}
              table={embed.table.table}
              viewKey={viewKey}
            />
          ) : (
            <ProductionTableWorkspace {...props} />
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="page-editor-view-node">
      <div
        contentEditable={false}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ViewRenderer
          bundle={embed.bundle}
          businessSlug={options.businessSlug}
          preview
          readOnly={readOnly}
          showHeading={false}
        />
        {editor.isEditable ? (
          <div className="page-editor-view-controls">
            <label>
              <span className="editor-sr-only">Replace saved View</span>
              <select
                aria-label="Replace saved View"
                onChange={(event) =>
                  updateAttributes({
                    checklist: null,
                    viewKey: event.currentTarget.value,
                  })
                }
                value={viewKey}
              >
                {viewOptions.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary button-small"
              onClick={() => updateAttributes({ readOnly: !readOnly })}
              type="button"
            >
              {readOnly ? "Allow edits" : "Make read-only"}
            </button>
          </div>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

function PageImageNodeView({
  deleteNode,
  editor,
  extension,
  node,
  updateAttributes,
}: ReactNodeViewProps): React.ReactNode {
  const options = extensionOptions(extension);
  const [uploadError, setUploadError] = useState<string | null>(
    typeof node.attrs.error === "string" ? node.attrs.error : null,
  );
  const [localUploading, setLocalUploading] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [showImageOptions, setShowImageOptions] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const uploadGenerationRef = useRef(0);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const uploading = localUploading || node.attrs.status === "uploading";

  useEffect(() => {
    return () => {
      uploadGenerationRef.current += 1;
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = null;
    };
  }, []);

  const selectFile = async (file: File): Promise<void> => {
    if (!options.uploadImage || !editor.isEditable) return;
    uploadControllerRef.current?.abort();
    const generation = uploadGenerationRef.current + 1;
    uploadGenerationRef.current = generation;
    lastFileRef.current = file;
    const nextController = new AbortController();
    uploadControllerRef.current = nextController;
    setController(nextController);
    setLocalUploading(true);
    setUploadError(null);
    updateAttributes({
      assetId: null,
      src: null,
      status: "uploading",
      error: null,
    });
    options.onPendingUploadsChange?.(1);
    try {
      const result = await options.uploadImage(file, nextController.signal);
      if (generation !== uploadGenerationRef.current) return;
      updateAttributes({
        assetId: result.assetId,
        src: result.src,
        status: "ready",
        error: null,
      });
      setImageLoadFailed(false);
    } catch (caught) {
      if (generation !== uploadGenerationRef.current) return;
      const message = nextController.signal.aborted
        ? "Upload cancelled. Choose the image again to retry."
        : caught instanceof Error
          ? caught.message
          : "The image could not be uploaded.";
      setUploadError(message);
      updateAttributes({ status: "error", error: message });
    } finally {
      if (generation === uploadGenerationRef.current) {
        setLocalUploading(false);
        setController(null);
        uploadControllerRef.current = null;
      }
      options.onPendingUploadsChange?.(-1);
    }
  };

  const assetId =
    typeof node.attrs.assetId === "string" ? node.attrs.assetId : "";
  const src =
    typeof node.attrs.src === "string" && node.attrs.src
      ? node.attrs.src
      : assetId && options.businessSlug
        ? `/api/app/${encodeURIComponent(options.businessSlug)}/pages/assets/${assetId}`
        : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const caption =
    typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  const uploadToken =
    typeof node.attrs.uploadToken === "string" ? node.attrs.uploadToken : "";
  const presentation = node.attrs.presentation === "wide" ? "wide" : "content";
  return (
    <NodeViewWrapper
      className={`page-editor-image-node page-editor-image-${presentation}`}
      data-upload-status={
        uploading ? "uploading" : (node.attrs.status ?? "ready")
      }
    >
      <div
        className="page-editor-image-preview"
        contentEditable={false}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const file = event.dataTransfer.files[0];
          if (file) void selectFile(file);
        }}
      >
        {src && !imageLoadFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={alt}
            onError={() => setImageLoadFailed(true)}
            onLoad={() => setImageLoadFailed(false)}
            src={src}
          />
        ) : (
          <div className="page-editor-image-placeholder">
            {uploading
              ? "Uploading image…"
              : src || imageLoadFailed
                ? "Image preview unavailable. Replace it or try again."
                : "Choose an image to add to this Page"}
          </div>
        )}
      </div>
      {editor.isEditable ? (
        <div className="page-editor-image-controls" contentEditable={false}>
          <div className="page-editor-image-actions">
            <label className="button button-secondary button-small">
              {src ? "Replace" : "Choose image"}
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label={src ? "Replace image" : "Choose image"}
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void selectFile(file);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
            {uploading ? (
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  if (controller) controller.abort();
                  else if (uploadToken) options.cancelUpload?.(uploadToken);
                }}
                type="button"
              >
                Cancel
              </button>
            ) : null}
            {node.attrs.status === "error" ? (
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  setUploadError(null);
                  if (lastFileRef.current) void selectFile(lastFileRef.current);
                  else if (uploadToken) options.retryUpload?.(uploadToken);
                }}
                type="button"
              >
                Retry
              </button>
            ) : null}
            <button
              className="button button-secondary button-small"
              onClick={deleteNode}
              type="button"
            >
              Remove
            </button>
          </div>
          <button
            aria-expanded={showImageOptions}
            className="button button-quiet button-small page-editor-image-options-toggle"
            onClick={() => setShowImageOptions((value) => !value)}
            type="button"
          >
            {showImageOptions ? "Hide image details" : "Edit image details"}
          </button>
          {showImageOptions ? (
            <div className="page-editor-image-options" role="group">
              <div>
                <label>
                  <span>Image description</span>
                  <input
                    aria-label="Image description"
                    maxLength={300}
                    onChange={(event) =>
                      updateAttributes({ alt: event.currentTarget.value })
                    }
                    placeholder="Describe this image"
                    value={alt}
                  />
                </label>
                <label>
                  <span>Caption</span>
                  <input
                    aria-label="Image caption"
                    maxLength={500}
                    onChange={(event) =>
                      updateAttributes({ caption: event.currentTarget.value })
                    }
                    placeholder="Optional caption"
                    value={caption}
                  />
                </label>
                <label>
                  <span>Presentation</span>
                  <select
                    aria-label="Image presentation"
                    onChange={(event) =>
                      updateAttributes({
                        presentation: event.currentTarget.value,
                      })
                    }
                    value={presentation}
                  >
                    <option value="content">Document width</option>
                    <option value="wide">Wide</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}
          {uploadError || typeof node.attrs.error === "string" ? (
            <p className="page-editor-image-error" role="alert">
              {uploadError ?? String(node.attrs.error)}
            </p>
          ) : null}
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

function PageCollapsibleNodeView({
  editor,
  node,
  updateAttributes,
}: ReactNodeViewProps): React.ReactNode {
  const [open, setOpen] = useState(node.attrs.open !== false);
  return (
    <NodeViewWrapper
      className={`page-editor-collapsible-node${open ? " is-open" : ""}`}
    >
      <div className="page-editor-collapsible-summary" contentEditable={false}>
        <button
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} section`}
          className="page-editor-collapsible-toggle"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? "⌄" : "›"}
        </button>
        <input
          aria-label="Section summary"
          disabled={!editor.isEditable}
          maxLength={200}
          onChange={(event) =>
            updateAttributes({ summary: event.currentTarget.value })
          }
          value={String(node.attrs.summary ?? "")}
        />
      </div>
      <NodeViewContent
        className={`page-editor-collapsible-content${open ? "" : " is-collapsed"}`}
      />
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
        types: ["heading", "paragraph", "bulletList", "orderedList"],
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
      checklist: { default: null },
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

const PageImage = TiptapNode.create<PageEditorExtensionOptions>({
  name: pageEditorNodeNames.image,
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
      assetId: { default: null },
      src: { default: null },
      uploadToken: { default: null },
      alt: { default: "" },
      caption: { default: "" },
      presentation: { default: "content" },
      status: { default: "ready" },
      error: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-page-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-page-image": "true" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageImageNodeView);
  },
});

const PageCollapsible = TiptapNode.create<PageEditorExtensionOptions>({
  name: pageEditorNodeNames.collapsible,
  group: "block",
  content: "block*",
  defining: true,
  draggable: true,
  addOptions() {
    return { businessSlug: "", views: {} };
  },
  addAttributes() {
    return {
      blockId: { default: null },
      summary: { default: "Section" },
      open: { default: true },
    };
  },
  parseHTML() {
    return [{ tag: "section[data-page-collapsible]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "section",
      mergeAttributes(HTMLAttributes, { "data-page-collapsible": "true" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageCollapsibleNodeView);
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
      bold: {},
      bulletList: {},
      code: false,
      codeBlock: false,
      document: false,
      hardBreak: false,
      italic: {},
      link: {
        autolink: true,
        defaultProtocol: "https",
        openOnClick: false,
      },
      listItem: {},
      listKeymap: false,
      orderedList: {},
      strike: false,
      underline: false,
      horizontalRule: false,
      heading: { levels: [1, 2, 3] },
    }),
    PageBlockAttributes,
    PageDivider,
    PageCallout,
    PageView.configure(options),
    PageImage.configure(options),
    PageCollapsible.configure(options),
    PageLegacy,
  ];
}
