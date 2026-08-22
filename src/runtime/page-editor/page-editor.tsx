"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type { DirectPageActionResult } from "../pages/direct-actions";
import type {
  DirectPageBlockInput,
  DirectPageCurrentness,
  DirectPageIntent,
} from "../../core/configuration/direct-pages/schemas";
import type { PublicBookingCatalogue } from "../../core/booking/schemas";
import type { ExperienceFormBundle } from "../../core/experience/service";
import type { PageBlock, PageLayout } from "../../core/experience/schemas";
import { experienceKeyToPath } from "../routing";
import { ProductionTableWorkspace } from "../editor-kernel/production/production-table-workspace";
import type { EditorCapabilities } from "../editor-kernel/contracts";
import type { PageEditorViewEmbed } from "./extensions";
import { PageRenderer } from "../pages/page-renderer";
import { useUnsavedNavigationWarning } from "../unsaved-navigation-warning";
import {
  groupPageViewsByTable,
  selectPageView,
  selectPageViewTable,
  type PageViewOption,
} from "./view-chooser";

type PageStructureIntent = Extract<
  DirectPageIntent,
  {
    action:
      | "save_page_layout"
      | "add_page_block"
      | "update_page_block"
      | "remove_page_block"
      | "move_page_block";
  }
>;

type ApplyPageBlockAction = (input: {
  currentness: DirectPageCurrentness;
  intent: PageStructureIntent;
}) => Promise<DirectPageActionResult>;

type RenamePageAction = (input: {
  currentness: DirectPageCurrentness;
  title: string;
}) => Promise<DirectPageActionResult>;

export interface PageEditorProps {
  businessSlug: string;
  pageKey: string;
  title: string;
  layout: PageLayout;
  currentness: DirectPageCurrentness;
  views: Readonly<Record<string, PageEditorViewEmbed>>;
  availableViews: readonly PageViewOption[];
  applyPageBlockAction: ApplyPageBlockAction;
  renamePageAction: RenamePageAction;
  previewBookings?: Readonly<
    Record<string, { catalogue: PublicBookingCatalogue }>
  >;
  previewForms?: Readonly<Record<string, { bundle: ExperienceFormBundle }>>;
  siteMode?: boolean;
  publishedSite?: boolean;
}

type EditorSaveStatus = "saved" | "saving" | "stale" | "error";
type AddMenu = "closed" | "blocks" | "views";
type EditableBlock = Extract<PageBlock, { type: "heading" | "text" }>;

interface BlockDraft {
  id: string;
  type: EditableBlock["type"];
  text: string;
  level?: 1 | 2 | 3;
}

interface ReorderIntent {
  sourceId: string;
  targetIndex: number;
}

function statusText(status: EditorSaveStatus): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "stale":
      return "Needs reload";
    case "error":
      return "Could not save";
    case "saved":
      return "Saved";
  }
}

function blockId(block: PageBlock, fallbackIndex?: number): string | null {
  if ("id" in block && block.id) return block.id;
  return fallbackIndex === undefined ? null : `legacy:${fallbackIndex}`;
}

function blockLabel(block: PageBlock): string {
  switch (block.type) {
    case "heading":
      return "Heading";
    case "text":
      return "Text";
    case "view":
      return "Saved View";
    case "divider":
      return "Divider";
    case "callout":
      return "Note";
    case "image":
      return "Image";
    case "button":
      return "Button";
    case "form":
      return "Form";
    case "public_form":
      return "Public Form";
    case "booking":
      return "Booking";
    case "preorder":
      return "Preorder";
  }
}

function editableBlock(block: PageBlock): EditableBlock | null {
  return block.type === "heading" || block.type === "text" ? block : null;
}

function reorderPageLayout(
  layout: PageLayout,
  intent: ReorderIntent,
): PageLayout | null {
  const sourceIndex = layout.blocks.findIndex(
    (block, index) => blockId(block, index) === intent.sourceId,
  );
  if (
    sourceIndex < 0 ||
    intent.targetIndex < 0 ||
    intent.targetIndex >= layout.blocks.length ||
    sourceIndex === intent.targetIndex
  ) {
    return null;
  }
  const blocks = [...layout.blocks];
  const [moved] = blocks.splice(sourceIndex, 1);
  if (!moved) return null;
  blocks.splice(intent.targetIndex, 0, moved);
  return { blocks };
}

