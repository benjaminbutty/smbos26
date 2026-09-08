import {
  ConfigurationIdentityAllocationError,
  createGraphKeyAllocator,
  createPageSlugAllocator,
} from "../identity-allocation";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  configurationOperationsSchema,
  setPageOperationSchema,
  type ConfigurationOperation,
} from "../schemas";
import {
  normalizeTableViewConfig,
  pageBlockSchema,
  pageLayoutSchema,
  type PageLayout,
} from "../../experience/schemas";
import { walkPageBlocks } from "../../experience/page-blocks";
import {
  directPageIntentSchema,
  type DirectPageBlockInput,
  type DirectPageActionKind,
  type DirectPageIntent,
} from "./schemas";

type PageOperation = Extract<ConfigurationOperation, { op: "set_page" }>;

export const directPageErrorCodes = [
  "direct_page_input_invalid",
  "direct_page_snapshot_invalid",
  "direct_page_not_found",
  "direct_page_title_conflict",
  "direct_page_key_unavailable",
  "direct_page_slug_unavailable",
  "direct_page_view_unavailable",
  "direct_page_published_site_ineligible",
  "direct_page_published_site_requires_publication",
  "direct_page_site_block_locked",
  "direct_page_site_rich_text_unsupported",
  "direct_page_block_not_found",
  "direct_page_block_unchanged",
  "direct_page_operations_invalid",
  "direct_page_public_lifecycle_unsupported",
  "direct_page_checklist_name_conflict",
  "direct_page_checklist_unavailable",
] as const;

export type DirectPageErrorCode = (typeof directPageErrorCodes)[number];

const directPageErrorMessages: Readonly<Record<DirectPageErrorCode, string>> = {
  direct_page_input_invalid:
    "Check the Page name, content, and current screen, then try again.",
  direct_page_snapshot_invalid:
    "The current Page setup could not be read safely. Reload and try again.",
  direct_page_not_found:
    "That Page is no longer available. Reload and try again.",
  direct_page_title_conflict:
    "A Page with that name already exists. Choose a different name.",
  direct_page_key_unavailable:
    "That Page could not be prepared safely. Try a different name.",
  direct_page_slug_unavailable:
    "That Page address could not be prepared safely. Try a different name.",
  direct_page_view_unavailable:
    "That saved View is no longer available to add to this Page.",
  direct_page_published_site_ineligible:
    "This Page is not an active published Site. Reload and try again.",
  direct_page_published_site_requires_publication:
    "Published Site edits must be reviewed and published together. Reload the Site editor and use Publish changes.",
  direct_page_site_block_locked:
    "Booking, Form and other customer capabilities can be reordered here, but their settings and presence cannot be changed.",
  direct_page_site_rich_text_unsupported:
    "Rich document formatting is available on internal Pages only. This Site keeps its existing supported content controls.",
  direct_page_block_not_found:
    "That Page block is no longer available. Reload and try again.",
  direct_page_block_unchanged: "That Page block is already in that position.",
  direct_page_operations_invalid:
    "The Page change could not be prepared safely. Reload and try again.",
  direct_page_public_lifecycle_unsupported:
    "Public Sites keep their existing publishing controls. Manage this Page from internal Pages.",
  direct_page_checklist_name_conflict:
    "A checklist with that name already exists. Choose a different name.",
  direct_page_checklist_unavailable:
    "This checklist could not be prepared safely. Reload and try again.",
};

export class DirectPageComposerError extends Error {
  readonly code: DirectPageErrorCode;
  override readonly cause: unknown;

  constructor(code: DirectPageErrorCode, cause?: unknown) {
    super(directPageErrorMessages[code]);
    this.name = "DirectPageComposerError";
    this.code = code;
    this.cause = cause;
  }
}

export function directPageOwnerMessage(code: DirectPageErrorCode): string {
  return directPageErrorMessages[code];
}

