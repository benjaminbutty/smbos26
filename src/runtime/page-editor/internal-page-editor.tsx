"use client";

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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

interface InsertMenuState {
  source: "slash" | "gutter";
  query: string;
  from?: number;
  to?: number;
  insertPos?: number;
  left?: number;
  top?: number;
  maxHeight?: number;
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

function insertMenuPosition(cursor: {
  bottom: number;
  left: number;
  top: number;
}): Pick<InsertMenuState, "left" | "top" | "maxHeight"> {
  const gap = 8;
  const minimumMenuHeight = 176;
  const preferredMenuHeight = 384;
  const menuWidth = 336;
  const availableBelow = window.innerHeight - cursor.bottom - gap;
  const availableAbove = cursor.top - gap;
  const openAbove =
    availableBelow < minimumMenuHeight && availableAbove > availableBelow;
  const availableHeight = openAbove ? availableAbove : availableBelow;
  const maxHeight = Math.max(
    160,
    Math.min(preferredMenuHeight, availableHeight),
  );

  return {
    left: Math.min(
      Math.max(gap, cursor.left),
      Math.max(gap, window.innerWidth - menuWidth - gap),
    ),
    top: openAbove
      ? Math.max(gap, cursor.top - maxHeight - gap)
      : cursor.bottom + gap,
    maxHeight,
  };
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
  const currentnessRef = useRef(currentness);
  const bodyDirtyRef = useRef(false);
  const bodyRevisionRef = useRef(0);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [currentnessCandidate, setCurrentnessCandidate] = useState(currentness);
  const [loadedCurrentness, setLoadedCurrentness] = useState(currentness);
  const [title, setTitle] = useState(initialTitle);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
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
      bodyRevisionRef.current += 1;
      bodyDirtyRef.current = true;
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
      setInsertMenu({
        source: "slash",
        query: slash[1] ?? "",
        from: $from.start(),
        to: $from.pos,
        ...insertMenuPosition(cursor),
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
        editor.setEditable(canEdit, false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [canEdit, editor]);

  useEffect(() => {
    if (
      loadedCurrentness.expectedBaseVersionId ===
        currentness.expectedBaseVersionId &&
      loadedCurrentness.expectedHeadRevision ===
        currentness.expectedHeadRevision
    ) {
      return;
    }
    const reflectsOwnAction =
      currentnessCandidate.expectedBaseVersionId ===
        currentness.expectedBaseVersionId &&
      currentnessCandidate.expectedHeadRevision ===
        currentness.expectedHeadRevision;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadedCurrentness(currentness);
      setCurrentnessCandidate(currentness);
      currentnessRef.current = currentness;
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
    });
    return () => {
      cancelled = true;
    };
  }, [
    bodyDirty,
    currentness,
    currentnessCandidate,
    initialTitle,
    loadedCurrentness,
  ]);

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

  const savePage = useCallback(async (): Promise<void> => {
    if (!editor || status === "saving" || !bodyDirtyRef.current) return;
    const savedRevision = bodyRevisionRef.current;
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
      currentness: currentnessRef.current,
      intent: { action: "save_page_layout", pageKey, layout: candidate },
    });
    if (result.status !== "success") {
      setStatus(result.status === "stale" ? "stale" : "error");
      setMessage(result.message);
      return;
    }
    currentnessRef.current = result.currentness;
    setCurrentnessCandidate(result.currentness);
    const changedWhileSaving = bodyRevisionRef.current !== savedRevision;
    bodyDirtyRef.current = changedWhileSaving;
    setBodyDirty(changedWhileSaving);
    setStatus(changedWhileSaving ? "unsaved" : "saved");
    setMessage(null);
  }, [applyPageBlockAction, editor, pageKey, status]);

  const titleDirty = titleDraft.trim() !== title;
  const saveTitle = useCallback(async (): Promise<void> => {
    const nextTitle = titleDraft.trim();
    if (
      !nextTitle ||
      nextTitle === title ||
      bodyDirtyRef.current ||
      status === "saving"
    ) {
      return;
    }
    setStatus("saving");
    setMessage(null);
    const result = await renamePageAction({
      currentness: currentnessRef.current,
      title: nextTitle,
    });
    if (result.status !== "success") {
      setStatus(result.status === "stale" ? "stale" : "error");
      setMessage(result.message);
      return;
    }
    currentnessRef.current = result.currentness;
    setCurrentnessCandidate(result.currentness);
    setTitle(nextTitle);
    setTitleDraft(nextTitle);
    setStatus(bodyDirtyRef.current ? "unsaved" : "saved");
    router.refresh();
  }, [renamePageAction, router, status, title, titleDraft]);

  useEffect(() => {
    if (!editor || !bodyDirty || status !== "unsaved") {
      return;
    }
    const timeout = window.setTimeout(() => void savePage(), 600);
    return () => window.clearTimeout(timeout);
  }, [bodyDirty, editor, savePage, status]);

  useEffect(() => {
    if (!canEdit || bodyDirty || !titleDirty || status !== "unsaved") {
      return;
    }
    const timeout = window.setTimeout(() => void saveTitle(), 600);
    return () => window.clearTimeout(timeout);
  }, [bodyDirty, canEdit, saveTitle, status, titleDirty]);

  useUnsavedNavigationWarning(
    (bodyDirty || titleDirty) && status !== "saving",
    "Leave this Page? Your unsaved Page changes will be lost.",
  );

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
    if (
      insertMenu.source === "slash" &&
      insertMenu.from !== undefined &&
      insertMenu.to !== undefined
    ) {
      editor
        .chain()
        .focus()
        .insertContentAt({ from: insertMenu.from, to: insertMenu.to }, node)
        .run();
    } else if (insertMenu.insertPos !== undefined) {
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
      className="page-editor-shell page-editor-internal page-document-editor"
      data-can-edit={canEdit ? "true" : "false"}
      onKeyDown={handleEditorKeyDown}
    >
      <div className="page-editor-document">
        <header className="page-editor-header">
          {canEdit ? (
            <input
              aria-label="Page name"
              className="page-editor-title-input page-editor-title-inline"
              maxLength={120}
              onBlur={() => void saveTitle()}
              onChange={(event) => {
                setTitleDraft(event.currentTarget.value);
                setStatus("unsaved");
                setMessage(null);
              }}
              value={titleDraft}
            />
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
          {editor && canEdit ? (
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
                    setInsertIndex(0);
                    setInsertMenu({
                      source: "gutter",
                      query: "",
                      insertPos: selectedBlockPosition + node.nodeSize,
                      ...insertMenuPosition(cursor),
                    });
                  }}
                  type="button"
                >
                  +
                </button>
                <button
                  aria-label="Drag block to move it"
                  title="Drag to move this block"
                  type="button"
                >
                  ⋮⋮
                </button>
                <button
                  aria-label="Delete block"
                  onClick={removeSelected}
                  type="button"
                >
                  ×
                </button>
              </DragHandle>
            </>
          ) : null}

          <div
            className="page-editor-content-boundary"
            onMouseDown={(event) => {
              if (!editor || !canEdit) return;
              const target = event.target;
              if (!(target instanceof HTMLElement)) return;
              const paragraph = target.closest("p");
              if (
                !paragraph ||
                paragraph.parentElement !== editor.view.dom ||
                paragraph.textContent
              ) {
                return;
              }
              const position = editor.view.posAtDOM(paragraph, 0);
              event.preventDefault();
              editor
                .chain()
                .focus()
                .setTextSelection(position + 1)
                .run();
            }}
          >
            <EditorContent editor={editor} />
          </div>

          {canEdit && insertMenu ? (
            <div
              aria-label="Insert into Page"
              className="page-slash-menu"
              role="listbox"
              style={{
                left: insertMenu.left,
                top: insertMenu.top,
                maxHeight: insertMenu.maxHeight,
              }}
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

      {canEdit ? (
        <p className="page-editor-footer">
          Changes save automatically. Type naturally, use / for blocks, or
          select text to format it.
        </p>
      ) : null}
    </section>
  );
}
