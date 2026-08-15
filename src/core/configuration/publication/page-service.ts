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
  publicPagePublicationFormSchema,
  type PublicPagePublicationForm,
} from "./schemas";

type ConfigurationChangeSet = Tables<"configuration_change_sets">;
type SnapshotPage = ConfigurationSnapshotV1["pages"][number];
type SetPageOperation = Extract<ConfigurationOperation, { op: "set_page" }>;

export const publicPagePublicationErrorCodes = [
  "public_page_missing",
  "public_page_ineligible",
  "public_page_already_published",
  "public_page_stale",
] as const;

export type PublicPagePublicationErrorCode =
  (typeof publicPagePublicationErrorCodes)[number];

const ownerMessages: Readonly<Record<PublicPagePublicationErrorCode, string>> =
  {
    public_page_missing:
      "This public Site is no longer available for publication. No changes were prepared.",
    public_page_ineligible:
      "This Page is not a public Site that can be published. No changes were prepared.",
    public_page_already_published:
      "This Site is already available to customers.",
    public_page_stale:
      "Workspace setup changed after this Site was loaded. Reload and try again.",
  };

export class PublicPagePublicationError extends Error {
  readonly code: PublicPagePublicationErrorCode;

  constructor(code: PublicPagePublicationErrorCode) {
    super(ownerMessages[code]);
    this.name = "PublicPagePublicationError";
    this.code = code;
  }
}

function resolvePage(
  snapshotInput: ConfigurationSnapshotV1,
  pageKey: string,
): SnapshotPage {
  const snapshot = configurationSnapshotV1Schema.parse(snapshotInput);
  const page = snapshot.pages.find(
    (candidate) => candidate.key === pageKey && candidate.is_active,
  );
  if (!page) throw new PublicPagePublicationError("public_page_missing");
  if (page.audience !== "public" || page.status !== "draft") {
    if (page.audience === "public" && page.status === "published") {
      throw new PublicPagePublicationError("public_page_already_published");
    }
    throw new PublicPagePublicationError("public_page_ineligible");
  }
  return page;
}

export function composePublicPagePublicationOperation(
  snapshotInput: ConfigurationSnapshotV1,
  pageKey: string,
): SetPageOperation {
  const page = resolvePage(snapshotInput, pageKey);
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
  expected: PublicPagePublicationForm,
): void {
  if (
    active.baseVersionId !== expected.expectedBaseVersionId ||
    active.headRevision !== expected.expectedHeadRevision
  ) {
    throw new PublicPagePublicationError("public_page_stale");
  }
}

export async function preparePublicPagePublicationProposal(
  configuration: ConfigurationChangeService,
  input: PublicPagePublicationForm,
): Promise<ConfigurationChangeSet> {
  const parsed = publicPagePublicationFormSchema.parse(input);
  const active = await loadActiveManualAmendmentSnapshot(configuration);
  assertCurrentness(active, parsed);
  const operation = composePublicPagePublicationOperation(
    active.snapshot,
    parsed.pageKey,
  );

  return configuration.proposeChangeSet({
    expectedBaseVersionId: active.baseVersionId,
    expectedHeadRevision: active.headRevision,
    title: `Publish ${operation.title}`,
    description:
      "Make this public Site available to customers at its current public URL.",
    operations: [operation],
  });
}
