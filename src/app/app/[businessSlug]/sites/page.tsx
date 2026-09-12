import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  createSiteAction,
  prepareSiteReleaseAction,
  publishSiteReleaseAction,
  refreshSiteBookingSetupAction,
  resolveSiteDraftConflictAction,
  rebaseSiteDraftAction,
  stageSiteAdoptionAction,
  unpublishSiteAction,
  reenableSiteFieldAction,
  reenableSiteMediaAction,
  reenableSiteObjectAction,
  reenableSiteRecordAction,
  withdrawSiteFieldAction,
  withdrawSiteMediaAction,
  withdrawSiteObjectAction,
  withdrawSiteRecordAction,
  resolveSiteCustomerResolutionCaseAction,
} from "./actions";
import {
  SiteComposer,
  type OperationalBlockOption,
} from "../../../../components/sites/site-composer";
import { SiteCandidatePreview } from "../../../../components/sites/site-candidate-preview";
import { SiteAvailabilityControls } from "../../../../components/sites/site-availability-controls";
import {
  SiteCustomerReview,
  type CustomerResolutionCase,
} from "../../../../components/sites/site-customer-review";
import { ConfigurationChangeService } from "../../../../core/configuration/service";
import {
  siteReleaseV2Schema,
  siteReleaseV3Schema,
  siteReleaseV4Schema,
  siteStateSchema,
} from "../../../../core/sites/service";
import {
  sitePublicProjectionSchema,
  sitePublicProjectionV4Schema,
  sitePublicProjectionV3Schema,
} from "../../../../core/sites/schemas";
import { createServerClient } from "../../../../db/supabase/server";

interface SitesPageProps {
  params: Promise<{ businessSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown | null }>;
type ReadQuery<T> = QueryResult<T> & {
  eq(column: string, value: string | boolean): ReadQuery<T>;
  maybeSingle(): QueryResult<T>;
};
type SiteReader = {
  from(table: string): { select(columns: string): ReadQuery<unknown> };
};
type SiteRpcReader = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown | null }>;
};

type ObjectRow = {
  id: string;
  key: string;
  singular_label: string;
  plural_label: string;
  semantic_type: string | null;
  is_active: boolean;
};
type RelationshipRow = {
  id: string;
  key: string;
  source_object_definition_id: string;
  target_object_definition_id: string;
  source_label: string;
  target_label: string;
  cardinality: string;
  is_active: boolean;
};
type FieldRow = {
  id: string;
  key: string;
  label: string;
  field_type: string;
  required: boolean;
  is_active: boolean;
  default_value: unknown;
  settings_json: unknown;
};
type ViewRow = {
  key: string;
  name: string;
  is_active: boolean;
};
type RecordRow = {
  id: string;
  object_definition_id: string;
  record_revision: number;
  data_json: Record<string, unknown>;
};
type AttachmentRow = {
  record_id: string;
  field_definition_id: string;
  attachment_revision: number;
  asset_id: string;
};
type AvailabilityRow = {
  status: "available" | "withdrawn";
  availability_revision: number;
};
type ObjectAvailabilityRow = AvailabilityRow & {
  object_definition_id: string;
};
type RecordAvailabilityRow = AvailabilityRow & { record_id: string };
type FieldAvailabilityRow = AvailabilityRow & {
  field_definition_id: string;
};
type MediaAvailabilityRow = AvailabilityRow & { asset_id: string };
type DraftAssetReferenceRow = { asset_id: string };
type OperationalPageRow = {
  id: string;
  title: string;
  layout_json: unknown;
};
type PreorderExperienceRow = {
  key: string;
  config_json: unknown;
  is_active: boolean;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readQuery<T>(query: QueryResult<unknown>): QueryResult<T> {
  return query as unknown as QueryResult<T>;
}

function siteDraftReferences(draft: unknown): {
  objectKeys: Set<string>;
  fieldKeys: Set<string>;
  recordIds: Set<string>;
} {
  const objectKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const recordIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (item.type === "collection") {
      if (typeof item.object_key === "string") objectKeys.add(item.object_key);
      if (Array.isArray(item.public_field_keys)) {
        item.public_field_keys.forEach((field) => {
          if (typeof field === "string") fieldKeys.add(field);
        });
      }
      const selection =
        typeof item.selection === "object" && item.selection !== null
          ? (item.selection as Record<string, unknown>)
          : null;
      if (selection && Array.isArray(selection.record_ids)) {
        selection.record_ids.forEach((record) => {
          if (typeof record === "string") recordIds.add(record);
        });
      }
    }
    Object.values(item).forEach(visit);
  };
  visit(draft);
  return { objectKeys, fieldKeys, recordIds };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function operationalPreviewActions(
  review: unknown,
): Array<Record<string, unknown>> {
  const reviewValue = objectValue(review);
  const actions = reviewValue?._c4_operational_actions;
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((value) => {
    const action = objectValue(value);
    return action?.kind === "booking" || action?.kind === "preorder"
      ? [action]
      : [];
  });
}

function operationalBlocks(value: unknown): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  const visit = (candidate: unknown): void => {
    const block = objectValue(candidate);
    if (!block) return;
    if (
      (block.type === "booking" && typeof block.booking_key === "string") ||
      (block.type === "preorder" && typeof block.preorder_key === "string")
    ) {
      result.push(block);
    }
    if (Array.isArray(block.blocks)) block.blocks.forEach(visit);
    if (Array.isArray(block.columns)) block.columns.forEach(visit);
    Object.values(block.layout ?? {}).forEach(visit);
  };
  visit(value);
  return result;
}

