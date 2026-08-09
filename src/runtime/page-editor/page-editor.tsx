"use client";

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { DirectPageActionResult } from "../pages/direct-actions";
import type { DirectPageCurrentness } from "../../core/configuration/direct-pages/schemas";
import type { PageLayout } from "../../core/experience/schemas";
import {
  createPageEditorExtensions,
  type PageEditorExtensionOptions,
  type PageEditorViewEmbed,
} from "./extensions";
import {
  pageEditorNodeNames,
  pageLayoutToTiptap,
  tiptapToPageLayout,
} from "./page-translator";

interface PageViewOption {
  key: string;
  name: string;
  viewType: "table" | "list" | "cards" | "detail";
}

type SavePageLayoutAction = (input: {
  currentness: DirectPageCurrentness;
  layout: PageLayout;
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
  savePageLayoutAction: SavePageLayoutAction;
  renamePageAction: RenamePageAction;
}

type EditorSaveStatus = "idle" | "saving" | "saved" | "stale" | "error";
type InsertMenu = "closed" | "blocks" | "views";

function statusText(status: EditorSaveStatus): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "stale":
      return "Needs reload";
    case "error":
      return "Could not save";
    case "idle":
      return "Unsaved changes";
  }
}

function pageBlockContent(
  kind: "text" | "heading1" | "heading2" | "heading3" | "divider" | "callout",
): JSONContent {
  switch (kind) {
    case "heading1":
    case "heading2":
    case "heading3":
      return {
        type: "heading",
        attrs: {
          level: Number(kind.slice(-1)),
          blockId: null,
        },
        content: [{ type: "text", text: "New heading" }],
      };
    case "divider":
      return { type: pageEditorNodeNames.divider, attrs: { blockId: null } };
    case "callout":
      return {
        type: pageEditorNodeNames.callout,
        attrs: { blockId: null, text: "Add a note", tone: "info" },
      };
    case "text":
      return {
        type: "paragraph",
        attrs: { blockId: null },
        content: [{ type: "text", text: "Start writing…" }],
      };
  }
}

