"use client";

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  safePageHrefSchema,
  type PageBlock,
  type PageLayout,
} from "../../core/experience/schemas";
import { useUnsavedNavigationWarning } from "../unsaved-navigation-warning";
import { PageRenderer } from "../pages/page-renderer";
import type { PageEditorProps } from "./page-editor";
import {
  createPageEditorExtensions,
  PAGE_EDITOR_RETRY_UPLOAD_EVENT,
  PageEditorRuntimeContext,
  type PageEditorTableEmbed,
  type PageEditorExtensionOptions,
} from "./extensions";
import {
  pageEditorNodeNames,
  pageLayoutToTiptap,
  tiptapToPageLayout,
} from "./page-translator";
import { ensureEditorBlockIds, withEditorBlockIds } from "./block-identities";
import {
  SerialSaveCoordinator,
  type SaveCoordinatorResult,
} from "./save-coordinator";
import {
  pageDraftEquals,
  pageLayoutEquals,
  resolvePageSaveAcknowledgement,
  shouldPreserveEditorDocument,
  type PageDraft,
} from "./page-draft-state";
import { PageConflictPanel } from "./page-conflict-panel";
import {
  checklistFormForMode,
  type ChecklistFormState,
} from "./checklist-form-state";
import styles from "./internal-page-editor.module.css";
import { resolveSlashInsertionRange } from "./slash-insertion";
import {
  positionSlashMenu,
  slashMenuScrollTopForActiveOption,
} from "./slash-menu-layout";

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

function editableDocument(layout: InternalPageEditorProps["layout"]) {
  const document = pageLayoutToTiptap(withEditorBlockIds(layout));
  return document.content?.length
    ? document
    : { type: "doc" as const, content: [{ type: "paragraph" }] };
}

function isPageBlockNode(node: ProseMirrorNode): boolean {
  return (
    node.type.name === "paragraph" ||
    node.type.name === "heading" ||
    node.type.name === "bulletList" ||
    node.type.name === "orderedList" ||
    node.type.name === pageEditorNodeNames.divider ||
    node.type.name === pageEditorNodeNames.callout ||
    node.type.name === pageEditorNodeNames.view ||
    node.type.name === pageEditorNodeNames.image ||
    node.type.name === pageEditorNodeNames.collapsible ||
    node.type.name === pageEditorNodeNames.legacy
  );
}

function reconcileCanonicalIds(
  editor: Editor,
  candidate: PageLayout,
  canonical: PageLayout,
): void {
  const transaction = editor.state.tr;
  let changed = false;
  const reconcile = (
    node: ProseMirrorNode,
    candidateBlocks: readonly PageBlock[],
    canonicalBlocks: readonly PageBlock[],
    position: number,
  ): void => {
    const candidateBlock = candidateBlocks[0];
    const canonicalBlock = canonicalBlocks[0];
    const candidateId =
      candidateBlock && "id" in candidateBlock ? candidateBlock.id : undefined;
    const canonicalId =
      canonicalBlock && "id" in canonicalBlock ? canonicalBlock.id : undefined;
    if (
      candidateBlock &&
      canonicalBlock &&
      canonicalId &&
      node.attrs?.blockId !== canonicalId &&
      (node.attrs?.blockId === candidateId || !candidateId)
    ) {
      transaction.setNodeMarkup(position, undefined, {
        ...node.attrs,
        blockId: canonicalId,
      });
      changed = true;
    }
    if (node.type.name !== pageEditorNodeNames.collapsible) return;
    const candidateChildren =
      candidateBlock?.type === "collapsible" ? candidateBlock.blocks : [];
    const canonicalChildren =
      canonicalBlock?.type === "collapsible" ? canonicalBlock.blocks : [];
    let childOffset = 0;
    node.forEach((child, offset) => {
      reconcile(
        child,
        candidateChildren.slice(childOffset, childOffset + 1),
        canonicalChildren.slice(childOffset, childOffset + 1),
        position + 1 + offset,
      );
      childOffset += 1;
    });
  };

  let index = 0;
  editor.state.doc.forEach((node, position) => {
    reconcile(
      node,
      candidate.blocks.slice(index, index + 1),
      canonical.blocks.slice(index, index + 1),
      position,
    );
    index += 1;
  });
  if (!changed) return;
  transaction.setMeta("addToHistory", false);
  transaction.setMeta("preventUpdate", true);
  editor.view.dispatch(transaction);
}

function topLevelPosition(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const parent = $from.node(depth - 1);
    if (
      isPageBlockNode(node) &&
      (parent.type.name === "doc" ||
        parent.type.name === pageEditorNodeNames.collapsible)
    ) {
      return $from.before(depth);
    }
  }
  return null;
}

interface SelectedBlockDetails {
  index: number;
  node: ProseMirrorNode;
  parent: ProseMirrorNode;
  position: number;
}

function blockAtPosition(
  editor: Editor,
  position: number,
): SelectedBlockDetails | null {
  let selected: SelectedBlockDetails | null = null;
  editor.state.doc.descendants((node, nodePosition, parent) => {
    if (nodePosition !== position || !parent) return true;
    let index = -1;
    let cursor = 0;
    parent.forEach((candidate) => {
      if (candidate === node) index = cursor;
      cursor += 1;
    });
    if (index >= 0) {
      selected = {
        index,
        node,
        parent,
        position: nodePosition,
      };
    }
    return false;
  });
  return selected;
}

function duplicateWithFreshBlockIds(
  editor: Editor,
  node: ProseMirrorNode,
): ProseMirrorNode {
  const json = node.toJSON() as {
    attrs?: Record<string, unknown>;
    content?: { attrs?: Record<string, unknown>; content?: unknown[] }[];
    [key: string]: unknown;
  };
  const assign = (value: typeof json): typeof json => {
    const next = { ...value };
    if (next.attrs && typeof next.attrs.blockId === "string") {
      next.attrs = { ...next.attrs, blockId: globalThis.crypto.randomUUID() };
    }
    if (Array.isArray(next.content)) {
      next.content = next.content.map((child) => assign(child as typeof json));
    }
    return next;
  };
  return editor.schema.nodeFromJSON(assign(json));
}

