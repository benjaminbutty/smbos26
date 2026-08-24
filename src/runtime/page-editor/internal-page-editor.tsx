"use client";

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { safePageHrefSchema } from "../../core/experience/schemas";
import { useUnsavedNavigationWarning } from "../unsaved-navigation-warning";
import type { PageEditorProps } from "./page-editor";
import {
  createPageEditorExtensions,
  type PageEditorExtensionOptions,
} from "./extensions";
import {
  pageEditorNodeNames,
  pageLayoutToTiptap,
  tiptapToPageLayout,
} from "./page-translator";

type InternalPageEditorProps = Pick<
  PageEditorProps,
  | "applyPageBlockAction"
  | "availableViews"
  | "businessSlug"
  | "canEdit"
  | "currentness"
  | "layout"
  | "pageKey"
  | "renamePageAction"
  | "title"
  | "views"
>;

type SaveStatus = "saved" | "unsaved" | "saving" | "stale" | "error";
type EditorMode = "editing" | "reading";

interface InsertMenuState {
  source: "slash" | "gutter";
  query: string;
  from?: number;
  to?: number;
  insertPos?: number;
  left?: number;
  top?: number;
}

interface InsertChoice {
  id: string;
  label: string;
  description: string;
  kind:
    | "paragraph"
    | "heading"
    | "bulletList"
    | "orderedList"
    | "divider"
    | "callout"
    | "view";
  viewKey?: string;
}

function statusText(status: SaveStatus): string {
  switch (status) {
    case "saved":
      return "Saved";
    case "unsaved":
      return "Unsaved";
    case "saving":
      return "Saving…";
    case "stale":
      return "Things changed";
    case "error":
      return "Could not save";
  }
}

function editableDocument(layout: InternalPageEditorProps["layout"]) {
  const document = pageLayoutToTiptap(layout);
  return document.content?.length
    ? document
    : { type: "doc" as const, content: [{ type: "paragraph" }] };
}

function topLevelPosition(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  if ($from.depth === 0) {
    return editor.state.doc.nodeAt($from.pos) ? $from.pos : null;
  }
  return $from.before(1);
}

