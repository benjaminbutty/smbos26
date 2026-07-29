import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  ExperienceFormBundle,
  ExperiencePageBundle,
  ExperienceViewBundle,
} from "../experience/service";
import { createExperienceService } from "../experience/service";
import { graphKeySchema } from "../graph/schemas";
import type { PublicPreorderCatalogue } from "../preorder/schemas";
import { resolveConfigurationPreviewPreorder } from "../preorder/service";
import type { Database, Tables } from "../../db/supabase/database.types";
import {
  ConfigurationChangeService,
  ConfigurationChangeServiceError,
  type ConfigurationPreviewContext,
} from "./service";

const renderedPreviewRequestSchema = z
  .object({
    businessId: z.uuid(),
    actorId: z.uuid(),
    changeSetId: z.uuid(),
    pageKey: graphKeySchema,
  })
  .strict();

export interface RenderedConfigurationPreview {
  preview: ConfigurationPreviewContext;
  page: ExperiencePageBundle;
  navigationPages: Tables<"pages">[];
  views: Readonly<Record<string, ExperienceViewBundle>>;
  forms: Readonly<Record<string, { bundle: ExperienceFormBundle }>>;
  preorders: Readonly<Record<string, { catalogue: PublicPreorderCatalogue }>>;
}

export interface RenderedConfigurationPreviewDependencies {
  afterCandidatePageLoaded?: () => Promise<void>;
}

export class RenderedConfigurationPreviewError extends Error {
  readonly code: "configuration_preview_page_unavailable";

  constructor() {
    super("The candidate Page is not available.");
    this.name = "RenderedConfigurationPreviewError";
    this.code = "configuration_preview_page_unavailable";
  }
}

const controlledPreviewServiceErrorCodes = new Set([
  "configuration_actor_context_mismatch",
  "configuration_authentication_required",
  "configuration_owner_or_admin_required",
  "configuration_preview_not_found",
  "configuration_preview_stale",
  "configuration_preview_unavailable",
]);

export function isControlledConfigurationPreviewError(error: unknown): boolean {
  return (
    (error instanceof ConfigurationChangeServiceError &&
      controlledPreviewServiceErrorCodes.has(error.code)) ||
    error instanceof RenderedConfigurationPreviewError
  );
}

function assertFinalPreviewCurrent(
  initial: ConfigurationPreviewContext,
  final: ConfigurationPreviewContext,
): void {
  const identityMatches =
    final.proposalId === initial.proposalId &&
    final.businessId === initial.businessId &&
    final.candidateChecksum === initial.candidateChecksum &&
    final.kind === initial.kind;
  const statusProgressionIsAllowed =
    final.status === initial.status ||
    (initial.status === "proposed" && final.status === "validated");

  if (!identityMatches || !statusProgressionIsAllowed) {
    throw new ConfigurationChangeServiceError(
      "The configuration preview changed unexpectedly while it was rendering.",
      { message: "configuration_preview_currentness_mismatch" },
    );
  }
}

export async function loadRenderedConfigurationPreview(
  client: SupabaseClient<Database>,
  request: {
    businessId: string;
    actorId: string;
    changeSetId: string;
    pageKey: string;
  },
  dependencies: RenderedConfigurationPreviewDependencies = {},
): Promise<RenderedConfigurationPreview> {
  const trusted = renderedPreviewRequestSchema.parse(request);
  const configuration = new ConfigurationChangeService(client, {
    businessId: trusted.businessId,
    actorId: trusted.actorId,
  });
  const preview = await configuration.loadPreview(trusted.changeSetId);
  const candidatePage = preview.pages.find(
    (page) => page.key === trusted.pageKey && page.is_active,
  );
  if (!candidatePage) {
    throw new RenderedConfigurationPreviewError();
  }

  const experience = createExperienceService(
    client,
    { businessId: trusted.businessId },
    preview.definitionSource,
  );
  const page = await experience.loadPageByKey(
    trusted.pageKey,
    candidatePage.audience,
  );
  await dependencies.afterCandidatePageLoaded?.();
  const viewKeys = [
    ...new Set(
      page.layout.blocks.flatMap((block) =>
        block.type === "view" ? [block.view_key] : [],
      ),
    ),
  ];
  const formKeys = [
    ...new Set(
      page.layout.blocks.flatMap((block) =>
        block.type === "form" ? [block.form_key] : [],
      ),
    ),
  ];
  const preorderKeys = [
    ...new Set(
      page.layout.blocks.flatMap((block) =>
        block.type === "preorder" ? [block.preorder_key] : [],
      ),
    ),
  ];

  const [viewBundles, formBundles, preorderCatalogues] = await Promise.all([
    Promise.all(
      viewKeys.map(
        async (key) =>
          [
            key,
            await experience.loadView(key, candidatePage.audience),
          ] as const,
      ),
    ),
    Promise.all(
      formKeys.map(
        async (key) =>
          [
            key,
            {
              bundle: await experience.loadForm(key, candidatePage.audience),
            },
          ] as const,
      ),
    ),
    Promise.all(
      preorderKeys.map(async (key) => {
        const catalogue = await resolveConfigurationPreviewPreorder(client, {
          businessId: trusted.businessId,
          actorId: trusted.actorId,
          changeSetId: trusted.changeSetId,
          pageKey: trusted.pageKey,
          preorderKey: key,
        });
        if (!catalogue) {
          throw new Error("The candidate preorder is not available.");
        }
        return [key, { catalogue }] as const;
      }),
    ),
  ]);

  const internalPages = preview.pages.filter(
    (candidate) => candidate.is_active && candidate.audience === "internal",
  );
  const navigationPages =
    candidatePage.audience === "public"
      ? [...internalPages, candidatePage]
      : internalPages;
  // Assertion locks end with each RPC transaction. Re-assert after assembly so
  // this response is a point-in-time read, not a claim to hold an HTTP-wide lock.
  const finalPreview = await configuration.loadPreview(trusted.changeSetId);
  assertFinalPreviewCurrent(preview, finalPreview);

  return Object.freeze({
    preview: finalPreview,
    page,
    navigationPages,
    views: Object.fromEntries(viewBundles),
    forms: Object.fromEntries(formBundles),
    preorders: Object.fromEntries(preorderCatalogues),
  });
}
