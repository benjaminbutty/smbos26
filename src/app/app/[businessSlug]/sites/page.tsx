import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";

import { hasCapability, resolveTenant } from "../../../../auth/authorization";
import {
  createSiteAction,
  prepareSiteReleaseAction,
  publishSiteReleaseAction,
  resolveSiteDraftConflictAction,
  rebaseSiteDraftAction,
  saveSiteDraftAction,
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
} from "./actions";
import { SiteComposer } from "../../../../components/sites/site-composer";
import { SiteCandidatePreview } from "../../../../components/sites/site-candidate-preview";
import { SiteAvailabilityControls } from "../../../../components/sites/site-availability-controls";
import { ConfigurationChangeService } from "../../../../core/configuration/service";
import {
  siteReleaseV2Schema,
  siteStateSchema,
} from "../../../../core/sites/service";
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

type ObjectRow = { id: string; key: string; is_active: boolean };
type FieldRow = {
  id: string;
  key: string;
  field_type: string;
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
      .select("id,key,is_active")
      .eq("business_id", tenant.business.id)
      .eq("is_active", true),
  );
  if (objectResult.error) throw objectResult.error;
  const objectRows = objectResult.data ?? [];
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
          .select("id,key,field_type,is_active")
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
      if (fieldsResult.error) throw fieldsResult.error;
      if (recordsResult.error) throw recordsResult.error;
      return {
        id: objectValue.id,
        key: objectValue.key,
        fieldOptions: (fieldsResult.data ?? [])
          .map((field) => ({
            id: field.id,
            key: field.key,
            fieldType: field.field_type,
          }))
          .slice(0, 10),
        fields: (fieldsResult.data ?? [])
          .map((field) => field.key)
          .slice(0, 10),
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
    if (candidateResult.data)
      candidate = siteReleaseV2Schema.parse(candidateResult.data);
  }

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

  const noticeText: Record<string, string> = {
    created: "Your Site draft is ready.",
    saved: "Site draft saved.",
    rebased: "Site draft is aligned with the latest workspace configuration.",
    prepared: "A release candidate is ready for review.",
    published: "Your Site is live.",
    adopted: "Legacy Pages are staged for Site review.",
    unpublished: "The Site is unpublished. Its legacy Pages remain retired.",
    availability_changed:
      "Availability changed. Re-enabled data needs a new reviewed release.",
    stale: "This Site changed elsewhere. Reload and review the current draft.",
    input_invalid: "Review the highlighted Site details and try again.",
    failed: "The Site change could not be completed.",
  };

  return (
    <section className="tenant-content sites-composer-page">
      <header className="site-owner-heading">
        <div>
          <p className="eyebrow">Sites</p>
          <h1 className="page-title">Customer-facing Site</h1>
          <p className="lede">
            Compose pages, collections and managed media in a durable draft,
            then review the exact release before publishing.
          </p>
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

      {notice && noticeText[notice] ? (
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
                Existing published Pages are staged with their addresses and
                source history. Adoption takes effect only when you publish the
                reviewed Site candidate.
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
                <button type="submit">Stage legacy Pages for review</button>
              </form>
            </section>
          ) : null}

          <SiteComposer
            businessSlug={businessSlug}
            draft={state.draft_json}
            draftRevision={state.draft_revision}
            objectOptions={objectOptions}
            saveAction={saveSiteDraftAction.bind(null, businessSlug)}
            siteId={state.id}
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

          <section
            className="panel site-recovery-panel"
            aria-label="Draft recovery"
          >
            <div>
              <p className="eyebrow">Draft recovery</p>
              <h2>Keep editing after a workspace change</h2>
              <p className="muted">
                If another workspace change makes this draft stale, rebase its
                base explicitly before saving or preparing the next release.
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
                Rebase draft base
              </button>
            </form>
            {workspaceCurrentness &&
            (workspaceCurrentness.expectedBaseVersionId !==
              state.draft_base_version_id ||
              workspaceCurrentness.expectedHeadRevision !==
                state.draft_base_head_revision) ? (
              <form
                action={resolveSiteDraftConflictAction.bind(null, businessSlug)}
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

          {candidate ? (
            <SiteCandidatePreview
              businessSlug={businessSlug}
              candidateId={candidate.id}
              projection={candidate.projection_json}
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
                Publishing creates a new immutable public projection. Later
                draft edits remain private until reviewed again.
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
                <button type="submit">Prepare release for review</button>
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
                  <button type="submit">Publish reviewed candidate</button>
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
                Candidate {candidate.id.slice(0, 8)} is ready. Review the
                preview above, then publish this exact candidate.
              </p>
            ) : null}
          </section>
        </>
      )}
    </section>
  );
}
