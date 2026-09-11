"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { siteDraftV1Schema, type SiteDraftV1 } from "../../core/sites/schemas";
import { walkPageBlocks } from "../../core/experience/page-blocks";
import { SiteFormComposer, siteFormDraftBlockers } from "./site-form-composer";
import { useUnsavedNavigationWarning } from "../../runtime/unsaved-navigation-warning";
import {
  SerialSaveCoordinator,
  type SaveCoordinatorResult,
} from "../../runtime/page-editor/save-coordinator";

type SitePage = SiteDraftV1["pages"][number];
type SiteBlock = SitePage["layout"]["blocks"][number];
type SiteAction = (formData: FormData) => void | Promise<void>;

type FileFieldOption = { id: string; key: string };
type FieldOption = {
  id: string;
  key: string;
  label?: string;
  fieldType: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
};
type ViewOption = {
  key: string;
  label: string;
};
type RecordOption = {
  id: string;
  label: string;
  objectDefinitionId: string;
  recordRevision: number;
  attachments: Record<string, number>;
};
export type ObjectOption = {
  id: string;
  key: string;
  singularLabel?: string;
  pluralLabel?: string;
  fieldOptions: FieldOption[];
  viewOptions: ViewOption[];
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
  if (typeof value.object_key === "string") return displayKey(value.object_key);
  return displayKey(block.type);
}

function blockIdentity(block: SiteBlock, fallback: string): string {
  const value = asRecord(block);
  return typeof value.id === "string" ? value.id : fallback;
}

function displayKey(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type RichTextNodeType =
  "paragraph" | "heading" | "bullet_list" | "numbered_list";

const richTextNodeTypes: readonly RichTextNodeType[] = [
  "paragraph",
  "heading",
  "bullet_list",
  "numbered_list",
];

const safeRichTextHrefPattern = /^(?:https?:\/\/|\/|mailto:|tel:)[^\s]+$/i;

function richTextContentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((span) => asRecord(span))
    .map((span) => (typeof span.text === "string" ? span.text : ""))
    .join("");
}

function richTextNodeContent(node: UnknownRecord): UnknownRecord[] {
  if (node.type !== "bullet_list" && node.type !== "numbered_list") {
    return Array.isArray(node.content)
      ? node.content
          .map((span) => asRecord(span))
          .filter((span) => typeof span.text === "string")
          .map((span) => structuredClone(span))
      : [];
  }
  const content: UnknownRecord[] = [];
  const items = Array.isArray(node.items) ? node.items : [];
  items.forEach((item, index) => {
    if (index > 0) content.push({ type: "text", text: "\n" });
    const itemContent = asRecord(item).content;
    if (Array.isArray(itemContent)) {
      content.push(
        ...itemContent
          .map((span) => asRecord(span))
          .filter((span) => typeof span.text === "string")
          .map((span) => structuredClone(span)),
      );
    }
  });
  return content;
}

function richTextNodeText(node: UnknownRecord): string {
  return richTextContentText(richTextNodeContent(node));
}

function richTextNodeType(value: unknown): RichTextNodeType {
  const type = asRecord(value).type;
  return richTextNodeTypes.includes(type as RichTextNodeType)
    ? (type as RichTextNodeType)
    : "paragraph";
}

function richTextMarks(node: UnknownRecord): {
  bold: boolean;
  italic: boolean;
  link: string;
} {
  const firstSpan = richTextNodeContent(node).find(
    (span) => typeof span.text === "string" && span.text.length > 0,
  );
  const marks = Array.isArray(firstSpan?.marks) ? firstSpan.marks : [];
  const link = marks
    .map((mark) => asRecord(mark))
    .find((mark) => mark.type === "link");
  return {
    bold: marks.some((mark) => asRecord(mark).type === "bold"),
    italic: marks.some((mark) => asRecord(mark).type === "italic"),
    link: typeof link?.href === "string" ? link.href : "",
  };
}

function richTextMarksSignature(span: UnknownRecord): string {
  return JSON.stringify(Array.isArray(span.marks) ? span.marks : []);
}

function mergeRichTextSpans(spans: readonly UnknownRecord[]): UnknownRecord[] {
  const merged: UnknownRecord[] = [];
  for (const input of spans) {
    if (typeof input.text !== "string" || input.text.length === 0) continue;
    const span = structuredClone(input);
    const previous = merged.at(-1);
    if (
      previous &&
      previous.type === "text" &&
      richTextMarksSignature(previous) === richTextMarksSignature(span)
    ) {
      previous.text = String(previous.text) + span.text;
    } else {
      merged.push(span);
    }
  }
  return merged;
}

function richTextContentSlice(
  content: readonly UnknownRecord[],
  start: number,
  end: number,
): UnknownRecord[] {
  if (end <= start) return [];
  const result: UnknownRecord[] = [];
  let position = 0;
  for (const span of content) {
    const text = typeof span.text === "string" ? span.text : "";
    const spanStart = position;
    const spanEnd = position + text.length;
    position = spanEnd;
    if (spanEnd <= start || spanStart >= end || text.length === 0) continue;
    const from = Math.max(start - spanStart, 0);
    const to = Math.min(end - spanStart, text.length);
    const piece = structuredClone(span);
    piece.text = text.slice(from, to);
    result.push(piece);
  }
  return mergeRichTextSpans(result);
}

function richTextMarksAt(
  content: readonly UnknownRecord[],
  offset: number,
): UnknownRecord[] {
  let position = 0;
  let previous: UnknownRecord | undefined;
  for (const span of content) {
    const text = typeof span.text === "string" ? span.text : "";
    if (text.length === 0) continue;
    const end = position + text.length;
    if (offset < end || (offset === end && offset > 0)) {
      const source = offset === end && previous ? previous : span;
      return Array.isArray(source.marks) ? structuredClone(source.marks) : [];
    }
    previous = span;
    position = end;
  }
  return Array.isArray(previous?.marks) ? structuredClone(previous.marks) : [];
}

/**
 * Apply a textarea edit by retaining unchanged prefix and suffix spans. Only
 * the replaced range receives the nearest existing marks, so editing mixed
 * formatting does not flatten the canonical document.
 */
function preserveRichTextContentEdit(
  content: readonly UnknownRecord[],
  nextText: string,
): UnknownRecord[] {
  const previousText = richTextContentText(content);
  if (previousText === nextText) {
    return content.map((span) => structuredClone(span));
  }
  let prefix = 0;
  while (
    prefix < previousText.length &&
    prefix < nextText.length &&
    previousText[prefix] === nextText[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    previousText.length - prefix - suffix > 0 &&
    nextText.length - prefix - suffix > 0 &&
    previousText[previousText.length - suffix - 1] ===
      nextText[nextText.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const previousEnd = previousText.length - suffix;
  const nextEnd = nextText.length - suffix;
  const middleText = nextText.slice(prefix, nextEnd);
  const middleMarks = richTextMarksAt(content, prefix);
  const middle = middleText
    ? [
        {
          type: "text",
          text: middleText,
          ...(middleMarks.length ? { marks: middleMarks } : {}),
        },
      ]
    : [];
  return mergeRichTextSpans([
    ...richTextContentSlice(content, 0, prefix),
    ...middle,
    ...richTextContentSlice(content, previousEnd, previousText.length),
  ]);
}

function splitRichTextLines(
  content: readonly UnknownRecord[],
): UnknownRecord[][] {
  const lines: UnknownRecord[][] = [[]];
  for (const span of content) {
    const text = typeof span.text === "string" ? span.text : "";
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] !== "\n") continue;
      const piece = structuredClone(span);
      piece.text = text.slice(start, index);
      lines[lines.length - 1]!.push(piece);
      lines.push([]);
      start = index + 1;
    }
    const trailing = structuredClone(span);
    trailing.text = text.slice(start);
    lines[lines.length - 1]!.push(trailing);
  }
  return lines.map((line) => mergeRichTextSpans(line));
}

function richTextNodeWithContent(
  type: RichTextNodeType,
  content: readonly UnknownRecord[],
  level: 1 | 2 | 3,
): UnknownRecord {
  if (type === "bullet_list" || type === "numbered_list") {
    return {
      type,
      items: splitRichTextLines(content).map((line) => ({ content: line })),
    };
  }
  return {
    type,
    ...(type === "heading" ? { level } : {}),
    content: content.map((span) => structuredClone(span)),
  };
}

function richTextNodeWithText(
  node: UnknownRecord,
  nextText: string,
  type: RichTextNodeType,
  level: 1 | 2 | 3,
): UnknownRecord {
  const edited = preserveRichTextContentEdit(
    richTextNodeContent(node),
    nextText,
  );
  return richTextNodeWithContent(type, edited, level);
}

function richTextNodeWithMarks(
  node: UnknownRecord,
  options: Readonly<{
    bold?: boolean;
    italic?: boolean;
    link?: string;
  }>,
): UnknownRecord {
  const updateContent = (contentInput: unknown): UnknownRecord[] => {
    const content = Array.isArray(contentInput)
      ? contentInput.map((span) => asRecord(span))
      : [];
    return content.map((input) => {
      const span = structuredClone(input);
      const currentMarks = Array.isArray(span.marks)
        ? span.marks.map((mark) => asRecord(mark))
        : [];
      const marks = currentMarks.filter((mark) => {
        if (mark.type === "bold" && options.bold !== undefined) return false;
        if (mark.type === "italic" && options.italic !== undefined)
          return false;
        if (mark.type === "link" && options.link !== undefined) return false;
        return true;
      });
      if (options.bold) marks.push({ type: "bold" });
      if (options.italic) marks.push({ type: "italic" });
      if (
        options.link !== undefined &&
        safeRichTextHrefPattern.test(options.link)
      ) {
        marks.push({ type: "link", href: options.link });
      }
      if (marks.length) span.marks = marks;
      else delete span.marks;
      return span;
    });
  };
  if (node.type === "bullet_list" || node.type === "numbered_list") {
    return {
      ...structuredClone(node),
      items: (Array.isArray(node.items) ? node.items : []).map((item) => ({
        ...structuredClone(asRecord(item)),
        content: updateContent(asRecord(item).content),
      })),
    };
  }
  return { ...structuredClone(node), content: updateContent(node.content) };
}

