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
): void {
  assertEligibleSavedView(snapshot, viewKey);
  const view = snapshot.views.find((candidate) => candidate.key === viewKey);
  const object = snapshot.object_definitions.find(
    (candidate) => candidate.id === view?.object_definition_id,
  );
  const fields = snapshot.field_definitions.filter(
    (field) => field.object_definition_id === object?.id && field.is_active,
  );
  const label = fields.find((field) => field.key === labelField);
  const completed = fields.find((field) => field.key === completedField);
  if (
    !label ||
    !new Set(["short_text", "long_text", "email", "phone", "url"]).has(
      label.field_type,
    ) ||
    !completed ||
    completed.field_type !== "boolean"
  ) {
    throw new DirectPageComposerError("direct_page_checklist_unavailable");
  }
}

function blockById(
  layout: PageLayout,
  blockId: string,
): { block: PageLayout["blocks"][number]; index: number } {
  let index = layout.blocks.findIndex(
    (candidate) => "id" in candidate && candidate.id === blockId,
  );
  if (index < 0) {
    const legacyIndex = /^legacy:(\d+)$/.exec(blockId)?.[1];
    if (legacyIndex !== undefined) {
      const parsedIndex = Number(legacyIndex);
      if (Number.isSafeInteger(parsedIndex)) index = parsedIndex;
    }
  }
  const block = layout.blocks[index];
  if (!block) {
    throw new DirectPageComposerError("direct_page_block_not_found");
  }
  return { block, index };
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
  if (pageTitleConflict(snapshot, title, undefined, "internal")) {
    throw new DirectPageComposerError("direct_page_title_conflict");
  }

  const pageKey = allocateKey(
    snapshot.pages.map((page) => page.key),
    title,
    "page",
  );
  const pageSlug = allocateSlug(
    snapshot.pages.map((page) => page.slug),
    title,
  );
  return finalizeAction(
    "create_page",
    `Create ${title}`,
    pageKey,
    pageSlug,
    pageOperation({
      key: pageKey,
      title,
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
    const blocks = [...stableLayout.blocks];
    if (intent.afterBlockId === null) blocks.unshift(block);
    else if (intent.afterBlockId === undefined) blocks.push(block);
    else {
      const { index } = blockById(stableLayout, intent.afterBlockId);
      blocks.splice(index + 1, 0, block);
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
        );
      }
    }
    const nextBlock = {
      ...pageBlockFromInput(intent.block),
      id: globalThis.crypto.randomUUID(),
    };
    if (intent.afterBlockId === undefined) {
      nextBlocks.push(nextBlock);
    } else if (intent.afterBlockId === null) {
      nextBlocks.unshift(nextBlock);
    } else {
      const { index } = blockById(stableLayout, intent.afterBlockId);
      nextBlocks.splice(index + 1, 0, nextBlock);
    }
  } else if (intent.action === "update_page_block") {
    const { index, block } = blockById(stableLayout, intent.blockId);
    if (block.type !== intent.block.type) {
      throw new DirectPageComposerError("direct_page_block_not_found");
    }
    const stableId = "id" in block && block.id ? block.id : intent.blockId;
    nextBlocks[index] = {
      ...pageBlockFromInput(intent.block),
      id: stableId,
    };
  } else if (intent.action === "remove_page_block") {
    const { index } = blockById(stableLayout, intent.blockId);
    nextBlocks = nextBlocks.filter(
      (_, candidateIndex) => candidateIndex !== index,
    );
  } else {
    const { index } = blockById(stableLayout, intent.blockId);
    const nextIndex = intent.direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= nextBlocks.length) {
      throw new DirectPageComposerError("direct_page_block_unchanged");
    }
    const current = nextBlocks[index];
    const adjacent = nextBlocks[nextIndex];
    if (!current || !adjacent) {
      throw new DirectPageComposerError("direct_page_block_not_found");
    }
    nextBlocks[index] = adjacent;
    nextBlocks[nextIndex] = current;
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