function embeddedCapabilities(
  capabilities: EditorCapabilities,
  readOnly: boolean,
): EditorCapabilities {
  return {
    ...capabilities,
    canAddColumns: false,
    canAddConnections: false,
    canInsertColumns: false,
    canRenameColumns: false,
    canChangeColumnTypes: false,
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
}

function SavedViewBlock({
  block,
  businessSlug,
  embed,
}: Readonly<{
  block: Extract<PageBlock, { type: "view" }>;
  businessSlug: string;
  embed: PageEditorViewEmbed | undefined;
}>): ReactNode {
  if (!embed) {
    return (
      <div className="page-editor-unavailable-view" role="status">
        This saved View is unavailable. Remove it from the Page or add another
        saved View.
      </div>
    );
  }

  if (!embed.table) {
    return (
      <div className="page-editor-view-fallback">
        <p className="page-editor-view-source">
          Saved View · {embed.bundle.definition.name}
        </p>
        <div contentEditable={false}>
          <span>This saved View is available from its source workspace.</span>
        </div>
      </div>
    );
  }

  const tableEmbed = embed.table;
  const tablePath =
    tableEmbed.fullRecordPath ??
    `/app/${encodeURIComponent(businessSlug)}/workspace/${experienceKeyToPath(
      tableEmbed.table.key,
    )}`;

  return (
    <div className="page-editor-view-block">
      <div className="page-editor-view-header">
        <div>
          <p className="eyebrow">Saved View</p>
          <strong>{embed.bundle.definition.name}</strong>
          <span className="page-editor-view-source">
            From {embed.bundle.object.plural_label}
          </span>
          {block.read_only ? (
            <span className="page-editor-view-readonly">Read-only</span>
          ) : null}
        </div>
        <Link className="button button-secondary button-small" href={tablePath}>
          Open Table
        </Link>
      </div>
      <ProductionTableWorkspace
        actions={tableEmbed.actions}
        businessSlug={businessSlug}
        capabilities={embeddedCapabilities(
          tableEmbed.capabilities,
          block.read_only === true,
        )}
        currentness={tableEmbed.currentness}
        creationFallbackHref={tableEmbed.creationFallbackHref}
        {...(tableEmbed.createConnectedRecordTarget
          ? {
              createConnectedRecordTarget:
                tableEmbed.createConnectedRecordTarget,
            }
          : {})}
        fullRecordPath={tablePath}
        {...(tableEmbed.recordCountLabel
          ? { recordCountLabel: tableEmbed.recordCountLabel }
          : {})}
        {...(tableEmbed.recordTypeLabel
          ? { recordTypeLabel: tableEmbed.recordTypeLabel }
          : {})}
        {...(tableEmbed.readConnectedRecord
          ? { readConnectedRecord: tableEmbed.readConnectedRecord }
          : {})}
        readOnly={block.read_only === true}
        {...(tableEmbed.searchConnectedRecordTargets
          ? {
              searchConnectedRecordTargets:
                tableEmbed.searchConnectedRecordTargets,
            }
          : {})}
        surface="embedded"
        table={tableEmbed.table}
        {...(tableEmbed.updateConnectedRecordCell
          ? {
              updateConnectedRecordCell: tableEmbed.updateConnectedRecordCell,
            }
          : {})}
        {...(tableEmbed.updateConnectedRecordConnection
          ? {
              updateConnectedRecordConnection:
                tableEmbed.updateConnectedRecordConnection,
            }
          : {})}
      />
    </div>
  );
}

function CapabilityBlockFrame({
  businessSlug,
  children,
  label,
}: Readonly<{
  businessSlug: string;
  children: ReactNode;
  label: string;
}>): ReactNode {
  return (
    <section aria-label={label} className="page-editor-capability-block">
      <header className="page-editor-capability-header">
        <div>
          <p className="eyebrow">{label}</p>
          <span className="page-editor-view-source">
            Customer-facing settings are managed in Tell Lenni.
          </span>
        </div>
        <Link
          className="button button-secondary button-small"
          href={`/app/${encodeURIComponent(businessSlug)}/builder`}
        >
          Edit settings
        </Link>
      </header>
      {children}
    </section>
  );
}

function PageBlockView({
  block,
  blockIdentifier,
  businessSlug,
  editing,
  embed,
  previewBookings,
  previewForms,
  onCancel,
  onChange,
  onEdit,
  onSave,
  saveBlocked,
}: Readonly<{
  block: PageBlock;
  blockIdentifier: string | null;
  businessSlug: string;
  editing: BlockDraft | null;
  embed: PageEditorViewEmbed | undefined;
  previewBookings: Readonly<
    Record<string, { catalogue: PublicBookingCatalogue }>
  >;
  previewForms: Readonly<Record<string, { bundle: ExperienceFormBundle }>>;
  onCancel: () => void;
  onChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  saveBlocked: boolean;
}>): ReactNode {
  const id = blockIdentifier;
  const editingThisBlock = id !== null && editing?.id === id;
  const editable = editableBlock(block);

  if (editingThisBlock && editable) {
    return (
      <form
        className="page-editor-block-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {editable.type === "heading" ? (
          <input
            aria-label="Heading text"
            autoFocus
            maxLength={200}
            onChange={(event) => onChange(event.currentTarget.value)}
            value={editing.text}
          />
        ) : (
          <textarea
            aria-label="Text block content"
            autoFocus
            maxLength={5_000}
            onChange={(event) => onChange(event.currentTarget.value)}
            rows={4}
            value={editing.text}
          />
        )}
        <div className="page-editor-block-form-actions">
          <button
            className="button button-small"
            disabled={saveBlocked}
            type="submit"
          >
            Save
          </button>
          <button
            className="button button-secondary button-small"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const editableContent = (content: ReactNode): ReactNode => {
    if (!editable || !id) return content;
    return (
      <div
        aria-label={`Edit ${blockLabel(block)}`}
        className="page-editor-inline-edit"
        onClick={onEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onEdit();
          }
        }}
        role="button"
        tabIndex={0}
      >
        {content}
      </div>
    );
  };

  switch (block.type) {
    case "heading":
      if (block.level === 1) return editableContent(<h1>{block.text}</h1>);
      if (block.level === 3) return editableContent(<h3>{block.text}</h3>);
      return editableContent(<h2>{block.text}</h2>);
    case "text":
      return editableContent(<p className="page-text-block">{block.text}</p>);
    case "view":
      return (
        <SavedViewBlock
          block={block}
          businessSlug={businessSlug}
          embed={embed}
        />
      );
    case "divider":
      return <hr className="page-divider" />;
    case "callout":
      return (
        <aside
          className={`page-callout page-callout-${block.tone}`}
          role="note"
        >
          {block.text}
        </aside>
      );
    case "image":
      return (
        <figure className="page-image-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={block.alt} src={block.src} />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );
    case "button":
      return (
        <p className="page-button-block">
          <a
            className={
              block.style === "secondary" ? "button button-secondary" : "button"
            }
            href={block.href}
          >
            {block.label}
          </a>
        </p>
      );
    case "form":
    case "public_form": {
      const publicMode = block.type === "public_form";
      return (
        <CapabilityBlockFrame
          businessSlug={businessSlug}
          label={block.type === "public_form" ? "Public Form" : "Form"}
        >
          <PageRenderer
            forms={previewForms}
            layout={{ blocks: [block] }}
            previewMode
            publicMode={publicMode}
          />
        </CapabilityBlockFrame>
      );
    }
    case "booking":
      return (
        <CapabilityBlockFrame businessSlug={businessSlug} label="Booking">
          <PageRenderer
            bookings={previewBookings}
            layout={{ blocks: [block] }}
            previewMode
            publicMode
          />
        </CapabilityBlockFrame>
      );
    case "preorder":
      return (
        <div className="page-editor-legacy-inline" role="status">
          {blockLabel(block)} content can be viewed from the existing Page
          runtime.
        </div>
      );
  }
}