export function PageEditor({
  availableViews,
  businessSlug,
  currentness,
  layout,
  pageKey,
  renamePageAction,
  savePageLayoutAction,
  title: initialTitle,
  views,
}: Readonly<PageEditorProps>): React.ReactNode {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const [status, setStatus] = useState<EditorSaveStatus>("saved");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [insertMenu, setInsertMenu] = useState<InsertMenu>("closed");
  const [slashOpen, setSlashOpen] = useState(false);
  const currentnessRef = useRef(currentness);
  const lastSavedRef = useRef(JSON.stringify(layout));
  const latestLayoutRef = useRef<PageLayout | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const lastSaveAtRef = useRef(0);
  const flushSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const scheduleSaveRef = useRef<(nextLayout: PageLayout) => void>(
    () => undefined,
  );

  const extensionOptions = useMemo<PageEditorExtensionOptions>(
    () => ({ businessSlug, views }),
    [businessSlug, views],
  );
  const extensions = useMemo(
    () => createPageEditorExtensions(extensionOptions),
    [extensionOptions],
  );
  const editor = useEditor({
    content: pageLayoutToTiptap(layout),
    extensions,
    immediatelyRender: false,
    onUpdate: ({ editor: nextEditor }) => {
      const text = nextEditor.state.selection.$from.parent.textContent;
      setSlashOpen(text.endsWith("/"));
      if (text.endsWith("/")) return;
      try {
        scheduleSaveRef.current(tiptapToPageLayout(nextEditor.getJSON()));
      } catch {
        setStatus("error");
        setStatusMessage("This block combination cannot be saved yet.");
      }
    },
  });

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const flushSave = useCallback(async () => {
    if (saveInFlightRef.current || !latestLayoutRef.current) {
      return;
    }
    const nextLayout = latestLayoutRef.current;
    latestLayoutRef.current = null;
    if (JSON.stringify(nextLayout) === lastSavedRef.current) {
      return;
    }

    saveInFlightRef.current = true;
    setStatus("saving");
    setStatusMessage(null);
    const result = await savePageLayoutAction({
      currentness: currentnessRef.current,
      layout: nextLayout,
    });
    saveInFlightRef.current = false;

    if (result.status === "success") {
      currentnessRef.current = result.currentness;
      lastSavedRef.current = JSON.stringify(nextLayout);
      lastSaveAtRef.current = Date.now();
      setStatus("saved");
      setStatusMessage(null);
    } else if (result.status === "stale") {
      setStatus("stale");
      setStatusMessage(result.message);
    } else {
      setStatus("error");
      setStatusMessage(result.message);
    }

    if (
      latestLayoutRef.current &&
      JSON.stringify(latestLayoutRef.current) !== lastSavedRef.current
    ) {
      const delay = Math.max(
        2_000,
        5_000 - (Date.now() - lastSaveAtRef.current),
      );
      saveTimerRef.current = setTimeout(
        () => void flushSaveRef.current(),
        delay,
      );
    }
  }, [savePageLayoutAction]);

  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  const scheduleSave = useCallback((nextLayout: PageLayout) => {
    latestLayoutRef.current = nextLayout;
    setStatus("idle");
    setStatusMessage(null);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const delay = Math.max(2_000, 5_000 - (Date.now() - lastSaveAtRef.current));
    saveTimerRef.current = setTimeout(() => void flushSaveRef.current(), delay);
  }, []);

  useEffect(() => {
    scheduleSaveRef.current = scheduleSave;
  }, [scheduleSave]);

  const insertBlock = useCallback(
    (
      kind:
        "text" | "heading1" | "heading2" | "heading3" | "divider" | "callout",
    ) => {
      if (!editor) return;
      if (slashOpen) {
        const from = Math.max(1, editor.state.selection.from - 1);
        editor.commands.deleteRange({
          from,
          to: editor.state.selection.from,
        });
      }
      editor.commands.insertContent(pageBlockContent(kind));
      setSlashOpen(false);
      setInsertMenu("closed");
    },
    [editor, slashOpen],
  );

  const insertView = useCallback(
    (viewKey: string, readOnly = false) => {
      if (!editor) return;
      if (slashOpen) {
        const from = Math.max(1, editor.state.selection.from - 1);
        editor.commands.deleteRange({
          from,
          to: editor.state.selection.from,
        });
      }
      editor.commands.insertContent({
        type: pageEditorNodeNames.view,
        attrs: { blockId: null, viewKey, readOnly },
      });
      setSlashOpen(false);
      setInsertMenu("closed");
    },
    [editor, slashOpen],
  );

  const saveNow = (): void => {
    if (!editor) return;
    try {
      const nextLayout = tiptapToPageLayout(editor.getJSON());
      latestLayoutRef.current = nextLayout;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushSave();
    } catch {
      setStatus("error");
      setStatusMessage("This block combination cannot be saved yet.");
    }
  };

  const rename = async (): Promise<void> => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === title) {
      setTitleDraft(title);
      return;
    }
    setStatus("saving");
    const result = await renamePageAction({
      currentness: currentnessRef.current,
      title: nextTitle,
    });
    if (result.status === "success") {
      currentnessRef.current = result.currentness;
      setTitle(nextTitle);
      setTitleDraft(nextTitle);
      lastSaveAtRef.current = Date.now();
      setStatus("saved");
      setStatusMessage(null);
      router.refresh();
    } else if (result.status === "stale") {
      setStatus("stale");
      setStatusMessage(result.message);
    } else {
      setStatus("error");
      setStatusMessage(result.message);
    }
  };

  if (!editor) {
    return <p className="runtime-empty">Loading Page editor…</p>;
  }

  return (
    <section className="page-editor-shell">
      <header className="page-editor-header">
        <div>
          <p className="eyebrow">Page</p>
          <div className="page-editor-title-row">
            <input
              aria-label="Page name"
              className="page-editor-title-input"
              maxLength={120}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
              value={titleDraft}
            />
            <button
              className="button button-secondary"
              onClick={() => void rename()}
              type="button"
            >
              Rename
            </button>
          </div>
        </div>
        <div
          className={`page-editor-save-state page-editor-save-${status}`}
          role="status"
        >
          <span>{statusText(status)}</span>
          {status === "error" ? (
            <button
              className="page-editor-retry"
              onClick={saveNow}
              type="button"
            >
              Retry
            </button>
          ) : null}
          {status === "stale" ? (
            <button
              className="page-editor-retry"
              onClick={() => router.refresh()}
              type="button"
            >
              Reload
            </button>
          ) : null}
        </div>
      </header>

      {statusMessage ? (
        <p className="page-editor-status-message" role="alert">
          {statusMessage}
        </p>
      ) : null}

      <div className="page-editor-controls">
        <button
          className="button button-secondary"
          onClick={() =>
            setInsertMenu((value) => (value === "blocks" ? "closed" : "blocks"))
          }
          type="button"
        >
          + Add block
        </button>
        <button
          className="button button-secondary"
          onClick={saveNow}
          type="button"
        >
          Save now
        </button>
        <span className="page-editor-hint">
          Type / for quick blocks · drag the handle to reorder
        </span>
      </div>

      {slashOpen || insertMenu !== "closed" ? (
        <div className="page-editor-insert-menu" role="menu">
          <div className="page-editor-insert-menu-heading">
            {slashOpen ? "Insert block" : "Add to Page"}
          </div>
          <button onClick={() => insertBlock("text")} type="button">
            Text
          </button>
          <button onClick={() => insertBlock("heading1")} type="button">
            Heading 1
          </button>
          <button onClick={() => insertBlock("heading2")} type="button">
            Heading 2
          </button>
          <button onClick={() => insertBlock("heading3")} type="button">
            Heading 3
          </button>
          <button onClick={() => insertBlock("divider")} type="button">
            Divider
          </button>
          <button onClick={() => insertBlock("callout")} type="button">
            Callout
          </button>
          <button onClick={() => setInsertMenu("views")} type="button">
            Table View…
          </button>
          {insertMenu === "views" ? (
            <div className="page-editor-view-menu">
              {availableViews
                .filter((view) => view.viewType === "table")
                .map((view) => (
                  <button
                    key={view.key}
                    onClick={() => insertView(view.key)}
                    type="button"
                  >
                    {view.name}
                  </button>
                ))}
              {availableViews.filter((view) => view.viewType === "table")
                .length === 0 ? (
                <span>No internal Tables are available yet.</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="page-editor-canvas">
        <DragHandle editor={editor}>
          <button
            aria-label="Drag block"
            className="page-editor-drag-handle"
            type="button"
          >
            ⋮⋮
          </button>
        </DragHandle>
        <EditorContent editor={editor} />
      </div>

      <div className="page-editor-footer">
        <span>
          Plain text blocks round-trip safely. Existing legacy blocks stay
          read-only until a bounded editor is added.
        </span>
        <span aria-hidden="true">{pageKey}</span>
      </div>
    </section>
  );
}