export interface ComposedDirectPageAction {
  actionKind: DirectPageActionKind;
  title: string;
  description: string;
  operations: ConfigurationOperation[];
  pageKey: string;
  pageSlug: string;
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
}

function parseSnapshot(input: unknown): ConfigurationSnapshotV1 {
  try {
    return configurationSnapshotV1Schema.parse(input);
  } catch (error) {
    throw new DirectPageComposerError("direct_page_snapshot_invalid", error);
  }
}

function parseIntent(input: unknown): DirectPageIntent {
  try {
    return directPageIntentSchema.parse(input);
  } catch (error) {
    throw new DirectPageComposerError("direct_page_input_invalid", error);
  }
}

function allocateKey(
  reserved: Iterable<string>,
  value: string,
  fallback: string,
): string {
  try {
    return createGraphKeyAllocator(reserved).allocate(value, fallback);
  } catch (error) {
    if (
      error instanceof ConfigurationIdentityAllocationError &&
      error.code === "configuration_identity_key_unavailable"
    ) {
      throw new DirectPageComposerError("direct_page_key_unavailable", error);
    }
    throw error;
  }
}

function allocateSlug(reserved: Iterable<string>, value: string): string {
  try {
    return createPageSlugAllocator(reserved).allocate(value);
  } catch (error) {
    if (
      error instanceof ConfigurationIdentityAllocationError &&
      error.code === "configuration_identity_slug_unavailable"
    ) {
      throw new DirectPageComposerError("direct_page_slug_unavailable", error);
    }
    throw error;
  }
}

function activePage(
  snapshot: ConfigurationSnapshotV1,
  pageKey: string,
): (typeof snapshot.pages)[number] {
  const page = snapshot.pages.find(
    (candidate) => candidate.key === pageKey && candidate.is_active,
  );
  if (!page) {
    throw new DirectPageComposerError("direct_page_not_found");
  }
  return page;
}

function pageTitleConflict(
  snapshot: ConfigurationSnapshotV1,
  title: string,
  exceptPageKey?: string,
  audience?: "internal" | "public",
): boolean {
  const normalized = normalizeLabel(title);
  return snapshot.pages.some(
    (page) =>
      page.key !== exceptPageKey &&
      (audience === undefined || page.audience === audience) &&
      page.is_active &&
      normalizeLabel(page.title) === normalized,
  );
}

function pageLayoutWithStableIds(input: unknown, freshIds = false): PageLayout {
  const layout = pageLayoutSchema.parse(input);
  const assign = (input: unknown): unknown => {
    const block = pageBlockSchema.parse(input);
    const id =
      freshIds || !("id" in block && block.id)
        ? globalThis.crypto.randomUUID()
        : block.id;
    if (block.type !== "collapsible") return { ...block, id };
    return {
      ...block,
      id,
      blocks: block.blocks.map((child) => assign(child)),
    };
  };
  return pageLayoutSchema.parse({
    blocks: layout.blocks.map((block) => assign(block)),
  });
}

function pageBlockFromInput(
  input: DirectPageBlockInput,
): PageLayout["blocks"][number] {
  switch (input.type) {
    case "heading":
      return {
        type: "heading",
        text: input.text,
        level: input.level,
      };
    case "text":
      return { type: "text", text: input.text };
    case "divider":
      return { type: "divider" };
    case "view":
      return {
        type: "view",
        view_key: input.viewKey,
        ...(input.readOnly ? { read_only: true } : {}),
        ...(input.checklist
          ? {
              checklist: {
                label_field: input.checklist.labelField,
                completed_field: input.checklist.completedField,
              },
            }
          : {}),
      };
    case "image":
      return {
        type: "image",
        ...(input.src ? { src: input.src } : {}),
        ...(input.assetId ? { asset_id: input.assetId } : {}),
        alt: input.alt,
        ...(input.caption ? { caption: input.caption } : {}),
        presentation: input.presentation,
      };
    case "collapsible":
      return {
        type: "collapsible",
        summary: input.summary,
        blocks: [],
        open: true,
      };
  }
}