export function PageEditor({
  applyPageBlockAction,
  availableViews,
  businessSlug,
  currentness,
  layout: initialLayout,
  pageKey,
  previewBookings = {},
  previewForms = {},
  publishedSite = false,
  renamePageAction,
  siteMode = false,
  title: initialTitle,
  views,
}: Readonly<PageEditorProps>): ReactNode {
  const router = useRouter();
  const insertShellRef = useRef<HTMLDivElement>(null);
  const pageViewTables = useMemo(
    () => groupPageViewsByTable(availableViews),
    [availableViews],
  );
  const [title, setTitle] = useState(initialTitle);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [layout, setLayout] = useState(initialLayout);
  const [currentnessRef, setCurrentnessRef] = useState(currentness);
  const [loadedCurrentness, setLoadedCurrentness] = useState(currentness);
  const [status, setStatus] = useState<EditorSaveStatus>("saved");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<AddMenu>("closed");
  const [selectedTableKey, setSelectedTableKey] = useState(
    () => pageViewTables[0]?.key ?? "",
  );
  const [selectedViewKey, setSelectedViewKey] = useState(
    () => pageViewTables[0]?.views[0]?.key ?? "",
  );
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [pendingReorder, setPendingReorder] = useState<ReorderIntent | null>(
    null,
  );
  const selectedTable =
    pageViewTables.find((table) => table.key === selectedTableKey) ??
    pageViewTables[0];
  const effectiveSelectedViewKey = selectPageView(
    selectedTable,
    selectedViewKey,
  );
  const structureBlocked = status === "saving" || status === "stale";
  const editingSourceBlock = editing
    ? layout.blocks.find((block, index) => blockId(block, index) === editing.id)
    : undefined;
  const editingSourceCandidate = editingSourceBlock
    ? editableBlock(editingSourceBlock)
    : null;
  const editingSource =
    editingSourceCandidate?.type === editing?.type
      ? editingSourceCandidate
      : null;
  const hasMeaningfulDraft =
    (renaming && titleDraft.trim() !== title) ||
    (editing !== null && editingSource?.text !== editing.text) ||
    pendingReorder !== null;

  if (
    currentness.expectedBaseVersionId !==
      loadedCurrentness.expectedBaseVersionId ||
    currentness.expectedHeadRevision !== loadedCurrentness.expectedHeadRevision
  ) {
    const wasStale = status === "stale";
    const reprepared = pendingReorder
      ? reorderPageLayout(initialLayout, pendingReorder)
      : null;
    setLoadedCurrentness(currentness);
    setCurrentnessRef(currentness);
    setTitle(initialTitle);
    if (!renaming) setTitleDraft(initialTitle);
    setLayout(reprepared ?? initialLayout);
    setStatus("saved");
    if (wasStale) {
      setStatusMessage(
        reprepared
          ? "The latest Page is loaded. Review the proposed order and save it again."
          : "The latest Page is loaded. Review your draft and save it again.",
      );
    }
  }

  useUnsavedNavigationWarning(
    hasMeaningfulDraft && status !== "saving",
    "Leave this Page? Your unfinished Page change will be lost.",
  );

  useEffect(() => {
    if (addMenu === "closed") return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAddMenu("closed");
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        insertShellRef.current &&
        !insertShellRef.current.contains(target)
      ) {
        setAddMenu("closed");
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [addMenu]);

  const runStructureAction = async (
    intent: PageStructureIntent,
  ): Promise<DirectPageActionResult | null> => {
    if (status === "saving" || status === "stale") return null;
    setStatus("saving");
    setStatusMessage(null);
    const result = await applyPageBlockAction({
      currentness: currentnessRef,
      intent,
    });
    if (result.status === "success") {
      setCurrentnessRef(result.currentness);
      setLayout(result.layout);
      setStatus("saved");
      setEditing(null);
      setAddMenu("closed");
      router.refresh();
      return result;
    }
    setStatus(result.status === "stale" ? "stale" : "error");
    setStatusMessage(result.message);
    return null;
  };

  const moveBlockToIndex = async (
    sourceId: string,
    targetIndex: number,
  ): Promise<void> => {
    if (status === "saving" || status === "stale") return;
    const intent = { sourceId, targetIndex };
    const nextLayout = reorderPageLayout(layout, intent);
    if (!nextLayout) return;
    setPendingReorder(intent);
    setLayout(nextLayout);
    setStatus("saving");
    setStatusMessage(null);
    const result = await applyPageBlockAction({
      currentness: currentnessRef,
      intent: { action: "save_page_layout", pageKey, layout: nextLayout },
    });
    if (result.status !== "success") {
      setStatus(result.status === "stale" ? "stale" : "error");
      setStatusMessage(result.message);
      return;
    }
    setPendingReorder(null);
    setCurrentnessRef(result.currentness);
    setLayout(result.layout);
    setStatus("saved");
    router.refresh();
  };

  const saveRepreparedOrder = async (): Promise<void> => {
    if (!pendingReorder) return;
    const candidate = reorderPageLayout(initialLayout, pendingReorder);
    if (!candidate) {
      setPendingReorder(null);
      setLayout(initialLayout);
      setStatusMessage(
        "That block is no longer available in the latest Page. Choose a new order.",
      );
      return;
    }
    setStatus("saving");
    setStatusMessage(null);
    const result = await applyPageBlockAction({
      currentness: currentnessRef,
      intent: { action: "save_page_layout", pageKey, layout: candidate },
    });
    if (result.status !== "success") {
      setStatus(result.status === "stale" ? "stale" : "error");
      setStatusMessage(result.message);
      return;
    }
    setPendingReorder(null);
    setCurrentnessRef(result.currentness);
    setLayout(result.layout);
    setStatus("saved");
    router.refresh();
  };

  const rename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (status === "saving" || status === "stale") return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === title) {
      setTitleDraft(title);
      setRenaming(false);
      return;
    }
    setStatus("saving");
    setStatusMessage(null);
    const result = await renamePageAction({
      currentness: currentnessRef,
      title: nextTitle,
    });
    if (result.status === "success") {
      setCurrentnessRef(result.currentness);
      setTitle(nextTitle);
      setTitleDraft(nextTitle);
      setLayout(result.layout);
      setRenaming(false);
      setStatus("saved");
      router.refresh();
      return;
    }
    setStatus(result.status === "stale" ? "stale" : "error");
    setStatusMessage(result.message);
  };

  const startEditing = (block: PageBlock, identifier?: string | null): void => {
    const id = identifier ?? blockId(block);
    const editable = editableBlock(block);
    if (!id || !editable) return;
    setEditing({
      id,
      type: editable.type,
      text: editable.text,
      ...(editable.type === "heading" ? { level: editable.level } : {}),
    });
  };

  const saveEditing = async (): Promise<void> => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) {
      setStatus("error");
      setStatusMessage("Page content cannot be empty.");
      return;
    }
    const block: DirectPageBlockInput =
      editing.type === "heading"
        ? { type: "heading", text, level: editing.level ?? 2 }
        : { type: "text", text };
    await runStructureAction({
      action: "update_page_block",
      pageKey,
      blockId: editing.id,
      block,
    });
  };

  const addBlock = async (block: DirectPageBlockInput): Promise<void> => {
    await runStructureAction({
      action: "add_page_block",
      pageKey,
      block,
    });
  };

  return (
    <section className="page-editor-shell">
      <header className="page-editor-header">
        <div>
          <p className="eyebrow">{siteMode ? "Site" : "Page"}</p>
          {renaming ? (
            <form className="page-editor-title-form" onSubmit={rename}>
              <input
                aria-label={`${siteMode ? "Site" : "Page"} name`}
                autoFocus
                maxLength={120}
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                value={titleDraft}
              />
              <button
                className="button button-small"
                disabled={structureBlocked}
                type="submit"
              >
                Save
              </button>
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  setTitleDraft(title);
                  setRenaming(false);
                }}
                type="button"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              aria-label={`Rename ${siteMode ? "Site" : "Page"}`}
              className="page-editor-title-button"
              disabled={structureBlocked}
              onClick={() => setRenaming(true)}
              type="button"
            >
              <h1>{title}</h1>
            </button>
          )}
        </div>
        <div
          className={`page-editor-save-state page-editor-save-${status}`}
          data-save-state={status}
          aria-live="polite"
          role="status"
        >
          {statusText(status)}
        </div>
      </header>

      {statusMessage ? (
        <p className="page-editor-status-message" role="alert">
          {statusMessage}
          {status === "stale" ? (
            <button
              className="page-editor-retry"
              onClick={() => router.refresh()}
              type="button"
            >
              Refresh and recheck
            </button>
          ) : null}
          {status !== "stale" && pendingReorder ? (
            <button
              className="page-editor-retry"
              onClick={() => void saveRepreparedOrder()}
              type="button"
            >
              Save order
            </button>
          ) : null}
        </p>
      ) : null}

      {editing && !editingSource ? (
        <section
          aria-label="Unresolved Page text draft"
          className="page-editor-draft-conflict"
          role="alert"
        >
          <div>
            <strong>Your text draft is still here</strong>
            <p>
              That block is no longer on the latest Page. Copy anything you
              need, then discard this draft or add a new supported block.
            </p>
          </div>
          <textarea
            aria-label="Unresolved text draft"
            onChange={(event) =>
              setEditing((value) =>
                value ? { ...value, text: event.currentTarget.value } : value,
              )
            }
            rows={4}
            value={editing.text}
          />
          <button
            className="button button-secondary button-small"
            onClick={() => setEditing(null)}
            type="button"
          >
            Discard draft
          </button>
        </section>
      ) : null}

      <div className="page-editor-insert-shell" ref={insertShellRef}>
        <div className="page-editor-controls">
          <button
            aria-controls="page-editor-add-menu"
            aria-expanded={addMenu !== "closed"}
            className="button button-secondary"
            disabled={structureBlocked}
            onClick={() =>
              setAddMenu((value) => (value === "blocks" ? "closed" : "blocks"))
            }
            type="button"
          >
            + Add block
          </button>
          <span className="page-editor-add-hint">
            {siteMode
              ? "Edit content and order; preview matches the customer Site."
              : "Press / to add"}
          </span>
        </div>

        {addMenu !== "closed" ? (
          <div
            aria-label={`Add to ${siteMode ? "Site" : "Page"}`}
            className="page-editor-insert-menu"
            id="page-editor-add-menu"
            role="menu"
          >
            {addMenu === "blocks" ? (
              <>
                <div className="page-editor-insert-menu-heading">Add block</div>
                <button
                  onClick={() =>
                    void addBlock({
                      type: "heading",
                      text: "New heading",
                      level: 2,
                    })
                  }
                  type="button"
                >
                  Heading
                </button>
                <button
                  onClick={() =>
                    void addBlock({ type: "text", text: "Start writing…" })
                  }
                  type="button"
                >
                  Text
                </button>
                <button
                  onClick={() => void addBlock({ type: "divider" })}
                  type="button"
                >
                  Divider
                </button>
                {!siteMode ? (
                  <button
                    onClick={() => {
                      const table =
                        pageViewTables.find((candidate) =>
                          candidate.views.some(
                            (view) => view.key === effectiveSelectedViewKey,
                          ),
                        ) ?? pageViewTables[0];
                      const selection = selectPageViewTable(
                        pageViewTables,
                        table?.key ?? "",
                      );
                      setSelectedTableKey(selection.tableKey);
                      setSelectedViewKey(selection.viewKey);
                      setAddMenu("views");
                    }}
                    type="button"
                  >
                    Saved View
                  </button>
                ) : null}
              </>
            ) : (
              <form
                className="page-editor-view-chooser"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (effectiveSelectedViewKey) {
                    void addBlock({
                      type: "view",
                      viewKey: effectiveSelectedViewKey,
                    });
                  }
                }}
              >
                <div className="page-editor-insert-menu-heading">
                  Add saved View
                </div>
                <label>
                  Table
                  <select
                    aria-label="Table"
                    onChange={(event) => {
                      const selection = selectPageViewTable(
                        pageViewTables,
                        event.currentTarget.value,
                      );
                      setSelectedTableKey(selection.tableKey);
                      setSelectedViewKey(selection.viewKey);
                    }}
                    value={selectedTable?.key ?? ""}
                  >
                    {pageViewTables.map((table) => (
                      <option key={table.key} value={table.key}>
                        {table.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Saved View
                  <select
                    aria-label="Saved View"
                    disabled={!selectedTable}
                    onChange={(event) =>
                      setSelectedViewKey(
                        selectPageView(
                          selectedTable,
                          event.currentTarget.value,
                        ),
                      )
                    }
                    value={effectiveSelectedViewKey}
                  >
                    {selectedTable?.views.map((view) => (
                      <option key={view.key} value={view.key}>
                        {view.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-small"
                  disabled={!effectiveSelectedViewKey}
                  type="submit"
                >
                  Add to Page
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={() => setAddMenu("blocks")}
                  type="button"
                >
                  Back
                </button>
              </form>
            )}
          </div>
        ) : null}
      </div>

      <div
        aria-keyshortcuts="/"
        aria-label={`${title} content`}
        className="page-editor-canvas"
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            event.key !== "/" ||
            addMenu !== "closed" ||
            renaming ||
            editing ||
            target.closest("input, textarea, select, [contenteditable='true']")
          ) {
            return;
          }
          event.preventDefault();
          setAddMenu("blocks");
        }}
        tabIndex={0}
      >
        {layout.blocks.length === 0 ? (
          <div className="page-editor-empty">
            <strong>Start your {siteMode ? "Site" : "Page"}</strong>
            <span>
              {siteMode
                ? "Add a heading or customer-facing text."
                : "Add a heading, a note, or a live saved View."}
            </span>
          </div>
        ) : null}
        {layout.blocks.map((block, index) => {
          const id = blockId(block, index);
          return (
            <article
              className={`page-editor-block${
                draggingBlockId === id ? " is-dragging" : ""
              }`}
              data-block-type={block.type}
              draggable={Boolean(id) && !structureBlocked}
              key={id ?? `${index}-${block.type}`}
              onDragEnd={() => setDraggingBlockId(null)}
              onDragOver={(event) => {
                if (draggingBlockId && draggingBlockId !== id) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDragStart={(event) => {
                if (!id) return;
                setDraggingBlockId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId =
                  event.dataTransfer.getData("text/plain") || draggingBlockId;
                setDraggingBlockId(null);
                if (sourceId && sourceId !== id) {
                  void moveBlockToIndex(sourceId, index);
                }
              }}
            >
              <div className="page-editor-block-content">
                <PageBlockView
                  block={block}
                  blockIdentifier={id}
                  businessSlug={businessSlug}
                  editing={editingSource ? editing : null}
                  embed={
                    block.type === "view" ? views[block.view_key] : undefined
                  }
                  previewBookings={previewBookings}
                  previewForms={previewForms}
                  onEdit={() => startEditing(block, id)}
                  onCancel={() => setEditing(null)}
                  onChange={(text) =>
                    setEditing((value) => (value ? { ...value, text } : value))
                  }
                  onSave={() => void saveEditing()}
                  saveBlocked={structureBlocked}
                />
              </div>
              <div className="page-editor-block-actions">
                {id ? (
                  <span
                    aria-label="Drag to reorder Page block"
                    className="page-editor-drag-handle"
                    title="Drag to reorder"
                  >
                    ⋮⋮
                  </span>
                ) : null}
                <span className="page-editor-block-label">
                  {blockLabel(block)}
                </span>
                {editableBlock(block) && id ? (
                  <button
                    aria-label={`Edit ${blockLabel(block)}`}
                    className="page-editor-block-action"
                    onClick={() => startEditing(block, id)}
                    type="button"
                  >
                    Edit
                  </button>
                ) : null}
                {id ? (
                  <>
                    <button
                      aria-label={`Move ${blockLabel(block)} up`}
                      className="page-editor-block-action"
                      disabled={structureBlocked || index === 0}
                      onClick={() =>
                        void runStructureAction({
                          action: "move_page_block",
                          pageKey,
                          blockId: id,
                          direction: "up",
                        })
                      }
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move ${blockLabel(block)} down`}
                      className="page-editor-block-action"
                      disabled={
                        structureBlocked || index === layout.blocks.length - 1
                      }
                      onClick={() =>
                        void runStructureAction({
                          action: "move_page_block",
                          pageKey,
                          blockId: id,
                          direction: "down",
                        })
                      }
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`Remove ${blockLabel(block)}`}
                      className="page-editor-block-action page-editor-block-remove"
                      disabled={structureBlocked}
                      onClick={() => {
                        if (
                          window.confirm("Remove this block from the Page?")
                        ) {
                          void runStructureAction({
                            action: "remove_page_block",
                            pageKey,
                            blockId: id,
                          });
                        }
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <p className="page-editor-footer">
        {siteMode
          ? publishedSite
            ? "Changes to this published Site go live when you save."
            : "Site edits use the same Page structure as the customer preview. Publish Site remains a separate owner action."
          : "Pages bring guidance and live saved Views together. Record edits remain operational and use the same Table workspace."}
      </p>
    </section>
  );
}
