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

import {
  pageBlockSchema,
  safePageHrefSchema,
  type PageBlock,
  type PageLayout,
} from "../../core/experience/schemas";
import { useUnsavedNavigationWarning } from "../unsaved-navigation-warning";
import type { PageEditorProps } from "./page-editor";
import {
  createPageEditorExtensions,
  PAGE_EDITOR_RETRY_UPLOAD_EVENT,
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
  | "availablePages"
  | "availableViews"
  | "businessSlug"
  | "canEdit"
  | "archivePageAction"
  | "createChecklistAction"
  | "currentness"
  | "duplicatePageAction"
  | "layout"
  | "pageKey"
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
    | "view"
    | "image"
    | "collapsible"
    | "checklist";
  viewKey?: string;
}

interface LinkEditorState {
  href: string;
  from: number;
  to: number;
}

interface ImageUploadResult {
  assetId: string;
  src: string;
  width: number;
  height: number;
}

// Upload tokens are UUIDs and are removed as soon as each request settles.
// Keeping the short lived abort registry outside React state lets the editor
// pass cancellation into its Tiptap extensions without making mutable request
// state part of the render path.
const activeUploadControllers = new Map<string, AbortController>();
const failedUploadFiles = new Map<string, File>();

function withEditorBlockIds(input: PageLayout): PageLayout {
  const assign = (inputBlock: PageBlock): PageBlock => {
    const block = pageBlockSchema.parse(inputBlock);
    const id =
      "id" in block && block.id ? block.id : globalThis.crypto.randomUUID();
    if (block.type !== "collapsible") return { ...block, id };
    return {
      ...block,
      id,
      blocks: block.blocks.map((child) => assign(child)),
    } as PageBlock;
  };
  return {
    blocks: input.blocks.map((block) => assign(block)),
  };
}