function insertMenuPosition(cursor: {
  bottom: number;
  left: number;
  top: number;
}): Pick<InsertMenuState, "left" | "top" | "maxHeight"> {
  return positionSlashMenu(cursor, {
    height: window.innerHeight,
    width: window.innerWidth,
  });
}

function insertChoiceGroupLabel(
  choice: InsertChoice,
  availableViews: readonly { key: string; tableName?: string }[],
): string | null {
  if (choice.kind !== "view" || !choice.viewKey) return null;
  const view = availableViews.find(
    (candidate) => candidate.key === choice.viewKey,
  );
  return view?.tableName ?? "Saved Views";
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
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const selectedBlockPositionRef = useRef<number | null>(null);
  const pendingViewResolutionRef = useRef(false);
  const currentnessRef = useRef(currentness);
  const bodyDirtyRef = useRef(false);
  const saveBlockedRef = useRef<"stale" | "error" | null>(null);
  const candidateRef = useRef<PageDraft | null>(null);
  const initialLayoutRef = useRef(layout);
  const acknowledgedDraftRef = useRef<PageDraft>({
    layout: withEditorBlockIds(layout),
    title: initialTitle,
  });
  const saveCoordinatorRef = useRef<SerialSaveCoordinator<PageDraft> | null>(
    null,
  );
  const performPageSaveRef = useRef<
    (input: {
      candidate: PageDraft;
      revision: number;
      requestId: symbol;
    }) => Promise<SaveCoordinatorResult<PageDraft>>
  >(() =>
    Promise.resolve({
      canonical: { layout: withEditorBlockIds(layout), title: initialTitle },
      status: "success",
    }),
  );
  const navigationPendingRef = useRef(false);
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
  const [checklistForm, setChecklistForm] = useState<ChecklistFormState | null>(
    null,
  );
  const [isChecklistSubmitting, setIsChecklistSubmitting] = useState(false);
  const [mode, setMode] = useState<"editing" | "reading">("editing");
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [conflict, setConflict] = useState<{
    currentness: typeof currentness;
    layout: PageLayout;
    title: string;
  } | null>(null);
  const [readingLayout, setReadingLayout] = useState<PageLayout>(() =>
    withEditorBlockIds(layout),
  );
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
      pageKey,
      availableViews,
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
    [
      adjustPendingUploads,
      availableViews,
      businessSlug,
      cancelUpload,
      pageKey,
      views,
    ],
  );
  const extensions = useMemo(
    () => createPageEditorExtensions(extensionOptions),
    [extensionOptions],
  );
  const initialDocument = useMemo(() => editableDocument(layout), [layout]);

  const noteCandidate = useCallback(
    (activeEditor: Editor, nextTitle: string): void => {
      let nextLayout: PageLayout;
      try {
        nextLayout = tiptapToPageLayout(activeEditor.getJSON());
      } catch {
        return;
      }
      const candidate = { layout: nextLayout, title: nextTitle };
      candidateRef.current = candidate;
      setReadingLayout(nextLayout);
      const bodyChanged =
        JSON.stringify(nextLayout) !==
        JSON.stringify(acknowledgedDraftRef.current.layout);
      bodyDirtyRef.current = bodyChanged;
      setBodyDirty(bodyChanged);
      const coordinator = saveCoordinatorRef.current;
      if (coordinator) {
        coordinator.update(candidate);
        if (
          coordinator.state.status !== "stale" &&
          coordinator.state.status !== "error"
        ) {
          setMessage(null);
        }
      } else {
        setStatus(
          bodyChanged || nextTitle.trim() !== titleRef.current.trim()
            ? "unsaved"
            : "saved",
        );
        if (bodyChanged || nextTitle.trim() !== titleRef.current.trim()) {
          setMessage(null);
        }
      }
    },
    [setBodyDirty, setMessage, setReadingLayout, setStatus],
  );

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
      suppressUpdatesRef.current = true;
      try {
        ensureEditorBlockIds(activeEditor);
      } finally {
        suppressUpdatesRef.current = false;
      }
      setEmptyDocument(activeEditor.isEmpty);
      noteCandidate(activeEditor, titleDraftRef.current);
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

  const insertMenuOpen = insertMenu !== null;
  const insertMenuHeight = insertMenu?.maxHeight;
  const insertMenuQuery = insertMenu?.query;
  const insertMenuSource = insertMenu?.source;

  useEffect(() => {
    if (!insertMenuOpen) return;
    const options = slashMenuRef.current?.querySelector<HTMLElement>(
      ".page-slash-menu-options",
    );
    const activeChoice = options?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    if (!options || !activeChoice) return;
    const optionsRect = options.getBoundingClientRect();
    const activeChoiceRect = activeChoice.getBoundingClientRect();
    const optionTop =
      activeChoiceRect.top - optionsRect.top + options.scrollTop;
    const nextScrollTop = slashMenuScrollTopForActiveOption({
      clientHeight: options.clientHeight,
      optionBottom: optionTop + activeChoiceRect.height,
      optionTop,
      scrollTop: options.scrollTop,
    });
    if (nextScrollTop !== options.scrollTop) options.scrollTop = nextScrollTop;
  }, [
    insertIndex,
    insertMenuHeight,
    insertMenuOpen,
    insertMenuQuery,
    insertMenuSource,
  ]);

  useEffect(() => {
    if (!editor || !insertMenu) return;

    const reposition = (): void => {
      const anchor =
        insertMenu.source === "slash" ? insertMenu.to : insertMenu.insertPos;
      if (typeof anchor !== "number") {
        setInsertMenu(null);
        return;
      }
      let cursor: { bottom: number; left: number; top: number };
      try {
        cursor = editor.view.coordsAtPos(anchor);
      } catch {
        setInsertMenu(null);
        return;
      }
      if (cursor.bottom < 0 || cursor.top > window.innerHeight) {
        setInsertMenu(null);
        return;
      }
      setInsertMenu((current) =>
        current ? { ...current, ...insertMenuPosition(cursor) } : current,
      );
    };
    const onScroll = (event: Event): void => {
      if (
        event.target instanceof Element &&
        event.target.closest(".page-slash-menu")
      ) {
        return;
      }
      reposition();
    };

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editor, insertMenu]);

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
    const hasLocalDraft =
      bodyDirtyRef.current ||
      titleDraftRef.current.trim() !== titleRef.current.trim();
    const hasInFlightSave = saveCoordinatorRef.current?.inFlight ?? false;
    const latestLayout = withEditorBlockIds(layout);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoadedCurrentness(currentness);
      if (hasInFlightSave && !hasLocalDraft) {
        // A route refresh can arrive while a request is still settling (for
        // example after an edit is undone to the old baseline). Keep the
        // serial coordinator and its in-flight acknowledgement authoritative;
        // adopting the route payload here would cancel that request and let a
        // later refresh recreate a blocked/dirty state.
        setCurrentnessCandidate(currentness);
        currentnessRef.current = currentness;
        return;
      }
      if (hasLocalDraft && reflectsOwnAction) {
        // A route refresh after our own acknowledgement can arrive while a
        // later title/body candidate is still in memory. Keep that candidate
        // in the editor and advance only the currentness token; replacing it
        // with the route payload would silently discard the newer edit.
        setCurrentnessCandidate(currentness);
        currentnessRef.current = currentness;
        return;
      }
      if (hasLocalDraft) {
        const latestMatchesAcknowledged =
          initialTitle.trim() === acknowledgedDraftRef.current.title.trim() &&
          pageLayoutEquals(latestLayout, acknowledgedDraftRef.current.layout);
        if (latestMatchesAcknowledged) {
          // Only the workspace head moved. The Page itself is still the
          // acknowledged baseline, so its currentness can be safely rebased.
          setCurrentnessCandidate(currentness);
          currentnessRef.current = currentness;
          saveCoordinatorRef.current?.rebase();
          if (!saveBlockedRef.current) {
            setStatus("unsaved");
            setMessage(null);
          }
        } else {
          // Keep both candidates visible. The latest route payload is never
          // adopted while local Page work is still unacknowledged.
          setConflict({
            currentness,
            layout: latestLayout,
            title: initialTitle,
          });
          saveBlockedRef.current = "stale";
          saveCoordinatorRef.current?.block("stale");
          setStatus("stale");
          setMessage(
            "This Page changed elsewhere. Choose Use latest or Keep my version before saving.",
          );
        }
        return;
      }
      setCurrentnessCandidate(currentness);
      currentnessRef.current = currentness;
      titleRef.current = initialTitle;
      titleDraftRef.current = initialTitle;
      setTitle(initialTitle);
      setTitleDraft(initialTitle);
      let editorDraft: PageDraft | null = null;
      if (editor && !editor.isDestroyed) {
        try {
          editorDraft = {
            layout: withEditorBlockIds(tiptapToPageLayout(editor.getJSON())),
            title: initialTitle,
          };
        } catch {
          editorDraft = null;
        }
      }
      const latestDraft: PageDraft = {
        layout: latestLayout,
        title: initialTitle,
      };
      const preserveEditorDocument = shouldPreserveEditorDocument({
        acknowledged: acknowledgedDraftRef.current,
        editor: editorDraft,
        latest: latestDraft,
      });
      acknowledgedDraftRef.current = {
        layout: latestLayout,
        title: initialTitle,
      };
      candidateRef.current = acknowledgedDraftRef.current;
      setReadingLayout(latestLayout);
      if (editor && !editor.isDestroyed && !preserveEditorDocument) {
        suppressUpdatesRef.current = true;
        editor.commands.setContent(editableDocument(latestLayout), {
          emitUpdate: false,
        });
        suppressUpdatesRef.current = false;
      }
      saveBlockedRef.current = null;
      saveCoordinatorRef.current?.acknowledge(acknowledgedDraftRef.current);
      setStatus("saved");
      setMessage(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    bodyDirty,
    currentness,
    currentnessCandidate,
    editor,
    initialTitle,
    layout,
    loadedCurrentness,
  ]);

  const performPageSave = useCallback(
    async ({
      candidate,
      revision,
      requestId,
    }: {
      candidate: PageDraft;
      revision: number;
      requestId: symbol;
    }): Promise<SaveCoordinatorResult<PageDraft>> => {
      setMessage(null);
      let result;
      try {
        result = await applyPageBlockAction({
          currentness: currentnessRef.current,
          intent: {
            action: "save_page_layout",
            pageKey,
            layout: candidate.layout,
            ...(candidate.title.trim() !== titleRef.current.trim()
              ? { title: candidate.title.trim() }
              : {}),
          },
        });
      } catch {
        const message =
          "The Page could not be saved. Check your connection and try again.";
        setMessage(message);
        return { message, status: "error" };
      }
      if (result.status !== "success") {
        setMessage(result.message);
        if (result.status === "stale") routerRef.current.refresh();
        return {
          message: result.message,
          status: result.status === "stale" ? "stale" : "error",
        };
      }

      const canonical: PageDraft = {
        layout: withEditorBlockIds(result.layout),
        title: result.title,
      };
      const coordinator = saveCoordinatorRef.current;
      if (!coordinator || !coordinator.isRequestActive(requestId)) {
        // A conflict, replacement baseline, unmount, or a refreshed editor
        // can invalidate a request after its server action returns. Let the
        // coordinator discard this response without touching editor state.
        return { canonical, status: "success" };
      }
      acknowledgedDraftRef.current = canonical;
      currentnessRef.current = result.currentness;
      setCurrentnessCandidate(result.currentness);
      const latestCandidate = candidateRef.current ?? candidate;
      const acknowledgement = resolvePageSaveAcknowledgement({
        candidateAtRequest: candidate,
        canonical,
        latestCandidate,
        latestRevision: coordinator?.state.revision ?? revision,
        requestRevision: revision,
      });
      const changedWhileSaving = !acknowledgement.candidateIsCurrent;
      const preserveLocalCandidate = acknowledgement.preserveLocalCandidate;

      // Always advance the acknowledged title baseline. When a newer local
      // candidate exists, keep its draft value in the input while baselining
      // dirty-state comparisons against the title that was actually saved.
      titleRef.current = canonical.title;
      setTitle(canonical.title);
      if (!preserveLocalCandidate) {
        reconcileCanonicalIds(
          editor!,
          acknowledgement.candidate.layout,
          canonical.layout,
        );
        candidateRef.current = acknowledgement.candidate;
        setReadingLayout(canonical.layout);
        bodyDirtyRef.current = false;
        setBodyDirty(false);
        titleDraftRef.current = canonical.title;
        setTitleDraft(canonical.title);
      } else {
        bodyDirtyRef.current = !pageLayoutEquals(
          acknowledgement.candidate.layout,
          canonical.layout,
        );
        setBodyDirty(bodyDirtyRef.current);
        setReadingLayout(acknowledgement.candidate.layout);
      }
      setConflict(null);
      saveBlockedRef.current = null;
      setMessage(null);
      if (!changedWhileSaving && pendingViewResolutionRef.current) {
        pendingViewResolutionRef.current = false;
        routerRef.current.refresh();
      }
      return { canonical, status: "success" };
    },
    [applyPageBlockAction, editor, pageKey],
  );
  useEffect(() => {
    performPageSaveRef.current = performPageSave;
  }, [performPageSave]);

  const savePage = useCallback(async (): Promise<boolean> => {
    if (!editor || !saveCoordinatorRef.current) return false;
    const result = await saveCoordinatorRef.current.flush();
    if (result?.status === "error" || result?.status === "stale") {
      saveBlockedRef.current = result.status;
      return false;
    }
    return !saveCoordinatorRef.current.hasUnacknowledgedWork;
  }, [editor]);

  const retrySave = useCallback(async (): Promise<void> => {
    const result = await saveCoordinatorRef.current?.retry();
    if (result?.status === "error" || result?.status === "stale") {
      saveBlockedRef.current = result.status;
    }
  }, []);

  useEffect(() => {
    if (!editor || saveCoordinatorRef.current) return;
    let initialCandidate: PageDraft;
    try {
      initialCandidate = {
        layout: tiptapToPageLayout(editor.getJSON()),
        title: titleRef.current,
      };
    } catch {
      initialCandidate = {
        layout: withEditorBlockIds(initialLayoutRef.current),
        title: titleRef.current,
      };
    }
    const pendingCandidate = candidateRef.current;
    if (!pendingCandidate) {
      acknowledgedDraftRef.current = initialCandidate;
      candidateRef.current = initialCandidate;
      setReadingLayout(initialCandidate.layout);
    }
    const coordinator = new SerialSaveCoordinator<PageDraft>({
      equals: pageDraftEquals,
      initialValue: acknowledgedDraftRef.current,
      onStateChange: (next) => {
        if (next.status === "error" || next.status === "stale") {
          saveBlockedRef.current = next.status;
        } else if (next.status === "saved") {
          saveBlockedRef.current = null;
        }
        setStatus(next.status);
      },
      save: (input) => performPageSaveRef.current(input),
    });
    saveCoordinatorRef.current = coordinator;
    if (
      pendingCandidate &&
      !pageDraftEquals(pendingCandidate, acknowledgedDraftRef.current)
    ) {
      coordinator.update(pendingCandidate);
    }
    return () => {
      coordinator.dispose();
      saveCoordinatorRef.current = null;
    };
  }, [editor]);

  const titleDirty = titleDraft.trim() !== title;

  const flushBeforeNavigation = useCallback(
    async (href: string): Promise<void> => {
      if (navigationPendingRef.current) return;
      navigationPendingRef.current = true;
      if (pendingUploads > 0) {
        navigationPendingRef.current = false;
        setMessage(
          "Finish the image upload before leaving this Page. Your draft is still here.",
        );
        return;
      }
      const saved = await savePage();
      navigationPendingRef.current = false;
      if (!saved) {
        setMessage(
          "Save the current Page before opening that workspace. Your draft is still here.",
        );
        return;
      }
      routerRef.current.push(href);
    },
    [pendingUploads, savePage, setMessage],
  );
  const handleInternalNavigation = useCallback(
    (href: string): void => {
      void flushBeforeNavigation(href);
    },
    [flushBeforeNavigation],
  );

  useUnsavedNavigationWarning(
    bodyDirty || titleDirty || pendingUploads > 0 || status === "saving",
    "Leave this Page? Your unsaved Page changes will be lost.",
    handleInternalNavigation,
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
    const menu = insertMenu;
    const slashRange =
      menu.source === "slash"
        ? resolveSlashInsertionRange({
            documentSize: editor.state.doc.content.size,
            query: menu.query,
            ...(menu.from !== undefined ? { requestedFrom: menu.from } : {}),
            ...(menu.to !== undefined ? { requestedTo: menu.to } : {}),
            textBetween: (from, to) => editor.state.doc.textBetween(from, to),
          })
        : null;

    if (menu.source === "slash" && !slashRange) {
      setInsertMenu(null);
      setInsertIndex(0);
      return;
    }

    if (choice.kind === "checklist") {
      let afterBlockId: string | null | undefined;
      let containerBlockId: string | undefined;
      if (menu.source === "gutter") {
        const selected =
          selectedBlockPositionRef.current ?? selectedBlockPosition;
        const node =
          selected === null ? null : editor.state.doc.nodeAt(selected);
        const id = node?.attrs?.blockId;
        let selectedIndex = -1;
        let cursor = 0;
        editor.state.doc.forEach((_candidate, position) => {
          if (position === selected) selectedIndex = cursor;
          cursor += 1;
        });
        afterBlockId =
          typeof id === "string"
            ? id
            : selectedIndex >= 0
              ? `legacy:${selectedIndex}`
              : undefined;
      } else if (slashRange) {
        // The menu owns the insertion range. The chooser takes focus, and a
        // route refresh can otherwise move the editor selection before the
        // user confirms the checklist. The already-validated command range
        // can be removed without touching surrounding prose.
        const { from, to } = slashRange;
        let $from;
        try {
          $from = editor.state.doc.resolve(from);
        } catch {
          return;
        }
        const containerDepth = Array.from(
          { length: $from.depth },
          (_, index) => $from.depth - index,
        ).find(
          (depth) =>
            $from.node(depth).type.name === pageEditorNodeNames.collapsible,
        );
        const currentDepth = containerDepth ? containerDepth + 1 : 1;
        const position = $from.before(currentDepth);
        const current = editor.state.doc.nodeAt(position);
        const parent = $from.node(currentDepth - 1);
        const currentIndex = $from.index(currentDepth - 1);
        if (containerDepth) {
          const container = $from.node(containerDepth);
          if (typeof container.attrs?.blockId === "string") {
            containerBlockId = container.attrs.blockId;
          }
        }
        const previousId =
          currentIndex > 0
            ? parent.child(currentIndex - 1).attrs?.blockId
            : undefined;
        const previousBlockId =
          currentIndex > 0
            ? typeof previousId === "string"
              ? previousId
              : `legacy:${currentIndex - 1}`
            : undefined;
        const currentId = current?.attrs?.blockId;
        const commandLength = to - from;
        const commandIsWholeParagraph =
          current?.type.name === "paragraph" &&
          from === $from.start(currentDepth) &&
          commandLength <= current.textContent.length &&
          current.textContent.slice(commandLength).trim() === "";
        afterBlockId = commandIsWholeParagraph
          ? currentIndex === 0
            ? null
            : previousBlockId
          : typeof currentId === "string"
            ? currentId
            : currentIndex >= 0
              ? `legacy:${currentIndex}`
              : undefined;
        if (current && current.type.name === "paragraph") {
          const removeFrom = commandIsWholeParagraph ? position : from;
          const removeTo = commandIsWholeParagraph
            ? position + current.nodeSize
            : to;
          editor.view.dispatch(editor.state.tr.delete(removeFrom, removeTo));
        } else {
          editor.view.dispatch(editor.state.tr.delete(from, to));
        }
      } else {
        return;
      }
      setChecklistForm({
        ...(afterBlockId !== undefined ? { afterBlockId } : {}),
        ...(containerBlockId ? { containerBlockId } : {}),
        mode: "create",
        name: "",
      });
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
                          attrs: {
                            checklist: null,
                            readOnly: false,
                            viewKey: choice.viewKey,
                          },
                        };
    if (choice.kind === "view") {
      pendingViewResolutionRef.current = true;
    }
    if (slashRange) {
      editor.chain().focus().insertContentAt(slashRange, node).run();
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
    const target = event.target;
    const isInsideView =
      target instanceof Element && target.closest(".page-editor-view-node");
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      if (isInsideView) return;
      event.preventDefault();
      event.stopPropagation();
      void savePage();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      if (isInsideView) return;
      event.preventDefault();
      event.stopPropagation();
      openLinkEditor();
      return;
    }
    if (!insertMenu) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setInsertIndex((value) =>
        filteredChoices.length ? (value + 1) % filteredChoices.length : 0,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setInsertIndex((value) =>
        filteredChoices.length
          ? (value - 1 + filteredChoices.length) % filteredChoices.length
          : 0,
      );
      return;
    }
    if (event.key === "Enter" && filteredChoices[insertIndex]) {
      event.preventDefault();
      event.stopPropagation();
      insertChoice(filteredChoices[insertIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
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

  const selectedBlock = useCallback(() => {
    if (!editor) return null;
    const position =
      selectedBlockPositionRef.current ??
      topLevelPosition(editor) ??
      selectedBlockPosition;
    if (position === null || position === undefined) return null;
    return blockAtPosition(editor, position);
  }, [editor, selectedBlockPosition]);

  const selectedBlockDetails = useMemo(() => {
    if (!editor || selectedBlockPosition === null) return null;
    return blockAtPosition(editor, selectedBlockPosition);
  }, [editor, selectedBlockPosition]);
  const selectedBlockIndex = selectedBlockDetails?.index ?? null;
  const selectedBlockCount = selectedBlockDetails?.parent.childCount ?? null;

  const duplicateSelected = useCallback((): void => {
    const selected = selectedBlock();
    if (!selected || !editor) return;
    const duplicate = duplicateWithFreshBlockIds(editor, selected.node);
    const transaction = editor.state.tr.insert(
      selected.position + selected.node.nodeSize,
      duplicate,
    );
    transaction.setMeta("addToHistory", true);
    editor.view.dispatch(transaction);
    setBlockMenuOpen(false);
  }, [editor, selectedBlock]);

  const moveSelected = useCallback(
    (direction: "up" | "down"): void => {
      const selected = selectedBlock();
      if (!selected || !editor) return;
      if (
        (direction === "up" && selected.index <= 0) ||
        (direction === "down" &&
          selected.index >= selected.parent.childCount - 1)
      ) {
        return;
      }
      const adjacent = selected.parent.child(
        direction === "up" ? selected.index - 1 : selected.index + 1,
      );
      const transaction = editor.state.tr.delete(
        selected.position,
        selected.position + selected.node.nodeSize,
      );
      const insertionPosition =
        direction === "up"
          ? selected.position - adjacent.nodeSize
          : transaction.mapping.map(
              selected.position + selected.node.nodeSize,
              1,
            ) + adjacent.nodeSize;
      transaction.insert(insertionPosition, selected.node);
      transaction.setMeta("addToHistory", true);
      editor.view.dispatch(transaction);
      setBlockMenuOpen(false);
    },
    [editor, selectedBlock],
  );

  const requestReadingMode = (): void => {
    if (!canEdit) return;
    if (pendingUploads > 0) {
      setMessage("Finish the image upload before opening Reading mode.");
      return;
    }
    void (async () => {
      if (bodyDirty || titleDirty || saveCoordinatorRef.current?.inFlight) {
        const saved = await savePage();
        if (!saved) return;
      }
      setMode("reading");
      setMessage(null);
    })();
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
    if (!(await savePage())) {
      setMessage("Save the current Page before managing it.");
      return;
    }
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

  const useLatestConflict = (): void => {
    if (!conflict || !editor) return;
    const latest = {
      layout: withEditorBlockIds(conflict.layout),
      title: conflict.title,
    };
    suppressUpdatesRef.current = true;
    editor.commands.setContent(editableDocument(latest.layout), {
      emitUpdate: false,
    });
    suppressUpdatesRef.current = false;
    acknowledgedDraftRef.current = latest;
    candidateRef.current = latest;
    setReadingLayout(latest.layout);
    bodyDirtyRef.current = false;
    setBodyDirty(false);
    titleRef.current = latest.title;
    titleDraftRef.current = latest.title;
    setTitle(latest.title);
    setTitleDraft(latest.title);
    currentnessRef.current = conflict.currentness;
    setCurrentnessCandidate(conflict.currentness);
    saveBlockedRef.current = null;
    saveCoordinatorRef.current?.acknowledge(latest);
    setConflict(null);
    setStatus("saved");
    setMessage(null);
  };

  const keepMyConflict = (): void => {
    if (!conflict) return;
    currentnessRef.current = conflict.currentness;
    setCurrentnessCandidate(conflict.currentness);
    setConflict(null);
    saveBlockedRef.current = null;
    void retrySave();
  };

  const readingViews = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(views).map(([key, embed]) => [key, embed.bundle]),
      ),
    [views],
  );
  const readingTables = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(views).flatMap(([key, embed]) =>
          embed.table
            ? [[key, { ...embed.table, currentness: currentnessCandidate }]]
            : [],
        ),
      ) as Readonly<Record<string, PageEditorTableEmbed>>,
    [currentnessCandidate, views],
  );
  const editorRuntimeContext = useMemo(
    () => ({ availableViews, currentness: currentnessCandidate, views }),
    [availableViews, currentnessCandidate, views],
  );
  const checklistViews = useMemo(
    () =>
      availableViews.filter(
        (view) =>
          view.viewType === "table" &&
          view.checklistFields?.some((field) => field.kind === "text") &&
          view.checklistFields?.some((field) => field.kind === "boolean"),
      ),
    [availableViews],
  );
  const selectedChecklistView =
    checklistForm?.mode === "existing"
      ? availableViews.find((view) => view.key === checklistForm.viewKey)
      : undefined;
  const selectedChecklistLabelField =
    selectedChecklistView?.checklistFields?.find(
      (field) => field.key === checklistForm?.labelField,
    );
  const selectedChecklistCompletedField =
    selectedChecklistView?.checklistFields?.find(
      (field) => field.key === checklistForm?.completedField,
    );
  const selectedChecklistNeedsReadOnly = Boolean(
    selectedChecklistLabelField?.editable === false ||
    selectedChecklistCompletedField?.editable === false,
  );
  const localConflictDraft: PageDraft = {
    layout: readingLayout,
    title: titleDraft,
  };

  return (
    <section
      className={`page-editor-shell page-editor-internal page-document-editor ${styles.pageDocumentEditor}`}
      data-can-edit={canEdit ? "true" : "false"}
      data-page-mode={mode}
      onClickCapture={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const anchor = target.closest("a[href]");
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const href = anchor.getAttribute("href");
        if (!href || !href.startsWith("/")) return;
        if (
          !bodyDirtyRef.current &&
          titleDraftRef.current.trim() === titleRef.current.trim() &&
          pendingUploads === 0 &&
          !saveCoordinatorRef.current?.inFlight
        ) {
          return;
        }
        event.preventDefault();
        void flushBeforeNavigation(href);
      }}
      onKeyDownCapture={handleEditorKeyDown}
    >
      <div className="page-editor-document">
        <header className="page-editor-header">
          <div className="page-editor-heading-wrap">
            {canEdit && mode === "editing" ? (
              <input
                aria-label="Page name"
                className="page-editor-title-input page-editor-title-inline"
                autoFocus
                maxLength={120}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  editor?.chain().focus().setTextSelection(1).run();
                }}
                onChange={(event) => {
                  const nextTitle = event.currentTarget.value;
                  titleDraftRef.current = nextTitle;
                  setTitleDraft(nextTitle);
                  if (editor) noteCandidate(editor, nextTitle);
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

        {message && !conflict ? (
          <p className="page-editor-status-message" role="alert">
            {message}
            {status === "stale" ? (
              <button
                className="page-editor-retry"
                onClick={() => routerRef.current.refresh()}
                type="button"
              >
                Reload latest setup
              </button>
            ) : null}
            {status === "error" ? (
              <button
                className="page-editor-retry"
                onClick={() => void retrySave()}
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

        {conflict ? (
          <PageConflictPanel
            businessSlug={businessSlug}
            latest={{
              layout: conflict.layout,
              title: conflict.title,
            }}
            local={localConflictDraft}
            onKeepMyVersion={keepMyConflict}
            onUseLatest={useLatestConflict}
          />
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
                {editor.isActive("heading") ? (
                  <label className="page-editor-heading-level-control">
                    <span className="editor-sr-only">Heading level</span>
                    <select
                      aria-label="Heading level"
                      onChange={(event) =>
                        editor
                          .chain()
                          .focus()
                          .setNode("heading", {
                            level: Number(event.currentTarget.value),
                          })
                          .run()
                      }
                      value={String(editor.getAttributes("heading").level ?? 2)}
                    >
                      <option value="1">Heading 1</option>
                      <option value="2">Heading 2</option>
                      <option value="3">Heading 3</option>
                    </select>
                  </label>
                ) : null}
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
                <details
                  className="page-editor-block-actions"
                  onToggle={(event) =>
                    setBlockMenuOpen(event.currentTarget.open)
                  }
                  open={blockMenuOpen}
                >
                  <summary aria-label="Block actions">•••</summary>
                  <div className="page-editor-block-menu" role="menu">
                    <button
                      disabled={
                        selectedBlockIndex === null || selectedBlockIndex === 0
                      }
                      onClick={() => moveSelected("up")}
                      role="menuitem"
                      type="button"
                    >
                      Move up
                    </button>
                    <button
                      disabled={
                        selectedBlockIndex === null ||
                        selectedBlockCount === null ||
                        selectedBlockIndex >= selectedBlockCount - 1
                      }
                      onClick={() => moveSelected("down")}
                      role="menuitem"
                      type="button"
                    >
                      Move down
                    </button>
                    <button
                      onClick={duplicateSelected}
                      role="menuitem"
                      type="button"
                    >
                      Duplicate block
                    </button>
                    <button
                      className="page-editor-block-remove"
                      onClick={removeSelected}
                      role="menuitem"
                      type="button"
                    >
                      Remove block
                    </button>
                  </div>
                </details>
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
            {mode === "reading" ? (
              <PageRenderer
                businessSlug={businessSlug}
                layout={readingLayout}
                pageKey={pageKey}
                tableEmbeds={readingTables}
                views={readingViews}
              />
            ) : (
              <PageEditorRuntimeContext.Provider value={editorRuntimeContext}>
                <EditorContent
                  editor={editor}
                  onPaste={pasteImage}
                  onDrop={dropImage}
                />
              </PageEditorRuntimeContext.Provider>
            )}
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
                  onClick={() => setChecklistForm({ mode: "create", name: "" })}
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
              ref={slashMenuRef}
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
                    const query = event.currentTarget.value;
                    setInsertIndex(0);
                    setInsertMenu((value) =>
                      value ? { ...value, query } : value,
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
                {filteredChoices.map((choice, index) => {
                  const groupLabel = insertChoiceGroupLabel(
                    choice,
                    availableViews,
                  );
                  const previousGroupLabel =
                    index > 0
                      ? insertChoiceGroupLabel(
                          filteredChoices[index - 1]!,
                          availableViews,
                        )
                      : null;
                  return (
                    <Fragment key={choice.id}>
                      {groupLabel && groupLabel !== previousGroupLabel ? (
                        <p className="page-editor-choice-group-label">
                          {groupLabel}
                        </p>
                      ) : null}
                      <button
                        aria-selected={insertIndex === index}
                        className={insertIndex === index ? "is-active" : ""}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertChoice(choice)}
                        role="option"
                        type="button"
                      >
                        <strong>{choice.label}</strong>
                        <span>{choice.description}</span>
                      </button>
                    </Fragment>
                  );
                })}
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
                  onChange={(event) => {
                    const href = event.currentTarget.value;
                    setLinkEditor((value) =>
                      value ? { ...value, href } : value,
                    );
                  }}
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

          {canEdit && mode === "editing" && checklistForm ? (
            <form
              aria-label="Add checklist"
              className="page-checklist-create-popover"
              onSubmit={async (event) => {
                event.preventDefault();
                if (isChecklistSubmitting) return;
                const isExisting = checklistForm.mode === "existing";
                const name = checklistForm.name.trim();
                if (
                  (!isExisting && (!name || !createChecklistAction)) ||
                  (isExisting &&
                    (!checklistForm.viewKey ||
                      !checklistForm.labelField ||
                      !checklistForm.completedField))
                ) {
                  return;
                }
                setIsChecklistSubmitting(true);
                if (!(await savePage())) {
                  setMessage(
                    "Save the current Page before adding a checklist.",
                  );
                  setIsChecklistSubmitting(false);
                  return;
                }
                setStatus("saving");
                setMessage(null);
                let result;
                try {
                  result = isExisting
                    ? await applyPageBlockAction({
                        currentness: currentnessRef.current,
                        intent: {
                          action: "add_page_block",
                          afterBlockId: checklistForm.afterBlockId,
                          block: {
                            type: "view",
                            viewKey: checklistForm.viewKey!,
                            ...(checklistForm.readOnly
                              ? { readOnly: true }
                              : {}),
                            checklist: {
                              completedField: checklistForm.completedField!,
                              labelField: checklistForm.labelField!,
                            },
                          },
                          ...(checklistForm.containerBlockId
                            ? {
                                containerBlockId:
                                  checklistForm.containerBlockId,
                              }
                            : {}),
                          pageKey,
                        },
                      })
                    : await createChecklistAction!({
                        currentness: currentnessRef.current,
                        name,
                        pageKey,
                        ...(checklistForm.afterBlockId !== undefined
                          ? { afterBlockId: checklistForm.afterBlockId }
                          : {}),
                        ...(checklistForm.containerBlockId
                          ? { containerBlockId: checklistForm.containerBlockId }
                          : {}),
                      });
                } catch {
                  setStatus("error");
                  setMessage("The checklist could not be created. Try again.");
                  setIsChecklistSubmitting(false);
                  return;
                }
                if (result.status !== "success") {
                  setStatus(result.status === "stale" ? "stale" : "error");
                  setMessage(result.message);
                  setIsChecklistSubmitting(false);
                  return;
                }
                currentnessRef.current = result.currentness;
                setCurrentnessCandidate(result.currentness);
                acknowledgedDraftRef.current = {
                  layout: withEditorBlockIds(result.layout),
                  title: result.title,
                };
                candidateRef.current = acknowledgedDraftRef.current;
                saveCoordinatorRef.current?.acknowledge(
                  acknowledgedDraftRef.current,
                );
                bodyDirtyRef.current = false;
                setBodyDirty(false);
                setChecklistForm(null);
                setStatus("saved");
                setIsChecklistSubmitting(false);
                router.refresh();
              }}
              role="dialog"
            >
              <strong>
                {checklistForm.mode === "existing"
                  ? "Use an existing Table"
                  : "Create a live checklist"}
              </strong>
              <p>Items stay shared with the rest of your workspace.</p>
              {checklistForm.mode === "create" ? (
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
              ) : (
                <>
                  <label>
                    <span>Table or saved View</span>
                    <select
                      aria-label="Checklist Table"
                      autoFocus
                      onChange={(event) => {
                        const viewKey = event.currentTarget.value;
                        const view = availableViews.find(
                          (candidate) => candidate.key === viewKey,
                        );
                        const textField = view?.checklistFields?.find(
                          (field) => field.kind === "text",
                        );
                        const booleanField = view?.checklistFields?.find(
                          (field) => field.kind === "boolean",
                        );
                        setChecklistForm((value) =>
                          value
                            ? {
                                ...value,
                                completedField: booleanField?.key,
                                labelField: textField?.key,
                                viewKey,
                              }
                            : value,
                        );
                      }}
                      value={checklistForm.viewKey ?? ""}
                    >
                      <option disabled value="">
                        Choose a Table
                      </option>
                      {checklistViews.map((view) => (
                        <option key={view.key} value={view.key}>
                          {view.tableName ?? view.name} · {view.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {checklistViews.length === 0 ? (
                    <p role="status">
                      No saved Table has both a text item field and a boolean
                      completion field.
                    </p>
                  ) : null}
                  {(() => {
                    const view = availableViews.find(
                      (candidate) => candidate.key === checklistForm.viewKey,
                    );
                    const fields = view?.checklistFields ?? [];
                    return (
                      <>
                        <label>
                          <span>Item label</span>
                          <select
                            aria-label="Checklist label field"
                            onChange={(event) => {
                              const labelField = event.currentTarget.value;
                              setChecklistForm((value) =>
                                value
                                  ? {
                                      ...value,
                                      labelField,
                                    }
                                  : value,
                              );
                            }}
                            value={checklistForm.labelField ?? ""}
                          >
                            {fields
                              .filter((field) => field.kind === "text")
                              .map((field) => (
                                <option key={field.key} value={field.key}>
                                  {field.label}
                                  {field.editable === false
                                    ? " · read-only"
                                    : ""}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          <span>Completion field</span>
                          <select
                            aria-label="Checklist completion field"
                            onChange={(event) => {
                              const completedField = event.currentTarget.value;
                              setChecklistForm((value) =>
                                value
                                  ? {
                                      ...value,
                                      completedField,
                                    }
                                  : value,
                              );
                            }}
                            value={checklistForm.completedField ?? ""}
                          >
                            {fields
                              .filter((field) => field.kind === "boolean")
                              .map((field) => (
                                <option key={field.key} value={field.key}>
                                  {field.label}
                                  {field.editable === false
                                    ? " · read-only"
                                    : ""}
                                </option>
                              ))}
                          </select>
                        </label>
                      </>
                    );
                  })()}
                  <label className="page-checklist-readonly-choice">
                    <input
                      checked={checklistForm.readOnly === true}
                      onChange={(event) => {
                        const readOnly = event.currentTarget.checked;
                        setChecklistForm((value) =>
                          value
                            ? {
                                ...value,
                                readOnly,
                              }
                            : value,
                        );
                      }}
                      type="checkbox"
                    />
                    Read-only on this Page
                  </label>
                  {selectedChecklistNeedsReadOnly &&
                  checklistForm.readOnly !== true ? (
                    <p role="alert">
                      One or more selected fields are read-only in this View.
                      Mark this checklist read-only before adding it.
                    </p>
                  ) : null}
                </>
              )}
              <div className="page-editor-confirm-actions">
                <button
                  className="button button-small"
                  disabled={
                    isChecklistSubmitting ||
                    (checklistForm.mode === "create"
                      ? !checklistForm.name.trim() || !createChecklistAction
                      : !checklistForm.viewKey ||
                        !checklistForm.labelField ||
                        !checklistForm.completedField ||
                        (selectedChecklistNeedsReadOnly &&
                          checklistForm.readOnly !== true))
                  }
                  type="submit"
                >
                  {checklistForm.mode === "create"
                    ? "Create checklist"
                    : "Add existing Table"}
                </button>
                {checklistForm.mode === "create" ? (
                  <button
                    className="button button-secondary button-small"
                    onClick={() =>
                      setChecklistForm((value) =>
                        value ? checklistFormForMode(value, "existing") : value,
                      )
                    }
                    type="button"
                  >
                    Use existing Table
                  </button>
                ) : (
                  <button
                    className="button button-secondary button-small"
                    onClick={() =>
                      setChecklistForm((value) =>
                        value ? checklistFormForMode(value, "create") : value,
                      )
                    }
                    type="button"
                  >
                    Create new checklist
                  </button>
                )}
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

      {canEdit && mode === "editing" ? (
        <p className="page-editor-footer">
          Changes save automatically. Type naturally, use / for blocks, or
          select text to format it.
        </p>
      ) : null}
    </section>
  );
}