function richTextNodeWithType(
  node: UnknownRecord,
  type: RichTextNodeType,
  level: 1 | 2 | 3,
): UnknownRecord {
  return richTextNodeWithContent(type, richTextNodeContent(node), level);
}

function previewRichText(nodeInput: unknown): ReactNode {
  const node = asRecord(nodeInput);
  const text = richTextNodeText(node);
  if (node.type === "heading") {
    return (
      <span className="site-composer-canvas-rich-text-heading">
        {text || "Add a formatted heading"}
      </span>
    );
  }
  if (node.type === "bullet_list" || node.type === "numbered_list") {
    const items = (Array.isArray(node.items) ? node.items : [])
      .map((item) => richTextContentText(asRecord(item).content))
      .filter((item) => item.trim());
    return (
      <span className="site-composer-canvas-rich-text-list">
        {items.length
          ? items.map((item, index) => (
              <span key={`${index}-${item}`}>
                {node.type === "bullet_list" ? "•" : `${index + 1}.`} {item}
              </span>
            ))
          : "Add list items"}
      </span>
    );
  }
  return (
    <span className="site-composer-canvas-rich-text">
      {text || "Add formatted text"}
    </span>
  );
}

function previewBlockContent(
  block: SiteBlock,
  objectOptions: readonly ObjectOption[],
  businessSlug: string,
): ReactNode {
  const value = asRecord(block);
  if (block.type === "heading") {
    return <h2>{typeof value.text === "string" ? value.text : "Heading"}</h2>;
  }
  if (block.type === "rich_text") {
    return previewRichText(value.node);
  }
  if (block.type === "text" || block.type === "callout") {
    return (
      <p>
        {typeof value.text === "string" && value.text.trim()
          ? value.text
          : "Add a short message for visitors."}
      </p>
    );
  }
  if (block.type === "button") {
    return (
      <span className="site-composer-canvas-button">
        {typeof value.label === "string" && value.label.trim()
          ? value.label
          : "Add a button label"}
      </span>
    );
  }
  if (block.type === "image") {
    const assetId = typeof value.asset_id === "string" ? value.asset_id : null;
    const alt =
      typeof value.alt === "string" && value.alt.trim()
        ? value.alt
        : "Managed image";
    return (
      <span className="site-composer-canvas-image">
        {assetId ? (
          <Image
            alt={alt}
            height={180}
            src={`/api/app/${encodeURIComponent(
              businessSlug,
            )}/pages/assets/${encodeURIComponent(assetId)}`}
            unoptimized
            width={320}
          />
        ) : (
          <span>Choose an image</span>
        )}
        {assetId ? <span>{alt}</span> : null}
      </span>
    );
  }
  if (block.type === "gallery") {
    const images = Array.isArray(value.images)
      ? value.images.map((image) => asRecord(image))
      : [];
    return (
      <span className="site-composer-canvas-gallery">
        {images.length ? (
          images.slice(0, 4).map((image, index) => {
            const assetId =
              typeof image.asset_id === "string" ? image.asset_id : null;
            return assetId ? (
              <Image
                alt={
                  typeof image.alt === "string" ? image.alt : "Gallery image"
                }
                height={120}
                key={`${assetId}-${index}`}
                src={`/api/app/${encodeURIComponent(
                  businessSlug,
                )}/pages/assets/${encodeURIComponent(assetId)}`}
                unoptimized
                width={160}
              />
            ) : null;
          })
        ) : (
          <span>Add images</span>
        )}
        {images.length > 4 ? (
          <small className="muted">+{images.length - 4} more</small>
        ) : null}
      </span>
    );
  }
  if (block.type === "collection") {
    const option =
      typeof value.object_key === "string"
        ? objectOptions.find((candidate) => candidate.key === value.object_key)
        : undefined;
    const selection = asRecord(value.selection);
    const count = Array.isArray(selection.record_ids)
      ? selection.record_ids.length
      : 0;
    const selectedIds = new Set(
      Array.isArray(selection.record_ids)
        ? selection.record_ids.filter(
            (recordId): recordId is string => typeof recordId === "string",
          )
        : [],
    );
    const selectedRecords = option
      ? option.records
          .filter((record) => selectedIds.has(record.id))
          .slice(0, 3)
      : [];
    return (
      <span className="site-composer-canvas-collection">
        <strong>
          {option ? displayKey(option.key) : "Choose information"}
        </strong>
        {selectedRecords.length ? (
          <span>
            {selectedRecords.map((record) => (
              <span key={record.id}>{record.label}</span>
            ))}
          </span>
        ) : (
          <span>
            {count
              ? `${count} selected item${count === 1 ? "" : "s"}`
              : "Choose items"}
          </span>
        )}
      </span>
    );
  }
  if (block.type === "record_detail") {
    return <span>Shared details for each item</span>;
  }
  if (block.type === "collapsible") {
    const nestedBlocks = Array.isArray(value.blocks) ? value.blocks : [];
    return (
      <span className="site-composer-canvas-collapsible">
        <strong>
          {typeof value.summary === "string" && value.summary.trim()
            ? value.summary
            : "Expandable section"}
        </strong>
        <span>
          {nestedBlocks.slice(0, 3).map((nested, index) => (
            <span key={index}>
              {previewBlockContent(
                nested as SiteBlock,
                objectOptions,
                businessSlug,
              )}
            </span>
          ))}
          {nestedBlocks.length > 3 ? (
            <small className="muted">+{nestedBlocks.length - 3} more</small>
          ) : null}
        </span>
      </span>
    );
  }
  if (block.type === "section") {
    const columns = Array.isArray(value.columns) ? value.columns : [];
    return (
      <span className="site-composer-canvas-section">
        {columns.map((column, index) => {
          const columnValue = asRecord(column);
          const nestedBlocks = Array.isArray(columnValue.blocks)
            ? columnValue.blocks
            : [];
          return (
            <span key={index}>
              {nestedBlocks.slice(0, 3).map((nested, nestedIndex) => (
                <span key={nestedIndex}>
                  {previewBlockContent(
                    nested as SiteBlock,
                    objectOptions,
                    businessSlug,
                  )}
                </span>
              ))}
            </span>
          );
        })}
      </span>
    );
  }
  return <span>{displayKey(block.type)}</span>;
}

function previewSitePage(
  page: SitePage,
  objectOptions: readonly ObjectOption[],
  businessSlug: string,
  className: string,
): ReactNode {
  return (
    <div className={className}>
      <header>
        <p className="eyebrow">Page</p>
        <h3>{page.title}</h3>
      </header>
      <div className="site-composer-conflict-preview-content">
        {page.layout.blocks.map((block, index) => (
          <article key={blockIdentity(block, `${page.id}-${index}`)}>
            {previewBlockContent(block, objectOptions, businessSlug)}
          </article>
        ))}
      </div>
    </div>
  );
}

function copyDraft(draft: SiteDraftV1): SiteDraftV1 {
  return structuredClone(draft);
}

