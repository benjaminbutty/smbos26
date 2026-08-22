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
type SuccessfulPageAction = Extract<
  DirectPageActionResult,
  { status: "success" }
>;
type EditorMode = "editing" | "reading";
type AddMenuStep = "blocks" | "views";

interface AddMenuState {
  step: AddMenuStep;
  afterBlockId: string | null;
}
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

interface PendingInsert {
  type: "heading" | "text";
  afterBlockId: string | null;
  text: string;
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
  authoring,
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
  onLevelChange,
  onSave,
  saveBlocked,
}: Readonly<{
  authoring: boolean;
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
  onLevelChange: (value: 1 | 2 | 3) => void;
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
          <div className="page-editor-heading-fields">
            <input
              aria-label="Heading text"
              autoFocus
              maxLength={200}
              onChange={(event) => onChange(event.currentTarget.value)}
              value={editing.text}
            />
            <label>
              Heading size
              <select
                aria-label="Heading size"
                onChange={(event) =>
                  onLevelChange(Number(event.currentTarget.value) as 1 | 2 | 3)
                }
                value={editing.level ?? 2}
              >
                <option value={1}>Large</option>
                <option value={2}>Medium</option>
                <option value={3}>Small</option>
              </select>
            </label>
          </div>
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
    if (!authoring || !editable || !id) return content;
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
  const editorShellRef = useRef<HTMLElement>(null);
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
  const [mode, setMode] = useState<EditorMode>("editing");
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);
  const [selectedTableKey, setSelectedTableKey] = useState(
    () => pageViewTables[0]?.key ?? "",
  );
  const [selectedViewKey, setSelectedViewKey] = useState(
    () => pageViewTables[0]?.views[0]?.key ?? "",
  );
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [pendingInsert, setPendingInsert] = useState<PendingInsert | null>(
    null,
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [blockMenuId, setBlockMenuId] = useState<string | null>(null);
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
    (pendingInsert !== null && pendingInsert.text.trim().length > 0) ||
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
    if (addMenu === null && blockMenuId === null) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAddMenu(null);
        setBlockMenuId(null);
      }
    };
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        !target.closest(
          ".page-editor-insert-menu, .page-editor-block-menu, [aria-controls='page-editor-add-menu'], .page-editor-grip-button",
        )
      ) {
        setAddMenu(null);
        setBlockMenuId(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [addMenu, blockMenuId]);

  const runStructureAction = async (
    intent: PageStructureIntent,
  ): Promise<SuccessfulPageAction | null> => {
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
      setAddMenu(null);
      setBlockMenuId(null);
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

  const addBlock = async (
    block: DirectPageBlockInput,
    afterBlockId: string | null,
  ): Promise<void> => {
    const insertedIndex =
      afterBlockId === null
        ? 0
        : layout.blocks.findIndex(
            (candidate, index) => blockId(candidate, index) === afterBlockId,
          ) + 1;
    const result = await runStructureAction({
      action: "add_page_block",
      pageKey,
      block,
      afterBlockId,
    });
    if (!result) return;
    setPendingInsert(null);
    const inserted = result.layout.blocks[insertedIndex];
    const insertedId = inserted ? blockId(inserted, insertedIndex) : null;
    setSelectedBlockId(insertedId);
    globalThis.requestAnimationFrame(() => {
      if (!insertedId) return;
      document
        .querySelector<HTMLElement>(
          `[data-page-block-id="${CSS.escape(insertedId)}"]`,
        )
        ?.focus();
    });
  };

  const openAddMenu = (afterBlockId: string | null): void => {
    setPendingInsert(null);
    setBlockMenuId(null);
    setAddMenu((value) =>
      value?.step === "blocks" && value.afterBlockId === afterBlockId
        ? null
        : { step: "blocks", afterBlockId },
    );
  };

  const beginTextInsert = (
    type: PendingInsert["type"],
    afterBlockId: string | null,
  ): void => {
    setAddMenu(null);
    setPendingInsert({ type, afterBlockId, text: "" });
  };

  const savePendingInsert = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!pendingInsert) return;
    const text = pendingInsert.text.trim();
    if (!text) {
      setStatus("error");
      setStatusMessage("Write something before adding this block.");
      return;
    }
    await addBlock(
      pendingInsert.type === "heading"
        ? { type: "heading", text, level: 2 }
        : { type: "text", text },
      pendingInsert.afterBlockId,
    );
  };

  const enterReadingMode = (): void => {
    if (hasMeaningfulDraft) {
      const discard = window.confirm(
        "Switch to Reading and discard your unfinished Page change?",
      );
      if (!discard) return;
    }
    setRenaming(false);
    setTitleDraft(title);
    setEditing(null);
    setPendingInsert(null);
    setAddMenu(null);
    setBlockMenuId(null);
    setSelectedBlockId(null);
    setMode("reading");
  };

  const authoring = siteMode || mode === "editing";
  const trailingBlockId =
    layout.blocks.length > 0
      ? blockId(layout.blocks.at(-1)!, layout.blocks.length - 1)
      : null;

  const insertMenu = (afterBlockId: string | null): ReactNode => {
    if (!addMenu || addMenu.afterBlockId !== afterBlockId) return null;
    return (
      <div
        aria-label={`Add to ${siteMode ? "Site" : "Page"}`}
        className="page-editor-insert-menu"
        id="page-editor-add-menu"
        role="menu"
      >
        {addMenu.step === "blocks" ? (
          <>
            <div className="page-editor-insert-menu-heading">
              Add to this {siteMode ? "Site" : "Page"}
            </div>
            {!siteMode ? (
              <button
                className="page-editor-insert-choice"
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
                  setAddMenu({ step: "views", afterBlockId });
                }}
                type="button"
              >
                <span aria-hidden="true">▦</span>
                <span>
                  <strong>Saved view</strong>
                  <small>Live records from a Table</small>
                </span>
              </button>
            ) : null}
            <button
              className="page-editor-insert-choice"
              onClick={() => beginTextInsert("heading", afterBlockId)}
              type="button"
            >
              <span aria-hidden="true">H</span>
              <span>
                <strong>Heading</strong>
                <small>Introduce a section</small>
              </span>
            </button>
            <button
              className="page-editor-insert-choice"
              onClick={() => beginTextInsert("text", afterBlockId)}
              type="button"
            >
              <span aria-hidden="true">T</span>
              <span>
                <strong>Text</strong>
                <small>Add guidance or context</small>
              </span>
            </button>
            <button
              className="page-editor-insert-choice"
              onClick={() => void addBlock({ type: "divider" }, afterBlockId)}
              type="button"
            >
              <span aria-hidden="true">—</span>
              <span>
                <strong>Divider</strong>
                <small>Separate sections</small>
              </span>
            </button>
          </>
        ) : (
          <form
            className="page-editor-view-chooser"
            onSubmit={(event) => {
              event.preventDefault();
              if (effectiveSelectedViewKey) {
                void addBlock(
                  { type: "view", viewKey: effectiveSelectedViewKey },
                  afterBlockId,
                );
              }
            }}
          >
            <div className="page-editor-insert-menu-heading">
              Add a saved View
            </div>
            <p>Choose an existing View. Its records stay live on this Page.</p>
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
                    selectPageView(selectedTable, event.currentTarget.value),
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
            <div className="page-editor-menu-actions">
              <button
                className="button button-small"
                disabled={!effectiveSelectedViewKey}
                type="submit"
              >
                Add saved View
              </button>
              <button
                className="button button-secondary button-small"
                onClick={() => setAddMenu({ step: "blocks", afterBlockId })}
                type="button"
              >
                Back
              </button>
            </div>
          </form>
        )}
      </div>
    );
  };

  const pendingInsertForm = (afterBlockId: string | null): ReactNode => {
    if (!pendingInsert || pendingInsert.afterBlockId !== afterBlockId) {
      return null;
    }
    return (
      <form
        className={`page-editor-new-block page-editor-new-${pendingInsert.type}`}
        onSubmit={(event) => void savePendingInsert(event)}
      >
        {pendingInsert.type === "heading" ? (
          <input
            aria-label="New heading"
            autoFocus
            maxLength={200}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setPendingInsert((value) => (value ? { ...value, text } : value));
            }}
            placeholder="Heading"
            value={pendingInsert.text}
          />
        ) : (
          <textarea
            aria-label="New text"
            autoFocus
            maxLength={5_000}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setPendingInsert((value) => (value ? { ...value, text } : value));
            }}
            placeholder="Start writing…"
            rows={3}
            value={pendingInsert.text}
          />
        )}
        <div className="page-editor-block-form-actions">
          <button className="button button-small" type="submit">
            Add {pendingInsert.type}
          </button>
          <button
            className="button button-secondary button-small"
            onClick={() => setPendingInsert(null)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  };

  return (
    <section
      className={`page-editor-shell ${
        siteMode ? "page-editor-site" : "page-editor-internal"
      } ${authoring ? "is-editing" : "is-reading"}`}
      ref={editorShellRef}
    >
      <div className="page-editor-topbar">
        <div className="page-editor-context">
          <span aria-hidden="true" className="page-editor-page-icon">
            ▤
          </span>
          <span>{siteMode ? "Site" : "Pages"}</span>
          <span aria-hidden="true">/</span>
          <strong>{title}</strong>
          <span
            aria-live="polite"
            className={`page-editor-save-state page-editor-save-${status}`}
            data-save-state={status}
            role="status"
          >
            {statusText(status)}
          </span>
        </div>
        {!siteMode ? (
          <div aria-label="Page mode" className="page-editor-mode-switch">
            <button
              aria-pressed={mode === "editing"}
              className={mode === "editing" ? "is-active" : ""}
              onClick={() => setMode("editing")}
              type="button"
            >
              Editing
            </button>
            <button
              aria-pressed={mode === "reading"}
              className={mode === "reading" ? "is-active" : ""}
              onClick={enterReadingMode}
              type="button"
            >
              Reading
            </button>
          </div>
        ) : null}
      </div>

      <div className="page-editor-document">
        <header className="page-editor-header">
          {renaming && authoring ? (
            <form className="page-editor-title-form" onSubmit={rename}>
              <input
                aria-label={`${siteMode ? "Site" : "Page"} name`}
                autoFocus
                maxLength={120}
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                value={titleDraft}
              />
              <div className="page-editor-block-form-actions">
                <button
                  className="button button-small"
                  disabled={structureBlocked}
                  type="submit"
                >
                  Save title
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
              </div>
            </form>
          ) : authoring ? (
            <button
              aria-label={`Rename ${siteMode ? "Site" : "Page"}`}
              className="page-editor-title-button"
              disabled={structureBlocked}
              onClick={() => setRenaming(true)}
              type="button"
            >
              <h1>{title}</h1>
            </button>
          ) : (
            <h1 className="page-editor-reading-title">{title}</h1>
          )}
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
              onChange={(event) => {
                const text = event.currentTarget.value;
                setEditing((value) => (value ? { ...value, text } : value));
              }}
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

        <div
          aria-keyshortcuts="/"
          aria-label={`${title} content`}
          className="page-editor-canvas"
          onKeyDown={(event) => {
            const target = event.target as HTMLElement;
            if (
              !authoring ||
              event.key !== "/" ||
              addMenu !== null ||
              renaming ||
              editing ||
              pendingInsert ||
              target.closest(
                "input, textarea, select, button, [contenteditable='true']",
              )
            ) {
              return;
            }
            event.preventDefault();
            openAddMenu(selectedBlockId ?? trailingBlockId);
          }}
          tabIndex={authoring ? 0 : undefined}
        >
          {layout.blocks.length === 0 && !pendingInsert ? (
            authoring ? (
              <button
                aria-controls="page-editor-add-menu"
                aria-expanded={addMenu?.afterBlockId === null}
                className="page-editor-empty"
                disabled={structureBlocked}
                onClick={() => openAddMenu(null)}
                type="button"
              >
                <strong>Start this {siteMode ? "Site" : "Page"}</strong>
                <span>Choose a saved View, heading, text or divider.</span>
              </button>
            ) : (
              <p className="page-editor-reading-empty">
                This Page has no content yet.
              </p>
            )
          ) : null}
          {pendingInsertForm(null)}
          {insertMenu(null)}
          {layout.blocks.map((block, index) => {
            const id = blockId(block, index);
            const selected = selectedBlockId === id;
            return (
              <div
                className="page-editor-block-stack"
                key={id ?? `${index}-${block.type}`}
              >
                <article
                  className={`page-editor-block${
                    draggingBlockId === id ? " is-dragging" : ""
                  }${selected ? " is-selected" : ""}`}
                  data-block-type={block.type}
                  data-page-block-id={id ?? undefined}
                  onClick={() => {
                    if (authoring && id) setSelectedBlockId(id);
                  }}
                  onDragOver={(event) => {
                    if (draggingBlockId && draggingBlockId !== id) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId =
                      event.dataTransfer.getData("text/plain") ||
                      draggingBlockId;
                    setDraggingBlockId(null);
                    if (sourceId && sourceId !== id) {
                      void moveBlockToIndex(sourceId, index);
                    }
                  }}
                  tabIndex={authoring ? 0 : undefined}
                >
                  {authoring && id ? (
                    <div
                      aria-label={`${blockLabel(block)} block controls`}
                      className="page-editor-block-gutter"
                    >
                      <button
                        aria-controls="page-editor-add-menu"
                        aria-expanded={addMenu?.afterBlockId === id}
                        aria-label={`Add a block after ${blockLabel(block)}`}
                        disabled={structureBlocked}
                        onClick={(event) => {
                          event.stopPropagation();
                          openAddMenu(id);
                        }}
                        type="button"
                      >
                        +
                      </button>
                      <button
                        aria-expanded={blockMenuId === id}
                        aria-label={`Options for ${blockLabel(block)}`}
                        className="page-editor-grip-button"
                        disabled={structureBlocked}
                        draggable={!structureBlocked}
                        onDragEnd={() => setDraggingBlockId(null)}
                        onDragStart={(event) => {
                          setDraggingBlockId(id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", id);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedBlockId(id);
                          setAddMenu(null);
                          setBlockMenuId((value) => (value === id ? null : id));
                        }}
                        title="Drag to reorder or open options"
                        type="button"
                      >
                        ⋮⋮
                      </button>
                    </div>
                  ) : null}
                  <div className="page-editor-block-content">
                    <PageBlockView
                      authoring={authoring}
                      block={block}
                      blockIdentifier={id}
                      businessSlug={businessSlug}
                      editing={authoring && editingSource ? editing : null}
                      embed={
                        block.type === "view"
                          ? views[block.view_key]
                          : undefined
                      }
                      previewBookings={previewBookings}
                      previewForms={previewForms}
                      onEdit={() => startEditing(block, id)}
                      onLevelChange={(level) =>
                        setEditing((value) =>
                          value?.type === "heading"
                            ? { ...value, level }
                            : value,
                        )
                      }
                      onCancel={() => setEditing(null)}
                      onChange={(text) =>
                        setEditing((value) =>
                          value ? { ...value, text } : value,
                        )
                      }
                      onSave={() => void saveEditing()}
                      saveBlocked={structureBlocked}
                    />
                  </div>
                  {authoring && id && blockMenuId === id ? (
                    <div
                      aria-label={`${blockLabel(block)} actions`}
                      className="page-editor-block-menu"
                      role="menu"
                    >
                      <div className="page-editor-insert-menu-heading">
                        {blockLabel(block)}
                      </div>
                      {editableBlock(block) ? (
                        <button
                          onClick={() => {
                            setBlockMenuId(null);
                            startEditing(block, id);
                          }}
                          type="button"
                        >
                          Edit
                        </button>
                      ) : null}
                      <button
                        disabled={structureBlocked || index === 0}
                        onClick={() => {
                          setBlockMenuId(null);
                          void runStructureAction({
                            action: "move_page_block",
                            pageKey,
                            blockId: id,
                            direction: "up",
                          });
                        }}
                        type="button"
                      >
                        Move up
                      </button>
                      <button
                        disabled={
                          structureBlocked || index === layout.blocks.length - 1
                        }
                        onClick={() => {
                          setBlockMenuId(null);
                          void runStructureAction({
                            action: "move_page_block",
                            pageKey,
                            blockId: id,
                            direction: "down",
                          });
                        }}
                        type="button"
                      >
                        Move down
                      </button>
                      <button
                        className="page-editor-block-remove"
                        disabled={structureBlocked}
                        onClick={() => {
                          if (
                            window.confirm("Remove this block from the Page?")
                          ) {
                            setBlockMenuId(null);
                            void runStructureAction({
                              action: "remove_page_block",
                              pageKey,
                              blockId: id,
                            });
                          }
                        }}
                        type="button"
                      >
                        Remove from Page
                      </button>
                    </div>
                  ) : null}
                </article>
                {pendingInsertForm(id)}
                {insertMenu(id)}
              </div>
            );
          })}
          {authoring && layout.blocks.length > 0 ? (
            <div className="page-editor-end-insert">
              <button
                aria-controls="page-editor-add-menu"
                aria-expanded={addMenu?.afterBlockId === trailingBlockId}
                disabled={structureBlocked}
                onClick={() => openAddMenu(trailingBlockId)}
                type="button"
              >
                <span aria-hidden="true">+</span>
                <span>Type / or add a block</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {authoring ? (
        <p className="page-editor-footer">
          {siteMode
            ? publishedSite
              ? "Changes to this published Site go live when you save."
              : "Site edits use the same Page structure as the customer preview. Publish Site remains a separate owner action."
            : "Click content to edit it. Use + to add below, or the grip for move and remove actions."}
        </p>
      ) : null}
    </section>
  );
}
