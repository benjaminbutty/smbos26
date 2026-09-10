"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SiteDraftV1 } from "../../core/sites/schemas";

type SitePage = SiteDraftV1["pages"][number];
type SiteBlock = SitePage["layout"]["blocks"][number];
type SaveAction = (formData: FormData) => void | Promise<void>;

type FileFieldOption = { id: string; key: string };
type FieldOption = { id: string; key: string; fieldType: string };
type RecordOption = {
  id: string;
  label: string;
  objectDefinitionId: string;
  recordRevision: number;
  attachments: Record<string, number>;
};
type ObjectOption = {
  id: string;
  key: string;
  fieldOptions: FieldOption[];
  fields: string[];
  fileFields: FileFieldOption[];
  records: RecordOption[];
};

type UnknownRecord = Record<string, unknown>;
type SiteFilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "is_empty"
  | "is_not_empty";

const noValueFilterOperators = new Set<SiteFilterOperator>([
  "is_empty",
  "is_not_empty",
]);

function filterOperatorsForField(
  fieldType: string | undefined,
): SiteFilterOperator[] {
  if (fieldType === "number" || fieldType === "currency") {
    return [
      "is_not_empty",
      "is_empty",
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
      "is",
      "is_not",
    ];
  }
  return [
    "is_not_empty",
    "is_empty",
    "contains",
    "does_not_contain",
    "is",
    "is_not",
  ];
}

function defaultFilterValue(
  operator: SiteFilterOperator,
  fieldType: string | undefined,
): string | number | boolean | undefined {
  if (noValueFilterOperators.has(operator)) return undefined;
  if (fieldType === "number" || fieldType === "currency") return 0;
  if (fieldType === "boolean") return false;
  return "";
}

