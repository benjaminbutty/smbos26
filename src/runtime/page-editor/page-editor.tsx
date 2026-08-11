"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type { DirectPageActionResult } from "../pages/direct-actions";
import type {
  DirectPageBlockInput,
  DirectPageCurrentness,
  DirectPageIntent,
} from "../../core/configuration/direct-pages/schemas";
import type { PageBlock, PageLayout } from "../../core/experience/schemas";
import { experienceKeyToPath } from "../routing";
import { ProductionTableWorkspace } from "../editor-kernel/production/production-table-workspace";
import type { EditorCapabilities } from "../editor-kernel/contracts";
import type { PageEditorViewEmbed } from "./extensions";

interface PageViewOption {
  key: string;
  name: string;
  tableName?: string;
  viewType: "table" | "list" | "cards" | "detail";
}

type PageBlockIntent = Extract<
  DirectPageIntent,
  {
    action:
      | "add_page_block"
      | "update_page_block"
      | "remove_page_block"
      | "move_page_block";
  }
>;

type ApplyPageBlockAction = (input: {
  currentness: DirectPageCurrentness;
  intent: PageBlockIntent;
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

function blockId(block: PageBlock): string | null {
  return "id" in block && block.id ? block.id : null;
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
    case "preorder":
      return "Preorder";
  }
}

function editableBlock(block: PageBlock): EditableBlock | null {
  return block.type === "heading" || block.type === "text" ? block : null;
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

function PageBlockView({
  block,
  businessSlug,
  editing,
  embed,
  onCancel,
  onChange,
  onSave,
}: Readonly<{
  block: PageBlock;
  businessSlug: string;
  editing: BlockDraft | null;
  embed: PageEditorViewEmbed | undefined;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
}>): ReactNode {
  const id = blockId(block);
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
          <button className="button button-small" type="submit">
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

  switch (block.type) {
    case "heading":
      if (block.level === 1) return <h1>{block.text}</h1>;
      if (block.level === 3) return <h3>{block.text}</h3>;
      return <h2>{block.text}</h2>;
    case "text":
      return <p className="page-text-block">{block.text}</p>;
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
  renamePageAction,
  title: initialTitle,
  views,
}: Readonly<PageEditorProps>): ReactNode {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [layout, setLayout] = useState(initialLayout);
  const [currentnessRef, setCurrentnessRef] = useState(currentness);
  const [status, setStatus] = useState<EditorSaveStatus>("saved");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<AddMenu>("closed");
  const [selectedViewKey, setSelectedViewKey] = useState(
    availableViews[0]?.key ?? "",
  );
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<BlockDraft | null>(null);

  const runStructureAction = async (
    intent: PageBlockIntent,
  ): Promise<DirectPageActionResult | null> => {
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

  const rename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
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

  const startEditing = (block: PageBlock): void => {
    const id = blockId(block);
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
          <p className="eyebrow">Page</p>
          {renaming ? (
            <form className="page-editor-title-form" onSubmit={rename}>
              <input
                aria-label="Page name"
                autoFocus
                maxLength={120}
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                value={titleDraft}
              />
              <button className="button button-small" type="submit">
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
              aria-label="Rename Page"
              className="page-editor-title-button"
              onClick={() => setRenaming(true)}
              type="button"
            >
              <h1>{title}</h1>
            </button>
          )}
        </div>
        <div
          className={`page-editor-save-state page-editor-save-${status}`}
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
              Reload
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="page-editor-controls">
        <button
          className="button button-secondary"
          onClick={() =>
            setAddMenu((value) => (value === "blocks" ? "closed" : "blocks"))
          }
          type="button"
        >
          + Add block
        </button>
      </div>

      {addMenu !== "closed" ? (
        <div className="page-editor-insert-menu" role="menu">
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
                onClick={() => {
                  setSelectedViewKey(
                    selectedViewKey || availableViews[0]?.key || "",
                  );
                  setAddMenu("views");
                }}
                type="button"
              >
                Saved View
              </button>
            </>
          ) : (
            <form
              className="page-editor-view-chooser"
              onSubmit={(event) => {
                event.preventDefault();
                if (selectedViewKey) {
                  void addBlock({ type: "view", viewKey: selectedViewKey });
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
                  onChange={(event) =>
                    setSelectedViewKey(event.currentTarget.value)
                  }
                  value={selectedViewKey}
                >
                  {availableViews.map((view) => (
                    <option key={view.key} value={view.key}>
                      {view.tableName ?? view.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="page-editor-selected-view">
                View ·{" "}
                {availableViews.find((view) => view.key === selectedViewKey)
                  ?.name ?? "Unavailable"}
              </p>
              <button
                className="button button-small"
                disabled={!selectedViewKey}
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

      <div aria-label={`${title} content`} className="page-editor-canvas">
        {layout.blocks.length === 0 ? (
          <div className="page-editor-empty">
            <strong>Start your Page</strong>
            <span>Add a heading, a note, or a live saved View.</span>
          </div>
        ) : null}
        {layout.blocks.map((block, index) => {
          const id = blockId(block);
          return (
            <article
              className="page-editor-block"
              data-block-type={block.type}
              key={id ?? `${index}-${block.type}`}
            >
              <div className="page-editor-block-content">
                <PageBlockView
                  block={block}
                  businessSlug={businessSlug}
                  editing={editing}
                  embed={
                    block.type === "view" ? views[block.view_key] : undefined
                  }
                  onCancel={() => setEditing(null)}
                  onChange={(text) =>
                    setEditing((value) => (value ? { ...value, text } : value))
                  }
                  onSave={() => void saveEditing()}
                />
              </div>
              <div className="page-editor-block-actions">
                <span className="page-editor-block-label">
                  {blockLabel(block)}
                </span>
                {editableBlock(block) && id ? (
                  <button
                    aria-label={`Edit ${blockLabel(block)}`}
                    className="page-editor-block-action"
                    onClick={() => startEditing(block)}
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
                      disabled={index === 0}
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
                      disabled={index === layout.blocks.length - 1}
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
        Pages bring guidance and live saved Views together. Record edits remain
        operational and use the same Table workspace.
      </p>
    </section>
  );
}