function siteDraftEquals(left: SiteDraftV1, right: SiteDraftV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

function newRichTextBlock(): SiteBlock {
  return {
    type: "rich_text",
    id: crypto.randomUUID(),
    node: {
      type: "paragraph",
      content: [{ type: "text", text: "Write something useful." }],
    },
  } as SiteBlock;
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
  draftBaseVersionId,
  draftBaseHeadRevision,
  objectOptions,
  previewAction,
  publishAction,
  candidateId,
  siteId,
}: Readonly<{
  businessSlug: string;
  draft: SiteDraftV1;
  draftRevision: number;
  draftBaseVersionId: string;
  draftBaseHeadRevision: number;
  objectOptions: ObjectOption[];
  previewAction?: SiteAction;
  publishAction?: SiteAction;
  candidateId: string | undefined;
  siteId: string;
}>): ReactNode {
  const [draft, setDraft] = useState<SiteDraftV1>(() =>
    copyDraft(initialDraft),
  );
  const [revision, setRevision] = useState(draftRevision);
  const [undoStack, setUndoStack] = useState<SiteDraftV1[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [serverConflict, setServerConflict] = useState<{
    draft: SiteDraftV1;
    revision: number;
  } | null>(null);
  const [showingServerDraft, setShowingServerDraft] = useState(false);
  const [serverDraftPageId, setServerDraftPageId] = useState<string | null>(
    null,
  );
  const [attachmentRevisions, setAttachmentRevisions] = useState<
    Record<string, number>
  >({});
  const [recordRevisions, setRecordRevisions] = useState<
    Record<string, number>
  >({});
  const [autosaveStatus, setAutosaveStatus] = useState<
    "saved" | "saving" | "error"
  >("saved");
  const initialDraftRef = useRef(copyDraft(initialDraft));
  const serverDraftRef = useRef(copyDraft(initialDraft));
  const serverRevisionRef = useRef(draftRevision);
  const observedPropsDraftRef = useRef(copyDraft(initialDraft));
  const observedPropsRevisionRef = useRef(draftRevision);
  const revisionRef = useRef(draftRevision);
  const mountedRef = useRef(false);
  const saveFailureMessageRef = useRef<string | null>(null);
  const saveCoordinatorRef = useRef<SerialSaveCoordinator<SiteDraftV1> | null>(
    null,
  );
  const navigationPendingRef = useRef(false);
  const navigationBypassRef = useRef(false);
  const manualSavePendingRef = useRef(false);
  const [selectedPageId, setSelectedPageId] = useState(() => {
    const home = initialDraft.pages.find((page) => page.is_home);
    return home?.id ?? initialDraft.pages[0]?.id ?? "";
  });
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [addBlockMenuOpen, setAddBlockMenuOpen] = useState(false);
  const addBlockButtonRef = useRef<HTMLButtonElement | null>(null);
  const addBlockMenuRef = useRef<HTMLDivElement | null>(null);

  const fetchLatestServerDraft = useCallback(async (): Promise<{
    draft: SiteDraftV1;
    revision: number;
  } | null> => {
    try {
      const response = await fetch(
        `/api/app/${encodeURIComponent(
          businessSlug,
        )}/sites/draft?siteId=${encodeURIComponent(siteId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const result: unknown = await response.json().catch(() => null);
      const value = asRecord(result);
      const parsedDraft = siteDraftV1Schema.safeParse(value.draft);
      const nextRevision = value.draftRevision;
      if (
        value.siteId !== siteId ||
        !parsedDraft.success ||
        typeof nextRevision !== "number" ||
        !Number.isInteger(nextRevision) ||
        nextRevision <= 0
      ) {
        return null;
      }
      return { draft: parsedDraft.data, revision: nextRevision };
    } catch {
      return null;
    }
  }, [businessSlug, siteId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const coordinator = new SerialSaveCoordinator<SiteDraftV1>({
      debounceMs: 900,
      maxWaitMs: 10_000,
      equals: siteDraftEquals,
      initialValue: initialDraftRef.current,
      onStateChange: (next) => {
        if (next.status === "error" || next.status === "stale") {
          setAutosaveStatus("error");
          setMessage(
            saveFailureMessageRef.current ??
              "Draft autosave failed. Use Save draft to try again.",
          );
          return;
        }
        if (next.status === "saved") {
          setAutosaveStatus("saved");
          return;
        }
        setAutosaveStatus("saving");
      },
      save: async ({
        candidate,
        requestId,
      }): Promise<SaveCoordinatorResult<SiteDraftV1>> => {
        const failureMessage =
          "Draft autosave failed. Use Save draft to try again.";
        try {
          const response = await fetch(
            `/api/app/${encodeURIComponent(businessSlug)}/sites/draft`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                siteId,
                expectedDraftRevision: revisionRef.current,
                draft: candidate,
              }),
            },
          );
          if (!response.ok) {
            const stale = response.status === 409;
            saveFailureMessageRef.current = stale
              ? "This draft changed elsewhere. Your edits are still here; saving is paused until the draft is reconciled."
              : failureMessage;
            if (stale) {
              const latest = await fetchLatestServerDraft();
              const requestIsActive =
                saveCoordinatorRef.current?.isRequestActive(requestId) ?? false;
              if (latest && requestIsActive && mountedRef.current) {
                if (latest.revision >= serverRevisionRef.current) {
                  const latestDraft = copyDraft(latest.draft);
                  serverDraftRef.current = copyDraft(latestDraft);
                  serverRevisionRef.current = latest.revision;
                  setServerConflict({
                    draft: latestDraft,
                    revision: latest.revision,
                  });
                  setShowingServerDraft(false);
                  setServerDraftPageId(
                    latestDraft.pages.find((page) => page.is_home)?.id ??
                      latestDraft.pages[0]?.id ??
                      null,
                  );
                }
              }
            }
            return {
              status: stale ? "stale" : "error",
              message: saveFailureMessageRef.current,
            };
          }
          const result: unknown = await response.json().catch(() => null);
          const nextRevision = asRecord(result).draftRevision;
          if (
            typeof nextRevision !== "number" ||
            !Number.isInteger(nextRevision) ||
            nextRevision <= 0
          ) {
            saveFailureMessageRef.current =
              "The draft save response was incomplete. Use Save draft to try again.";
            return {
              status: "error",
              message: saveFailureMessageRef.current,
            };
          }
          const requestIsActive =
            saveCoordinatorRef.current?.isRequestActive(requestId) ?? false;
          if (!requestIsActive) {
            return { status: "success", canonical: candidate };
          }
          if (nextRevision >= serverRevisionRef.current) {
            serverDraftRef.current = copyDraft(candidate);
          }
          serverRevisionRef.current = Math.max(
            serverRevisionRef.current,
            nextRevision,
          );
          revisionRef.current = Math.max(revisionRef.current, nextRevision);
          if (mountedRef.current) setRevision(revisionRef.current);
          saveFailureMessageRef.current = null;
          return { status: "success", canonical: candidate };
        } catch {
          saveFailureMessageRef.current = failureMessage;
          return { status: "error", message: failureMessage };
        }
      },
    });
    saveCoordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      if (saveCoordinatorRef.current === coordinator) {
        saveCoordinatorRef.current = null;
      }
    };
  }, [businessSlug, fetchLatestServerDraft, siteId]);

  useEffect(() => {
    const coordinator = saveCoordinatorRef.current;
    if (!coordinator || siteDraftEquals(coordinator.candidate, draft)) return;
    coordinator.update(copyDraft(draft));
  }, [draft]);

  useEffect(() => {
    const nextServerDraft = copyDraft(initialDraft);
    const propsChanged =
      draftRevision !== observedPropsRevisionRef.current ||
      !siteDraftEquals(observedPropsDraftRef.current, nextServerDraft);
    observedPropsDraftRef.current = copyDraft(nextServerDraft);
    observedPropsRevisionRef.current = draftRevision;
    if (!propsChanged || draftRevision < serverRevisionRef.current) return;

    const serverChanged =
      draftRevision !== serverRevisionRef.current ||
      !siteDraftEquals(serverDraftRef.current, nextServerDraft);
    if (!serverChanged) return;
    serverDraftRef.current = copyDraft(nextServerDraft);
    serverRevisionRef.current = draftRevision;

    const coordinator = saveCoordinatorRef.current;
    if (!coordinator) return;
    if (
      coordinator.hasUnacknowledgedWork &&
      !siteDraftEquals(coordinator.candidate, nextServerDraft)
    ) {
      // Keep the visible candidate intact, but stop its next write until the
      // owner has reviewed the newer server baseline. This avoids clobbering
      // a rebased or adopted draft with a stale local revision.
      coordinator.block("stale");
      setServerConflict({
        draft: nextServerDraft,
        revision: draftRevision,
      });
      setShowingServerDraft(false);
      setServerDraftPageId(
        nextServerDraft.pages.find((page) => page.is_home)?.id ??
          nextServerDraft.pages[0]?.id ??
          null,
      );
      setAutosaveStatus("error");
      setMessage(
        "This draft was updated elsewhere. Your edits are still here; review the latest draft before saving.",
      );
      return;
    }

    initialDraftRef.current = nextServerDraft;
    revisionRef.current = draftRevision;
    coordinator.acknowledge(nextServerDraft);
    setDraft(nextServerDraft);
    setRevision(draftRevision);
    setUndoStack([]);
    setSelectedPageId((currentPageId) => {
      if (nextServerDraft.pages.some((page) => page.id === currentPageId)) {
        return currentPageId;
      }
      return (
        nextServerDraft.pages.find((page) => page.is_home)?.id ??
        nextServerDraft.pages[0]?.id ??
        ""
      );
    });
    setSelectedBlockId(null);
    setPageSettingsOpen(false);
    setAddBlockMenuOpen(false);
    navigationBypassRef.current = false;
    saveFailureMessageRef.current = null;
    setMessage(null);
    setAutosaveStatus("saved");
  }, [draft, draftRevision, initialDraft]);

  function showLatestServerDraft(): void {
    if (!serverConflict) return;
    setShowingServerDraft((showing) => !showing);
    setMessage(
      "The latest draft is shown below. Your edits remain here until you choose which version to keep.",
    );
  }

  function useLatestServerDraft(): void {
    const conflict = serverConflict;
    if (!conflict) return;
    const canonical = copyDraft(conflict.draft);
    initialDraftRef.current = copyDraft(canonical);
    serverDraftRef.current = copyDraft(canonical);
    serverRevisionRef.current = conflict.revision;
    revisionRef.current = conflict.revision;
    saveCoordinatorRef.current?.acknowledge(copyDraft(canonical));
    setDraft(canonical);
    setRevision(conflict.revision);
    setUndoStack([]);
    setSelectedPageId((currentPageId) => {
      if (canonical.pages.some((page) => page.id === currentPageId)) {
        return currentPageId;
      }
      return (
        canonical.pages.find((page) => page.is_home)?.id ??
        canonical.pages[0]?.id ??
        ""
      );
    });
    setSelectedBlockId(null);
    setPageSettingsOpen(false);
    setAddBlockMenuOpen(false);
    setServerConflict(null);
    setShowingServerDraft(false);
    setServerDraftPageId(null);
    navigationBypassRef.current = false;
    saveFailureMessageRef.current = null;
    setMessage("The latest Site draft is now open for editing.");
    setAutosaveStatus("saved");
  }

  function keepLocalDraftOnLatestServer(): void {
    const conflict = serverConflict;
    const coordinator = saveCoordinatorRef.current;
    if (!conflict || !coordinator) return;
    const canonical = copyDraft(conflict.draft);
    const localCandidate = copyDraft(draft);
    initialDraftRef.current = copyDraft(canonical);
    serverDraftRef.current = copyDraft(canonical);
    serverRevisionRef.current = conflict.revision;
    revisionRef.current = conflict.revision;
    coordinator.acknowledge(copyDraft(canonical));
    coordinator.update(localCandidate);
    setDraft(localCandidate);
    setRevision(conflict.revision);
    setUndoStack([]);
    setServerConflict(null);
    setShowingServerDraft(false);
    setServerDraftPageId(null);
    navigationBypassRef.current = false;
    saveFailureMessageRef.current = null;
    setMessage("Your edits are ready to save over the latest Site draft.");
    setAutosaveStatus("saving");
  }

  const latestConflictPage = serverConflict
    ? (serverConflict.draft.pages.find(
        (page) => page.id === serverDraftPageId,
      ) ??
      serverConflict.draft.pages.find((page) => page.is_home) ??
      serverConflict.draft.pages[0])
    : undefined;
  const reachableFormKeys = new Set(
    draft.pages
      .filter((page) => page.is_included)
      .flatMap((page) =>
        walkPageBlocks(page.layout).flatMap((block) =>
          block.type === "public_form" ? [block.form_key] : [],
        ),
      ),
  );
  const formsReady = (draft.forms ?? [])
    .filter((form) => reachableFormKeys.has(form.key))
    .every((form) => siteFormDraftBlockers(form, objectOptions).length === 0);
  const releaseReady =
    autosaveStatus === "saved" && serverConflict === null && formsReady;

  const saveDraftNow = useCallback(async (): Promise<boolean> => {
    const coordinator = saveCoordinatorRef.current;
    if (!coordinator) return false;
    if (!siteDraftEquals(coordinator.candidate, draft)) {
      coordinator.update(copyDraft(draft));
    }
    if (coordinator.state.blocked === "stale") return false;
    const result =
      coordinator.state.blocked === "error"
        ? await coordinator.retry()
        : await coordinator.flush();
    if (result?.status === "error" || result?.status === "stale") return false;
    return !coordinator.hasUnacknowledgedWork;
  }, [draft]);

  const flushBeforeNavigation = useCallback(
    async (href: string): Promise<void> => {
      if (navigationPendingRef.current) return;
      navigationPendingRef.current = true;
      const saved = await saveDraftNow();
      navigationPendingRef.current = false;
      if (!saved) {
        setMessage(
          "Your latest Site edits are still here. Save them before leaving this page.",
        );
        return;
      }
      const destination = new URL(href, window.location.href);
      const sameDocument =
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search;
      navigationBypassRef.current = !sameDocument;
      window.location.assign(href);
    },
    [saveDraftNow],
  );

  useUnsavedNavigationWarning(
    autosaveStatus !== "saved",
    "Leave this Site? Your latest edits are still being saved.",
    flushBeforeNavigation,
    navigationBypassRef,
  );

  useEffect(() => {
    if (!addBlockMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (addBlockMenuRef.current?.contains(event.target) ||
          addBlockButtonRef.current?.contains(event.target))
      ) {
        return;
      }
      setAddBlockMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAddBlockMenuOpen(false);
      addBlockButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [addBlockMenuOpen]);

  function commit(next: SiteDraftV1): void {
    navigationBypassRef.current = false;
    setUndoStack((previous) => [...previous.slice(-19), copyDraft(draft)]);
    setDraft(next);
    setMessage(null);
    setAutosaveStatus("saving");
  }

  function addFormToPage(formKey: string, pageId: string): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    page.layout.blocks.unshift({
      type: "public_form",
      id: crypto.randomUUID(),
      form_key: formKey,
    } as SiteBlock);
    commit(next);
    setMessage(
      "Form added to the Page. It will be available when you publish.",
    );
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
    if (selectedPageId === pageId) {
      const nextPage =
        next.pages.find((candidate) => candidate.is_home) ?? next.pages[0];
      setSelectedPageId(nextPage?.id ?? "");
      setSelectedBlockId(null);
    }
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

  function moveBlockToDestination(
    pageId: string,
    blockId: string,
    destination: string,
  ): void {
    const parsedDestination = parseSiteBlockDestination(destination);
    if (!parsedDestination) return;
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    const sourceBlocks = findBlockList(page.layout.blocks, blockId);
    const sourceIndex =
      sourceBlocks?.findIndex(
        (candidate) => asRecord(candidate).id === blockId,
      ) ?? -1;
    const moved = sourceBlocks?.[sourceIndex];
    if (!sourceBlocks || sourceIndex < 0 || !moved) return;

    let targetBlocks: SiteBlock[];
    if (parsedDestination.kind === "root") {
      targetBlocks = page.layout.blocks;
    } else {
      if (moved.type === "section") return;
      const section = page.layout.blocks.find(
        (candidate) =>
          candidate.type === "section" &&
          candidate.id === parsedDestination.sectionId,
      );
      if (!section || section.type !== "section") return;
      const targetColumn = section.columns[parsedDestination.columnIndex];
      if (!targetColumn) return;
      targetBlocks = targetColumn.blocks as SiteBlock[];
    }
    if (sourceBlocks === targetBlocks) return;

    sourceBlocks.splice(sourceIndex, 1);
    targetBlocks.push(moved);
    setFocusBlockId(blockId);
    commit(next);
    setSelectedPageId(pageId);
    setSelectedBlockId(
      parsedDestination.kind === "section"
        ? parsedDestination.sectionId
        : blockId,
    );
  }

  function moveBlockToColumn(
    pageId: string,
    sectionId: string,
    blockId: string,
    sourceColumnIndex: number,
    targetColumnIndex: number,
  ): void {
    if (sourceColumnIndex === targetColumnIndex) return;
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    const sectionBlocks = page
      ? findBlockList(page.layout.blocks, sectionId)
      : null;
    const section = sectionBlocks?.find(
      (candidate) => asRecord(candidate).id === sectionId,
    );
    const sectionValue = asRecord(section);
    const columns = Array.isArray(sectionValue.columns)
      ? sectionValue.columns.map((column) => asRecord(column))
      : [];
    const sourceColumn = columns[sourceColumnIndex];
    const targetColumn = columns[targetColumnIndex];
    if (!sourceColumn || !targetColumn) return;
    const sourceBlocks = Array.isArray(sourceColumn.blocks)
      ? sourceColumn.blocks
      : [];
    const moved = sourceBlocks.find(
      (candidate) => asRecord(candidate).id === blockId,
    );
    if (!moved) return;
    sourceColumn.blocks = sourceBlocks.filter(
      (candidate) => asRecord(candidate).id !== blockId,
    );
    targetColumn.blocks = [
      ...(Array.isArray(targetColumn.blocks) ? targetColumn.blocks : []),
      moved,
    ];
    sectionValue.columns = columns;
    commit(next);
  }

  function moveBlockAcrossSections(
    pageId: string,
    sectionId: string,
    blockId: string,
    offset: -1 | 1,
  ): void {
    const next = copyDraft(draft);
    const page = next.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    const sections = page.layout.blocks.filter(
      (block) => block.type === "section",
    );
    const sourceSectionIndex = sections.findIndex(
      (section) => asRecord(section).id === sectionId,
    );
    const targetSection = sections[sourceSectionIndex + offset];
    if (!targetSection) return;
    const sourceSection = sections[sourceSectionIndex];
    const sourceColumns = asRecord(sourceSection).columns;
    const targetColumns = asRecord(targetSection).columns;
    if (!Array.isArray(sourceColumns) || !Array.isArray(targetColumns)) return;

    let sourceBlocks: SiteBlock[] | null = null;
    let moved: SiteBlock | null = null;
    for (const column of sourceColumns) {
      const columnValue = asRecord(column);
      if (!Array.isArray(columnValue.blocks)) continue;
      const candidate = columnValue.blocks.find(
        (block) => asRecord(block).id === blockId,
      );
      if (candidate) {
        sourceBlocks = columnValue.blocks as SiteBlock[];
        moved = candidate as SiteBlock;
        break;
      }
    }
    const targetColumn = asRecord(targetColumns[0]);
    if (!sourceBlocks || !moved || !Array.isArray(targetColumn.blocks)) return;
    sourceBlocks.splice(
      sourceBlocks.findIndex((block) => asRecord(block).id === blockId),
      1,
    );
    targetColumn.blocks = [...(targetColumn.blocks as SiteBlock[]), moved];
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
    setSelectedPageId(pageId);
    setSelectedBlockId(blockIdentity(block, ""));
    setPageSettingsOpen(false);
    setAddBlockMenuOpen(false);
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

  function setSectionPresentation(
    pageId: string,
    blockId: string,
    property: "width" | "spacing" | "alignment" | "background",
    value: string,
  ): void {
    updateBlock(pageId, blockId, (block) => {
      block[property] = value;
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
      spacing: "comfortable",
      alignment: "start",
      background: "plain",
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
    if (!(await saveDraftNow())) {
      setMessage(
        "The Site draft could not be saved before attaching the Record image.",
      );
      return;
    }
    setMessage(`Uploading ${displayKey(field.key)} for ${record.label}…`);
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
    setMessage("Record image is ready for your next Site update.");
  }

  function undo(): void {
    const previous = undoStack.at(-1);
    if (!previous) return;
    navigationBypassRef.current = false;
    setUndoStack((stack) => stack.slice(0, -1));
    setDraft(previous);
    setMessage(null);
    setAutosaveStatus("saving");
  }

  return (
    <div className="site-composer">
      <div className="site-composer-toolbar">
        <div>
          <label className="site-composer-toolbar-site-name">
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
        </div>
        <div className="site-composer-toolbar-actions">
          <p
            className={`site-composer-autosave-status is-${autosaveStatus}`}
            aria-live="polite"
          >
            {autosaveStatus === "saving"
              ? "Saving…"
              : autosaveStatus === "error"
                ? "Autosave needs attention"
                : "Saved automatically"}
          </p>
          <button
            className="button-secondary site-composer-quiet-action"
            disabled={undoStack.length === 0}
            onClick={undo}
            type="button"
          >
            Undo
          </button>
          <form
            onSubmit={(event) => {
              if (manualSavePendingRef.current) {
                event.preventDefault();
                return;
              }
              event.preventDefault();
              manualSavePendingRef.current = true;
              void saveDraftNow()
                .then((saved) => {
                  manualSavePendingRef.current = false;
                  if (saved) setMessage("Draft saved.");
                })
                .catch(() => {
                  manualSavePendingRef.current = false;
                  setMessage("The Site draft could not be saved. Try again.");
                });
            }}
          >
            <button
              className="button-secondary site-composer-save-action"
              type="submit"
            >
              Save draft
            </button>
          </form>
          {previewAction ? (
            <form action={previewAction}>
              <input name="siteId" type="hidden" value={siteId} />
              <input
                name="expectedDraftRevision"
                type="hidden"
                value={revision}
              />
              <input
                name="expectedBaseVersionId"
                type="hidden"
                value={draftBaseVersionId}
              />
              <input
                name="expectedHeadRevision"
                type="hidden"
                value={draftBaseHeadRevision}
              />
              <button
                className="button-secondary site-composer-preview-action"
                disabled={!releaseReady}
                type="submit"
              >
                Preview
              </button>
            </form>
          ) : null}
          {publishAction && candidateId ? (
            <form action={publishAction}>
              <input name="siteId" type="hidden" value={siteId} />
              <input name="candidateId" type="hidden" value={candidateId} />
              <input
                name="expectedDraftRevision"
                type="hidden"
                value={revision}
              />
              <input
                name="expectedBaseVersionId"
                type="hidden"
                value={draftBaseVersionId}
              />
              <input
                name="expectedHeadRevision"
                type="hidden"
                value={draftBaseHeadRevision}
              />
              <button
                className="site-composer-publish-action"
                disabled={!releaseReady}
                type="submit"
              >
                Publish
              </button>
            </form>
          ) : publishAction ? (
            <button
              className="site-composer-publish-action"
              disabled
              title="Preview your changes before publishing"
              type="button"
            >
              Publish
            </button>
          ) : null}
        </div>
      </div>
      {message ? <p className="notice notice-message">{message}</p> : null}
      {serverConflict ? (
        <section
          aria-label="Review newer Site draft"
          className="site-composer-conflict"
        >
          <div>
            <p className="eyebrow">Draft update</p>
            <h2>Review a newer Site draft</h2>
            <p className="muted">
              Another update was saved while you were editing. Choose which
              version you want to continue with.
            </p>
          </div>
          <div className="site-composer-inline-actions">
            <button
              className="button-secondary"
              onClick={showLatestServerDraft}
              type="button"
            >
              {showingServerDraft ? "Hide latest draft" : "Review latest draft"}
            </button>
            <button
              className="button-secondary"
              onClick={useLatestServerDraft}
              type="button"
            >
              Use latest draft (discard my edits)
            </button>
            <button onClick={keepLocalDraftOnLatestServer} type="button">
              Keep my edits and save over latest
            </button>
          </div>
          {showingServerDraft && latestConflictPage ? (
            <div className="site-composer-conflict-review">
              {serverConflict.draft.pages.length > 1 ? (
                <nav aria-label="Pages in latest draft">
                  {serverConflict.draft.pages.map((page) => (
                    <button
                      aria-pressed={page.id === latestConflictPage.id}
                      className="button-secondary"
                      key={page.id}
                      onClick={() => setServerDraftPageId(page.id)}
                      type="button"
                    >
                      {page.navigation_label || page.title}
                    </button>
                  ))}
                </nav>
              ) : null}
              {previewSitePage(
                latestConflictPage,
                objectOptions,
                businessSlug,
                "site-composer-conflict-preview",
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      <SiteFormComposer
        draft={draft}
        objectOptions={objectOptions}
        onAddToPage={addFormToPage}
        onChange={commit}
      />

      <details className="panel site-composer-branding" open={identityOpen}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            setIdentityOpen((open) => !open);
          }}
        >
          <span>
            <strong>Site identity</strong>
            <small className="muted">Appearance and logo</small>
          </span>
          <span aria-hidden="true">{identityOpen ? "−" : "+"}</span>
        </summary>
        <div className="site-composer-fields">
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
      </details>

      <div className="site-composer-workspace">
        <aside className="site-composer-page-nav" aria-label="Site Pages">
          <div className="site-composer-page-nav-heading">
            <div>
              <p className="eyebrow">Your Site</p>
              <h3>Pages</h3>
            </div>
            <button
              onClick={() => {
                const nextPage = pageWithDefaults(
                  draft.pages.length + 1,
                  draft.pages.length === 0,
                );
                const next = copyDraft(draft);
                next.pages = [...next.pages, nextPage];
                commit(next);
                setSelectedPageId(nextPage.id);
                setSelectedBlockId(
                  blockIdentity(nextPage.layout.blocks[0]!, ""),
                );
                setPageSettingsOpen(true);
              }}
              type="button"
            >
              Add Page
            </button>
          </div>
          <nav aria-label="Choose a Page">
            {draft.pages.map((page) => (
              <button
                aria-label={
                  page.navigation_label || page.title || "Untitled Page"
                }
                aria-current={page.id === selectedPageId ? "page" : undefined}
                className={
                  page.id === selectedPageId
                    ? "site-composer-page-link is-selected"
                    : "site-composer-page-link"
                }
                key={page.id}
                onClick={() => {
                  setSelectedPageId(page.id);
                  setSelectedBlockId(null);
                  setPageSettingsOpen(false);
                  setAddBlockMenuOpen(false);
                }}
                type="button"
              >
                <span>
                  {page.navigation_label || page.title || "Untitled Page"}
                </span>
                <small className="muted">
                  {page.is_home
                    ? "Home"
                    : page.is_included
                      ? "Included"
                      : "Draft only"}
                </small>
              </button>
            ))}
          </nav>
        </aside>
        <main className="site-composer-pages">
          {draft.pages
            .filter((page) => page.id === selectedPageId)
            .map((page) => {
              const pageIndex = draft.pages.findIndex(
                (candidate) => candidate.id === page.id,
              );
              return (
                <article className="panel site-composer-page" key={page.id}>
                  <header className="site-composer-page-header">
                    <div>
                      <p className="eyebrow">
                        {page.is_home ? "Home" : "Page"}
                      </p>
                      <h2>{page.title || "Untitled Page"}</h2>
                    </div>
                    <div className="site-composer-inline-actions">
                      <button
                        aria-expanded={pageSettingsOpen}
                        onClick={() => setPageSettingsOpen((open) => !open)}
                        type="button"
                      >
                        Page settings
                      </button>
                      {pageIndex > 0 ? (
                        <button
                          onClick={() => movePage(page.id, -1)}
                          aria-label="Move Page earlier"
                          type="button"
                        >
                          ↑
                        </button>
                      ) : null}
                      {pageIndex < draft.pages.length - 1 ? (
                        <button
                          onClick={() => movePage(page.id, 1)}
                          aria-label="Move Page later"
                          type="button"
                        >
                          ↓
                        </button>
                      ) : null}
                      {!page.is_home && draft.pages.length > 1 ? (
                        <button
                          onClick={() => removePage(page.id)}
                          type="button"
                        >
                          Remove Page
                        </button>
                      ) : null}
                    </div>
                  </header>
                  {pageSettingsOpen ? (
                    <section
                      className="site-composer-page-settings"
                      aria-label="Page settings"
                    >
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
                    </section>
                  ) : null}
                  <section
                    className="site-composer-canvas"
                    aria-label="Page canvas"
                  >
                    <div className="site-composer-canvas-heading">
                      <div>
                        <p className="eyebrow">Draft preview</p>
                        <h3>{page.title || "Untitled Page"}</h3>
                      </div>
                      <span className="muted">
                        {page.is_included ? "Included in Site" : "Draft only"}
                      </span>
                    </div>
                    <div className="site-composer-canvas-content">
                      {page.layout.blocks.map((block, blockIndex) => {
                        const id = blockIdentity(
                          block,
                          `${page.id}-${blockIndex}`,
                        );
                        return (
                          <button
                            aria-pressed={selectedBlockId === id}
                            className={
                              selectedBlockId === id
                                ? "site-composer-canvas-block is-selected"
                                : "site-composer-canvas-block"
                            }
                            key={id}
                            onClick={() => {
                              setSelectedBlockId(id);
                              setPageSettingsOpen(false);
                            }}
                            type="button"
                          >
                            <span className="site-composer-canvas-block-type">
                              {displayKey(block.type)}
                            </span>
                            {previewBlockContent(
                              block,
                              objectOptions,
                              businessSlug,
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section
                    className="site-composer-inspector"
                    aria-label="Block settings"
                  >
                    <div className="site-composer-inspector-heading">
                      <div>
                        <p className="eyebrow">Selected content</p>
                        <h3>
                          {selectedBlockId
                            ? "Edit this block"
                            : "Choose a block to edit"}
                        </h3>
                      </div>
                      <span className="muted">Changes save as you work</span>
                    </div>
                    <div className="site-composer-blocks">
                      {page.layout.blocks
                        .filter(
                          (block, blockIndex) =>
                            blockIdentity(block, `${page.id}-${blockIndex}`) ===
                            selectedBlockId,
                        )
                        .map((block) => {
                          const value = asRecord(block);
                          const id = blockIdentity(
                            block,
                            `${page.id}-selected`,
                          );
                          const blockIndex = page.layout.blocks.findIndex(
                            (candidate) => blockIdentity(candidate, "") === id,
                          );
                          const sectionTargets = siteSectionTargets(page);
                          const collectionOption =
                            block.type === "collection"
                              ? objectOptions.find(
                                  (option) => option.key === value.object_key,
                                )
                              : undefined;
                          const collectionFileFields =
                            collectionOption?.fileFields ?? [];
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
                            block.type === "collection"
                              ? asRecord(value.filter)
                              : {};
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
                            <div
                              className="site-composer-block is-selected"
                              data-site-block-id={id}
                              key={id}
                            >
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
                                      blockIndex ===
                                      page.layout.blocks.length - 1
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
                              {block.type !== "section" ? (
                                <SiteBlockDestinationField
                                  currentDestination="root"
                                  focusOnMount={focusBlockId === id}
                                  onMove={(destination) =>
                                    moveBlockToDestination(
                                      page.id,
                                      id,
                                      destination,
                                    )
                                  }
                                  onFocused={() =>
                                    setFocusBlockId((current) =>
                                      current === id ? null : current,
                                    )
                                  }
                                  sectionTargets={sectionTargets}
                                />
                              ) : null}
                              {block.type === "heading" ? (
                                <input
                                  value={
                                    typeof value.text === "string"
                                      ? value.text
                                      : ""
                                  }
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
                              {block.type === "text" ||
                              block.type === "callout" ? (
                                <textarea
                                  value={
                                    typeof value.text === "string"
                                      ? value.text
                                      : ""
                                  }
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
                              {block.type === "rich_text" ? (
                                <RichTextEditor
                                  businessSlug={businessSlug}
                                  pages={draft.pages}
                                  value={value}
                                  onChange={(node) =>
                                    updateBlock(page.id, id, (item) => {
                                      item.node = node;
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
                                        typeof value.label === "string"
                                          ? value.label
                                          : ""
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
                                        typeof value.href === "string"
                                          ? value.href
                                          : ""
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
                                  <SitePageDestinationField
                                    businessSlug={businessSlug}
                                    href={
                                      typeof value.href === "string"
                                        ? value.href
                                        : ""
                                    }
                                    onChange={(href) =>
                                      updateBlock(page.id, id, (item) => {
                                        item.href = href;
                                      })
                                    }
                                    pages={draft.pages}
                                  />
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
                                      <option value="secondary">
                                        Secondary
                                      </option>
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
                                        typeof value.alt === "string"
                                          ? value.alt
                                          : ""
                                      }
                                      onChange={(event) =>
                                        updateBlock(page.id, id, (item) => {
                                          item.alt = event.target.value;
                                          item.draft_state =
                                            event.target.value.trim() &&
                                            item.asset_id
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
                                        void uploadGalleryImage(
                                          event,
                                          page.id,
                                          id,
                                        );
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
                                      <option value="">
                                        Choose a Record type
                                      </option>
                                      {objectOptions.map((option) => (
                                        <option
                                          key={option.key}
                                          value={option.key}
                                        >
                                          {displayKey(option.key)}
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
                                      <option value="">
                                        No shared detail Page
                                      </option>
                                      {draft.pages.map((candidate) => (
                                        <option
                                          key={candidate.id}
                                          value={candidate.id}
                                        >
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
                                              Array.isArray(
                                                value.public_field_keys,
                                              ) &&
                                              value.public_field_keys.includes(
                                                field.key,
                                              )
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
                                          {displayKey(field.key)}
                                        </label>
                                      ),
                                    )}
                                  </fieldset>
                                  <label>
                                    Filter to Records with
                                    <select
                                      value={
                                        typeof filterField === "string"
                                          ? filterField
                                          : ""
                                      }
                                      onChange={(event) =>
                                        setCollectionFilter(
                                          page.id,
                                          id,
                                          event.target.value,
                                          "is_not_empty",
                                          collectionOption?.fieldOptions.find(
                                            (field) =>
                                              field.key === event.target.value,
                                          )?.fieldType,
                                        )
                                      }
                                    >
                                      <option value="">
                                        All selected Records
                                      </option>
                                      {(collectionOption?.fields ?? []).map(
                                        (field) => (
                                          <option key={field} value={field}>
                                            {displayKey(field)} is not empty
                                          </option>
                                        ),
                                      )}
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
                                        {filterOperatorsForField(
                                          filterFieldType,
                                        ).map((operator) => (
                                          <option
                                            key={operator}
                                            value={operator}
                                          >
                                            {filterOperatorLabel(operator)}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}
                                  {filterField &&
                                  !noValueFilterOperators.has(
                                    filterOperator,
                                  ) ? (
                                    <label>
                                      Filter value
                                      {filterFieldType === "boolean" ? (
                                        <select
                                          value={
                                            filterRawValue === true
                                              ? "true"
                                              : "false"
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
                                            typeof filterRawValue ===
                                              "number" ||
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
                                      <option value="">
                                        Keep selected order
                                      </option>
                                      {(collectionOption?.fields ?? []).map(
                                        (field) => (
                                          <option key={field} value={field}>
                                            {displayKey(field)}
                                          </option>
                                        ),
                                      )}
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
                                        <option value="ascending">
                                          Ascending
                                        </option>
                                        <option value="descending">
                                          Descending
                                        </option>
                                      </select>
                                    </label>
                                  ) : null}
                                  <div className="site-composer-record-options">
                                    <span className="muted">
                                      Selected Records
                                    </span>
                                    {(collectionOption?.records ?? []).map(
                                      (record) => (
                                        <div
                                          className="site-composer-record-option"
                                          key={record.id}
                                        >
                                          <label>
                                            <input
                                              checked={selectedRecordIds.has(
                                                record.id,
                                              )}
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
                                              {collectionFileFields.map(
                                                (field) => (
                                                  <label key={field.id}>
                                                    Record image (
                                                    {displayKey(field.key)})
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
                                                ),
                                              )}
                                            </div>
                                          ) : null}
                                        </div>
                                      ),
                                    )}
                                    {collectionOption &&
                                    collectionOption.records.length > 0 &&
                                    collectionFileFields.length === 0 ? (
                                      <span className="muted">
                                        Add a file Property to attach Record
                                        images.
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
                                          item.draft_state =
                                            event.target.value.trim()
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
                                    businessSlug={businessSlug}
                                    blocks={
                                      Array.isArray(value.blocks)
                                        ? (value.blocks as SiteBlock[])
                                        : []
                                    }
                                    appendBlock={appendNestedBlock}
                                    containerId={id}
                                    duplicateBlock={duplicateBlock}
                                    moveBlock={moveBlock}
                                    moveBlockAcrossSections={
                                      moveBlockAcrossSections
                                    }
                                    moveBlockToDestination={
                                      moveBlockToDestination
                                    }
                                    moveBlockToColumn={moveBlockToColumn}
                                    focusBlockId={focusBlockId}
                                    onUploadGalleryImage={uploadGalleryImage}
                                    onUploadImage={uploadImage}
                                    onBlockFocused={(blockId) =>
                                      setFocusBlockId((current) =>
                                        current === blockId ? null : current,
                                      )
                                    }
                                    pageId={page.id}
                                    pages={draft.pages}
                                    removeBlock={removeBlock}
                                    sectionTargets={sectionTargets}
                                    sectionIds={page.layout.blocks
                                      .filter((item) => item.type === "section")
                                      .map((item) => blockIdentity(item, ""))}
                                    setSectionColumns={setSectionColumns}
                                    setSectionPresentation={
                                      setSectionPresentation
                                    }
                                    updateBlock={updateBlock}
                                  />
                                </div>
                              ) : null}
                              {block.type === "section" ? (
                                <div className="site-composer-nested-editor">
                                  <div className="site-composer-collection-fields">
                                    <label>
                                      Width
                                      <select
                                        value={
                                          value.width === "wide"
                                            ? "wide"
                                            : "content"
                                        }
                                        onChange={(event) =>
                                          setSectionPresentation(
                                            page.id,
                                            id,
                                            "width",
                                            event.target.value,
                                          )
                                        }
                                      >
                                        <option value="content">
                                          Content width
                                        </option>
                                        <option value="wide">Wide</option>
                                      </select>
                                    </label>
                                    <label>
                                      Spacing
                                      <select
                                        value={
                                          value.spacing === "compact" ||
                                          value.spacing === "spacious"
                                            ? value.spacing
                                            : "comfortable"
                                        }
                                        onChange={(event) =>
                                          setSectionPresentation(
                                            page.id,
                                            id,
                                            "spacing",
                                            event.target.value,
                                          )
                                        }
                                      >
                                        <option value="compact">Compact</option>
                                        <option value="comfortable">
                                          Comfortable
                                        </option>
                                        <option value="spacious">
                                          Spacious
                                        </option>
                                      </select>
                                    </label>
                                    <label>
                                      Alignment
                                      <select
                                        value={
                                          value.alignment === "center" ||
                                          value.alignment === "end"
                                            ? value.alignment
                                            : "start"
                                        }
                                        onChange={(event) =>
                                          setSectionPresentation(
                                            page.id,
                                            id,
                                            "alignment",
                                            event.target.value,
                                          )
                                        }
                                      >
                                        <option value="start">Left</option>
                                        <option value="center">Center</option>
                                        <option value="end">Right</option>
                                      </select>
                                    </label>
                                    <label>
                                      Background
                                      <select
                                        value={
                                          value.background === "tint"
                                            ? "tint"
                                            : "plain"
                                        }
                                        onChange={(event) =>
                                          setSectionPresentation(
                                            page.id,
                                            id,
                                            "background",
                                            event.target.value,
                                          )
                                        }
                                      >
                                        <option value="plain">Plain</option>
                                        <option value="tint">Soft tint</option>
                                      </select>
                                    </label>
                                  </div>
                                  <label>
                                    Columns
                                    <select
                                      value={
                                        Array.isArray(value.columns)
                                          ? Math.min(
                                              Math.max(value.columns.length, 1),
                                              3,
                                            )
                                          : 1
                                      }
                                      onChange={(event) => {
                                        const nextCount = Number(
                                          event.target.value,
                                        );
                                        if (
                                          nextCount === 1 ||
                                          nextCount === 2 ||
                                          nextCount === 3
                                        ) {
                                          setSectionColumns(
                                            page.id,
                                            id,
                                            nextCount,
                                          );
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
                                        <strong>
                                          Column {columnIndex + 1}
                                        </strong>
                                        <NestedSiteBlocks
                                          businessSlug={businessSlug}
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
                                          moveBlockAcrossSections={
                                            moveBlockAcrossSections
                                          }
                                          moveBlockToDestination={
                                            moveBlockToDestination
                                          }
                                          moveBlockToColumn={moveBlockToColumn}
                                          focusBlockId={focusBlockId}
                                          onUploadGalleryImage={
                                            uploadGalleryImage
                                          }
                                          onUploadImage={uploadImage}
                                          onBlockFocused={(blockId) =>
                                            setFocusBlockId((current) =>
                                              current === blockId
                                                ? null
                                                : current,
                                            )
                                          }
                                          pageId={page.id}
                                          pages={draft.pages}
                                          removeBlock={removeBlock}
                                          sectionTargets={sectionTargets}
                                          sectionIds={page.layout.blocks
                                            .filter(
                                              (item) => item.type === "section",
                                            )
                                            .map((item) =>
                                              blockIdentity(item, ""),
                                            )}
                                          setSectionColumns={setSectionColumns}
                                          setSectionPresentation={
                                            setSectionPresentation
                                          }
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
                        aria-expanded={addBlockMenuOpen}
                        aria-haspopup="menu"
                        onClick={() => setAddBlockMenuOpen((open) => !open)}
                        ref={addBlockButtonRef}
                        type="button"
                      >
                        Add block
                      </button>
                      {addBlockMenuOpen ? (
                        <div
                          className="site-composer-add-menu"
                          ref={addBlockMenuRef}
                          role="menu"
                        >
                          <button
                            onClick={() =>
                              addBlock(page.id, newBlock("heading"))
                            }
                            role="menuitem"
                            type="button"
                          >
                            Add heading
                          </button>
                          <button
                            onClick={() => addBlock(page.id, newBlock("text"))}
                            role="menuitem"
                            type="button"
                          >
                            Add text
                          </button>
                          <button
                            onClick={() =>
                              addBlock(page.id, newRichTextBlock())
                            }
                            role="menuitem"
                            type="button"
                          >
                            Add formatted text
                          </button>
                          <button
                            onClick={() =>
                              addBlock(page.id, newBlock("callout"))
                            }
                            role="menuitem"
                            type="button"
                          >
                            Add callout
                          </button>
                          <button
                            onClick={() =>
                              addBlock(page.id, newBlock("button"))
                            }
                            role="menuitem"
                            type="button"
                          >
                            Add button
                          </button>
                          <button
                            onClick={() =>
                              addBlock(page.id, newBlock("divider"))
                            }
                            role="menuitem"
                            type="button"
                          >
                            Add divider
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addSection(page.id, 1);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add 1-column section
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addSection(page.id, 2);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add 2-column section
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addSection(page.id, 3);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add 3-column section
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addImage(page.id);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add Site image
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addGallery(page.id);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add image gallery
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addCollapsible(page.id);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add collapsible section
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addCollection(page.id);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add Record collection
                          </button>
                          <button
                            onClick={() => {
                              setAddBlockMenuOpen(false);
                              addRecordDetail(page.id);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Add shared Record detail
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </section>
                </article>
              );
            })}
        </main>
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
type SiteBlockMoveToColumn = (
  pageId: string,
  sectionId: string,
  blockId: string,
  sourceColumnIndex: number,
  targetColumnIndex: number,
) => void;
type SiteBlockMoveAcrossSections = (
  pageId: string,
  sectionId: string,
  blockId: string,
  offset: -1 | 1,
) => void;
type SiteBlockMoveToDestination = (
  pageId: string,
  blockId: string,
  destination: string,
) => void;
type SiteBlockUpload = (
  event: FormEvent<HTMLInputElement>,
  pageId: string,
  blockId: string,
) => Promise<void>;

type SiteSectionTarget = {
  id: string;
  label: string;
  columnCount: number;
};

function richTextNodeLabel(type: RichTextNodeType): string {
  if (type === "bullet_list") return "Bulleted list";
  if (type === "numbered_list") return "Numbered list";
  return type === "heading" ? "Heading" : "Paragraph";
}

function sitePageHref(businessSlug: string, pageSlug: string): string {
  return `/p/${encodeURIComponent(businessSlug)}/${encodeURIComponent(
    pageSlug,
  )}`;
}

function siteSectionTargets(page: SitePage): SiteSectionTarget[] {
  return page.layout.blocks.flatMap((block, index) => {
    if (block.type !== "section" || typeof block.id !== "string") return [];
    return [
      {
        id: block.id,
        label: `Section ${index + 1}`,
        columnCount: block.columns.length,
      },
    ];
  });
}

function siteSectionDestination(
  sectionId: string,
  columnIndex: number,
): string {
  return `section:${sectionId}:${columnIndex}`;
}

function parseSiteBlockDestination(
  value: string,
):
  | { kind: "root" }
  | { kind: "section"; sectionId: string; columnIndex: number }
  | null {
  if (value === "root") return { kind: "root" };
  const match = /^section:([^:]+):([0-2])$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return {
    kind: "section",
    sectionId: match[1],
    columnIndex: Number(match[2]),
  };
}

function SiteBlockDestinationField({
  currentDestination,
  focusOnMount = false,
  onMove,
  onFocused,
  sectionTargets,
}: Readonly<{
  currentDestination: string;
  focusOnMount?: boolean;
  onMove: (destination: string) => void;
  onFocused?: () => void;
  sectionTargets: readonly SiteSectionTarget[];
}>): ReactNode {
  const selectRef = useCallback(
    (element: HTMLSelectElement | null) => {
      if (!element || !focusOnMount) return;
      element.focus();
      if (document.activeElement === element) onFocused?.();
    },
    [focusOnMount, onFocused],
  );
  return (
    <label className="site-composer-move-destination">
      Move block to
      <select
        aria-label="Move block to"
        onChange={(event) => onMove(event.target.value)}
        ref={focusOnMount ? selectRef : undefined}
        value={currentDestination}
      >
        <option value="root">Page content</option>
        {sectionTargets.map((section) =>
          Array.from({ length: section.columnCount }, (_, columnIndex) => (
            <option
              key={siteSectionDestination(section.id, columnIndex)}
              value={siteSectionDestination(section.id, columnIndex)}
            >
              {section.label} · Column {columnIndex + 1}
            </option>
          )),
        )}
      </select>
    </label>
  );
}

function sitePageSlugForHref(
  businessSlug: string,
  href: string,
  pages: readonly SitePage[],
): string | null {
  const canonicalPage = pages.find(
    (page) => sitePageHref(businessSlug, page.slug) === href,
  );
  return canonicalPage?.slug ?? null;
}

function SitePageDestinationField({
  businessSlug,
  href,
  onChange,
  pages,
}: Readonly<{
  businessSlug: string;
  href: string;
  onChange: (href: string) => void;
  pages: readonly SitePage[];
}>): ReactNode {
  const selectedSlug = sitePageSlugForHref(businessSlug, href, pages) ?? "";
  return (
    <label>
      Site Page destination
      <select
        aria-label="Site Page destination"
        onChange={(event) => {
          const page = pages.find(
            (candidate) => candidate.slug === event.target.value,
          );
          if (page) onChange(sitePageHref(businessSlug, page.slug));
        }}
        value={selectedSlug}
      >
        <option value="">Choose a Site Page</option>
        {pages
          .filter((page) => page.is_included)
          .map((page) => (
            <option key={page.id} value={page.slug}>
              {page.navigation_label || page.title}
            </option>
          ))}
      </select>
    </label>
  );
}

function RichTextEditor({
  businessSlug,
  pages,
  value,
  onChange,
}: Readonly<{
  businessSlug: string;
  pages: readonly SitePage[];
  value: UnknownRecord;
  onChange: (node: UnknownRecord) => void;
}>): ReactNode {
  const node = asRecord(value.node);
  const type = richTextNodeType(node);
  const marks = richTextMarks(node);
  const text = richTextNodeText(node);
  const level =
    node.level === 1 || node.level === 3 ? node.level : (2 as const);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const update = (
    changes: Partial<{
      type: RichTextNodeType;
      text: string;
      bold: boolean;
      italic: boolean;
      link: string;
      level: 1 | 2 | 3;
    }>,
  ): void => {
    const nextType = changes.type ?? type;
    const nextLevel = changes.level ?? level;
    if (
      changes.text !== undefined &&
      (nextType === "bullet_list" || nextType === "numbered_list") &&
      changes.text.split("\n").length > 50
    ) {
      setValidationMessage("Lists can contain up to 50 items.");
      return;
    }
    setValidationMessage(null);
    if (changes.text !== undefined) {
      onChange(richTextNodeWithText(node, changes.text, nextType, nextLevel));
      return;
    }
    if (changes.type !== undefined || changes.level !== undefined) {
      onChange(richTextNodeWithType(node, nextType, nextLevel));
      return;
    }
    onChange(
      richTextNodeWithMarks(node, {
        ...(changes.bold !== undefined ? { bold: changes.bold } : {}),
        ...(changes.italic !== undefined ? { italic: changes.italic } : {}),
        ...(changes.link !== undefined ? { link: changes.link } : {}),
      }),
    );
  };

  return (
    <div className="site-composer-rich-text-fields">
      <label>
        Format
        <select
          value={type}
          onChange={(event) => {
            const nextType = event.target.value as RichTextNodeType;
            if (richTextNodeTypes.includes(nextType))
              update({ type: nextType });
          }}
        >
          {richTextNodeTypes.map((option) => (
            <option key={option} value={option}>
              {richTextNodeLabel(option)}
            </option>
          ))}
        </select>
      </label>
      {type === "heading" ? (
        <label>
          Heading level
          <select
            value={level}
            onChange={(event) => {
              const nextLevel = Number(event.target.value);
              if (nextLevel === 1 || nextLevel === 2 || nextLevel === 3) {
                update({ level: nextLevel });
              }
            }}
          >
            <option value={1}>Large</option>
            <option value={2}>Medium</option>
            <option value={3}>Small</option>
          </select>
        </label>
      ) : null}
      <label>
        {type === "bullet_list" || type === "numbered_list"
          ? "List items"
          : "Content"}
        <textarea
          aria-label={
            type === "bullet_list" || type === "numbered_list"
              ? "List items"
              : "Formatted text content"
          }
          maxLength={type === "heading" ? 200 : 5000}
          onChange={(event) => update({ text: event.target.value })}
          placeholder={
            type === "bullet_list" || type === "numbered_list"
              ? "One item per line"
              : "Write something useful."
          }
          rows={type === "bullet_list" || type === "numbered_list" ? 6 : 4}
          value={text}
        />
      </label>
      {validationMessage ? (
        <small className="site-composer-inline-error" role="status">
          {validationMessage}
        </small>
      ) : null}
      {type !== "bullet_list" && type !== "numbered_list" ? (
        <div className="site-composer-toggles">
          <label>
            <input
              checked={marks.bold}
              onChange={(event) => update({ bold: event.target.checked })}
              type="checkbox"
            />{" "}
            Bold
          </label>
          <label>
            <input
              checked={marks.italic}
              onChange={(event) => update({ italic: event.target.checked })}
              type="checkbox"
            />{" "}
            Italic
          </label>
        </div>
      ) : null}
      <label>
        Link (optional)
        <input
          inputMode="url"
          onBlur={(event) => {
            // The field stays uncontrolled while an owner types a URL. The
            // canonical node is updated only once the bounded URL is valid;
            // restore the last accepted value when focus leaves an invalid
            // entry.
            const input = event.currentTarget;
            if (input.value && !safeRichTextHrefPattern.test(input.value)) {
              input.value = marks.link;
            }
          }}
          onChange={(event) => {
            const nextLink = event.target.value;
            if (!nextLink || safeRichTextHrefPattern.test(nextLink)) {
              update({ link: nextLink });
            }
          }}
          placeholder="https://example.com or use Site Page destination"
          type="url"
          defaultValue={marks.link}
        />
      </label>
      <SitePageDestinationField
        businessSlug={businessSlug}
        href={marks.link}
        onChange={(href) => update({ link: href })}
        pages={pages}
      />
      <small className="muted">
        Use one line per list item. Links accept secure web, site, email, or
        phone addresses.
      </small>
    </div>
  );
}

function NestedSiteBlocks({
  businessSlug,
  blocks,
  appendBlock,
  columnIndex,
  containerId,
  duplicateBlock,
  moveBlock,
  moveBlockAcrossSections,
  moveBlockToDestination,
  moveBlockToColumn,
  focusBlockId,
  onBlockFocused,
  onUploadGalleryImage,
  onUploadImage,
  pageId,
  pages,
  removeBlock,
  sectionTargets,
  sectionIds,
  setSectionColumns,
  setSectionPresentation,
  updateBlock,
}: Readonly<{
  businessSlug: string;
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
  moveBlockAcrossSections: SiteBlockMoveAcrossSections;
  moveBlockToDestination: SiteBlockMoveToDestination;
  moveBlockToColumn: SiteBlockMoveToColumn;
  focusBlockId: string | null;
  onBlockFocused: (blockId: string) => void;
  onUploadGalleryImage: SiteBlockUpload;
  onUploadImage: SiteBlockUpload;
  pageId: string;
  pages: readonly SitePage[];
  removeBlock: SiteBlockMove;
  sectionTargets: readonly SiteSectionTarget[];
  sectionIds: readonly string[];
  setSectionColumns: (
    pageId: string,
    blockId: string,
    columnCount: 1 | 2 | 3,
  ) => void;
  setSectionPresentation: (
    pageId: string,
    blockId: string,
    property: "width" | "spacing" | "alignment" | "background",
    value: string,
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
        const sectionIndex = sectionIds.indexOf(containerId);
        return (
          <div
            className="site-composer-nested-block"
            data-site-block-id={id}
            key={id}
          >
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
                {typeof columnIndex === "number" ? (
                  <>
                    <button
                      aria-label="Move to previous column"
                      disabled={columnIndex === 0}
                      onClick={() =>
                        moveBlockToColumn(
                          pageId,
                          containerId,
                          id,
                          columnIndex,
                          columnIndex - 1,
                        )
                      }
                      title="Move to previous column"
                      type="button"
                    >
                      ←
                    </button>
                    <button
                      aria-label="Move to next column"
                      disabled={columnIndex >= 2}
                      onClick={() =>
                        moveBlockToColumn(
                          pageId,
                          containerId,
                          id,
                          columnIndex,
                          columnIndex + 1,
                        )
                      }
                      title="Move to next column"
                      type="button"
                    >
                      →
                    </button>
                    <button
                      aria-label="Move to previous section"
                      disabled={sectionIndex <= 0}
                      onClick={() =>
                        moveBlockAcrossSections(pageId, containerId, id, -1)
                      }
                      title="Move to previous section"
                      type="button"
                    >
                      ↑ section
                    </button>
                    <button
                      aria-label="Move to next section"
                      disabled={
                        sectionIndex < 0 ||
                        sectionIndex >= sectionIds.length - 1
                      }
                      onClick={() =>
                        moveBlockAcrossSections(pageId, containerId, id, 1)
                      }
                      title="Move to next section"
                      type="button"
                    >
                      ↓ section
                    </button>
                  </>
                ) : null}
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
            {typeof columnIndex === "number" ? (
              <SiteBlockDestinationField
                currentDestination={siteSectionDestination(
                  containerId,
                  columnIndex,
                )}
                focusOnMount={focusBlockId === id}
                onMove={(destination) =>
                  moveBlockToDestination(pageId, id, destination)
                }
                onFocused={() => onBlockFocused(id)}
                sectionTargets={sectionTargets}
              />
            ) : null}
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
            {block.type === "rich_text" ? (
              <RichTextEditor
                businessSlug={businessSlug}
                pages={pages}
                value={value}
                onChange={(node) =>
                  updateBlock(pageId, id, (item) => {
                    item.node = node;
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
                <SitePageDestinationField
                  businessSlug={businessSlug}
                  href={typeof value.href === "string" ? value.href : ""}
                  onChange={(href) =>
                    updateBlock(pageId, id, (item) => {
                      item.href = href;
                    })
                  }
                  pages={pages}
                />
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
                  businessSlug={businessSlug}
                  blocks={
                    Array.isArray(value.blocks)
                      ? (value.blocks as SiteBlock[])
                      : []
                  }
                  appendBlock={appendBlock}
                  containerId={id}
                  duplicateBlock={duplicateBlock}
                  moveBlock={moveBlock}
                  moveBlockAcrossSections={moveBlockAcrossSections}
                  moveBlockToDestination={moveBlockToDestination}
                  moveBlockToColumn={moveBlockToColumn}
                  focusBlockId={focusBlockId}
                  onUploadGalleryImage={onUploadGalleryImage}
                  onUploadImage={onUploadImage}
                  onBlockFocused={onBlockFocused}
                  pageId={pageId}
                  pages={pages}
                  removeBlock={removeBlock}
                  sectionTargets={sectionTargets}
                  sectionIds={sectionIds}
                  setSectionColumns={setSectionColumns}
                  setSectionPresentation={setSectionPresentation}
                  updateBlock={updateBlock}
                />
              </div>
            ) : null}
            {block.type === "section" ? (
              <div className="site-composer-nested-editor">
                <div className="site-composer-collection-fields">
                  <label>
                    Width
                    <select
                      value={value.width === "wide" ? "wide" : "content"}
                      onChange={(event) =>
                        setSectionPresentation(
                          pageId,
                          id,
                          "width",
                          event.target.value,
                        )
                      }
                    >
                      <option value="content">Content width</option>
                      <option value="wide">Wide</option>
                    </select>
                  </label>
                  <label>
                    Spacing
                    <select
                      value={
                        value.spacing === "compact" ||
                        value.spacing === "spacious"
                          ? value.spacing
                          : "comfortable"
                      }
                      onChange={(event) =>
                        setSectionPresentation(
                          pageId,
                          id,
                          "spacing",
                          event.target.value,
                        )
                      }
                    >
                      <option value="compact">Compact</option>
                      <option value="comfortable">Comfortable</option>
                      <option value="spacious">Spacious</option>
                    </select>
                  </label>
                  <label>
                    Alignment
                    <select
                      value={
                        value.alignment === "center" ||
                        value.alignment === "end"
                          ? value.alignment
                          : "start"
                      }
                      onChange={(event) =>
                        setSectionPresentation(
                          pageId,
                          id,
                          "alignment",
                          event.target.value,
                        )
                      }
                    >
                      <option value="start">Left</option>
                      <option value="center">Center</option>
                      <option value="end">Right</option>
                    </select>
                  </label>
                  <label>
                    Background
                    <select
                      value={value.background === "tint" ? "tint" : "plain"}
                      onChange={(event) =>
                        setSectionPresentation(
                          pageId,
                          id,
                          "background",
                          event.target.value,
                        )
                      }
                    >
                      <option value="plain">Plain</option>
                      <option value="tint">Soft tint</option>
                    </select>
                  </label>
                </div>
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
                          businessSlug={businessSlug}
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
                          moveBlockAcrossSections={moveBlockAcrossSections}
                          moveBlockToDestination={moveBlockToDestination}
                          moveBlockToColumn={moveBlockToColumn}
                          focusBlockId={focusBlockId}
                          onUploadGalleryImage={onUploadGalleryImage}
                          onUploadImage={onUploadImage}
                          onBlockFocused={onBlockFocused}
                          pageId={pageId}
                          pages={pages}
                          removeBlock={removeBlock}
                          sectionTargets={sectionTargets}
                          sectionIds={sectionIds}
                          setSectionColumns={setSectionColumns}
                          setSectionPresentation={setSectionPresentation}
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
            appendBlock(pageId, containerId, newRichTextBlock(), columnIndex)
          }
          type="button"
        >
          Add formatted text
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