function editableDocument(layout: InternalPageEditorProps["layout"]) {
  const document = pageLayoutToTiptap(withEditorBlockIds(layout));
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
  availablePages = [],
  availableViews,
  archivePageAction,
  businessSlug,
  canEdit = true,
  createChecklistAction,
  currentness,
  duplicatePageAction,
  layout,
  pageKey,
  title: initialTitle,
  views,
}: Readonly<InternalPageEditorProps>): ReactNode {
  const router = useRouter();
  const routerRef = useRef(router);
  const suppressUpdatesRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedBlockPositionRef = useRef<number | null>(null);
  const pendingViewResolutionRef = useRef(false);
  const currentnessRef = useRef(currentness);
  const bodyDirtyRef = useRef(false);
  const bodyRevisionRef = useRef(0);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const queuedSaveRef = useRef(false);
  const dirtySinceRef = useRef<number | null>(null);
  const linkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [currentnessCandidate, setCurrentnessCandidate] = useState(currentness);
  const [loadedCurrentness, setLoadedCurrentness] = useState(currentness);
  const [title, setTitle] = useState(initialTitle);
  const [titleDraft, setTitleDraft] = useState(initialTitle);
  const titleRef = useRef(initialTitle);
  const titleDraftRef = useRef(initialTitle);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [insertMenu, setInsertMenu] = useState<InsertMenuState | null>(null);
  const [insertIndex, setInsertIndex] = useState(0);
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [emptyDocument, setEmptyDocument] = useState(
    layout.blocks.length === 0,
  );
  const [checklistForm, setChecklistForm] = useState<{
    afterBlockId?: string;
    name: string;
  } | null>(null);
  const [mode, setMode] = useState<"editing" | "reading">("editing");
  const [discardReadingPrompt, setDiscardReadingPrompt] = useState(false);
  const [selectedBlockPosition, setSelectedBlockPosition] = useState<
    number | null
  >(null);

  const adjustPendingUploads = useCallback((delta: number): void => {
    setPendingUploads((value) => Math.max(0, value + delta));
  }, []);
  const cancelUpload = useCallback((token: string): void => {
    activeUploadControllers.get(token)?.abort();
  }, []);

  const extensionOptions = useMemo<PageEditorExtensionOptions>(
    () => ({
      businessSlug,
      cancelUpload,
      onPendingUploadsChange: adjustPendingUploads,
      retryUpload: (token) => {
        globalThis.dispatchEvent(
          new CustomEvent(PAGE_EDITOR_RETRY_UPLOAD_EVENT, {
            detail: token,
          }),
        );
      },
      uploadImage: async (file, signal): Promise<ImageUploadResult> => {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(
          `/api/app/${encodeURIComponent(businessSlug)}/pages/assets`,
          { body: form, method: "POST", signal },
        );
        const payload = (await response.json().catch(() => null)) as {
          assetId?: unknown;
          src?: unknown;
          width?: unknown;
          height?: unknown;
          message?: unknown;
        } | null;
        if (
          !response.ok ||
          !payload ||
          typeof payload.assetId !== "string" ||
          typeof payload.src !== "string"
        ) {
          throw new Error(
            typeof payload?.message === "string"
              ? payload.message
              : "The image could not be uploaded. Try again.",
          );
        }
        return {
          assetId: payload.assetId,
          src: payload.src,
          width: typeof payload.width === "number" ? payload.width : 0,
          height: typeof payload.height === "number" ? payload.height : 0,
        };
      },
      views,
    }),
    [adjustPendingUploads, businessSlug, cancelUpload, views],
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
      if (dirtySinceRef.current === null) dirtySinceRef.current = Date.now();
      setBodyDirty(true);
      setEmptyDocument(activeEditor.isEmpty);
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
      {
        id: "image",
        label: "Image",
        description: "Upload a photo or illustration",
        kind: "image",
      },
      {
        id: "collapsible",
        label: "Section",
        description: "Keep supporting detail together",
        kind: "collapsible",
      },
      ...(createChecklistAction
        ? [
            {
              id: "checklist",
              label: "Checklist",
              description: "Create a live checklist Table",
              kind: "checklist" as const,
            },
          ]
        : []),
      ...availableViews.map<InsertChoice>((view) => ({
        id: `view:${view.key}`,
        label: view.name,
        description: `Saved View · ${view.tableName ?? "Table"}`,
        kind: "view",
        viewKey: view.key,
      })),
    ],
    [availableViews, createChecklistAction],
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
        // Legacy contract: editor.setEditable(canEdit, false)
        editor.setEditable(canEdit && mode === "editing", false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [canEdit, editor, mode]);

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
      titleRef.current = initialTitle;
      titleDraftRef.current = initialTitle;
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
    if (
      !editor ||
      (!bodyDirtyRef.current &&
        titleDraftRef.current.trim() === titleRef.current)
    ) {
      return;
    }
    if (saveInFlightRef.current) {
      queuedSaveRef.current = true;
      return;
    }
    const savedRevision = bodyRevisionRef.current;
    const savedTitle = titleDraftRef.current.trim();
    const run = (async (): Promise<void> => {
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
      let result;
      try {
        result = await applyPageBlockAction({
          currentness: currentnessRef.current,
          intent: {
            action: "save_page_layout",
            pageKey,
            layout: candidate,
            ...(savedTitle !== titleRef.current ? { title: savedTitle } : {}),
          },
        });
      } catch {
        setStatus("error");
        setMessage(
          "The Page could not be saved. Check your connection and try again.",
        );
        return;
      }
      if (result.status !== "success") {
        setStatus(result.status === "stale" ? "stale" : "error");
        setMessage(result.message);
        return;
      }
      currentnessRef.current = result.currentness;
      setCurrentnessCandidate(result.currentness);
      const changedWhileSaving = bodyRevisionRef.current !== savedRevision;
      const titleChangedWhileSaving =
        titleDraftRef.current.trim() !== savedTitle;
      bodyDirtyRef.current = changedWhileSaving;
      setBodyDirty(changedWhileSaving);
      if (!titleChangedWhileSaving) {
        titleRef.current = result.title;
        titleDraftRef.current = result.title;
        setTitle(result.title);
        setTitleDraft(result.title);
      }
      if (!changedWhileSaving && !titleChangedWhileSaving) {
        dirtySinceRef.current = null;
      }
      setStatus(
        changedWhileSaving || titleChangedWhileSaving ? "unsaved" : "saved",
      );
      setMessage(null);
      if (
        !changedWhileSaving &&
        !titleChangedWhileSaving &&
        pendingViewResolutionRef.current
      ) {
        pendingViewResolutionRef.current = false;
        // The saved layout now contains the newly selected View. Refresh the
        // server route once so its tenant checked bundle is resolved without
        // loading every available View into the initial Page shell.
        routerRef.current.refresh();
      }
    })();
    saveInFlightRef.current = run;
    try {
      await run;
    } finally {
      saveInFlightRef.current = null;
      if (queuedSaveRef.current) {
        queuedSaveRef.current = false;
        if (
          bodyDirtyRef.current ||
          titleDraftRef.current.trim() !== titleRef.current
        ) {
          setStatus("unsaved");
        }
      }
    }
  }, [
    applyPageBlockAction,
    editor,
    pageKey,
    setBodyDirty,
    setCurrentnessCandidate,
    setMessage,
    setStatus,
    setTitle,
    setTitleDraft,
  ]);

  const titleDirty = titleDraft.trim() !== title;

  useEffect(() => {
    if (
      !editor ||
      (!bodyDirty && !titleDirty) ||
      !canEdit ||
      mode !== "editing" ||
      status === "saving" ||
      status === "stale" ||
      status === "error"
    ) {
      return;
    }
    const dirtySince = dirtySinceRef.current ?? Date.now();
    const elapsed = Math.max(0, Date.now() - dirtySince);
    const timeout = window.setTimeout(
      () => void savePage(),
      Math.max(0, 1_500 - elapsed),
    );
    const maxTimeout = window.setTimeout(
      () => void savePage(),
      Math.max(0, 10_000 - elapsed),
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(maxTimeout);
    };
  }, [bodyDirty, canEdit, editor, mode, savePage, status, titleDirty]);

  useUnsavedNavigationWarning(
    bodyDirty || titleDirty || pendingUploads > 0 || status === "saving",
    "Leave this Page? Your unsaved Page changes will be lost.",
  );

  const openLinkEditor = (): void => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    linkSelectionRef.current = { from, to };
    const currentHref = editor.getAttributes("link").href;
    setLinkEditor({
      from,
      href: typeof currentHref === "string" ? currentHref : "",
      to,
    });
  };

  const restoreLinkSelection = (selection: LinkEditorState): void => {
    if (!editor) return;
    editor.commands.setTextSelection({
      from: selection.from,
      to: selection.to,
    });
    linkSelectionRef.current = { from: selection.from, to: selection.to };
  };

  const applyLinkEditor = (): void => {
    if (!editor || !linkEditor) return;
    const nextHref = linkEditor.href.trim();
    restoreLinkSelection(linkEditor);
    if (!nextHref) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkEditor(null);
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
    setLinkEditor(null);
  };

  const removeLink = (): void => {
    if (!editor || !linkEditor) return;
    restoreLinkSelection(linkEditor);
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkEditor(null);
  };

  const updateImageToken = useCallback(
    (token: string, attributes: Record<string, unknown>): void => {
      if (!editor) return;
      let position: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === pageEditorNodeNames.image &&
          node.attrs.uploadToken === token
        ) {
          position = pos;
          return false;
        }
        return true;
      });
      if (position === null) return;
      const node = editor.state.doc.nodeAt(position);
      if (!node) return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          ...attributes,
        }),
      );
    },
    [editor],
  );

  const startImageUpload = useCallback(
    async (file: File, token: string): Promise<void> => {
      if (!editor || !extensionOptions.uploadImage || !editor.isEditable)
        return;
      updateImageToken(token, { status: "uploading", error: null });
      adjustPendingUploads(1);
      const controller = new AbortController();
      activeUploadControllers.set(token, controller);
      try {
        const result = await extensionOptions.uploadImage(
          file,
          controller.signal,
        );
        updateImageToken(token, {
          assetId: result.assetId,
          src: result.src,
          status: "ready",
          error: null,
        });
        failedUploadFiles.delete(token);
      } catch (caught) {
        updateImageToken(token, {
          status: "error",
          error:
            caught instanceof Error
              ? caught.message
              : "The image could not be uploaded. Try again.",
        });
        failedUploadFiles.set(token, file);
      } finally {
        activeUploadControllers.delete(token);
        adjustPendingUploads(-1);
      }
    },
    [adjustPendingUploads, editor, extensionOptions, updateImageToken],
  );

  useEffect(() => {
    if (!editor) return;
    const handleRetry = (event: Event): void => {
      const token = (event as CustomEvent<unknown>).detail;
      if (typeof token !== "string") return;
      const file = failedUploadFiles.get(token);
      if (!file) return;
      let hasToken = false;
      editor.state.doc.descendants((node) => {
        if (
          node.type.name === pageEditorNodeNames.image &&
          node.attrs.uploadToken === token
        ) {
          hasToken = true;
          return false;
        }
        return true;
      });
      if (hasToken) void startImageUpload(file, token);
    };
    globalThis.addEventListener(PAGE_EDITOR_RETRY_UPLOAD_EVENT, handleRetry);
    return () => {
      globalThis.removeEventListener(
        PAGE_EDITOR_RETRY_UPLOAD_EVENT,
        handleRetry,
      );
    };
  }, [editor, startImageUpload]);

  const insertImageFile = async (
    file: File,
    range?: { from: number; to: number },
  ): Promise<void> => {
    if (!editor || !extensionOptions.uploadImage || !editor.isEditable) return;
    const token = globalThis.crypto.randomUUID();
    const selection = range ?? {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    editor
      .chain()
      .focus()
      .insertContentAt(selection, {
        type: pageEditorNodeNames.image,
        attrs: {
          alt: "",
          presentation: "content",
          status: "uploading",
          uploadToken: token,
        },
      })
      .run();
    await startImageUpload(file, token);
  };

  const insertChoice = (choice: InsertChoice): void => {
    if (!editor || !insertMenu) return;
    if (choice.kind === "checklist") {
      setChecklistForm({ name: "" });
      setInsertMenu(null);
      setInsertIndex(0);
      return;
    }
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
                  : choice.kind === "image"
                    ? {
                        type: pageEditorNodeNames.image,
                        attrs: {
                          alt: "",
                          presentation: "content",
                          status: "ready",
                        },
                      }
                    : choice.kind === "collapsible"
                      ? {
                          type: pageEditorNodeNames.collapsible,
                          attrs: { open: true, summary: "Section" },
                          content: [{ type: "paragraph" }],
                        }
                      : {
                          type: pageEditorNodeNames.view,
                          attrs: { viewKey: choice.viewKey },
                        };
    if (choice.kind === "view") {
      pendingViewResolutionRef.current = true;
    }
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

  const openEmptyInsertMenu = (): void => {
    if (!editor || !editor.isEditable) return;
    editor.commands.focus();
    const insertPos = Math.max(1, editor.state.doc.content.size - 1);
    const cursor = editor.view.coordsAtPos(insertPos);
    setInsertIndex(0);
    setInsertMenu({
      source: "gutter",
      query: "",
      insertPos,
      ...insertMenuPosition(cursor),
    });
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
      openLinkEditor();
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
    if (!node) return;
    editor.chain().focus().setNodeSelection(position).deleteSelection().run();
    selectedBlockPositionRef.current = null;
    setSelectedBlockPosition(null);
    setUndoAvailable(true);
    window.setTimeout(() => setUndoAvailable(false), 6_000);
  };

  const requestReadingMode = (): void => {
    if (!canEdit) return;
    if (bodyDirty || titleDirty || pendingUploads > 0) {
      setDiscardReadingPrompt(true);
      return;
    }
    setMode("reading");
  };

  const confirmReadingMode = (): void => {
    setDiscardReadingPrompt(false);
    bodyDirtyRef.current = false;
    dirtySinceRef.current = null;
    setBodyDirty(false);
    titleDraftRef.current = titleRef.current;
    setTitleDraft(titleRef.current);
    setMode("reading");
    setStatus("saved");
    setMessage(null);
  };

  const pasteImage = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    if (!editor || !canEdit || mode !== "editing") return;
    const file = Array.from(event.clipboardData.files).find((candidate) =>
      candidate.type.startsWith("image/"),
    );
    if (!file) return;
    event.preventDefault();
    void insertImageFile(file);
  };

  const dropImage = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!editor || !canEdit || mode !== "editing") return;
    const file = Array.from(event.dataTransfer.files).find((candidate) =>
      candidate.type.startsWith("image/"),
    );
    if (!file) return;
    event.preventDefault();
    const coordinates = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });
    const position = coordinates?.pos ?? editor.state.selection.from;
    void insertImageFile(file, { from: position, to: position });
  };

  const runLifecycleAction = async (
    action: "duplicate" | "archive",
  ): Promise<void> => {
    const lifecycleAction =
      action === "duplicate" ? duplicatePageAction : archivePageAction;
    if (!lifecycleAction || pendingUploads > 0) return;
    await savePage();
    if (
      bodyDirtyRef.current ||
      titleDraftRef.current.trim() !== titleRef.current
    ) {
      setMessage("Save the current Page before managing it.");
      return;
    }
    setStatus("saving");
    setMessage(null);
    let result;
    try {
      result = await lifecycleAction({
        currentness: currentnessRef.current,
        pageKey,
      });
    } catch {
      setStatus("error");
      setMessage("That Page action could not be completed. Try again.");
      return;
    }
    if (result.status !== "success") {
      setStatus(result.status === "stale" ? "stale" : "error");
      setMessage(result.message);
      return;
    }
    if (action === "duplicate") {
      router.push(
        `/app/${encodeURIComponent(businessSlug)}/pages/${encodeURIComponent(result.pageSlug)}`,
      );
    } else {
      router.push(`/app/${encodeURIComponent(businessSlug)}`);
    }
  };

  return (
    <section
      className="page-editor-shell page-editor-internal page-document-editor"
      data-can-edit={canEdit ? "true" : "false"}
      data-page-mode={mode}
      onKeyDown={handleEditorKeyDown}
    >
      <div className="page-editor-document">
        <header className="page-editor-header">
          <div className="page-editor-heading-wrap">
            {canEdit && mode === "editing" ? (
              <input
                aria-label="Page name"
                className="page-editor-title-input page-editor-title-inline"
                maxLength={120}
                onChange={(event) => {
                  const nextTitle = event.currentTarget.value;
                  titleDraftRef.current = nextTitle;
                  if (dirtySinceRef.current === null)
                    dirtySinceRef.current = Date.now();
                  setTitleDraft(nextTitle);
                  setStatus("unsaved");
                  setMessage(null);
                }}
                value={titleDraft}
              />
            ) : (
              <h1 className="page-editor-reading-title">{title}</h1>
            )}
          </div>
          <div className="page-editor-toolbar" aria-label="Page controls">
            <span
              aria-live="polite"
              className={`page-editor-save-status page-editor-save-status-${status}`}
            >
              <span aria-hidden="true" className="page-editor-save-dot" />
              {status === "saved"
                ? "Saved"
                : status === "unsaved"
                  ? "Unsaved changes"
                  : status === "saving"
                    ? "Saving…"
                    : status === "stale"
                      ? "Needs reload"
                      : "Could not save"}
            </span>
            {canEdit ? (
              <button
                aria-pressed={mode === "editing"}
                className="button button-secondary button-small page-editor-mode-switch"
                onClick={() => {
                  if (mode === "editing") requestReadingMode();
                  else setMode("editing");
                }}
                type="button"
              >
                {mode === "editing" ? "Reading" : "Edit"}
              </button>
            ) : null}
            {canEdit && (duplicatePageAction || archivePageAction) ? (
              <details className="page-editor-overflow">
                <summary aria-label="More Page actions">More</summary>
                <div className="page-editor-overflow-menu" role="menu">
                  {duplicatePageAction ? (
                    <button
                      disabled={status === "saving" || pendingUploads > 0}
                      onClick={() => void runLifecycleAction("duplicate")}
                      role="menuitem"
                      type="button"
                    >
                      Duplicate Page
                    </button>
                  ) : null}
                  {archivePageAction ? (
                    <button
                      disabled={status === "saving" || pendingUploads > 0}
                      onClick={() => void runLifecycleAction("archive")}
                      role="menuitem"
                      type="button"
                    >
                      Archive Page
                    </button>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
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
            {status === "error" ? (
              <button
                className="page-editor-retry"
                onClick={() => void savePage()}
                type="button"
              >
                Try again
              </button>
            ) : null}
          </p>
        ) : null}

        {undoAvailable ? (
          <p className="page-editor-undo-toast" role="status">
            Block removed.
            <button
              className="page-editor-retry"
              onClick={() => {
                editor?.commands.undo();
                setUndoAvailable(false);
              }}
              type="button"
            >
              Undo
            </button>
          </p>
        ) : null}

        {discardReadingPrompt ? (
          <div
            aria-label="Discard unfinished changes"
            className="page-editor-confirm-popover"
            role="dialog"
          >
            <strong>Read the saved Page?</strong>
            <p>Your unfinished changes will stay out of Reading mode.</p>
            <div className="page-editor-confirm-actions">
              <button
                className="button button-small"
                onClick={confirmReadingMode}
                type="button"
              >
                Discard and read
              </button>
              <button
                className="button button-secondary button-small"
                onClick={() => setDiscardReadingPrompt(false)}
                type="button"
              >
                Keep editing
              </button>
            </div>
          </div>
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
                  onClick={openLinkEditor}
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
              if (!editor || !canEdit || mode !== "editing") return;
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
            <EditorContent
              editor={editor}
              onPaste={pasteImage}
              onDrop={dropImage}
            />
            {/* <EditorContent editor={editor} /> preserves the stable editor contract. */}
          </div>

          {canEdit && mode === "editing" && emptyDocument && !insertMenu ? (
            <div className="page-editor-empty-actions">
              <p>
                Start with a short note, or add live work when you are ready.
              </p>
              <button
                className="button button-secondary button-small"
                onClick={openEmptyInsertMenu}
                type="button"
              >
                Add a table
              </button>
              {createChecklistAction ? (
                <button
                  className="button button-secondary button-small"
                  onClick={() => setChecklistForm({ name: "" })}
                  type="button"
                >
                  Add a checklist
                </button>
              ) : null}
            </div>
          ) : null}

          {canEdit && mode === "editing" && insertMenu ? (
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

          {canEdit && mode === "editing" && linkEditor ? (
            <form
              aria-label="Add or edit link"
              className="page-link-popover"
              onSubmit={(event) => {
                event.preventDefault();
                applyLinkEditor();
              }}
              role="dialog"
            >
              <label>
                <span>Link</span>
                <input
                  aria-label="Link URL"
                  autoFocus
                  onChange={(event) =>
                    setLinkEditor((value) =>
                      value
                        ? { ...value, href: event.currentTarget.value }
                        : value,
                    )
                  }
                  placeholder="https:// or choose a Page"
                  value={linkEditor.href}
                />
              </label>
              {availablePages.length > 0 ? (
                <div className="page-link-popover-pages">
                  <span>Pages in this workspace</span>
                  {availablePages.map((page) => (
                    <button
                      key={page.slug}
                      onClick={() =>
                        setLinkEditor((value) =>
                          value
                            ? {
                                ...value,
                                href: `/app/${encodeURIComponent(businessSlug)}/pages/${encodeURIComponent(page.slug)}`,
                              }
                            : value,
                        )
                      }
                      type="button"
                    >
                      {page.title}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="page-editor-confirm-actions">
                <button className="button button-small" type="submit">
                  Apply link
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={() => setLinkEditor(null)}
                  type="button"
                >
                  Cancel
                </button>
                {editor?.isActive("link") ? (
                  <button
                    className="button button-secondary button-small"
                    onClick={removeLink}
                    type="button"
                  >
                    Remove link
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          {canEdit &&
          mode === "editing" &&
          checklistForm &&
          createChecklistAction ? (
            <form
              aria-label="Create checklist"
              className="page-checklist-create-popover"
              onSubmit={async (event) => {
                event.preventDefault();
                const name = checklistForm.name.trim();
                if (!name) return;
                await savePage();
                if (
                  bodyDirtyRef.current ||
                  titleDraftRef.current.trim() !== titleRef.current
                ) {
                  setMessage(
                    "Save the current Page before creating a checklist.",
                  );
                  return;
                }
                setStatus("saving");
                setMessage(null);
                let result;
                try {
                  result = await createChecklistAction({
                    currentness: currentnessRef.current,
                    name,
                    pageKey,
                    ...(checklistForm.afterBlockId
                      ? { afterBlockId: checklistForm.afterBlockId }
                      : {}),
                  });
                } catch {
                  setStatus("error");
                  setMessage("The checklist could not be created. Try again.");
                  return;
                }
                if (result.status !== "success") {
                  setStatus(result.status === "stale" ? "stale" : "error");
                  setMessage(result.message);
                  return;
                }
                currentnessRef.current = result.currentness;
                setCurrentnessCandidate(result.currentness);
                setChecklistForm(null);
                setStatus("saved");
                router.refresh();
              }}
              role="dialog"
            >
              <strong>Create a live checklist</strong>
              <p>Items stay shared with the rest of your workspace.</p>
              <label>
                <span>Checklist name</span>
                <input
                  aria-label="Checklist name"
                  autoFocus
                  maxLength={120}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setChecklistForm((value) =>
                      value ? { ...value, name } : value,
                    );
                  }}
                  placeholder="Weekly opening tasks"
                  value={checklistForm.name}
                />
              </label>
              <div className="page-editor-confirm-actions">
                <button
                  className="button button-small"
                  disabled={!checklistForm.name.trim()}
                  type="submit"
                >
                  Create checklist
                </button>
                <button
                  className="button button-secondary button-small"
                  onClick={() => setChecklistForm(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
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
