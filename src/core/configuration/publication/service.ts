import "server-only";

import type { Tables } from "../../../db/supabase/database.types";
import {
  configurationSnapshotV1Schema,
  type ConfigurationSnapshotV1,
} from "../definition-source";
import {
  setPageOperationSchema,
  type ConfigurationOperation,
} from "../schemas";
import {
  loadActiveManualAmendmentSnapshot,
  type ActiveManualAmendmentSnapshot,
} from "../manual-amendments/service";
import type { ConfigurationChangeService } from "../service";
import {
  publicPreorderPublicationFormSchema,
  type PublicPreorderPublicationForm,
} from "./schemas";

type ConfigurationChangeSet = Tables<"configuration_change_sets">;
type SnapshotPage = ConfigurationSnapshotV1["pages"][number];
type SetPageOperation = Extract<ConfigurationOperation, { op: "set_page" }>;

export const publicPreorderPublicationErrorCodes = [
  "public_preorder_page_missing",
  "public_preorder_page_ambiguous",
  "public_preorder_page_ineligible",
  "public_preorder_already_published",
  "public_preorder_stale",
] as const;

export type PublicPreorderPublicationErrorCode =
  (typeof publicPreorderPublicationErrorCodes)[number];

const ownerMessages: Readonly<
  Record<PublicPreorderPublicationErrorCode, string>
> = {
  public_preorder_page_missing:
    "The public preorder page could not be identified safely. No publication was prepared.",
  public_preorder_page_ambiguous:
    "More than one public preorder page could be identified. No publication was prepared.",
  public_preorder_page_ineligible:
    "The public preorder page is not available for publication. No publication was prepared.",
  public_preorder_already_published:
    "The preorder page is already available to customers.",
  public_preorder_stale:
    "Setup changed after this page was loaded. Reload and try again.",
};

export class PublicPreorderPublicationError extends Error {
  readonly code: PublicPreorderPublicationErrorCode;

  constructor(code: PublicPreorderPublicationErrorCode) {
    super(ownerMessages[code]);
    this.name = "PublicPreorderPublicationError";
    this.code = code;
  }
}

type PublicationResolution =
  | { kind: "ready"; page: SnapshotPage }
  | { kind: "published"; page: SnapshotPage }
  | {
      kind: "unavailable";
      reason: "missing" | "ambiguous" | "ineligible";
    };

export type PublicPreorderPublicationState =
  | { kind: "ready"; pageSlug: string }
  | { kind: "published"; pageSlug: string }
  | {
      kind: "unavailable";
      reason: "missing" | "ambiguous" | "ineligible";
    };

function resolvePublication(
  snapshotInput: ConfigurationSnapshotV1,
): PublicationResolution {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const activePreorderKeys = new Set(
    snapshot.preorder_experiences
      .filter((preorder) => preorder.is_active)
      .map((preorder) => preorder.key),
  );
  const pages = snapshot.pages.filter((page) =>
    page.layout_json.blocks.some(
      (block) =>
        block.type === "preorder" && activePreorderKeys.has(block.preorder_key),
    ),
  );

  if (pages.length === 0) {
    return { kind: "unavailable", reason: "missing" };
  }
  if (pages.length !== 1) {
    return { kind: "unavailable", reason: "ambiguous" };
  }

  const page = pages[0]!;
  if (!page.is_active || page.audience !== "public") {
    return { kind: "unavailable", reason: "ineligible" };
  }
  if (page.status === "published") {
    return { kind: "published", page };
  }
  if (page.status !== "draft") {
    return { kind: "unavailable", reason: "ineligible" };
  }
  return { kind: "ready", page };
}

function publicationErrorForResolution(
  resolution: Extract<PublicationResolution, { kind: "unavailable" }>,
): PublicPreorderPublicationError {
  return new PublicPreorderPublicationError(
    resolution.reason === "missing"
      ? "public_preorder_page_missing"
      : resolution.reason === "ambiguous"
        ? "public_preorder_page_ambiguous"
        : "public_preorder_page_ineligible",
  );
}

export function getPublicPreorderPublicationState(
  snapshotInput: ConfigurationSnapshotV1,
): PublicPreorderPublicationState {
  const resolution = resolvePublication(snapshotInput);
  if (resolution.kind === "unavailable") {
    return resolution;
  }
  return { kind: resolution.kind, pageSlug: resolution.page.slug };
}

export function composePublicPreorderPublicationOperation(
  snapshotInput: ConfigurationSnapshotV1,
): SetPageOperation {
  const resolution = resolvePublication(snapshotInput);
  if (resolution.kind === "unavailable") {
    throw publicationErrorForResolution(resolution);
  }
  if (resolution.kind === "published") {
    throw new PublicPreorderPublicationError(
      "public_preorder_already_published",
    );
  }

  const { page } = resolution;
  return setPageOperationSchema.parse({
    op: "set_page",
    key: page.key,
    title: page.title,
    slug: page.slug,
    audience: page.audience,
    layout_json: page.layout_json,
    status: "published",
    is_active: page.is_active,
  });
}

function assertCurrentness(
  active: ActiveManualAmendmentSnapshot,
  expected: PublicPreorderPublicationForm,
): void {
  if (
    active.baseVersionId !== expected.expectedBaseVersionId ||
    active.headRevision !== expected.expectedHeadRevision
  ) {
    throw new PublicPreorderPublicationError("public_preorder_stale");
  }
}

export async function preparePublicPreorderPublicationProposal(
  configuration: ConfigurationChangeService,
  input: PublicPreorderPublicationForm,
): Promise<ConfigurationChangeSet> {
  const parsed = publicPreorderPublicationFormSchema.parse(input);
  const active = await loadActiveManualAmendmentSnapshot(configuration);
  assertCurrentness(active, parsed);
  const operation = composePublicPreorderPublicationOperation(active.snapshot);

  return configuration.proposeChangeSet({
    expectedBaseVersionId: active.baseVersionId,
    expectedHeadRevision: active.headRevision,
    title: "Publish preorder",
    description:
      "Make the existing preorder page available to customers at its current public URL.",
    operations: [operation],
  });
}