function filterOperatorLabel(operator: SiteFilterOperator): string {
  return operator
    .replaceAll("_", " ")
    .replace(/^is not empty$/, "is not empty")
    .replace(/^is empty$/, "is empty");
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function blockLabel(block: SiteBlock): string {
  const value = asRecord(block);
  if (typeof value.text === "string" && value.text.trim()) return value.text;
  if (typeof value.summary === "string" && value.summary.trim())
    return value.summary;
  if (typeof value.object_key === "string") return value.object_key;
  return block.type.replaceAll("_", " ");
}

function copyDraft(draft: SiteDraftV1): SiteDraftV1 {
  return structuredClone(draft);
}

function newBlock(
  type: "heading" | "text" | "callout" | "button" | "divider",
): SiteBlock {
  const id = crypto.randomUUID();
  if (type === "heading") {
    return { type, id, text: "New heading", level: 2 } as SiteBlock;
  }
  if (type === "text")
    return { type, id, text: "Write something useful." } as SiteBlock;
  if (type === "callout") {
    return {
      type,
      id,
      text: "A helpful note for visitors.",
      tone: "info",
    } as SiteBlock;
  }
  if (type === "button") {
    return {
      type,
      id,
      label: "Learn more",
      href: "https://example.com",
      style: "primary",
    } as SiteBlock;
  }
  return { type, id } as SiteBlock;
}

function newImageBlock(): SiteBlock {
  return {
    type: "image",
    id: crypto.randomUUID(),
    alt: "",
    draft_state: "incomplete",
  } as SiteBlock;
}

function newGalleryBlock(): SiteBlock {
  return {
    type: "gallery",
    id: crypto.randomUUID(),
    images: [],
    presentation: "grid",
    draft_state: "incomplete",
  } as SiteBlock;
}

function newCollapsibleBlock(): SiteBlock {
  return {
    type: "collapsible",
    id: crypto.randomUUID(),
    summary: "More information",
    open: false,
    draft_state: "complete",
    blocks: [newBlock("text")],
  } as SiteBlock;
}

function pageWithDefaults(index: number, isHome: boolean): SitePage {
  const pageId = crypto.randomUUID();
  return {
    id: pageId,
    title: isHome ? "Home" : `Page ${index}`,
    slug: isHome ? "home" : `page-${index}`,
    navigation_label: isHome ? "Home" : `Page ${index}`,
    is_home: isHome,
    is_in_navigation: true,
    is_included: true,
    layout: { blocks: [newBlock("heading"), newBlock("text")] },
  } as SitePage;
}

export function SiteComposer({
  businessSlug,
  draft: initialDraft,
  draftRevision,
  objectOptions,
  saveAction,
  siteId,
}: Readonly<{
  businessSlug: string;
  draft: SiteDraftV1;
  draftRevision: number;
  objectOptions: ObjectOption[];
  saveAction: SaveAction;
  siteId: string;
}>): ReactNode {
  const [draft, setDraft] = useState<SiteDraftV1>(() =>
    copyDraft(initialDraft),
  );
  const [, setRevision] = useState(draftRevision);
  const [undoStack, setUndoStack] = useState<SiteDraftV1[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [attachmentRevisions, setAttachmentRevisions] = useState<
    Record<string, number>
  >({});
  const [recordRevisions, setRecordRevisions] = useState<
    Record<string, number>
  >({});
  const autosaveReady = useRef(false);
  const revisionRef = useRef(draftRevision);
  const autosaveQueue = useRef(Promise.resolve());
  const autosaveTimer = useRef<number | null>(null);
  const explicitSavePending = useRef(false);

  const cancelAutosaveTimer = useCallback(() => {
    if (autosaveTimer.current === null) return;
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  }, []);

  const queueDraftSave = useCallback(
    (draftToSave: SiteDraftV1, failureMessage: string): Promise<boolean> => {
      const queued = autosaveQueue.current.then(async () => {
        try {
          const response = await fetch(
            `/api/app/${encodeURIComponent(businessSlug)}/sites/draft`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                siteId,
                expectedDraftRevision: revisionRef.current,
                draft: draftToSave,
              }),
            },
          );
          if (!response.ok) {
            setMessage(
              response.status === 409
                ? "This draft changed elsewhere. Reload before continuing."
                : failureMessage,
            );
            return false;
          }
          const result: unknown = await response.json().catch(() => null);
          const nextRevision = asRecord(result).draftRevision;
          if (typeof nextRevision === "number") {
            revisionRef.current = nextRevision;
            setRevision(nextRevision);
          }
          return true;
        } catch {
          setMessage(failureMessage);
          return false;
        }
      });
      autosaveQueue.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [businessSlug, siteId],
  );

  useEffect(() => {
    if (!autosaveReady.current) {
      autosaveReady.current = true;
      return;
    }
    const draftToSave = copyDraft(draft);
    const timeout = window.setTimeout(() => {
      autosaveTimer.current = null;
      void queueDraftSave(
        draftToSave,
        "Draft autosave failed. Use Save draft to try again.",
      );
    }, 900);
    autosaveTimer.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (autosaveTimer.current === timeout) autosaveTimer.current = null;
    };
  }, [businessSlug, draft, queueDraftSave, siteId]);

  async function submitExplicitSave(event: FormEvent<HTMLFormElement>) {
    if (explicitSavePending.current) {
      explicitSavePending.current = false;
      return;
    }
    const form = event.currentTarget;
    event.preventDefault();
    explicitSavePending.current = true;
    cancelAutosaveTimer();
    await autosaveQueue.current;
    if (!form.isConnected) {
      explicitSavePending.current = false;
      return;
    }
    form.requestSubmit();
  }

  function commit(next: SiteDraftV1): void {
    setUndoStack((previous) => [...previous.slice(-19), copyDraft(draft)]);
    setDraft(next);
    setMessage(null);
  }

  function updatePage(pageId: string, update: (page: SitePage) => void): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    update(page);
    commit(next);
  }

  function updateBlock(
    pageId: string,
    blockId: string,
    update: (block: UnknownRecord) => void,
  ): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    const blocks = page ? findBlockList(page.layout.blocks, blockId) : null;
    const block = blocks?.find(
      (candidate) => asRecord(candidate).id === blockId,
    );
    if (!page || !blocks || !block) return;
    update(asRecord(block));
    commit(next);
  }

  function movePage(pageId: string, offset: -1 | 1): void {
    const next = copyDraft(draft);
    const index = next.pages.findIndex((page) => page.id === pageId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= next.pages.length) return;
    [next.pages[index], next.pages[target]] = [
      next.pages[target]!,
      next.pages[index]!,
    ];
    commit(next);
  }

  function removePage(pageId: string): void {
    if (draft.pages.length <= 1) {
      setMessage("Keep at least one Page in the Site draft.");
      return;
    }
    const page = draft.pages.find((candidate) => candidate.id === pageId);
    if (!page || page.is_home) {
      setMessage("Choose another Home Page before removing this Page.");
      return;
    }
    const next = copyDraft(draft);
    next.pages = next.pages.filter((candidate) => candidate.id !== pageId);
    for (const candidate of next.pages) {
      clearDetailPageReferences(candidate.layout.blocks, pageId);
    }
    commit(next);
  }

  function setHome(pageId: string): void {
    const next = copyDraft(draft);
    nextHome(next, pageId);
    commit(next);
  }

  function moveBlock(pageId: string, blockId: string, offset: -1 | 1): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    const blocks = page ? findBlockList(page.layout.blocks, blockId) : null;
    const index =
      blocks?.findIndex((candidate) => asRecord(candidate).id === blockId) ??
      -1;
    const target = index + offset;
    if (!blocks || index < 0 || target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    commit(next);
  }

  function duplicateBlock(pageId: string, blockId: string): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    const blocks = page ? findBlockList(page.layout.blocks, blockId) : null;
    const index =
      blocks?.findIndex((candidate) => asRecord(candidate).id === blockId) ??
      -1;
    if (!page || !blocks || index < 0) return;
    const duplicate = cloneBlockWithNewIds(blocks[index]!);
    blocks.splice(index + 1, 0, duplicate);
    commit(next);
  }

  function removeBlock(pageId: string, blockId: string): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    const blocks = page ? findBlockList(page.layout.blocks, blockId) : null;
    const index =
      blocks?.findIndex((candidate) => asRecord(candidate).id === blockId) ??
      -1;
    if (!page || !blocks || index < 0) return;
    blocks.splice(index, 1);
    commit(next);
  }

  function addBlock(pageId: string, block: SiteBlock): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    page.layout.blocks.push(block);
    commit(next);
  }

  function addCollection(pageId: string): void {
    const option = objectOptions[0];
    if (!option) {
      setMessage("Create a Record type before adding a collection.");
      return;
    }
    addBlock(pageId, {
      type: "collection",
      id: crypto.randomUUID(),
      object_key: option.key,
      selection: { schema_version: 1, record_ids: [] },
      public_field_keys: option.fields.slice(0, 3),
      presentation: "cards",
      draft_state: option.fields.length > 0 ? "complete" : "incomplete",
    } as SiteBlock);
  }

  function addImage(pageId: string): void {
    addBlock(pageId, newImageBlock());
  }

  function addGallery(pageId: string): void {
    addBlock(pageId, newGalleryBlock());
  }

  function addCollapsible(pageId: string): void {
    addBlock(pageId, newCollapsibleBlock());
  }

  function addRecordDetail(pageId: string): void {
    const collection = findCollectionForDetailPage(draft, pageId);
    if (!collection || typeof collection.id !== "string") {
      setMessage("Choose this Page as a collection's detail Page first.");
      return;
    }
    const fields = Array.isArray(collection.public_field_keys)
      ? collection.public_field_keys.filter(
          (field): field is string => typeof field === "string",
        )
      : [];
    if (fields.length === 0) {
      setMessage("Choose public Properties before adding a detail layout.");
      return;
    }
    addBlock(pageId, {
      type: "record_detail",
      id: crypto.randomUUID(),
      collection_block_id: collection.id,
      public_field_keys: fields.slice(0, 10),
    } as SiteBlock);
  }

  function appendNestedBlock(
    pageId: string,
    containerId: string,
    block: SiteBlock,
    columnIndex?: number,
  ): void {
    updateBlock(pageId, containerId, (container) => {
      if (typeof columnIndex === "number" && container.type === "section") {
        const columns = Array.isArray(container.columns)
          ? container.columns.map((column) => asRecord(column))
          : [];
        const column = columns[columnIndex];
        if (!column) return;
        column.blocks = [
          ...(Array.isArray(column.blocks) ? column.blocks : []),
          block,
        ];
        container.columns = columns;
        return;
      }
      if (container.type === "collapsible") {
        container.blocks = [
          ...(Array.isArray(container.blocks) ? container.blocks : []),
          block,
        ];
      }
    });
  }

  function updateCollectionOption(
    pageId: string,
    blockId: string,
    objectKey: string,
  ): void {
    const option = objectOptions.find(
      (candidate) => candidate.key === objectKey,
    );
    if (!option) return;
    updateBlock(pageId, blockId, (block) => {
      block.object_key = option.key;
      block.public_field_keys = option.fields.slice(0, 3);
      block.selection = { schema_version: 1, record_ids: [] };
      delete block.filter;
      block.draft_state = option.fields.length > 0 ? "complete" : "incomplete";
    });
  }

  function toggleCollectionRecord(
    pageId: string,
    blockId: string,
    recordId: string,
    selected: boolean,
  ): void {
    updateBlock(pageId, blockId, (block) => {
      const selection = asRecord(block.selection);
      const current = Array.isArray(selection.record_ids)
        ? selection.record_ids.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const nextIds = selected
        ? [...new Set([...current, recordId])]
        : current.filter((value) => value !== recordId);
      block.selection = { schema_version: 1, record_ids: nextIds };
    });
  }

  function toggleCollectionField(
    pageId: string,
    blockId: string,
    fieldKey: string,
    selected: boolean,
  ): void {
    updateBlock(pageId, blockId, (block) => {
      const current = Array.isArray(block.public_field_keys)
        ? block.public_field_keys.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const next = selected
        ? [...new Set([...current, fieldKey])]
        : current.filter((value) => value !== fieldKey);
      const nextFieldKeys = next.slice(0, 50);
      block.public_field_keys = nextFieldKeys;
      if (nextFieldKeys.length > 0 && block.object_key) {
        delete block.draft_state;
      } else {
        block.draft_state = "incomplete";
      }
    });
  }

  function setCollectionDetailPage(
    pageId: string,
    blockId: string,
    detailPageId: string,
  ): void {
    updateBlock(pageId, blockId, (block) => {
      if (detailPageId) block.detail_page_id = detailPageId;
      else delete block.detail_page_id;
    });
  }

  function setCollectionFilter(
    pageId: string,
    blockId: string,
    fieldKey: string,
    operator: SiteFilterOperator = "is_not_empty",
    fieldType?: string,
  ): void {
    updateBlock(pageId, blockId, (block) => {
      if (!fieldKey) {
        delete block.filter;
        return;
      }
      const filterValue = defaultFilterValue(operator, fieldType);
      const nextFilter = {
        field_key: fieldKey,
        operator,
        ...(filterValue !== undefined ? { value: filterValue } : {}),
      };
      const current = asRecord(block.filter);
      const sorts = Array.isArray(current.sorts) ? current.sorts : [];
      block.filter = {
        schema_version: 1,
        filters: [nextFilter],
        filter_match: "all",
        sorts,
      };
    });
  }

  function setCollectionFilterValue(
    pageId: string,
    blockId: string,
    fieldKey: string,
    operator: SiteFilterOperator,
    fieldType: string | undefined,
    rawValue: string,
  ): void {
    updateBlock(pageId, blockId, (block) => {
      const current = asRecord(block.filter);
      const filters = Array.isArray(current.filters)
        ? current.filters.map((item) => asRecord(item))
        : [];
      const parsedValue =
        fieldType === "number" || fieldType === "currency"
          ? Number.isFinite(Number(rawValue))
            ? Number(rawValue)
            : 0
          : fieldType === "boolean"
            ? rawValue === "true"
            : rawValue;
      const nextFilter = {
        field_key: fieldKey,
        operator,
        value: parsedValue,
      };
      block.filter = {
        schema_version: 1,
        filters: [nextFilter, ...filters.slice(1)],
        filter_match: current.filter_match === "any" ? "any" : "all",
        sorts: Array.isArray(current.sorts) ? current.sorts : [],
      };
    });
  }

  function setCollectionSort(
    pageId: string,
    blockId: string,
    fieldKey: string,
    direction: "ascending" | "descending",
  ): void {
    updateBlock(pageId, blockId, (block) => {
      const current = asRecord(block.filter);
      const filters = Array.isArray(current.filters) ? current.filters : [];
      const filterMatch =
        current.filter_match === "any" ? "any" : ("all" as const);
      if (!fieldKey) {
        if (filters.length === 0) delete block.filter;
        else {
          block.filter = {
            schema_version: 1,
            filters,
            filter_match: filterMatch,
            sorts: [],
          };
        }
        return;
      }
      block.filter = {
        schema_version: 1,
        filters,
        filter_match: filterMatch,
        sorts: [{ field_key: fieldKey, direction }],
      };
    });
  }

  function setSectionColumns(
    pageId: string,
    blockId: string,
    columnCount: 1 | 2 | 3,
  ): void {
    updateBlock(pageId, blockId, (block) => {
      const currentColumns = Array.isArray(block.columns)
        ? block.columns.map((column) => asRecord(column))
        : [];
      while (currentColumns.length < columnCount) {
        currentColumns.push({ blocks: [] });
      }
      if (currentColumns.length > columnCount) {
        const retained = currentColumns.slice(0, columnCount);
        const lastColumn = retained[columnCount - 1]!;
        const movedBlocks = currentColumns
          .slice(columnCount)
          .flatMap((column) =>
            Array.isArray(column.blocks) ? column.blocks : [],
          );
        lastColumn.blocks = [
          ...(Array.isArray(lastColumn.blocks) ? lastColumn.blocks : []),
          ...movedBlocks,
        ];
        block.columns = retained;
      } else {
        block.columns = currentColumns;
      }
    });
  }

  function addSection(pageId: string, columnCount: 1 | 2 | 3 = 2): void {
    const columns = Array.from({ length: columnCount }, (_, index) => ({
      blocks:
        index === 0
          ? [
              newBlock("heading"),
              ...(columnCount === 1 ? [newBlock("text")] : []),
            ]
          : index === 1
            ? [newBlock("text")]
            : [],
    }));
    addBlock(pageId, {
      type: "section",
      id: crypto.randomUUID(),
      width: "content",
      columns,
    } as SiteBlock);
  }

  async function uploadManagedAsset(file: File): Promise<string | null> {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(
      `/api/app/${encodeURIComponent(businessSlug)}/pages/assets`,
      { method: "POST", body },
    );
    const result: unknown = await response.json().catch(() => null);
    const value = asRecord(result);
    return response.ok && typeof value.assetId === "string"
      ? value.assetId
      : null;
  }

  async function uploadImage(
    event: FormEvent<HTMLInputElement>,
    pageId: string,
    blockId: string,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setMessage("Uploading image…");
    const assetId = await uploadManagedAsset(file);
    if (!assetId) {
      setMessage("The image could not be uploaded.");
      return;
    }
    updateBlock(pageId, blockId, (block) => {
      block.asset_id = assetId;
      block.alt =
        typeof block.alt === "string" && block.alt.trim()
          ? block.alt
          : file.name;
      block.draft_state = "complete";
    });
    setMessage("Image uploaded. Save the Site draft to keep it.");
  }

  async function uploadGalleryImage(
    event: FormEvent<HTMLInputElement>,
    pageId: string,
    blockId: string,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setMessage("Uploading gallery image…");
    const assetId = await uploadManagedAsset(file);
    if (!assetId) {
      setMessage("The gallery image could not be uploaded.");
      return;
    }
    updateBlock(pageId, blockId, (block) => {
      const images = Array.isArray(block.images) ? block.images : [];
      block.images = [
        ...images,
        { asset_id: assetId, alt: file.name, draft_state: "complete" },
      ];
      block.draft_state = "complete";
    });
    setMessage("Gallery image uploaded. Save the Site draft to keep it.");
  }

  async function uploadRecordImage(
    event: FormEvent<HTMLInputElement>,
    record: RecordOption,
    field: FileFieldOption,
    siteIdValue: string,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setMessage("Saving the Site draft before attaching the Record image…");
    if (
      !(await queueDraftSave(
        copyDraft(draft),
        "The Site draft could not be saved before attaching the Record image.",
      ))
    ) {
      return;
    }
    setMessage(`Uploading ${field.key} for ${record.label}…`);
    const assetId = await uploadManagedAsset(file);
    if (!assetId) {
      setMessage("The Record image could not be uploaded.");
      return;
    }
    const attachmentKey = `${record.id}:${field.id}`;
    const expectedAttachmentRevision =
      attachmentRevisions[attachmentKey] ?? record.attachments[field.id] ?? 0;
    const response = await fetch(
      `/api/app/${encodeURIComponent(businessSlug)}/sites/record-media`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: siteIdValue,
          recordId: record.id,
          objectDefinitionId: record.objectDefinitionId,
          fieldDefinitionId: field.id,
          assetId,
          expectedRecordRevision:
            recordRevisions[record.id] ?? record.recordRevision,
          expectedAttachmentRevision,
        }),
      },
    );
    if (!response.ok) {
      setMessage(
        response.status === 409
          ? "That Record changed elsewhere. Reload before adding its image."
          : "The Record image could not be attached.",
      );
      return;
    }
    const result: unknown = await response.json().catch(() => null);
    const nextAttachmentRevision = asRecord(result).attachmentRevision;
    if (typeof nextAttachmentRevision === "number") {
      setAttachmentRevisions((previous) => ({
        ...previous,
        [attachmentKey]: nextAttachmentRevision,
      }));
    }
    const nextRecordRevision = asRecord(result).recordRevision;
    if (typeof nextRecordRevision === "number") {
      setRecordRevisions((previous) => ({
        ...previous,
        [record.id]: nextRecordRevision,
      }));
    }
    setMessage("Record image attached for the next reviewed release.");
  }

  function undo(): void {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setDraft(previous);
    setMessage(null);
  }

  return (
    <div className="site-composer">
      <div className="site-composer-toolbar">
        <div>
          <p className="eyebrow">Site builder</p>
          <h2>Shape the customer-facing Site</h2>
          <p className="muted">
            Incomplete work autosaves as you shape it. Publish always uses the
            reviewed candidate.
          </p>
        </div>
        <div className="site-composer-toolbar-actions">
          <button
            disabled={undoStack.length === 0}
            onClick={undo}
            type="button"
          >
            Undo
          </button>
          <form action={saveAction} onSubmit={submitExplicitSave}>
            <input name="siteId" type="hidden" value={siteId} />
            <input
              name="expectedDraftRevision"
              type="hidden"
              value={revisionRef.current}
            />
            <input name="draft" type="hidden" value={JSON.stringify(draft)} />
            <button type="submit">Save draft</button>
          </form>
        </div>
      </div>
      {message ? <p className="notice notice-message">{message}</p> : null}

      <section
        className="panel site-composer-branding"
        aria-label="Site branding"
      >
        <h3>Branding</h3>
        <div className="site-composer-fields">
          <label>
            Site name
            <input
              value={draft.branding.name}
              onChange={(event) => {
                const next = copyDraft(draft);
                next.branding.name = event.target.value;
                commit(next);
              }}
            />
          </label>
          <label>
            Accent
            <select
              value={draft.branding.accent}
              onChange={(event) => {
                const next = copyDraft(draft);
                next.branding.accent = event.target
                  .value as SiteDraftV1["branding"]["accent"];
                commit(next);
              }}
            >
              {(["coral", "clay", "forest", "ocean", "plum"] as const).map(
                (accent) => (
                  <option key={accent} value={accent}>
                    {accent}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Site logo
            <input
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                setMessage("Uploading Site logo…");
                void uploadManagedAsset(file).then((assetId) => {
                  if (!assetId) {
                    setMessage("The Site logo could not be uploaded.");
                    return;
                  }
                  const next = copyDraft(draft);
                  next.branding.logo_asset_id = assetId;
                  commit(next);
                  setMessage(
                    "Site logo uploaded. Save the Site draft to keep it.",
                  );
                });
              }}
              type="file"
            />
            {draft.branding.logo_asset_id ? (
              <button
                onClick={() => {
                  const next = copyDraft(draft);
                  delete next.branding.logo_asset_id;
                  commit(next);
                }}
                type="button"
              >
                Remove logo
              </button>
            ) : null}
          </label>
        </div>
      </section>

      <div className="site-composer-pages">
        {draft.pages.map((page, pageIndex) => (
          <article className="panel site-composer-page" key={page.id}>
            <header className="site-composer-page-header">
              <div>
                <p className="eyebrow">Page {pageIndex + 1}</p>
                <h3>{page.title || "Untitled Page"}</h3>
              </div>
              <div className="site-composer-inline-actions">
                <button
                  disabled={pageIndex === 0}
                  onClick={() => movePage(page.id, -1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  disabled={pageIndex === draft.pages.length - 1}
                  onClick={() => movePage(page.id, 1)}
                  type="button"
                >
                  ↓
                </button>
                <button
                  disabled={page.is_home || draft.pages.length <= 1}
                  onClick={() => removePage(page.id)}
                  type="button"
                >
                  Remove Page
                </button>
              </div>
            </header>
            <div className="site-composer-fields">
              <label>
                Title
                <input
                  value={page.title}
                  onChange={(event) =>
                    updatePage(page.id, (value) => {
                      value.title = event.target.value;
                    })
                  }
                />
              </label>
              <label>
                Address
                <input
                  value={page.slug}
                  onChange={(event) =>
                    updatePage(page.id, (value) => {
                      value.slug = event.target.value;
                    })
                  }
                />
              </label>
              <label>
                Navigation label
                <input
                  value={page.navigation_label}
                  onChange={(event) =>
                    updatePage(page.id, (value) => {
                      value.navigation_label = event.target.value;
                    })
                  }
                />
              </label>
            </div>
            <div className="site-composer-toggles">
              <label>
                <input
                  checked={page.is_home}
                  onChange={() => setHome(page.id)}
                  type="checkbox"
                />{" "}
                Home
              </label>
              <label>
                <input
                  checked={page.is_in_navigation}
                  onChange={(event) =>
                    updatePage(page.id, (value) => {
                      value.is_in_navigation = event.target.checked;
                    })
                  }
                  type="checkbox"
                />{" "}
                Show in navigation
              </label>
              <label>
                <input
                  checked={page.is_included}
                  onChange={(event) =>
                    updatePage(page.id, (value) => {
                      value.is_included = event.target.checked;
                    })
                  }
                  type="checkbox"
                />{" "}
                Include in Site
              </label>
            </div>
            <div className="site-composer-blocks">
              {page.layout.blocks.map((block, blockIndex) => {
                const value = asRecord(block);
                const id =
                  typeof value.id === "string"
                    ? value.id
                    : `${page.id}-${blockIndex}`;
                const collectionOption =
                  block.type === "collection"
                    ? objectOptions.find(
                        (option) => option.key === value.object_key,
                      )
                    : undefined;
                const collectionFileFields = collectionOption?.fileFields ?? [];
                const selectionValue = asRecord(value.selection);
                const selectedRecordIds = new Set(
                  block.type === "collection" &&
                    Array.isArray(selectionValue.record_ids)
                    ? selectionValue.record_ids.filter(
                        (recordId): recordId is string =>
                          typeof recordId === "string",
                      )
                    : [],
                );
                const filterValue =
                  block.type === "collection" ? asRecord(value.filter) : {};
                const filterItems = Array.isArray(filterValue.filters)
                  ? filterValue.filters
                  : [];
                const firstFilter = asRecord(filterItems[0]);
                const filterField =
                  filterItems.length > 0
                    ? asRecord(filterItems[0]).field_key
                    : "";
                const filterFieldOption =
                  typeof filterField === "string"
                    ? collectionOption?.fieldOptions.find(
                        (field) => field.key === filterField,
                      )
                    : undefined;
                const filterFieldType = filterFieldOption?.fieldType;
                const filterOperator =
                  filterOperatorsForField(filterFieldType).find(
                    (operator) => operator === firstFilter.operator,
                  ) ?? "is_not_empty";
                const filterRawValue = firstFilter.value;
                const sortItems = Array.isArray(filterValue.sorts)
                  ? filterValue.sorts
                  : [];
                const firstSort = asRecord(sortItems[0]);
                const sortField =
                  typeof firstSort.field_key === "string"
                    ? firstSort.field_key
                    : "";
                const sortDirection =
                  firstSort.direction === "descending"
                    ? "descending"
                    : "ascending";
                return (
                  <div className="site-composer-block" key={id}>
                    <div className="site-composer-block-header">
                      <strong>{blockLabel(block)}</strong>
                      <div className="site-composer-inline-actions">
                        <button
                          disabled={blockIndex === 0}
                          onClick={() => moveBlock(page.id, id, -1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          disabled={
                            blockIndex === page.layout.blocks.length - 1
                          }
                          onClick={() => moveBlock(page.id, id, 1)}
                          type="button"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => duplicateBlock(page.id, id)}
                          type="button"
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => removeBlock(page.id, id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {block.type === "heading" ? (
                      <input
                        value={typeof value.text === "string" ? value.text : ""}
                        onChange={(event) =>
                          updateBlock(page.id, id, (item) => {
                            item.text = event.target.value;
                            if (event.target.value.trim()) {
                              delete item.draft_state;
                            } else {
                              item.draft_state = "incomplete";
                            }
                          })
                        }
                      />
                    ) : null}
                    {block.type === "text" || block.type === "callout" ? (
                      <textarea
                        value={typeof value.text === "string" ? value.text : ""}
                        onChange={(event) =>
                          updateBlock(page.id, id, (item) => {
                            item.text = event.target.value;
                            if (event.target.value.trim()) {
                              delete item.draft_state;
                            } else {
                              item.draft_state = "incomplete";
                            }
                          })
                        }
                      />
                    ) : null}
                    {block.type === "button" ? (
                      <div className="site-composer-media-fields">
                        <label>
                          Button label
                          <input
                            value={
                              typeof value.label === "string" ? value.label : ""
                            }
                            onChange={(event) =>
                              updateBlock(page.id, id, (item) => {
                                item.label = event.target.value;
                                if (event.target.value.trim()) {
                                  delete item.draft_state;
                                } else {
                                  item.draft_state = "incomplete";
                                }
                              })
                            }
                          />
                        </label>
                        <label>
                          Button link
                          <input
                            value={
                              typeof value.href === "string" ? value.href : ""
                            }
                            onChange={(event) =>
                              updateBlock(page.id, id, (item) => {
                                item.href = event.target.value;
                                if (event.target.value.trim()) {
                                  delete item.draft_state;
                                } else {
                                  item.draft_state = "incomplete";
                                }
                              })
                            }
                          />
                        </label>
                        <label>
                          Style
                          <select
                            value={
                              value.style === "secondary"
                                ? "secondary"
                                : "primary"
                            }
                            onChange={(event) =>
                              updateBlock(page.id, id, (item) => {
                                item.style = event.target.value;
                              })
                            }
                          >
                            <option value="primary">Primary</option>
                            <option value="secondary">Secondary</option>
                          </select>
                        </label>
                      </div>
                    ) : null}
                    {block.type === "image" ? (
                      <div className="site-composer-media-fields">
                        <label>
                          Image description
                          <input
                            value={
                              typeof value.alt === "string" ? value.alt : ""
                            }
                            onChange={(event) =>
                              updateBlock(page.id, id, (item) => {
                                item.alt = event.target.value;
                                item.draft_state =
                                  event.target.value.trim() && item.asset_id
                                    ? "complete"
                                    : "incomplete";
                              })
                            }
                          />
                        </label>
                        <label>
                          Choose managed image
                          <input
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              void uploadImage(event, page.id, id);
                            }}
                            type="file"
                          />
                        </label>
                      </div>
                    ) : null}
                    {block.type === "gallery" ? (
                      <div className="site-composer-media-fields">
                        <label>
                          Add managed gallery image
                          <input
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              void uploadGalleryImage(event, page.id, id);
                            }}
                            type="file"
                          />
                        </label>
                        <span className="muted">
                          {Array.isArray(value.images)
                            ? `${value.images.length} image${value.images.length === 1 ? "" : "s"}`
                            : "No images yet"}
                        </span>
                      </div>
                    ) : null}
                    {block.type === "collection" ? (
                      <div className="site-composer-collection-fields">
                        <label>
                          Record type
                          <select
                            value={
                              typeof value.object_key === "string"
                                ? value.object_key
                                : ""
                            }
                            onChange={(event) =>
                              updateCollectionOption(
                                page.id,
                                id,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">Choose a Record type</option>
                            {objectOptions.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.key}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Detail Page
                          <select
                            value={
                              typeof value.detail_page_id === "string"
                                ? value.detail_page_id
                                : ""
                            }
                            onChange={(event) =>
                              setCollectionDetailPage(
                                page.id,
                                id,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">No shared detail Page</option>
                            {draft.pages.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.title || "Untitled Page"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Presentation
                          <select
                            value={
                              value.presentation === "list" ||
                              value.presentation === "table"
                                ? value.presentation
                                : "cards"
                            }
                            onChange={(event) =>
                              updateBlock(page.id, id, (item) => {
                                item.presentation =
                                  event.target.value === "list" ||
                                  event.target.value === "table"
                                    ? event.target.value
                                    : "cards";
                              })
                            }
                          >
                            <option value="cards">Cards</option>
                            <option value="list">List</option>
                            <option value="table">Table</option>
                          </select>
                        </label>
                        <fieldset className="site-composer-field-allowlist">
                          <legend>Public Properties</legend>
                          {(collectionOption?.fieldOptions ?? []).map(
                            (field) => (
                              <label key={field.id}>
                                <input
                                  checked={
                                    Array.isArray(value.public_field_keys) &&
                                    value.public_field_keys.includes(field.key)
                                  }
                                  onChange={(event) =>
                                    toggleCollectionField(
                                      page.id,
                                      id,
                                      field.key,
                                      event.target.checked,
                                    )
                                  }
                                  type="checkbox"
                                />{" "}
                                {field.key}
                              </label>
                            ),
                          )}
                        </fieldset>
                        <label>
                          Filter to Records with
                          <select
                            value={
                              typeof filterField === "string" ? filterField : ""
                            }
                            onChange={(event) =>
                              setCollectionFilter(
                                page.id,
                                id,
                                event.target.value,
                                "is_not_empty",
                                collectionOption?.fieldOptions.find(
                                  (field) => field.key === event.target.value,
                                )?.fieldType,
                              )
                            }
                          >
                            <option value="">All selected Records</option>
                            {(collectionOption?.fields ?? []).map((field) => (
                              <option key={field} value={field}>
                                {field} is not empty
                              </option>
                            ))}
                          </select>
                        </label>
                        {filterField ? (
                          <label>
                            Filter operator
                            <select
                              value={filterOperator}
                              onChange={(event) => {
                                const nextOperator = event.target
                                  .value as SiteFilterOperator;
                                setCollectionFilter(
                                  page.id,
                                  id,
                                  String(filterField),
                                  nextOperator,
                                  filterFieldType,
                                );
                              }}
                            >
                              {filterOperatorsForField(filterFieldType).map(
                                (operator) => (
                                  <option key={operator} value={operator}>
                                    {filterOperatorLabel(operator)}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        ) : null}
                        {filterField &&
                        !noValueFilterOperators.has(filterOperator) ? (
                          <label>
                            Filter value
                            {filterFieldType === "boolean" ? (
                              <select
                                value={
                                  filterRawValue === true ? "true" : "false"
                                }
                                onChange={(event) =>
                                  setCollectionFilterValue(
                                    page.id,
                                    id,
                                    String(filterField),
                                    filterOperator,
                                    filterFieldType,
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="true">True</option>
                                <option value="false">False</option>
                              </select>
                            ) : (
                              <input
                                inputMode={
                                  filterFieldType === "number" ||
                                  filterFieldType === "currency"
                                    ? "decimal"
                                    : undefined
                                }
                                onChange={(event) =>
                                  setCollectionFilterValue(
                                    page.id,
                                    id,
                                    String(filterField),
                                    filterOperator,
                                    filterFieldType,
                                    event.target.value,
                                  )
                                }
                                type={
                                  filterFieldType === "number" ||
                                  filterFieldType === "currency"
                                    ? "number"
                                    : "text"
                                }
                                value={
                                  typeof filterRawValue === "number" ||
                                  typeof filterRawValue === "string"
                                    ? String(filterRawValue)
                                    : ""
                                }
                              />
                            )}
                          </label>
                        ) : null}
                        <label>
                          Order Records by
                          <select
                            value={sortField}
                            onChange={(event) =>
                              setCollectionSort(
                                page.id,
                                id,
                                event.target.value,
                                sortDirection,
                              )
                            }
                          >
                            <option value="">Keep selected order</option>
                            {(collectionOption?.fields ?? []).map((field) => (
                              <option key={field} value={field}>
                                {field}
                              </option>
                            ))}
                          </select>
                        </label>
                        {sortField ? (
                          <label>
                            Direction
                            <select
                              value={sortDirection}
                              onChange={(event) =>
                                setCollectionSort(
                                  page.id,
                                  id,
                                  sortField,
                                  event.target.value === "descending"
                                    ? "descending"
                                    : "ascending",
                                )
                              }
                            >
                              <option value="ascending">Ascending</option>
                              <option value="descending">Descending</option>
                            </select>
                          </label>
                        ) : null}
                        <div className="site-composer-record-options">
                          <span className="muted">Selected Records</span>
                          {(collectionOption?.records ?? []).map((record) => (
                            <div
                              className="site-composer-record-option"
                              key={record.id}
                            >
                              <label>
                                <input
                                  checked={selectedRecordIds.has(record.id)}
                                  onChange={(event) =>
                                    toggleCollectionRecord(
                                      page.id,
                                      id,
                                      record.id,
                                      event.target.checked,
                                    )
                                  }
                                  type="checkbox"
                                />{" "}
                                {record.label}
                              </label>
                              {collectionFileFields.length > 0 ? (
                                <div className="site-composer-record-media">
                                  {collectionFileFields.map((field) => (
                                    <label key={field.id}>
                                      Record image ({field.key})
                                      <input
                                        accept="image/jpeg,image/png,image/webp"
                                        onChange={(event) => {
                                          void uploadRecordImage(
                                            event,
                                            record,
                                            field,
                                            siteId,
                                          );
                                        }}
                                        type="file"
                                      />
                                    </label>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                          {collectionOption &&
                          collectionOption.records.length > 0 &&
                          collectionFileFields.length === 0 ? (
                            <span className="muted">
                              Add a file Property to attach Record images.
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {block.type === "collapsible" ? (
                      <div className="site-composer-nested-editor">
                        <label>
                          Summary
                          <input
                            value={
                              typeof value.summary === "string"
                                ? value.summary
                                : ""
                            }
                            onChange={(event) =>
                              updateBlock(page.id, id, (item) => {
                                item.summary = event.target.value;
                                item.draft_state = event.target.value.trim()
                                  ? "complete"
                                  : "incomplete";
                              })
                            }
                          />
                        </label>
                        <label>
                          <input
                            checked={value.open !== false}
                            onChange={(event) =>
                              updateBlock(page.id, id, (item) => {
                                item.open = event.target.checked;
                              })
                            }
                            type="checkbox"
                          />{" "}
                          Open by default
                        </label>
                        <NestedSiteBlocks
                          blocks={
                            Array.isArray(value.blocks)
                              ? (value.blocks as SiteBlock[])
                              : []
                          }
                          appendBlock={appendNestedBlock}
                          containerId={id}
                          duplicateBlock={duplicateBlock}
                          moveBlock={moveBlock}
                          onUploadGalleryImage={uploadGalleryImage}
                          onUploadImage={uploadImage}
                          pageId={page.id}
                          removeBlock={removeBlock}
                          setSectionColumns={setSectionColumns}
                          updateBlock={updateBlock}
                        />
                      </div>
                    ) : null}
                    {block.type === "section" ? (
                      <div className="site-composer-nested-editor">
                        <label>
                          Columns
                          <select
                            value={
                              Array.isArray(value.columns)
                                ? Math.min(Math.max(value.columns.length, 1), 3)
                                : 1
                            }
                            onChange={(event) => {
                              const nextCount = Number(event.target.value);
                              if (
                                nextCount === 1 ||
                                nextCount === 2 ||
                                nextCount === 3
                              ) {
                                setSectionColumns(page.id, id, nextCount);
                              }
                            }}
                          >
                            <option value={1}>1 column</option>
                            <option value={2}>2 columns</option>
                            <option value={3}>3 columns</option>
                          </select>
                        </label>
                        {(Array.isArray(value.columns)
                          ? value.columns
                          : []
                        ).map((column, columnIndex) => {
                          const columnValue = asRecord(column);
                          return (
                            <div
                              className="site-composer-column-editor"
                              key={id + "-column-" + columnIndex}
                            >
                              <strong>Column {columnIndex + 1}</strong>
                              <NestedSiteBlocks
                                blocks={
                                  Array.isArray(columnValue.blocks)
                                    ? (columnValue.blocks as SiteBlock[])
                                    : []
                                }
                                appendBlock={appendNestedBlock}
                                columnIndex={columnIndex}
                                containerId={id}
                                duplicateBlock={duplicateBlock}
                                moveBlock={moveBlock}
                                onUploadGalleryImage={uploadGalleryImage}
                                onUploadImage={uploadImage}
                                pageId={page.id}
                                removeBlock={removeBlock}
                                setSectionColumns={setSectionColumns}
                                updateBlock={updateBlock}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="site-composer-add-actions">
              <button
                onClick={() => addBlock(page.id, newBlock("heading"))}
                type="button"
              >
                Add heading
              </button>
              <button
                onClick={() => addBlock(page.id, newBlock("text"))}
                type="button"
              >
                Add text
              </button>
              <button
                onClick={() => addBlock(page.id, newBlock("callout"))}
                type="button"
              >
                Add callout
              </button>
              <button
                onClick={() => addBlock(page.id, newBlock("button"))}
                type="button"
              >
                Add button
              </button>
              <button
                onClick={() => addBlock(page.id, newBlock("divider"))}
                type="button"
              >
                Add divider
              </button>
              <button onClick={() => addSection(page.id, 1)} type="button">
                Add 1-column section
              </button>
              <button onClick={() => addSection(page.id, 2)} type="button">
                Add 2-column section
              </button>
              <button onClick={() => addSection(page.id, 3)} type="button">
                Add 3-column section
              </button>
              <button onClick={() => addImage(page.id)} type="button">
                Add Site image
              </button>
              <button onClick={() => addGallery(page.id)} type="button">
                Add image gallery
              </button>
              <button onClick={() => addCollapsible(page.id)} type="button">
                Add collapsible section
              </button>
              <button onClick={() => addCollection(page.id)} type="button">
                Add Record collection
              </button>
              <button onClick={() => addRecordDetail(page.id)} type="button">
                Add shared Record detail
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="site-composer-footer-actions">
        <button
          onClick={() =>
            commit({
              ...copyDraft(draft),
              pages: [
                ...draft.pages,
                pageWithDefaults(
                  draft.pages.length + 1,
                  draft.pages.length === 0,
                ),
              ],
            })
          }
          type="button"
        >
          Add Page
        </button>
      </div>
    </div>
  );
}

type SiteBlockUpdate = (
  pageId: string,
  blockId: string,
  update: (block: UnknownRecord) => void,
) => void;
type SiteBlockMove = (pageId: string, blockId: string, offset: -1 | 1) => void;
type SiteBlockUpload = (
  event: FormEvent<HTMLInputElement>,
  pageId: string,
  blockId: string,
) => Promise<void>;

function NestedSiteBlocks({
  blocks,
  appendBlock,
  columnIndex,
  containerId,
  duplicateBlock,
  moveBlock,
  onUploadGalleryImage,
  onUploadImage,
  pageId,
  removeBlock,
  setSectionColumns,
  updateBlock,
}: Readonly<{
  blocks: SiteBlock[];
  appendBlock: (
    pageId: string,
    containerId: string,
    block: SiteBlock,
    columnIndex?: number,
  ) => void;
  columnIndex?: number;
  containerId: string;
  duplicateBlock: SiteBlockMove;
  moveBlock: SiteBlockMove;
  onUploadGalleryImage: SiteBlockUpload;
  onUploadImage: SiteBlockUpload;
  pageId: string;
  removeBlock: SiteBlockMove;
  setSectionColumns: (
    pageId: string,
    blockId: string,
    columnCount: 1 | 2 | 3,
  ) => void;
  updateBlock: SiteBlockUpdate;
}>): ReactNode {
  return (
    <div className="site-composer-nested-blocks">
      {blocks.map((block, blockIndex) => {
        const value = asRecord(block);
        const id =
          typeof value.id === "string"
            ? value.id
            : pageId + "-nested-" + blockIndex;
        return (
          <div className="site-composer-nested-block" key={id}>
            <div className="site-composer-block-header">
              <strong>{blockLabel(block)}</strong>
              <div className="site-composer-inline-actions">
                <button
                  disabled={blockIndex === 0}
                  onClick={() => moveBlock(pageId, id, -1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  disabled={blockIndex === blocks.length - 1}
                  onClick={() => moveBlock(pageId, id, 1)}
                  type="button"
                >
                  ↓
                </button>
                <button
                  onClick={() => duplicateBlock(pageId, id, 1)}
                  type="button"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => removeBlock(pageId, id, 1)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
            {block.type === "heading" ? (
              <input
                value={typeof value.text === "string" ? value.text : ""}
                onChange={(event) =>
                  updateBlock(pageId, id, (item) => {
                    item.text = event.target.value;
                    if (event.target.value.trim()) {
                      delete item.draft_state;
                    } else {
                      item.draft_state = "incomplete";
                    }
                  })
                }
              />
            ) : null}
            {block.type === "text" || block.type === "callout" ? (
              <textarea
                value={typeof value.text === "string" ? value.text : ""}
                onChange={(event) =>
                  updateBlock(pageId, id, (item) => {
                    item.text = event.target.value;
                    if (event.target.value.trim()) {
                      delete item.draft_state;
                    } else {
                      item.draft_state = "incomplete";
                    }
                  })
                }
              />
            ) : null}
            {block.type === "button" ? (
              <div className="site-composer-media-fields">
                <label>
                  Button label
                  <input
                    value={typeof value.label === "string" ? value.label : ""}
                    onChange={(event) =>
                      updateBlock(pageId, id, (item) => {
                        item.label = event.target.value;
                        if (event.target.value.trim()) {
                          delete item.draft_state;
                        } else {
                          item.draft_state = "incomplete";
                        }
                      })
                    }
                  />
                </label>
                <label>
                  Button link
                  <input
                    value={typeof value.href === "string" ? value.href : ""}
                    onChange={(event) =>
                      updateBlock(pageId, id, (item) => {
                        item.href = event.target.value;
                        if (event.target.value.trim()) {
                          delete item.draft_state;
                        } else {
                          item.draft_state = "incomplete";
                        }
                      })
                    }
                  />
                </label>
                <label>
                  Style
                  <select
                    value={
                      value.style === "secondary" ? "secondary" : "primary"
                    }
                    onChange={(event) =>
                      updateBlock(pageId, id, (item) => {
                        item.style = event.target.value;
                      })
                    }
                  >
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                  </select>
                </label>
              </div>
            ) : null}
            {block.type === "image" ? (
              <div className="site-composer-media-fields">
                <label>
                  Image description
                  <input
                    value={typeof value.alt === "string" ? value.alt : ""}
                    onChange={(event) =>
                      updateBlock(pageId, id, (item) => {
                        item.alt = event.target.value;
                        item.draft_state =
                          event.target.value.trim() && item.asset_id
                            ? "complete"
                            : "incomplete";
                      })
                    }
                  />
                </label>
                <label>
                  Choose managed image
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      void onUploadImage(event, pageId, id);
                    }}
                    type="file"
                  />
                </label>
              </div>
            ) : null}
            {block.type === "gallery" ? (
              <div className="site-composer-media-fields">
                <label>
                  Add managed gallery image
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      void onUploadGalleryImage(event, pageId, id);
                    }}
                    type="file"
                  />
                </label>
                <span className="muted">
                  {Array.isArray(value.images)
                    ? value.images.length +
                      " image" +
                      (value.images.length === 1 ? "" : "s")
                    : "No images yet"}
                </span>
              </div>
            ) : null}
            {block.type === "collapsible" ? (
              <div className="site-composer-nested-editor">
                <label>
                  Summary
                  <input
                    value={
                      typeof value.summary === "string" ? value.summary : ""
                    }
                    onChange={(event) =>
                      updateBlock(pageId, id, (item) => {
                        item.summary = event.target.value;
                        item.draft_state = event.target.value.trim()
                          ? "complete"
                          : "incomplete";
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    checked={value.open !== false}
                    onChange={(event) =>
                      updateBlock(pageId, id, (item) => {
                        item.open = event.target.checked;
                      })
                    }
                    type="checkbox"
                  />{" "}
                  Open by default
                </label>
                <NestedSiteBlocks
                  blocks={
                    Array.isArray(value.blocks)
                      ? (value.blocks as SiteBlock[])
                      : []
                  }
                  appendBlock={appendBlock}
                  containerId={id}
                  duplicateBlock={duplicateBlock}
                  moveBlock={moveBlock}
                  onUploadGalleryImage={onUploadGalleryImage}
                  onUploadImage={onUploadImage}
                  pageId={pageId}
                  removeBlock={removeBlock}
                  setSectionColumns={setSectionColumns}
                  updateBlock={updateBlock}
                />
              </div>
            ) : null}
            {block.type === "section" ? (
              <div className="site-composer-nested-editor">
                <label>
                  Columns
                  <select
                    value={
                      Array.isArray(value.columns)
                        ? Math.min(Math.max(value.columns.length, 1), 3)
                        : 1
                    }
                    onChange={(event) => {
                      const nextCount = Number(event.target.value);
                      if (
                        nextCount === 1 ||
                        nextCount === 2 ||
                        nextCount === 3
                      ) {
                        setSectionColumns(pageId, id, nextCount);
                      }
                    }}
                  >
                    <option value={1}>1 column</option>
                    <option value={2}>2 columns</option>
                    <option value={3}>3 columns</option>
                  </select>
                </label>
                {(Array.isArray(value.columns) ? value.columns : []).map(
                  (column, columnIndex) => {
                    const columnValue = asRecord(column);
                    return (
                      <div
                        className="site-composer-column-editor"
                        key={id + "-column-" + columnIndex}
                      >
                        <strong>Column {columnIndex + 1}</strong>
                        <NestedSiteBlocks
                          blocks={
                            Array.isArray(columnValue.blocks)
                              ? (columnValue.blocks as SiteBlock[])
                              : []
                          }
                          appendBlock={appendBlock}
                          columnIndex={columnIndex}
                          containerId={id}
                          duplicateBlock={duplicateBlock}
                          moveBlock={moveBlock}
                          onUploadGalleryImage={onUploadGalleryImage}
                          onUploadImage={onUploadImage}
                          pageId={pageId}
                          removeBlock={removeBlock}
                          setSectionColumns={setSectionColumns}
                          updateBlock={updateBlock}
                        />
                      </div>
                    );
                  },
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="site-composer-add-actions site-composer-nested-add-actions">
        <button
          onClick={() =>
            appendBlock(pageId, containerId, newBlock("heading"), columnIndex)
          }
          type="button"
        >
          Add heading
        </button>
        <button
          onClick={() =>
            appendBlock(pageId, containerId, newBlock("text"), columnIndex)
          }
          type="button"
        >
          Add text
        </button>
        <button
          onClick={() =>
            appendBlock(pageId, containerId, newBlock("callout"), columnIndex)
          }
          type="button"
        >
          Add callout
        </button>
        <button
          onClick={() =>
            appendBlock(pageId, containerId, newBlock("button"), columnIndex)
          }
          type="button"
        >
          Add button
        </button>
        <button
          onClick={() =>
            appendBlock(pageId, containerId, newBlock("divider"), columnIndex)
          }
          type="button"
        >
          Add divider
        </button>
      </div>
    </div>
  );
}

function nextHome(draft: SiteDraftV1, pageId: string): void {
  for (const page of draft.pages) {
    page.is_home = page.id === pageId;
  }
}

function findBlockList(
  blocks: SiteBlock[],
  blockId: string,
): SiteBlock[] | null {
  if (blocks.some((block) => asRecord(block).id === blockId)) return blocks;
  for (const block of blocks) {
    const value = asRecord(block);
    if (Array.isArray(value.blocks)) {
      const nested = findBlockList(value.blocks as SiteBlock[], blockId);
      if (nested) return nested;
    }
    if (Array.isArray(value.columns)) {
      for (const column of value.columns) {
        const columnValue = asRecord(column);
        if (!Array.isArray(columnValue.blocks)) continue;
        const nested = findBlockList(
          columnValue.blocks as SiteBlock[],
          blockId,
        );
        if (nested) return nested;
      }
    }
  }
  return null;
}

function cloneBlockWithNewIds(block: SiteBlock): SiteBlock {
  const cloned = structuredClone(block) as SiteBlock;
  const assignIds = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(assignIds);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as UnknownRecord;
    if (typeof object.id === "string") object.id = crypto.randomUUID();
    Object.values(object).forEach(assignIds);
  };
  assignIds(cloned);
  return cloned;
}

function findCollectionForDetailPage(
  draft: SiteDraftV1,
  pageId: string,
): UnknownRecord | null {
  const visit = (blocks: readonly SiteBlock[]): UnknownRecord | null => {
    for (const block of blocks) {
      const value = asRecord(block);
      if (value.type === "collection" && value.detail_page_id === pageId) {
        return value;
      }
      if (Array.isArray(value.blocks)) {
        const nested = visit(value.blocks as SiteBlock[]);
        if (nested) return nested;
      }
      if (Array.isArray(value.columns)) {
        for (const column of value.columns) {
          const columnValue = asRecord(column);
          if (!Array.isArray(columnValue.blocks)) continue;
          const nested = visit(columnValue.blocks as SiteBlock[]);
          if (nested) return nested;
        }
      }
    }
    return null;
  };
  for (const page of draft.pages) {
    const collection = visit(page.layout.blocks);
    if (collection) return collection;
  }
  return null;
}

function clearDetailPageReferences(
  blocks: readonly SiteBlock[],
  removedPageId: string,
): void {
  for (const block of blocks) {
    const value = asRecord(block);
    if (value.detail_page_id === removedPageId) {
      delete value.detail_page_id;
    }
    if (Array.isArray(value.blocks)) {
      clearDetailPageReferences(value.blocks as SiteBlock[], removedPageId);
    }
    if (Array.isArray(value.columns)) {
      for (const column of value.columns) {
        const columnValue = asRecord(column);
        if (Array.isArray(columnValue.blocks)) {
          clearDetailPageReferences(
            columnValue.blocks as SiteBlock[],
            removedPageId,
          );
        }
      }
    }
  }
}