function moveTopLevelNode(editor: Editor, position: number, offset: -1 | 1) {
  const { doc, tr } = editor.state;
  const node = doc.nodeAt(position);
  if (!node) return false;
  const resolved = doc.resolve(position);
  const index = resolved.index(0);
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= doc.childCount) return false;
  if (offset === -1) {
    const previous = doc.child(targetIndex);
    tr.delete(position, position + node.nodeSize).insert(
      position - previous.nodeSize,
      node,
    );
  } else {
    const next = doc.child(targetIndex);
    tr.delete(position, position + node.nodeSize).insert(
      position + next.nodeSize,
      node,
    );
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function InternalPageEditor({
  applyPageBlockAction,
  availableViews,
  businessSlug,
  canEdit = true,
  currentness,
  layout,
  pageKey,
  renamePageAction,
  title: initialTitle,
  views,
}: Readonly<InternalPageEditorProps>): ReactNode {
  const router = useRouter();
  const suppressUpdatesRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedBlockPositionRef = useRef<number | null>(null);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [currentnessCandidate, setCurrentnessCandidate] = useState(currentness);
  const [loadedCurrentness, setLoadedCurrentness] = useState(currentness);
  const [title, setTitle] = useState(initialTitle);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [renaming, setRenaming] = useState(false);
  const [mode, setMode] = useState<EditorMode>(canEdit ? "editing" : "reading");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [insertMenu, setInsertMenu] = useState<InsertMenuState | null>(null);
  const [insertIndex, setInsertIndex] = useState(0);
  const [selectedBlockPosition, setSelectedBlockPosition] = useState<
    number | null
  >(null);

  const extensionOptions = useMemo<PageEditorExtensionOptions>(
    () => ({ businessSlug, views }),
    [businessSlug, views],
  );
  const extensions = useMemo(
    () => createPageEditorExtensions(extensionOptions),
    [extensionOptions],
  );
  const initialDocument = useMemo(() => editableDocument(layout), [layout]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initialDocument,
    editorProps: {
      attributes: {
        "aria-label": `${initialTitle} Page body`,
        class: "page-editor-content",
        spellcheck: "true",
      },
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const position = topLevelPosition(activeEditor);
      selectedBlockPositionRef.current = position;
      setSelectedBlockPosition(position);
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (suppressUpdatesRef.current) return;
      setBodyDirty(true);
      setStatus("unsaved");
      setMessage(null);
      const { $from } = activeEditor.state.selection;
      if ($from.parent.type.name !== "paragraph") {
        setInsertMenu((value) => (value?.source === "slash" ? null : value));
        return;
      }
      const beforeCursor = $from.parent.textBetween(0, $from.parentOffset);
      const slash = /^\/([^\s/]*)$/.exec(beforeCursor);
      if (!slash) {
        setInsertMenu((value) => (value?.source === "slash" ? null : value));
        return;
      }
      setInsertIndex(0);
      const cursor = activeEditor.view.coordsAtPos($from.pos);
      const canvas = canvasRef.current?.getBoundingClientRect();
      setInsertMenu({
        source: "slash",
        query: slash[1] ?? "",
        from: $from.start(),
        to: $from.pos,
        ...(canvas
          ? {
              left: Math.max(0, cursor.left - canvas.left),
              top: cursor.bottom - canvas.top + 8,
            }
          : {}),
      });
    },
  });

  const insertChoices = useMemo<InsertChoice[]>(
    () => [
      {
        id: "paragraph",
        label: "Text",
        description: "Write a paragraph",
        kind: "paragraph",
      },
      {
        id: "heading",
        label: "Heading",
        description: "Start a section",
        kind: "heading",
      },
      {
        id: "bullet-list",
        label: "Bulleted list",
        description: "Create a simple list",
        kind: "bulletList",
      },
      {
        id: "numbered-list",
        label: "Numbered list",
        description: "Create a numbered list",
        kind: "orderedList",
      },
      {
        id: "divider",
        label: "Divider",
        description: "Separate sections",
        kind: "divider",
      },
      {
        id: "callout",
        label: "Callout",
        description: "Highlight a short note",
        kind: "callout",
      },
      ...availableViews.map<InsertChoice>((view) => ({
        id: `view:${view.key}`,
        label: view.name,
        description: `Saved View · ${view.tableName ?? "Table"}`,
        kind: "view",
        viewKey: view.key,
      })),
    ],
    [availableViews],
  );
  const filteredChoices = useMemo(() => {
    const query = insertMenu?.query.trim().toLocaleLowerCase("en") ?? "";
    return query
      ? insertChoices.filter((choice) =>
          `${choice.label} ${choice.description}`
            .toLocaleLowerCase("en")
            .includes(query),
        )
      : insertChoices;
  }, [insertChoices, insertMenu?.query]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && !editor.isDestroyed) {
        editor.setEditable(canEdit && mode === "editing", false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [canEdit, editor, mode]);

  if (
    loadedCurrentness.expectedBaseVersionId !==
      currentness.expectedBaseVersionId ||
    loadedCurrentness.expectedHeadRevision !== currentness.expectedHeadRevision
  ) {
    const reflectsOwnAction =
      currentnessCandidate.expectedBaseVersionId ===
        currentness.expectedBaseVersionId &&
      currentnessCandidate.expectedHeadRevision ===
        currentness.expectedHeadRevision;
    setLoadedCurrentness(currentness);
    setCurrentnessCandidate(currentness);
    setTitle(initialTitle);
    setTitleDraft(initialTitle);
    if (bodyDirty && !reflectsOwnAction) {
      setStatus("stale");
      setMessage(
        "Things changed since you opened this Page. Your draft is still here; review it, then save again.",
      );
    } else {
      setStatus(bodyDirty ? "unsaved" : "saved");
      setMessage(null);
    }
  }

  useEffect(() => {
    if (!editor || bodyDirty) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || editor.isDestroyed) return;
      suppressUpdatesRef.current = true;
      editor.commands.setContent(editableDocument(layout), {
        emitUpdate: false,
      });
      suppressUpdatesRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [bodyDirty, editor, layout, loadedCurrentness]);

  useUnsavedNavigationWarning(
    bodyDirty && status !== "saving",
    "Leave this Page? Your unsaved Page changes will be lost.",
  );

  const savePage = async (): Promise<void> => {
    if (!editor || status === "saving" || !bodyDirty) return;
    let candidate;
    try {
      candidate = tiptapToPageLayout(editor.getJSON());
    } catch {
      setStatus("error");
      setMessage(
        "This Page contains content Lenni cannot save safely. Remove nested or unsupported content and try again.",
      );
      return;
    }
    setStatus("saving");
    setMessage(null);
    const result = await applyPageBlockAction({
      currentness: currentnessCandidate,
      intent: { action: "save_page_layout", pageKey, layout: candidate },
    });
    if (result.status !== "success") {
      setStatus(result.status === "stale" ? "stale" : "error");
      setMessage(result.message);
      return;
    }
    setCurrentnessCandidate(result.currentness);
    suppressUpdatesRef.current = true;
    editor.commands.setContent(editableDocument(result.layout), {
      emitUpdate: false,
    });
    suppressUpdatesRef.current = false;
    setBodyDirty(false);
    setStatus("saved");
    setMessage(null);
    router.refresh();
  };

  const rename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === title || status === "saving") {
      setTitleDraft(title);
      setRenaming(false);
      return;
    }
    const previousStatus = bodyDirty ? "unsaved" : "saved";
    setStatus("saving");
    setMessage(null);
    const result = await renamePageAction({
      currentness: currentnessCandidate,
      title: nextTitle,
    });
    if (result.status !== "success") {
      setStatus(result.status === "stale" ? "stale" : "error");
      setMessage(result.message);
      return;
    }
    setCurrentnessCandidate(result.currentness);
    setTitle(nextTitle);
    setTitleDraft(nextTitle);
    setRenaming(false);
    setStatus(previousStatus);
    router.refresh();
  };

  const editLink = (): void => {
    if (!editor) return;
    const currentHref = editor.getAttributes("link").href;
    const nextHref = window.prompt(
      "Link to a web page, Page, email or telephone number",
      typeof currentHref === "string" ? currentHref : "https://",
    );
    if (nextHref === null) return;
    if (!nextHref.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = safePageHrefSchema.safeParse(nextHref);
    if (!href.success) {
      setStatus("error");
      setMessage("Use a safe web, Page, email or telephone link.");
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: href.data })
      .run();
  };

  const insertChoice = (choice: InsertChoice): void => {
    if (!editor || !insertMenu) return;
    const chain = editor.chain().focus();
    if (
      insertMenu.source === "slash" &&
      insertMenu.from !== undefined &&
      insertMenu.to !== undefined
    ) {
      chain.deleteRange({ from: insertMenu.from, to: insertMenu.to });
      if (choice.kind === "paragraph") chain.setParagraph();
      if (choice.kind === "heading") chain.setHeading({ level: 2 });
      if (choice.kind === "bulletList") chain.toggleBulletList();
      if (choice.kind === "orderedList") chain.toggleOrderedList();
      if (choice.kind === "divider") {
        chain.insertContent({ type: pageEditorNodeNames.divider });
      }
      if (choice.kind === "callout") {
        chain.insertContent({
          type: pageEditorNodeNames.callout,
          attrs: { text: "Write a note", tone: "info" },
        });
      }
      if (choice.kind === "view") {
        chain.insertContent({
          type: pageEditorNodeNames.view,
          attrs: { viewKey: choice.viewKey },
        });
      }
      chain.run();
    } else if (insertMenu.insertPos !== undefined) {
      const node =
        choice.kind === "paragraph"
          ? { type: "paragraph" }
          : choice.kind === "heading"
            ? { type: "heading", attrs: { level: 2 } }
            : choice.kind === "bulletList"
              ? {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph" }],
                    },
                  ],
                }
              : choice.kind === "orderedList"
                ? {
                    type: "orderedList",
                    content: [
                      {
                        type: "listItem",
                        content: [{ type: "paragraph" }],
                      },
                    ],
                  }
                : choice.kind === "divider"
                  ? { type: pageEditorNodeNames.divider }
                  : choice.kind === "callout"
                    ? {
                        type: pageEditorNodeNames.callout,
                        attrs: { text: "Write a note", tone: "info" },
                      }
                    : {
                        type: pageEditorNodeNames.view,
                        attrs: { viewKey: choice.viewKey },
                      };
      editor.chain().focus().insertContentAt(insertMenu.insertPos, node).run();
    }
    setInsertMenu(null);
    setInsertIndex(0);
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      if ((event.target as Element).closest(".page-editor-view-node")) return;
      event.preventDefault();
      void savePage();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      if ((event.target as Element).closest(".page-editor-view-node")) return;
      event.preventDefault();
      editLink();
      return;
    }
    if (!insertMenu || insertMenu.source !== "slash") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setInsertIndex((value) =>
        filteredChoices.length ? (value + 1) % filteredChoices.length : 0,
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setInsertIndex((value) =>
        filteredChoices.length
          ? (value - 1 + filteredChoices.length) % filteredChoices.length
          : 0,
      );
    }
    if (event.key === "Enter" && filteredChoices[insertIndex]) {
      event.preventDefault();
      insertChoice(filteredChoices[insertIndex]);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setInsertMenu(null);
    }
  };

  const moveSelected = (offset: -1 | 1): void => {
    if (!editor || selectedBlockPosition === null) return;
    const position =
      selectedBlockPositionRef.current ??
      topLevelPosition(editor) ??
      selectedBlockPosition;
    if (moveTopLevelNode(editor, position, offset)) {
      selectedBlockPositionRef.current = null;
      setSelectedBlockPosition(null);
    }
  };

  const removeSelected = (): void => {
    if (!editor || selectedBlockPosition === null) return;
    const position =
      selectedBlockPositionRef.current ??
      topLevelPosition(editor) ??
      selectedBlockPosition;
    const node = editor.state.doc.nodeAt(position);
    if (!node || !window.confirm("Remove this block from the Page?")) return;
    editor.chain().focus().setNodeSelection(position).deleteSelection().run();
    selectedBlockPositionRef.current = null;
    setSelectedBlockPosition(null);
  };

  return (
    <section
      className={`page-editor-shell page-editor-internal page-document-editor is-${mode}`}
      data-can-edit={canEdit ? "true" : "false"}
      onKeyDown={handleEditorKeyDown}
    >
      <div className="page-editor-topbar">
        <div className="page-editor-context">
          <span aria-hidden="true" className="page-editor-page-icon">
            ▤
          </span>
          <span>Pages</span>
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
        <div className="page-document-actions">
          {canEdit ? (
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
                onClick={() => setMode("reading")}
                type="button"
              >
                Reading
              </button>
            </div>
          ) : (
            <span className="page-editor-reading-state">Reading</span>
          )}
          {canEdit && mode === "editing" ? (
            <button
              className="button button-small"
              disabled={!bodyDirty || status === "saving"}
              onClick={() => void savePage()}
              type="button"
            >
              Save page
            </button>
          ) : null}
        </div>
      </div>

      <div className="page-editor-document">
        <header className="page-editor-header">
          {canEdit && renaming && mode === "editing" ? (
            <form className="page-editor-title-form" onSubmit={rename}>
              <input
                aria-label="Page name"
                autoFocus
                maxLength={120}
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                value={titleDraft}
              />
              <button className="button button-small" type="submit">
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
            </form>
          ) : canEdit && mode === "editing" ? (
            <button
              aria-label="Rename Page"
              className="page-editor-title-button"
              onClick={() => setRenaming(true)}
              type="button"
            >
              <h1>{title}</h1>
            </button>
          ) : (
            <h1 className="page-editor-reading-title">{title}</h1>
          )}
        </header>

        {message ? (
          <p className="page-editor-status-message" role="alert">
            {message}
            {status === "stale" ? (
              <button
                className="page-editor-retry"
                onClick={() => router.refresh()}
                type="button"
              >
                Reload latest setup
              </button>
            ) : null}
          </p>
        ) : null}

        <div className="page-document-canvas" ref={canvasRef}>
          {editor && canEdit && mode === "editing" ? (
            <>
              <BubbleMenu
                className="page-format-menu"
                editor={editor}
                shouldShow={({ editor: activeEditor }) =>
                  !activeEditor.state.selection.empty &&
                  !activeEditor.isActive(pageEditorNodeNames.view)
                }
              >
                <button
                  aria-label="Bold"
                  aria-pressed={editor.isActive("bold")}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  type="button"
                >
                  B
                </button>
                <button
                  aria-label="Italic"
                  aria-pressed={editor.isActive("italic")}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  type="button"
                >
                  <em>I</em>
                </button>
                <button
                  aria-label="Add or edit link"
                  aria-pressed={editor.isActive("link")}
                  onClick={editLink}
                  type="button"
                >
                  Link
                </button>
              </BubbleMenu>
              <DragHandle
                className="page-document-gutter"
                editor={editor}
                onNodeChange={({ node, pos }) => {
                  if (node) {
                    selectedBlockPositionRef.current = pos;
                    setSelectedBlockPosition(pos);
                  }
                }}
              >
                <button
                  aria-label="Add a block below"
                  onClick={() => {
                    if (selectedBlockPosition === null) return;
                    const node = editor.state.doc.nodeAt(selectedBlockPosition);
                    if (!node) return;
                    const cursor = editor.view.coordsAtPos(
                      selectedBlockPosition + node.nodeSize,
                    );
                    const canvas = canvasRef.current?.getBoundingClientRect();
                    setInsertIndex(0);
                    setInsertMenu({
                      source: "gutter",
                      query: "",
                      insertPos: selectedBlockPosition + node.nodeSize,
                      ...(canvas
                        ? {
                            left: Math.max(0, cursor.left - canvas.left),
                            top: cursor.bottom - canvas.top + 8,
                          }
                        : {}),
                    });
                  }}
                  type="button"
                >
                  +
                </button>
                <button
                  aria-label="Drag block or use block actions"
                  onClick={() => undefined}
                  type="button"
                >
                  ⋮⋮
                </button>
              </DragHandle>
            </>
          ) : null}

          <EditorContent editor={editor} />

          {canEdit && mode === "editing" && selectedBlockPosition !== null ? (
            <div
              aria-label="Selected block actions"
              className="page-block-actions"
            >
              <button
                onClick={() => moveSelected(-1)}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                Move up
              </button>
              <button
                onClick={() => moveSelected(1)}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                Move down
              </button>
              <button
                onClick={removeSelected}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                Remove
              </button>
            </div>
          ) : null}

          {canEdit && mode === "editing" && insertMenu ? (
            <div
              aria-label="Insert into Page"
              className="page-slash-menu"
              role="listbox"
              style={{ left: insertMenu.left, top: insertMenu.top }}
            >
              {insertMenu.source === "gutter" ? (
                <input
                  aria-label="Search Page blocks"
                  autoFocus
                  onChange={(event) => {
                    setInsertIndex(0);
                    setInsertMenu((value) =>
                      value
                        ? { ...value, query: event.currentTarget.value }
                        : value,
                    );
                  }}
                  placeholder="Search blocks…"
                  value={insertMenu.query}
                />
              ) : (
                <div className="page-slash-menu-query">
                  Insert{" "}
                  {insertMenu.query ? `“${insertMenu.query}”` : "a block"}
                </div>
              )}
              <div className="page-slash-menu-options">
                {filteredChoices.map((choice, index) => (
                  <button
                    aria-selected={insertIndex === index}
                    className={insertIndex === index ? "is-active" : ""}
                    key={choice.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertChoice(choice)}
                    role="option"
                    type="button"
                  >
                    <strong>{choice.label}</strong>
                    <span>{choice.description}</span>
                  </button>
                ))}
                {filteredChoices.length === 0 ? (
                  <p>No matching Page blocks.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {canEdit && mode === "editing" ? (
        <p className="page-editor-footer">
          Type naturally, use / for blocks, or select text to format it. Save
          the complete Page with Cmd/Ctrl+S.
        </p>
      ) : null}
    </section>
  );
}