function assertEligibleSavedView(
  snapshot: ConfigurationSnapshotV1,
  viewKey: string,
): void {
  const view = snapshot.views.find(
    (candidate) =>
      candidate.key === viewKey &&
      candidate.view_type === "table" &&
      candidate.audience === "internal" &&
      candidate.is_active,
  );
  if (!view) {
    throw new DirectPageComposerError("direct_page_view_unavailable");
  }
}

function assertChecklistViewFields(
  snapshot: ConfigurationSnapshotV1,
  viewKey: string,
  labelField: string,
  completedField: string,
  readOnly = false,
): void {
  assertEligibleSavedView(snapshot, viewKey);
  const view = snapshot.views.find((candidate) => candidate.key === viewKey);
  if (!view) {
    throw new DirectPageComposerError("direct_page_checklist_unavailable");
  }
  const object = snapshot.object_definitions.find(
    (candidate) => candidate.id === view?.object_definition_id,
  );
  const fields = snapshot.field_definitions.filter(
    (field) => field.object_definition_id === object?.id && field.is_active,
  );
  const viewConfig = normalizeTableViewConfig(view.config_json);
  const visibleFieldKeys = new Set(viewConfig.fields);
  const label = fields.find((field) => field.key === labelField);
  const completed = fields.find((field) => field.key === completedField);
  const editForm = viewConfig.edit_form_key
    ? snapshot.forms.find(
        (form) =>
          form.key === viewConfig.edit_form_key &&
          form.object_definition_id === object?.id &&
          form.mode === "edit" &&
          form.is_active,
      )
    : undefined;
  const writableFieldKeys = editForm
    ? new Set(
        editForm.config_json.fields
          .filter((field) => !field.hidden)
          .map((field) => field.field),
      )
    : null;
  if (
    !label ||
    !visibleFieldKeys.has(label.key) ||
    !new Set(["short_text", "long_text", "email", "phone", "url"]).has(
      label.field_type,
    ) ||
    !completed ||
    !visibleFieldKeys.has(completed.key) ||
    completed.field_type !== "boolean" ||
    (!readOnly &&
      writableFieldKeys !== null &&
      (!writableFieldKeys.has(label.key) ||
        !writableFieldKeys.has(completed.key)))
  ) {
    throw new DirectPageComposerError("direct_page_checklist_unavailable");
  }
}

type PageBlockItem = PageLayout["blocks"][number];

function blockMatches(
  block: PageBlockItem,
  blockId: string,
  index: number,
  allowLegacyId: boolean,
): boolean {
  if ("id" in block && block.id === blockId) return true;
  if (!allowLegacyId) return false;
  const legacyIndex = /^legacy:(\d+)$/.exec(blockId)?.[1];
  return legacyIndex !== undefined && Number(legacyIndex) === index;
}

function insertAfterBlock(
  blocks: readonly PageBlockItem[],
  afterBlockId: string,
  nextBlock: PageBlockItem,
  allowLegacyId: boolean,
): PageBlockItem[] | null {
  const index = blocks.findIndex((block, candidateIndex) =>
    blockMatches(block, afterBlockId, candidateIndex, allowLegacyId),
  );
  if (index >= 0) {
    return [
      ...blocks.slice(0, index + 1),
      nextBlock,
      ...blocks.slice(index + 1),
    ];
  }
  for (let childIndex = 0; childIndex < blocks.length; childIndex += 1) {
    const block = blocks[childIndex];
    if (block?.type !== "collapsible") continue;
    const children = insertAfterBlock(
      block.blocks,
      afterBlockId,
      nextBlock,
      false,
    );
    if (!children) continue;
    return blocks.map((candidate, candidateIndex) =>
      candidateIndex === childIndex
        ? ({ ...block, blocks: children } as PageBlockItem)
        : candidate,
    );
  }
  return null;
}