export default async function SitesPage({
  params,
  searchParams,
}: Readonly<SitesPageProps>): Promise<ReactNode> {
  const { businessSlug } = await params;
  const query = searchParams ? await searchParams : {};
  const notice = firstParam(query.notice);
  const candidateId = firstParam(query.candidate);
  const supabase = await createServerClient();
  const tenant = await resolveTenant(businessSlug, supabase);
  const canManageConfiguration = hasCapability(
    tenant.membership.role,
    "manage_configuration",
  );
  const reader = supabase as unknown as SiteReader;
  const stateResult = await readQuery<unknown>(
    reader
      .from("site_states")
      .select("*")
      .eq("business_id", tenant.business.id)
      .maybeSingle(),
  );
  if (stateResult.error) throw stateResult.error;
  const state = stateResult.data
    ? siteStateSchema.parse(stateResult.data)
    : null;
  let workspaceCurrentness: {
    expectedBaseVersionId: string;
    expectedHeadRevision: number;
  } | null = null;
  if (state && canManageConfiguration) {
    try {
      workspaceCurrentness = await new ConfigurationChangeService(supabase, {
        businessId: tenant.business.id,
        actorId: tenant.user.id,
      }).getProposalCurrentness();
    } catch {
      workspaceCurrentness = null;
    }
  }

  const objectResult = await readQuery<ObjectRow[]>(
    reader
      .from("object_definitions")
      .select("id,key,singular_label,plural_label,semantic_type,is_active")
      .eq("business_id", tenant.business.id)
      .eq("is_active", true),
  );
  if (objectResult.error) throw objectResult.error;
  const objectRows = objectResult.data ?? [];
  const relationshipResult = await readQuery<RelationshipRow[]>(
    reader
      .from("relationship_definitions")
      .select(
        "id,key,source_object_definition_id,target_object_definition_id,source_label,target_label,cardinality,is_active",
      )
      .eq("business_id", tenant.business.id)
      .eq("is_active", true),
  );
  if (relationshipResult.error) throw relationshipResult.error;
  const objectLabels = new Map(
    objectRows.map((objectValue) => [
      objectValue.id,
      objectValue.plural_label || objectValue.singular_label || "Table",
    ]),
  );
  const relationshipOptions = (relationshipResult.data ?? []).map(
    (relationship) => ({
      key: relationship.key,
      label: `${objectLabels.get(relationship.source_object_definition_id) ?? relationship.source_label} → ${objectLabels.get(relationship.target_object_definition_id) ?? relationship.target_label}`,
      sourceObjectId: relationship.source_object_definition_id,
      targetObjectId: relationship.target_object_definition_id,
      cardinality: relationship.cardinality,
    }),
  );
  const operationalPageResult = await readQuery<OperationalPageRow[]>(
    reader
      .from("pages")
      .select("id,title,layout_json")
      .eq("business_id", tenant.business.id)
      .eq("audience", "public")
      .eq("is_active", true),
  );
  if (operationalPageResult.error) throw operationalPageResult.error;
  const operationalOptions: OperationalBlockOption[] = [];
  const operationalKeys = new Set<string>();
  const preorderPageTitles = new Map<string, string>();
  for (const page of operationalPageResult.data ?? []) {
    for (const block of operationalBlocks(page.layout_json)) {
      if (
        block.type === "preorder" &&
        typeof block.preorder_key === "string" &&
        page.title.trim()
      ) {
        preorderPageTitles.set(block.preorder_key, page.title.trim());
        continue;
      }
      const config = objectValue(block.config);
      if (!config) continue;
      const bookingKey = block.booking_key;
      const sourcePageId = page.id;
      const optionKey = `booking:${sourcePageId}:${String(bookingKey)}`;
      if (operationalKeys.has(optionKey)) continue;
      operationalKeys.add(optionKey);
      operationalOptions.push({
        type: "booking",
        key: String(bookingKey),
        label: page.title.trim() ? `Booking · ${page.title.trim()}` : "Booking",
        config,
        stableSourcePageId: sourcePageId,
      });
    }
  }
  const preorderResult = await readQuery<PreorderExperienceRow[]>(
    reader
      .from("preorder_experiences")
      .select("key,config_json,is_active")
      .eq("business_id", tenant.business.id)
      .eq("is_active", true),
  );
  if (preorderResult.error) throw preorderResult.error;
  for (const experience of preorderResult.data ?? []) {
    const optionKey = `preorder:${experience.key}`;
    if (operationalKeys.has(optionKey)) continue;
    operationalKeys.add(optionKey);
    operationalOptions.push({
      type: "preorder",
      key: experience.key,
      label: preorderPageTitles.get(experience.key)
        ? `Preorder · ${preorderPageTitles.get(experience.key)}`
        : "Preorder collection",
    });
  }
  let attachmentRows: AttachmentRow[] = [];
  let draftAssetIds: string[] = [];
  let objectAvailabilityRows: ObjectAvailabilityRow[] = [];
  let recordAvailabilityRows: RecordAvailabilityRow[] = [];
  let fieldAvailabilityRows: FieldAvailabilityRow[] = [];
  let mediaAvailabilityRows: MediaAvailabilityRow[] = [];
  if (state) {
    const attachmentResult = await readQuery<AttachmentRow[]>(
      reader
        .from("site_record_media_attachments")
        .select("record_id,field_definition_id,attachment_revision,asset_id")
        .eq("business_id", tenant.business.id)
        .eq("site_id", state.id),
    );
    if (attachmentResult.error) throw attachmentResult.error;
    attachmentRows = attachmentResult.data ?? [];
    const draftAssetResult = await readQuery<DraftAssetReferenceRow[]>(
      reader
        .from("site_draft_asset_references")
        .select("asset_id")
        .eq("business_id", tenant.business.id)
        .eq("site_id", state.id),
    );
    if (draftAssetResult.error) throw draftAssetResult.error;
    draftAssetIds = (draftAssetResult.data ?? []).map((row) => row.asset_id);
    const objectAvailabilityResult = await readQuery<ObjectAvailabilityRow[]>(
      reader
        .from("site_public_object_availability")
        .select("object_definition_id,status,availability_revision")
        .eq("business_id", tenant.business.id)
        .eq("site_id", state.id),
    );
    if (objectAvailabilityResult.error) throw objectAvailabilityResult.error;
    objectAvailabilityRows = objectAvailabilityResult.data ?? [];
    const recordAvailabilityResult = await readQuery<RecordAvailabilityRow[]>(
      reader
        .from("site_public_record_availability")
        .select("record_id,status,availability_revision")
        .eq("business_id", tenant.business.id)
        .eq("site_id", state.id),
    );
    if (recordAvailabilityResult.error) throw recordAvailabilityResult.error;
    recordAvailabilityRows = recordAvailabilityResult.data ?? [];
    const fieldAvailabilityResult = await readQuery<FieldAvailabilityRow[]>(
      reader
        .from("site_public_field_availability")
        .select("field_definition_id,status,availability_revision")
        .eq("business_id", tenant.business.id)
        .eq("site_id", state.id),
    );
    if (fieldAvailabilityResult.error) throw fieldAvailabilityResult.error;
    fieldAvailabilityRows = fieldAvailabilityResult.data ?? [];
    const mediaAvailabilityResult = await readQuery<MediaAvailabilityRow[]>(
      reader
        .from("site_public_media_availability")
        .select("asset_id,status,availability_revision")
        .eq("business_id", tenant.business.id)
        .eq("site_id", state.id),
    );
    if (mediaAvailabilityResult.error) throw mediaAvailabilityResult.error;
    mediaAvailabilityRows = mediaAvailabilityResult.data ?? [];
  }
  const objectOptions = await Promise.all(
    objectRows.map(async (objectValue) => {
      const fieldsResult = await readQuery<FieldRow[]>(
        reader
          .from("field_definitions")
          .select(
            "id,key,label,field_type,required,is_active,default_value,settings_json",
          )
          .eq("business_id", tenant.business.id)
          .eq("object_definition_id", objectValue.id)
          .eq("is_active", true),
      );
      const recordsResult = await readQuery<RecordRow[]>(
        reader
          .from("records")
          .select("id,object_definition_id,record_revision,data_json")
          .eq("business_id", tenant.business.id)
          .eq("object_definition_id", objectValue.id)
          .eq("record_status", "active"),
      );
      const viewsResult = await readQuery<ViewRow[]>(
        reader
          .from("views")
          .select("key,name,is_active")
          .eq("business_id", tenant.business.id)
          .eq("object_definition_id", objectValue.id)
          .eq("is_active", true),
      );
      if (fieldsResult.error) throw fieldsResult.error;
      if (recordsResult.error) throw recordsResult.error;
      if (viewsResult.error) throw viewsResult.error;
      return {
        id: objectValue.id,
        key: objectValue.key,
        singularLabel: objectValue.singular_label,
        pluralLabel: objectValue.plural_label,
        semanticType: objectValue.semantic_type,
        relationshipOptions,
        fieldOptions: (fieldsResult.data ?? [])
          .map((field) => {
            const settings =
              typeof field.settings_json === "object" &&
              field.settings_json !== null &&
              !Array.isArray(field.settings_json)
                ? (field.settings_json as Record<string, unknown>)
                : {};
            const options = Array.isArray(settings.options)
              ? settings.options.filter(
                  (option): option is string => typeof option === "string",
                )
              : undefined;
            return {
              id: field.id,
              key: field.key,
              label: field.label,
              fieldType: field.field_type,
              required: field.required,
              defaultValue: field.default_value,
              ...(options ? { options } : {}),
            };
          })
          .slice(0, 50),
        viewOptions: (viewsResult.data ?? [])
          .map((view) => ({ key: view.key, label: view.name }))
          .slice(0, 20),
        fields: (fieldsResult.data ?? [])
          .map((field) => field.key)
          .slice(0, 50),
        fileFields: (fieldsResult.data ?? [])
          .filter((field) => field.field_type === "file")
          .map((field) => ({ id: field.id, key: field.key })),
        records: (recordsResult.data ?? []).slice(0, 500).map((record) => ({
          id: record.id,
          objectDefinitionId: record.object_definition_id,
          recordRevision: record.record_revision,
          label:
            typeof record.data_json.name === "string"
              ? record.data_json.name
              : typeof record.data_json.title === "string"
                ? record.data_json.title
                : record.id.slice(0, 8),
          attachments: Object.fromEntries(
            attachmentRows
              .filter((attachment) => attachment.record_id === record.id)
              .map((attachment) => [
                attachment.field_definition_id,
                attachment.attachment_revision,
              ]),
          ),
        })),
      };
    }),
  );

  let customerResolutionCases: CustomerResolutionCase[] = [];
  if (state && canManageConfiguration) {
    const rpcReader = supabase as unknown as SiteRpcReader;
    const resolutionResult = await rpcReader.rpc(
      "list_site_customer_resolution_cases",
      { expected_business_id: tenant.business.id },
    );
    if (!resolutionResult.error && Array.isArray(resolutionResult.data)) {
      customerResolutionCases = resolutionResult.data.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const kind = item.kind;
        const candidateIds = Array.isArray(item.candidate_ids)
          ? item.candidate_ids.filter(
              (candidate): candidate is string => typeof candidate === "string",
            )
          : [];
        const candidateProfiles = Array.isArray(item.candidate_profiles)
          ? item.candidate_profiles.flatMap((candidate) => {
              if (!candidate || typeof candidate !== "object") return [];
              const profile = candidate as Record<string, unknown>;
              if (
                typeof profile.id !== "string" ||
                typeof profile.label !== "string" ||
                !profile.profile ||
                typeof profile.profile !== "object" ||
                Array.isArray(profile.profile)
              ) {
                return [];
              }
              return [
                {
                  id: profile.id,
                  label: profile.label,
                  profile: profile.profile as Record<string, unknown>,
                },
              ];
            })
          : [];
        const submittedDetails =
          item.submitted_details &&
          typeof item.submitted_details === "object" &&
          !Array.isArray(item.submitted_details)
            ? (item.submitted_details as Record<string, unknown>)
            : {};
        if (
          (kind !== "form" && kind !== "booking" && kind !== "preorder") ||
          typeof item.receipt_id !== "string" ||
          typeof item.resolution_revision !== "number" ||
          candidateIds.length < 2
        ) {
          return [];
        }
        return [
          {
            kind,
            receipt_id: item.receipt_id,
            public_reference:
              typeof item.public_reference === "string"
                ? item.public_reference
                : null,
            match_count:
              typeof item.match_count === "number" ? item.match_count : 0,
            candidate_ids: candidateIds.slice(0, 8),
            candidate_profiles: candidateProfiles.slice(0, 8),
            submitted_details: submittedDetails,
            original_customer_record_id:
              typeof item.original_customer_record_id === "string"
                ? item.original_customer_record_id
                : null,
            customer_record_id:
              typeof item.customer_record_id === "string"
                ? item.customer_record_id
                : null,
            resolution_state:
              typeof item.resolution_state === "string"
                ? item.resolution_state
                : null,
            resolution_revision: item.resolution_revision,
          },
        ];
      });
    }
  }

  let candidate = null;
  if (candidateId && z.uuid().safeParse(candidateId).success) {
    const candidateResult = await readQuery<unknown>(
      reader
        .from("site_releases")
        .select("*")
        .eq("business_id", tenant.business.id)
        .eq("id", candidateId)
        .maybeSingle(),
    );
    if (candidateResult.data) {
      const parsedRelease = candidateResult.data as {
        projection_schema_version?: unknown;
      };
      candidate =
        parsedRelease.projection_schema_version === 4
          ? siteReleaseV4Schema.parse(candidateResult.data)
          : parsedRelease.projection_schema_version === 3
            ? siteReleaseV3Schema.parse(candidateResult.data)
            : siteReleaseV2Schema.parse(candidateResult.data);
    }
  }
  const candidateProjection = candidate
    ? candidate.projection_schema_version === 4
      ? sitePublicProjectionV4Schema.parse(candidate.projection_json)
      : candidate.projection_schema_version === 3
        ? sitePublicProjectionV3Schema.parse(candidate.projection_json)
        : sitePublicProjectionSchema.parse(candidate.projection_json)
    : null;
  const candidateOperationalPreviewActions = candidate
    ? operationalPreviewActions(candidate.review_json)
    : [];

  const objectAvailabilityById = new Map(
    objectAvailabilityRows.map((row) => [row.object_definition_id, row]),
  );
  const fieldAvailabilityById = new Map(
    fieldAvailabilityRows.map((row) => [row.field_definition_id, row]),
  );
  const recordAvailabilityById = new Map(
    recordAvailabilityRows.map((row) => [row.record_id, row]),
  );
  const mediaAvailabilityById = new Map(
    mediaAvailabilityRows.map((row) => [row.asset_id, row]),
  );
  const mediaIds = [
    ...new Set([
      ...draftAssetIds,
      ...attachmentRows.map((attachment) => attachment.asset_id),
    ]),
  ];
  const draftReferences = state ? siteDraftReferences(state.draft_json) : null;
  const availabilityItems = state
    ? {
        objects: objectOptions
          .filter(
            (objectValue) =>
              draftReferences?.objectKeys.has(objectValue.key) ?? false,
          )
          .map((objectValue) => {
            const row = objectAvailabilityById.get(objectValue.id);
            return {
              targetId: objectValue.id,
              label: objectValue.key,
              status: row?.status ?? "available",
              availabilityRevision: row?.availability_revision ?? 0,
            };
          }),
        records: objectOptions.flatMap((objectValue) =>
          (draftReferences?.objectKeys.has(objectValue.key) ?? false)
            ? objectValue.records
                .filter(
                  (record) =>
                    draftReferences?.recordIds.has(record.id) ?? false,
                )
                .map((record) => {
                  const row = recordAvailabilityById.get(record.id);
                  return {
                    targetId: record.id,
                    label: `${objectValue.key} · ${record.label}`,
                    status: row?.status ?? "available",
                    availabilityRevision: row?.availability_revision ?? 0,
                  };
                })
            : [],
        ),
        fields: objectOptions.flatMap((objectValue) =>
          (draftReferences?.objectKeys.has(objectValue.key) ?? false)
            ? objectValue.fieldOptions
                .filter(
                  (field) => draftReferences?.fieldKeys.has(field.key) ?? false,
                )
                .map((field) => {
                  const row = fieldAvailabilityById.get(field.id);
                  return {
                    targetId: field.id,
                    label: `${objectValue.key} · ${field.key}`,
                    status: row?.status ?? "available",
                    availabilityRevision: row?.availability_revision ?? 0,
                  };
                })
            : [],
        ),
        media: mediaIds.map((assetId) => {
          const row = mediaAvailabilityById.get(assetId);
          return {
            targetId: assetId,
            label: assetId.slice(0, 8),
            status: row?.status ?? "available",
            availabilityRevision: row?.availability_revision ?? 0,
          };
        }),
      }
    : null;

  const draftNeedsUpdate = Boolean(
    state &&
    workspaceCurrentness &&
    (workspaceCurrentness.expectedBaseVersionId !==
      state.draft_base_version_id ||
      workspaceCurrentness.expectedHeadRevision !==
        state.draft_base_head_revision),
  );

  const noticeText: Record<string, string> = {
    created: "Your Site draft is ready.",
    saved: "Site draft saved.",
    rebased: "Your Site draft is up to date with workspace changes.",
    prepared: "Your Site update is ready to review.",
    published: "Your Site is live.",
    adopted: "Existing Pages are ready to review in your Site.",
    unpublished: "The Site is unpublished. Its legacy Pages remain retired.",
    availability_changed:
      "Availability changed. Re-enabled items return after you publish an update.",
    stale: "This Site changed elsewhere. Reload and review the current draft.",
    link_not_ready:
      "A Site link points to a missing or hidden Page. Include that Page or change or remove the link, then preview again.",
    input_invalid: "Review the highlighted Site details and try again.",
    failed: "The Site change could not be completed.",
    customer_reviewed: "Customer choice saved.",
  };

  return (
    <section className="tenant-content sites-composer-page">
      <header
        className={
          state
            ? "site-owner-heading site-owner-heading-compact"
            : "site-owner-heading"
        }
      >
        <div>
          {!state ? <p className="eyebrow">Sites</p> : null}
          <h1 className="page-title">Your Site</h1>
          {!state ? (
            <p className="lede">
              Build your pages, then preview and publish when they are ready.
            </p>
          ) : null}
        </div>
        <div className="site-owner-actions">
          <Link
            className="button-link"
            href={`/app/${encodeURIComponent(businessSlug)}`}
          >
            Back to Home
          </Link>
        </div>
      </header>

      {notice && noticeText[notice] && !(state && notice === "created") ? (
        <p className="notice notice-message">{noticeText[notice]}</p>
      ) : null}

      {!canManageConfiguration ? (
        <section className="panel">
          <h2>Site access</h2>
          <p className="muted">
            Your role can review customer-facing Pages but cannot change Site
            content.
          </p>
        </section>
      ) : !state ? (
        <section className="panel site-empty-state">
          <h2>Start your Site</h2>
          <p className="muted">
            Create a private Home draft, then add the pages and content your
            visitors need.
          </p>
          <form action={createSiteAction.bind(null, businessSlug)}>
            <button type="submit">Create Site draft</button>
          </form>
        </section>
      ) : (
        <>
          {state.migration_state === "legacy_pending" ? (
            <section className="panel site-adoption-panel">
              <h2>Review existing public Pages</h2>
              <p className="muted">
                Existing published Pages are ready with their addresses and
                content. Bring them into this Site when you publish.
              </p>
              <form action={stageSiteAdoptionAction.bind(null, businessSlug)}>
                <input name="siteId" type="hidden" value={state.id} />
                <input
                  name="expectedDraftRevision"
                  type="hidden"
                  value={state.draft_revision}
                />
                <input
                  name="expectedBaseVersionId"
                  type="hidden"
                  value={state.draft_base_version_id}
                />
                <input
                  name="expectedHeadRevision"
                  type="hidden"
                  value={state.draft_base_head_revision}
                />
                <button type="submit">Bring Pages into this Site</button>
              </form>
            </section>
          ) : null}

          {operationalOptions.length === 0 ? (
            <section
              aria-labelledby="site-operational-setup-heading"
              className="panel site-operational-setup"
            >
              <h2 id="site-operational-setup-heading">
                Add a customer journey
              </h2>
              <p className="muted">
                Set up a collection experience or an appointments workspace,
                then return here to place it on this Site. The setup stays
                private until you review and publish it.
              </p>
              <div className="configuration-action-links">
                <Link
                  className="button button-secondary"
                  href={`/app/${encodeURIComponent(businessSlug)}/setup`}
                >
                  Set up a collection experience
                </Link>
                <Link
                  className="button button-secondary"
                  href={`/app/${encodeURIComponent(businessSlug)}/setup/booking`}
                >
                  Set up appointments and public booking
                </Link>
              </div>
            </section>
          ) : null}

          <SiteComposer
            businessSlug={businessSlug}
            draft={state.draft_json}
            draftRevision={state.draft_revision}
            draftBaseVersionId={state.draft_base_version_id}
            draftBaseHeadRevision={state.draft_base_head_revision}
            objectOptions={objectOptions}
            operationalOptions={operationalOptions}
            previewAction={prepareSiteReleaseAction.bind(null, businessSlug)}
            publishAction={publishSiteReleaseAction.bind(null, businessSlug)}
            {...(operationalOptions.some((option) => option.type === "booking")
              ? {
                  bookingRefreshAction: refreshSiteBookingSetupAction.bind(
                    null,
                    businessSlug,
                  ),
                }
              : {})}
            candidateId={candidate?.id}
            siteId={state.id}
          />

          <SiteCustomerReview
            cases={customerResolutionCases}
            resolveAction={resolveSiteCustomerResolutionCaseAction.bind(
              null,
              businessSlug,
            )}
          />

          {availabilityItems ? (
            <SiteAvailabilityControls
              activeReleaseRevision={state.active_release_revision}
              fieldItems={availabilityItems.fields}
              mediaItems={availabilityItems.media}
              objectItems={availabilityItems.objects}
              recordItems={availabilityItems.records}
              siteId={state.id}
              actions={{
                reenableField: reenableSiteFieldAction.bind(null, businessSlug),
                reenableMedia: reenableSiteMediaAction.bind(null, businessSlug),
                reenableObject: reenableSiteObjectAction.bind(
                  null,
                  businessSlug,
                ),
                reenableRecord: reenableSiteRecordAction.bind(
                  null,
                  businessSlug,
                ),
                withdrawField: withdrawSiteFieldAction.bind(null, businessSlug),
                withdrawMedia: withdrawSiteMediaAction.bind(null, businessSlug),
                withdrawObject: withdrawSiteObjectAction.bind(
                  null,
                  businessSlug,
                ),
                withdrawRecord: withdrawSiteRecordAction.bind(
                  null,
                  businessSlug,
                ),
              }}
            />
          ) : null}

          {draftNeedsUpdate ? (
            <section
              className="panel site-recovery-panel"
              aria-label="Draft recovery"
            >
              <div>
                <p className="eyebrow">Draft recovery</p>
                <h2>Keep editing after a workspace change</h2>
                <p className="muted">
                  Another workspace change happened while you were editing.
                  Update this draft before saving or publishing.
                </p>
              </div>
              <form action={rebaseSiteDraftAction.bind(null, businessSlug)}>
                <input name="siteId" type="hidden" value={state.id} />
                <input
                  name="expectedDraftRevision"
                  type="hidden"
                  value={state.draft_revision}
                />
                <input
                  name="expectedBaseVersionId"
                  type="hidden"
                  value={state.draft_base_version_id}
                />
                <input
                  name="expectedHeadRevision"
                  type="hidden"
                  value={state.draft_base_head_revision}
                />
                <button className="button-secondary" type="submit">
                  Update draft
                </button>
              </form>
              {workspaceCurrentness &&
              (workspaceCurrentness.expectedBaseVersionId !==
                state.draft_base_version_id ||
                workspaceCurrentness.expectedHeadRevision !==
                  state.draft_base_head_revision) ? (
                <form
                  action={resolveSiteDraftConflictAction.bind(
                    null,
                    businessSlug,
                  )}
                >
                  <input name="siteId" type="hidden" value={state.id} />
                  <input
                    name="expectedDraftRevision"
                    type="hidden"
                    value={state.draft_revision}
                  />
                  <input
                    name="expectedBaseVersionId"
                    type="hidden"
                    value={state.draft_base_version_id}
                  />
                  <input
                    name="expectedHeadRevision"
                    type="hidden"
                    value={state.draft_base_head_revision}
                  />
                  <input
                    name="expectedTargetVersionId"
                    type="hidden"
                    value={workspaceCurrentness.expectedBaseVersionId}
                  />
                  <input
                    name="expectedTargetHeadRevision"
                    type="hidden"
                    value={workspaceCurrentness.expectedHeadRevision}
                  />
                  <input
                    name="resolution"
                    type="hidden"
                    value="keep_site_draft"
                  />
                  <button className="button-secondary" type="submit">
                    Keep Site draft and continue
                  </button>
                </form>
              ) : null}
            </section>
          ) : null}

          {candidate && candidateProjection ? (
            <SiteCandidatePreview
              businessSlug={businessSlug}
              candidateId={candidate.id}
              operationalPreviewActions={candidateOperationalPreviewActions}
              projection={candidateProjection}
            />
          ) : null}

          <section
            className="panel site-release-panel"
            aria-label="Release controls"
          >
            <div>
              <p className="eyebrow">Review and publish</p>
              <h2>
                {state.active_release_id
                  ? "Update the live Site"
                  : "Publish the Site"}
              </h2>
              <p className="muted">
                Publishing updates the public Site. Later draft edits remain
                private until you review them.
              </p>
            </div>
            <div className="site-release-actions">
              <form action={prepareSiteReleaseAction.bind(null, businessSlug)}>
                <input name="siteId" type="hidden" value={state.id} />
                <input
                  name="expectedDraftRevision"
                  type="hidden"
                  value={state.draft_revision}
                />
                <input
                  name="expectedBaseVersionId"
                  type="hidden"
                  value={state.draft_base_version_id}
                />
                <input
                  name="expectedHeadRevision"
                  type="hidden"
                  value={state.draft_base_head_revision}
                />
                <button type="submit">Preview Site update</button>
              </form>
              {candidate ? (
                <form
                  action={publishSiteReleaseAction.bind(null, businessSlug)}
                >
                  <input name="siteId" type="hidden" value={state.id} />
                  <input
                    name="candidateId"
                    type="hidden"
                    value={candidate.id}
                  />
                  <input
                    name="expectedDraftRevision"
                    type="hidden"
                    value={state.draft_revision}
                  />
                  <input
                    name="expectedBaseVersionId"
                    type="hidden"
                    value={state.draft_base_version_id}
                  />
                  <input
                    name="expectedHeadRevision"
                    type="hidden"
                    value={state.draft_base_head_revision}
                  />
                  <button type="submit">Publish Site update</button>
                </form>
              ) : null}
              {state.active_release_id ? (
                <form action={unpublishSiteAction.bind(null, businessSlug)}>
                  <input name="siteId" type="hidden" value={state.id} />
                  <input
                    name="expectedActiveReleaseRevision"
                    type="hidden"
                    value={state.active_release_revision}
                  />
                  <button className="button-secondary" type="submit">
                    Unpublish Site
                  </button>
                </form>
              ) : null}
            </div>
            {candidate ? (
              <p className="notice notice-message">
                Your Site update is ready. Review the preview above, then
                publish it.
              </p>
            ) : null}
          </section>
        </>
      )}
    </section>
  );
}
