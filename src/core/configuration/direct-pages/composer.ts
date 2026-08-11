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
import { pageLayoutSchema, type PageLayout } from "../../experience/schemas";
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
  "direct_page_block_not_found",
  "direct_page_block_unchanged",
  "direct_page_operations_invalid",
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
  direct_page_block_not_found:
    "That Page block is no longer available. Reload and try again.",
  direct_page_block_unchanged: "That Page block is already in that position.",
  direct_page_operations_invalid:
    "The Page change could not be prepared safely. Reload and try again.",
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
    (candidate) =>
      candidate.key === pageKey &&
      candidate.is_active &&
      candidate.audience === "internal",
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
): boolean {
  const normalized = normalizeLabel(title);
  return snapshot.pages.some(
    (page) =>
      page.key !== exceptPageKey &&
      page.audience === "internal" &&
      page.is_active &&
      normalizeLabel(page.title) === normalized,
  );
}

function pageLayoutWithStableIds(input: unknown): PageLayout {
  const layout = pageLayoutSchema.parse(input);
  return pageLayoutSchema.parse({
    blocks: layout.blocks.map((block) =>
      "id" in block && block.id
        ? block
        : { ...block, id: globalThis.crypto.randomUUID() },
    ),
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
    case "view":
      return {
        type: "view",
        view_key: input.viewKey,
        ...(input.readOnly ? { read_only: true } : {}),
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

function blockById(
  layout: PageLayout,
  blockId: string,
): { block: PageLayout["blocks"][number]; index: number } {
  const index = layout.blocks.findIndex(
    (candidate) => "id" in candidate && candidate.id === blockId,
  );
  const block = layout.blocks[index];
  if (!block) {
    throw new DirectPageComposerError("direct_page_block_not_found");
  }
  return { block, index };
}

function pageOperation(values: Omit<PageOperation, "op">): PageOperation {
  return setPageOperationSchema.parse({ op: "set_page", ...values });
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
  if (pageTitleConflict(snapshot, title)) {
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
  const page = activePage(snapshot, intent.pageKey);
  const baseLayout = pageLayoutSchema.parse(page.layout_json);

  if (intent.action === "rename_page") {
    if (pageTitleConflict(snapshot, intent.title, page.key)) {
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
      assertEligibleSavedView(snapshot, intent.block.viewKey);
    }
    nextBlocks.push({
      ...pageBlockFromInput(intent.block),
      id: globalThis.crypto.randomUUID(),
    });
  } else if (intent.action === "update_page_block") {
    const { index, block } = blockById(stableLayout, intent.blockId);
    if (block.type !== intent.block.type) {
      throw new DirectPageComposerError("direct_page_block_not_found");
    }
    nextBlocks[index] = {
      ...pageBlockFromInput(intent.block),
      id: intent.blockId,
    };
  } else if (intent.action === "remove_page_block") {
    blockById(stableLayout, intent.blockId);
    nextBlocks = nextBlocks.filter(
      (candidate) => !("id" in candidate && candidate.id === intent.blockId),
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