function insertIntoContainer(
  blocks: readonly PageBlockItem[],
  containerBlockId: string,
  afterBlockId: string | null | undefined,
  nextBlock: PageBlockItem,
): PageBlockItem[] | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if ("id" in block && block.id === containerBlockId) {
      if (block.type !== "collapsible") return null;
      let children: PageBlockItem[] | null;
      if (afterBlockId === null) {
        children = [nextBlock, ...block.blocks];
      } else if (afterBlockId === undefined) {
        children = [...block.blocks, nextBlock];
      } else {
        children = insertAfterBlock(
          block.blocks,
          afterBlockId,
          nextBlock,
          false,
        );
      }
      if (!children) return null;
      return blocks.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? ({ ...block, blocks: children } as PageBlockItem)
          : candidate,
      );
    }
    if (block.type !== "collapsible") continue;
    const nested = insertIntoContainer(
      block.blocks,
      containerBlockId,
      afterBlockId,
      nextBlock,
    );
    if (!nested) continue;
    return blocks.map((candidate, candidateIndex) =>
      candidateIndex === index
        ? ({ ...block, blocks: nested } as PageBlockItem)
        : candidate,
    );
  }
  return null;
}

function rewriteBlock(
  blocks: readonly PageBlockItem[],
  blockId: string,
  transform: (block: PageBlockItem) => PageBlockItem | null,
  allowLegacyId: boolean,
): { blocks: PageBlockItem[]; found: boolean } {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (blockMatches(block, blockId, index, allowLegacyId)) {
      const replacement = transform(block);
      return {
        blocks:
          replacement === null
            ? [...blocks.slice(0, index), ...blocks.slice(index + 1)]
            : blocks.map((candidate, candidateIndex) =>
                candidateIndex === index ? replacement : candidate,
              ),
        found: true,
      };
    }
    if (block.type !== "collapsible") continue;
    const nested = rewriteBlock(block.blocks, blockId, transform, false);
    if (!nested.found) continue;
    return {
      blocks: blocks.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? ({ ...block, blocks: nested.blocks } as PageBlockItem)
          : candidate,
      ),
      found: true,
    };
  }
  return { blocks: [...blocks], found: false };
}

function moveBlock(
  blocks: readonly PageBlockItem[],
  blockId: string,
  direction: "up" | "down",
  allowLegacyId: boolean,
): { blocks: PageBlockItem[]; found: boolean; moved: boolean } {
  const index = blocks.findIndex((block, candidateIndex) =>
    blockMatches(block, blockId, candidateIndex, allowLegacyId),
  );
  if (index >= 0) {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= blocks.length) {
      return { blocks: [...blocks], found: true, moved: false };
    }
    const next = [...blocks];
    const current = next[index];
    const adjacent = next[nextIndex];
    if (!current || !adjacent) {
      return { blocks: [...blocks], found: true, moved: false };
    }
    next[index] = adjacent;
    next[nextIndex] = current;
    return { blocks: next, found: true, moved: true };
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block?.type !== "collapsible") continue;
    const nested = moveBlock(block.blocks, blockId, direction, false);
    if (!nested.found) continue;
    return {
      blocks: blocks.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? ({ ...block, blocks: nested.blocks } as PageBlockItem)
          : candidate,
      ),
      found: true,
      moved: nested.moved,
    };
  }
  return { blocks: [...blocks], found: false, moved: false };
}

function pageOperation(values: Omit<PageOperation, "op">): PageOperation {
  return setPageOperationSchema.parse({ op: "set_page", ...values });
}

function siteBlockIsEditable(block: PageLayout["blocks"][number]): boolean {
  return (
    block.type === "heading" ||
    block.type === "text" ||
    block.type === "divider"
  );
}

function lockedSiteBlockCounts(layout: PageLayout): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of layout.blocks) {
    if (siteBlockIsEditable(block)) continue;
    const configuredBlock = { ...block, id: undefined };
    const signature = JSON.stringify(configuredBlock);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return counts;
}

function assertLockedSiteBlocksUnchanged(
  baseLayout: PageLayout,
  candidateLayout: PageLayout,
): void {
  const candidateSignatures = new Set(
    candidateLayout.blocks
      .filter((block) => !siteBlockIsEditable(block))
      .map((block) => JSON.stringify(block)),
  );
  const stableBaseBlocksRemain = baseLayout.blocks
    .filter(
      (block) =>
        !siteBlockIsEditable(block) && "id" in block && Boolean(block.id),
    )
    .every((block) => candidateSignatures.has(JSON.stringify(block)));
  const base = lockedSiteBlockCounts(baseLayout);
  const candidate = lockedSiteBlockCounts(candidateLayout);
  if (
    !stableBaseBlocksRemain ||
    base.size !== candidate.size ||
    [...base].some(([signature, count]) => candidate.get(signature) !== count)
  ) {
    throw new DirectPageComposerError("direct_page_site_block_locked");
  }
}

function finalizeAction(
  actionKind: DirectPageActionKind,
  title: string,
  pageKey: string,
  pageSlug: string,
  operation: PageOperation,
): ComposedDirectPageAction {
  try {
    return {
      actionKind,
      title: title.slice(0, 120),
      description: `Direct Page Workspace action: ${actionKind}.`,
      operations: configurationOperationsSchema.parse([operation]),
      pageKey,
      pageSlug,
    };
  } catch (error) {
    throw new DirectPageComposerError("direct_page_operations_invalid", error);
  }
}

function composeCreatePage(
  snapshot: ConfigurationSnapshotV1,
  title: string,
): ComposedDirectPageAction {
  const resolvedTitle =
    normalizeLabel(title) === normalizeLabel("Untitled page")
      ? allocateUniquePageTitle(snapshot, "Untitled page")
      : title;
  if (pageTitleConflict(snapshot, resolvedTitle, undefined, "internal")) {
    throw new DirectPageComposerError("direct_page_title_conflict");
  }

  const pageKey = allocateKey(
    snapshot.pages.map((page) => page.key),
    resolvedTitle,
    "page",
  );
  const pageSlug = allocateSlug(
    snapshot.pages.map((page) => page.slug),
    resolvedTitle,
  );
  return finalizeAction(
    "create_page",
    `Create ${resolvedTitle}`,
    pageKey,
    pageSlug,
    pageOperation({
      key: pageKey,
      title: resolvedTitle,
      slug: pageSlug,
      audience: "internal",
      layout_json: { blocks: [] },
      status: "draft",
      is_active: true,
    }),
  );
}

function composePageMutation(
  snapshot: ConfigurationSnapshotV1,
  intent: Exclude<DirectPageIntent, { action: "create_page" }>,
): ComposedDirectPageAction {
  const page =
    intent.action === "restore_page"
      ? snapshot.pages.find((candidate) => candidate.key === intent.pageKey)
      : activePage(snapshot, intent.pageKey);
  if (!page) throw new DirectPageComposerError("direct_page_not_found");
  const baseLayout = pageLayoutSchema.parse(page.layout_json);

  if (
    page.audience === "public" &&
    (intent.action === "duplicate_page" ||
      intent.action === "archive_page" ||
      intent.action === "restore_page")
  ) {
    throw new DirectPageComposerError(
      "direct_page_public_lifecycle_unsupported",
    );
  }

  if (intent.action === "duplicate_page") {
    if (page.audience !== "internal") {
      throw new DirectPageComposerError(
        "direct_page_public_lifecycle_unsupported",
      );
    }
    const duplicateTitle = allocateUniquePageTitle(
      snapshot,
      `Copy of ${page.title}`,
      page.key,
    );
    const pageKey = allocateKey(
      snapshot.pages.map((candidate) => candidate.key),
      duplicateTitle,
      "page",
    );
    const pageSlug = allocateSlug(
      snapshot.pages.map((candidate) => candidate.slug),
      duplicateTitle,
    );
    return finalizeAction(
      "duplicate_page",
      `Duplicate ${page.title}`,
      pageKey,
      pageSlug,
      pageOperation({
        key: pageKey,
        title: duplicateTitle,
        slug: pageSlug,
        audience: "internal",
        layout_json: pageLayoutWithStableIds(baseLayout, true),
        status: "draft",
        is_active: true,
      }),
    );
  }

  if (intent.action === "archive_page" || intent.action === "restore_page") {
    const shouldRestore = intent.action === "restore_page";
    if (shouldRestore && page.is_active) {
      throw new DirectPageComposerError("direct_page_block_unchanged");
    }
    if (!shouldRestore && !page.is_active) {
      throw new DirectPageComposerError("direct_page_block_unchanged");
    }
    return finalizeAction(
      intent.action,
      `${shouldRestore ? "Restore" : "Archive"} ${page.title}`,
      page.key,
      page.slug,
      pageOperation({
        key: page.key,
        title: page.title,
        slug: page.slug,
        audience: page.audience,
        layout_json: baseLayout,
        status: page.status,
        is_active: shouldRestore,
      }),
    );
  }

  if (intent.action === "create_checklist") {
    if (page.audience !== "internal" || !page.is_active) {
      throw new DirectPageComposerError("direct_page_checklist_unavailable");
    }
    const objectKey = allocateKey(
      [
        ...snapshot.object_definitions.map((candidate) => candidate.key),
        ...snapshot.views.map((candidate) => candidate.key),
      ],
      intent.name,
      "checklist",
    );
    const nameConflict = snapshot.object_definitions.some(
      (candidate) =>
        candidate.is_active &&
        normalizeLabel(candidate.plural_label) === normalizeLabel(intent.name),
    );
    if (nameConflict) {
      throw new DirectPageComposerError("direct_page_checklist_name_conflict");
    }
    const viewKey = objectKey;
    const stableLayout = pageLayoutWithStableIds(baseLayout);
    const block = {
      type: "view" as const,
      view_key: viewKey,
      checklist: { label_field: "name", completed_field: "completed" },
      id: globalThis.crypto.randomUUID(),
    };
    let blocks = [...stableLayout.blocks];
    if (intent.containerBlockId) {
      const inserted = insertIntoContainer(
        blocks,
        intent.containerBlockId,
        intent.afterBlockId,
        block,
      );
      if (!inserted) {
        throw new DirectPageComposerError("direct_page_block_not_found");
      }
      blocks = inserted;
    } else if (intent.afterBlockId === null) blocks.unshift(block);
    else if (intent.afterBlockId === undefined) blocks.push(block);
    else {
      const inserted = insertAfterBlock(
        blocks,
        intent.afterBlockId,
        block,
        true,
      );
      if (!inserted) {
        throw new DirectPageComposerError("direct_page_block_not_found");
      }
      blocks = inserted;
    }
    const operations: ConfigurationOperation[] = [
      {
        op: "set_object",
        key: objectKey,
        singular_label: intent.name,
        plural_label: intent.name,
        description: "A simple checklist for the team.",
        icon: null,
        is_active: true,
      },
      {
        op: "set_field",
        object_key: objectKey,
        key: "name",
        label: "Name",
        field_type: "short_text",
        required: true,
        default_value: null,
        settings_json: {},
        position: 0,
        is_active: true,
      },
      {
        op: "set_field",
        object_key: objectKey,
        key: "completed",
        label: "Completed",
        field_type: "boolean",
        required: false,
        default_value: false,
        settings_json: {},
        position: 1,
        is_active: true,
      },
      {
        op: "set_view",
        key: viewKey,
        name: intent.name,
        view_type: "table",
        object_key: objectKey,
        config_json: {
          schema_version: 2,
          role: "primary",
          columns: [
            { kind: "field", field_key: "name" },
            { kind: "field", field_key: "completed" },
          ],
          fields: ["name", "completed"],
          title_field: "name",
          include_archived: false,
          filters: [],
          filter_match: "all",
          sorts: [],
          group: null,
        },
        audience: "internal",
        is_active: true,
      },
      pageOperation({
        key: page.key,
        title: page.title,
        slug: page.slug,
        audience: page.audience,
        layout_json: { blocks },
        status: page.status,
        is_active: page.is_active,
      }),
    ];
    try {
      return {
        actionKind: "create_checklist",
        title: `Create ${intent.name} checklist`,
        description: "Create a checklist and place it on this Page.",
        operations: configurationOperationsSchema.parse(operations),
        pageKey: page.key,
        pageSlug: page.slug,
      };
    } catch (error) {
      throw new DirectPageComposerError(
        "direct_page_checklist_unavailable",
        error,
      );
    }
  }

  if (intent.action === "publish_page_changes") {
    if (page.audience !== "public" || page.status !== "published") {
      throw new DirectPageComposerError(
        "direct_page_published_site_ineligible",
      );
    }
    if (pageTitleConflict(snapshot, intent.title, page.key, "public")) {
      throw new DirectPageComposerError("direct_page_title_conflict");
    }
    const candidateLayout = pageLayoutSchema.parse(intent.layout);
    assertLockedSiteBlocksUnchanged(baseLayout, candidateLayout);
    if (
      intent.title === page.title &&
      JSON.stringify(candidateLayout) === JSON.stringify(baseLayout)
    ) {
      throw new DirectPageComposerError("direct_page_block_unchanged");
    }
    return finalizeAction(
      "publish_page_changes",
      `Publish changes to ${intent.title}`,
      page.key,
      page.slug,
      pageOperation({
        key: page.key,
        title: intent.title,
        slug: page.slug,
        audience: "public",
        layout_json: pageLayoutWithStableIds(candidateLayout),
        status: "published",
        is_active: page.is_active,
      }),
    );
  }

  if (page.audience === "public" && page.status === "published") {
    throw new DirectPageComposerError(
      "direct_page_published_site_requires_publication",
    );
  }

  if (intent.action === "rename_page") {
    if (pageTitleConflict(snapshot, intent.title, page.key, page.audience)) {
      throw new DirectPageComposerError("direct_page_title_conflict");
    }
    return finalizeAction(
      "rename_page",
      `Rename ${intent.title}`,
      page.key,
      page.slug,
      pageOperation({
        key: page.key,
        title: intent.title,
        slug: page.slug,
        audience: page.audience,
        layout_json: baseLayout,
        status: page.status,
        is_active: page.is_active,
      }),
    );
  }

  if (intent.action === "save_page_layout") {
    const nextTitle = intent.title?.trim() || page.title;
    if (pageTitleConflict(snapshot, nextTitle, page.key, page.audience)) {
      throw new DirectPageComposerError("direct_page_title_conflict");
    }
    if (
      page.audience === "public" &&
      walkPageBlocks(intent.layout).some((block) => block.type === "rich_text")
    ) {
      throw new DirectPageComposerError(
        "direct_page_site_rich_text_unsupported",
      );
    }
    return finalizeAction(
      "save_page_layout",
      `Save ${nextTitle}`,
      page.key,
      page.slug,
      pageOperation({
        key: page.key,
        title: nextTitle,
        slug: page.slug,
        audience: page.audience,
        layout_json: pageLayoutWithStableIds(intent.layout),
        status: page.status,
        is_active: page.is_active,
      }),
    );
  }

  const stableLayout = pageLayoutWithStableIds(baseLayout);
  let nextBlocks = [...stableLayout.blocks];

  if (intent.action === "add_page_block") {
    if (intent.block.type === "view") {
      if (page.audience !== "internal") {
        throw new DirectPageComposerError("direct_page_view_unavailable");
      }
      assertEligibleSavedView(snapshot, intent.block.viewKey);
      if (intent.block.checklist) {
        assertChecklistViewFields(
          snapshot,
          intent.block.viewKey,
          intent.block.checklist.labelField,
          intent.block.checklist.completedField,
          intent.block.readOnly === true,
        );
      }
    }
    const nextBlock = {
      ...pageBlockFromInput(intent.block),
      id: globalThis.crypto.randomUUID(),
    };
    if (intent.containerBlockId) {
      const inserted = insertIntoContainer(
        nextBlocks,
        intent.containerBlockId,
        intent.afterBlockId,
        nextBlock,
      );
      if (!inserted) {
        throw new DirectPageComposerError("direct_page_block_not_found");
      }
      nextBlocks = inserted;
    } else if (intent.afterBlockId === undefined) {
      nextBlocks.push(nextBlock);
    } else if (intent.afterBlockId === null) {
      nextBlocks.unshift(nextBlock);
    } else {
      const inserted = insertAfterBlock(
        nextBlocks,
        intent.afterBlockId,
        nextBlock,
        true,
      );
      if (!inserted) {
        throw new DirectPageComposerError("direct_page_block_not_found");
      }
      nextBlocks = inserted;
    }
  } else if (intent.action === "update_page_block") {
    let existingBlock: PageBlockItem | null = null;
    let existingBlockTypeMatches = false;
    const updated = rewriteBlock(
      nextBlocks,
      intent.blockId,
      (block) => {
        existingBlock = block;
        if (block.type !== intent.block.type) return null;
        existingBlockTypeMatches = true;
        const stableId = "id" in block && block.id ? block.id : intent.blockId;
        return { ...pageBlockFromInput(intent.block), id: stableId };
      },
      true,
    );
    if (!updated.found || !existingBlock || !existingBlockTypeMatches) {
      throw new DirectPageComposerError("direct_page_block_not_found");
    }
    nextBlocks = updated.blocks;
  } else if (intent.action === "remove_page_block") {
    const removed = rewriteBlock(nextBlocks, intent.blockId, () => null, true);
    if (!removed.found) {
      throw new DirectPageComposerError("direct_page_block_not_found");
    }
    nextBlocks = removed.blocks;
  } else {
    const moved = moveBlock(nextBlocks, intent.blockId, intent.direction, true);
    if (!moved.found || !moved.moved) {
      throw new DirectPageComposerError("direct_page_block_unchanged");
    }
    nextBlocks = moved.blocks;
  }

  return finalizeAction(
    "save_page_layout",
    `Save ${page.title}`,
    page.key,
    page.slug,
    pageOperation({
      key: page.key,
      title: page.title,
      slug: page.slug,
      audience: page.audience,
      layout_json: pageLayoutSchema.parse({ blocks: nextBlocks }),
      status: page.status,
      is_active: page.is_active,
    }),
  );
}

function allocateUniquePageTitle(
  snapshot: ConfigurationSnapshotV1,
  requested: string,
  exceptPageKey?: string,
): string {
  const normalized = normalizeLabel(requested);
  if (
    !snapshot.pages.some(
      (page) =>
        page.key !== exceptPageKey &&
        page.is_active &&
        normalizeLabel(page.title) === normalized,
    )
  ) {
    return requested;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${requested} ${index}`;
    if (!pageTitleConflict(snapshot, candidate, exceptPageKey, "internal")) {
      return candidate;
    }
  }
  throw new DirectPageComposerError("direct_page_title_conflict");
}

export function composeDirectPageAction(
  snapshotInput: unknown,
  intentInput: unknown,
): ComposedDirectPageAction {
  const snapshot = parseSnapshot(snapshotInput);
  const intent = parseIntent(intentInput);
  return intent.action === "create_page"
    ? composeCreatePage(snapshot, intent.title)
    : composePageMutation(snapshot, intent);
}
