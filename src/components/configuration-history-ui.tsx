import Link from "next/link";
import type { ReactNode } from "react";

import type {
  ConfigurationValidationResult,
  SemanticDiff,
} from "../core/configuration/schemas";
import type { Json, Tables } from "../db/supabase/database.types";

type ChangeSet = Tables<"configuration_change_sets">;
type Version = Tables<"configuration_versions">;
type Page = Tables<"pages">;

const statusPresentation = {
  proposed: {
    label: "Proposed — review before checking",
    tone: "attention",
  },
  validated: {
    label: "Checked — ready to apply",
    tone: "ready",
  },
  applied: { label: "Applied · Live", tone: "complete" },
  rejected: { label: "Rejected — needs a new proposal", tone: "problem" },
  conflicted: {
    label: "Things changed — review current setup",
    tone: "problem",
  },
  abandoned: { label: "Closed — abandoned", tone: "muted" },
} as const;

const entityLabels: Readonly<
  Record<SemanticDiff["changes"][number]["entity_type"], string>
> = {
  object: "Business item",
  field: "Question or field",
  relationship: "Connection",
  view: "Screen",
  form: "Form",
  page: "Page",
  preorder_experience: "Preorder setup",
  preorder_location: "Collection location",
};

const changeLabels = {
  created: "Created",
  updated: "Updated",
  restored: "Restored",
  archived: "Archived",
} as const;

const dayNames = new Map([
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
]);

function pathForChange(businessSlug: string, changeSetId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/${encodeURIComponent(changeSetId)}`;
}

function pathForVersion(businessSlug: string, versionId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/versions/${encodeURIComponent(versionId)}`;
}

function pathForBuilderUndo(
  businessSlug: string,
  sourceVersionId: string,
): string {
  const query = new URLSearchParams({ undoVersion: sourceVersionId });
  return `/app/${encodeURIComponent(businessSlug)}/builder?${query.toString()}`;
}

function previewPath(
  businessSlug: string,
  changeSetId: string,
  pageKey: string,
): string {
  return `${pathForChange(businessSlug, changeSetId)}/preview/${encodeURIComponent(pageKey)}`;
}

function titleCase(value: string): string {
  return value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Timestamp({ value }: Readonly<{ value: string }>): ReactNode {
  return (
    <time dateTime={value} title={`${value} (UTC)`}>
      {formatTimestamp(value)} UTC
    </time>
  );
}

function StatusBadge({
  status,
}: Readonly<{ status: ChangeSet["status"] }>): ReactNode {
  const presentation = statusPresentation[status];
  return (
    <span
      className={`change-status change-status-${presentation.tone}`}
      data-status={status}
      title={`Stored status: ${status}`}
    >
      {presentation.label}
      <span className="sr-only">. Stored status: {status}.</span>
    </span>
  );
}

function ownerConsequence(
  status: ChangeSet["status"],
  appliedVersionNumber: number | null,
): { eyebrow: string; heading: string; body: string } {
  switch (status) {
    case "proposed":
      return {
        eyebrow: "Configuration proposal",
        heading: "Nothing is live yet",
        body: "Review the before-and-after change, check it against current operational information, then apply it deliberately if it is right.",
      };
    case "validated":
      return {
        eyebrow: "Checked proposal",
        heading: "Ready for deliberate application",
        body: "This proposal has been checked against current operational information. Checking did not make it live; Apply remains a separate action.",
      };
    case "applied":
      return {
        eyebrow: "Applied configuration",
        heading: appliedVersionNumber
          ? `Live as Version ${appliedVersionNumber}`
          : "Live configuration",
        body: "This change is now the active configuration. Any undo or rollback creates a new forward history entry; it does not roll back ordinary business records.",
      };
    case "conflicted":
      return {
        eyebrow: "Things changed",
        heading: "Review the current setup",
        body: "The active configuration moved on before this proposal could continue. Nothing was silently rebased or applied; prepare a new proposal from the current setup.",
      };
    case "rejected":
      return {
        eyebrow: "Needs a new proposal",
        heading: "Nothing from this candidate is live",
        body: "The current operational information was not compatible with this candidate. Review the checked result and prepare a new proposal.",
      };
    case "abandoned":
      return {
        eyebrow: "Closed proposal",
        heading: "Live configuration was not changed",
        body: "This proposal is closed. Its stored history remains available for reference, but no configuration action is available.",
      };
  }
}

function DiffCounts({ diff }: Readonly<{ diff: SemanticDiff }>): ReactNode {
  return (
    <dl className="change-counts" aria-label="Semantic difference counts">
      {(["created", "updated", "restored", "archived"] as const).map(
        (changeType) => (
          <div key={changeType}>
            <dt>{changeLabels[changeType]}</dt>
            <dd>{diff.counts[changeType]}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

function validationCounts(
  result: ConfigurationValidationResult | null,
): { errors: number; warnings: number } | null {
  return result
    ? { errors: result.errors.length, warnings: result.warnings.length }
    : null;
}

function SimpleValue({
  property,
  value,
}: Readonly<{ property: string; value: Json }>): ReactNode {
  if (value === null) {
    return <span className="muted">Not set</span>;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-GB").format(value);
  }
  if (typeof value === "string") {
    if (property === "status" && ["draft", "published"].includes(value)) {
      return value === "published" ? "Published" : "Draft";
    }
    if (value.length <= 500) {
      return value;
    }
    return (
      <>
        {value.slice(0, 500)}…
        <details className="technical-details">
          <summary>Full value</summary>
          <pre>{value.slice(0, 4_000)}</pre>
        </details>
      </>
    );
  }
  if (
    property === "schedule.days_of_week" &&
    Array.isArray(value) &&
    value.every((day) => typeof day === "number" && dayNames.has(day))
  ) {
    return value.map((day) => dayNames.get(day as number)).join(", ");
  }
  if (
    Array.isArray(value) &&
    value.length <= 12 &&
    value.every(
      (item) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  ) {
    if (value.length === 0) {
      return <span className="muted">None</span>;
    }
    return (
      <ul className="value-list">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`}>
            <SimpleValue property={property} value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (!Array.isArray(value)) {
    const entries = Object.entries(value).filter(
      (entry): entry is [string, Json] => entry[1] !== undefined,
    );
    if (entries.length === 0) {
      return <span className="muted">No settings</span>;
    }
    const isSimpleObject =
      entries.length <= 8 &&
      entries.every(([, item]) => {
        if (
          item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        ) {
          return true;
        }
        return (
          Array.isArray(item) &&
          item.length <= 12 &&
          item.every(
            (nested) =>
              nested === null ||
              typeof nested === "string" ||
              typeof nested === "number" ||
              typeof nested === "boolean",
          )
        );
      });
    if (isSimpleObject) {
      return (
        <dl className="value-object">
          {entries.map(([key, item]) => (
            <div key={key}>
              <dt>{titleCase(key)}</dt>
              <dd>
                <SimpleValue property={key} value={item} />
              </dd>
            </div>
          ))}
        </dl>
      );
    }
  }

  const serialized = JSON.stringify(value, null, 2);
  return (
    <details className="technical-details">
      <summary>View structured details</summary>
      <pre>
        {serialized.slice(0, 4_000)}
        {serialized.length > 4_000 ? "\n… value truncated" : ""}
      </pre>
    </details>
  );
}

function ValidationResult({
  result,
  validatedAt,
}: Readonly<{
  result: ConfigurationValidationResult | null;
  validatedAt: string | null;
}>): ReactNode {
  if (!result) {
    return (
      <section className="change-section" aria-labelledby="validation-heading">
        <h2 id="validation-heading">Validation</h2>
        <div className="history-notice">
          <strong>Validation has not run</strong>
          <p>
            This proposal has not received an operational compatibility result.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="change-section" aria-labelledby="validation-heading">
      <h2 id="validation-heading">Validation</h2>
      <div
        className={`history-notice ${
          result.outcome === "valid"
            ? "history-notice-success"
            : "history-notice-error"
        }`}
      >
        <strong>
          {result.outcome === "valid"
            ? "Checked successfully"
            : "Rejected because current operational data is incompatible"}
        </strong>
        {validatedAt ? (
          <p>
            Checked <Timestamp value={validatedAt} />
          </p>
        ) : null}
      </div>

      {result.errors.length > 0 ? (
        <div className="validation-issues">
          <h3>Errors</h3>
          <ul>
            {result.errors.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <span>{issue.message}</span>
                <code>{issue.code}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.warnings.length > 0 ? (
        <div className="validation-issues">
          <h3>Warnings</h3>
          <ul>
            {result.warnings.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <span>{issue.message}</span>
                <code>{issue.code}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function SemanticDiffView({
  diff,
}: Readonly<{ diff: SemanticDiff }>): ReactNode {
  return (
    <section className="change-section" aria-labelledby="semantic-diff-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Owner impact · before and after</p>
          <h2 id="semantic-diff-heading">What changes</h2>
        </div>
        <DiffCounts diff={diff} />
      </div>

      {diff.changes.length === 0 ? (
        <div className="history-empty">
          No semantic differences were stored.
        </div>
      ) : (
        (["created", "updated", "restored", "archived"] as const).map(
          (changeType) => {
            const changes = diff.changes.filter(
              (change) => change.change_type === changeType,
            );
            if (changes.length === 0) {
              return null;
            }
            return (
              <section
                className="diff-group"
                aria-labelledby={`diff-${changeType}`}
                key={changeType}
              >
                <h3 id={`diff-${changeType}`}>
                  {changeLabels[changeType]} ({changes.length})
                </h3>
                <div className="diff-list">
                  {changes.map((change) => (
                    <article
                      className="diff-card"
                      key={`${change.entity_type}:${change.entity_key}`}
                    >
                      <header>
                        <div>
                          <span className="diff-entity-type">
                            {entityLabels[change.entity_type]}
                          </span>
                          <h4>{change.label}</h4>
                        </div>
                        <details className="technical-details diff-technical-details">
                          <summary>Technical ID</summary>
                          <code>{change.entity_key}</code>
                        </details>
                      </header>
                      {change.properties.length > 0 ? (
                        <div className="diff-properties">
                          {change.properties.map((property) => (
                            <section
                              aria-label={`${titleCase(property.property)} before and after`}
                              className="diff-property"
                              key={property.property}
                            >
                              <h5>{titleCase(property.property)}</h5>
                              <dl>
                                <div>
                                  <dt>Before</dt>
                                  <dd>
                                    <SimpleValue
                                      property={property.property}
                                      value={property.before}
                                    />
                                  </dd>
                                </div>
                                <div>
                                  <dt>After</dt>
                                  <dd>
                                    <SimpleValue
                                      property={property.property}
                                      value={property.after}
                                    />
                                  </dd>
                                </div>
                              </dl>
                            </section>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">
                          The complete item is {change.change_type}.
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          },
        )
      )}
    </section>
  );
}

export interface ConfigurationChangesOverviewProps {
  activeVersionId: string;
  businessSlug: string;
  changeSets: ChangeSet[];
  versions: Version[];
}

function ChangeCard({
  businessSlug,
  changeSet,
  versionById,
}: Readonly<{
  businessSlug: string;
  changeSet: ChangeSet;
  versionById: ReadonlyMap<string, Version>;
}>): ReactNode {
  const diff = changeSet.semantic_diff_json as unknown as SemanticDiff;
  const validation =
    changeSet.validation_result_json as ConfigurationValidationResult | null;
  const counts = validationCounts(validation);
  const appliedVersion = changeSet.applied_version_id
    ? versionById.get(changeSet.applied_version_id)
    : null;
  const rollbackTarget = changeSet.rollback_target_version_id
    ? versionById.get(changeSet.rollback_target_version_id)
    : null;

  return (
    <article className="change-card">
      <header>
        <div>
          <p className="change-kind">
            {changeSet.kind === "rollback" ? "Rollback" : "Change"}
          </p>
          <h3>{changeSet.title}</h3>
        </div>
        <StatusBadge status={changeSet.status} />
      </header>
      {changeSet.description ? (
        <p className="change-description">{changeSet.description}</p>
      ) : null}
      <p className="change-card-meta">
        Requested <Timestamp value={changeSet.created_at} />
      </p>
      <details className="technical-details change-technical-details">
        <summary>Technical details</summary>
        <p>Base revision {changeSet.base_head_revision}</p>
      </details>
      {appliedVersion ? (
        <p className="change-provenance">
          Applied as Version {appliedVersion.version_number}
        </p>
      ) : null}
      {changeSet.kind === "rollback" && changeSet.rollback_target_version_id ? (
        <p className="change-provenance">
          Restores{" "}
          {rollbackTarget
            ? `Version ${rollbackTarget.version_number}`
            : "an earlier configuration version"}
        </p>
      ) : null}
      <DiffCounts diff={diff} />
      {counts ? (
        <p className="validation-counts">
          Validation: {counts.errors} {counts.errors === 1 ? "error" : "errors"}
          , {counts.warnings} {counts.warnings === 1 ? "warning" : "warnings"}
        </p>
      ) : (
        <p className="validation-counts">Validation has not run</p>
      )}
      <Link
        aria-label={`View details for ${changeSet.title}`}
        className="text-link"
        href={pathForChange(businessSlug, changeSet.id)}
      >
        View details
      </Link>
    </article>
  );
}

function VersionHistory({
  activeVersionId,
  businessSlug,
  versions,
}: Readonly<{
  activeVersionId: string;
  businessSlug: string;
  versions: Version[];
}>): ReactNode {
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const newestFirst = [...versions].toSorted(
    (left, right) => right.version_number - left.version_number,
  );

  return (
    <div className="version-chain" aria-label="Forward configuration history">
      {newestFirst.map((version, index) => {
        const parent = version.parent_version_id
          ? versionById.get(version.parent_version_id)
          : null;
        const restored = version.restored_from_version_id
          ? versionById.get(version.restored_from_version_id)
          : null;
        return (
          <div className="version-chain-step" key={version.id}>
            {index > 0 ? (
              <span className="version-chain-arrow">
                <span aria-hidden="true">↑</span>
                <span className="sr-only">Newer version shown above.</span>
              </span>
            ) : null}
            <article className="version-card">
              <header>
                <div>
                  <p className="change-kind">
                    {version.kind === "baseline"
                      ? "Baseline"
                      : version.kind === "rollback"
                        ? "Rollback"
                        : "Change"}
                  </p>
                  <h3>Version {version.version_number}</h3>
                </div>
                {version.id === activeVersionId ? (
                  <span className="active-version-marker">Active</span>
                ) : (
                  <span className="historical-version-marker">Historical</span>
                )}
              </header>
              <p className="change-card-meta">
                Created <Timestamp value={version.created_at} />
              </p>
              <p className="change-provenance">
                {parent
                  ? `Follows Version ${parent.version_number}`
                  : version.parent_version_id
                    ? "Follows an earlier version outside this recent history"
                    : "First configuration version"}
                {version.restored_from_version_id
                  ? restored
                    ? ` · Rollback restoring Version ${restored.version_number}`
                    : " · Rollback restoring an earlier version"
                  : ""}
              </p>
              <details className="technical-details change-technical-details">
                <summary>Technical details</summary>
                <p>
                  Checksum <code>{version.snapshot_checksum.slice(0, 12)}</code>
                </p>
              </details>
              <Link
                aria-label={`View configuration Version ${version.version_number}`}
                className="text-link"
                href={pathForVersion(businessSlug, version.id)}
              >
                View version
              </Link>
            </article>
          </div>
        );
      })}
    </div>
  );
}

export function ConfigurationChangesOverview({
  activeVersionId,
  businessSlug,
  changeSets,
  versions,
}: Readonly<ConfigurationChangesOverviewProps>): ReactNode {
  const sortedChangeSets = [...changeSets].toSorted((left, right) => {
    const createdOrder = right.created_at.localeCompare(left.created_at);
    return createdOrder === 0 ? right.id.localeCompare(left.id) : createdOrder;
  });
  const open = sortedChangeSets.filter(
    (changeSet) =>
      changeSet.status === "proposed" || changeSet.status === "validated",
  );
  const completed = sortedChangeSets.filter(
    (changeSet) =>
      changeSet.status !== "proposed" && changeSet.status !== "validated",
  );
  const versionById = new Map(versions.map((version) => [version.id, version]));

  return (
    <section className="tenant-content configuration-history-page">
      <header className="history-page-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1 className="runtime-title">Changes</h1>
          <p className="muted">
            See what is proposed, what has been checked, and what is live in
            this Business.
          </p>
        </div>
        <nav aria-label="Changes sections" className="history-section-links">
          <a href="#changes">Changes</a>
          <a href="#version-history">Version history</a>
        </nav>
      </header>

      <section
        className="change-section"
        id="changes"
        aria-labelledby="changes-heading"
      >
        <h2 id="changes-heading">Changes</h2>
        <section aria-labelledby="needs-attention-heading">
          <div className="section-heading">
            <div>
              <h3 id="needs-attention-heading">Needs attention</h3>
              <p className="muted">Proposed and checked changes.</p>
            </div>
            <span className="section-count">{open.length}</span>
          </div>
          {open.length > 0 ? (
            <div className="change-card-grid">
              {open.map((changeSet) => (
                <ChangeCard
                  businessSlug={businessSlug}
                  changeSet={changeSet}
                  key={changeSet.id}
                  versionById={versionById}
                />
              ))}
            </div>
          ) : (
            <div className="history-empty">
              No proposed or validated changes need attention.
            </div>
          )}
        </section>

        <section aria-labelledby="completed-heading">
          <div className="section-heading">
            <div>
              <h3 id="completed-heading">Completed</h3>
              <p className="muted">Applied and closed proposals.</p>
            </div>
            <span className="section-count">{completed.length}</span>
          </div>
          {completed.length > 0 ? (
            <div className="change-card-grid">
              {completed.map((changeSet) => (
                <ChangeCard
                  businessSlug={businessSlug}
                  changeSet={changeSet}
                  key={changeSet.id}
                  versionById={versionById}
                />
              ))}
            </div>
          ) : (
            <div className="history-empty">No completed changes yet.</div>
          )}
        </section>
      </section>

      <section
        className="change-section"
        id="version-history"
        aria-labelledby="version-history-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="version-history-heading">Version history</h2>
            <p className="muted">
              Each applied change creates a new forward-only version.
            </p>
          </div>
          <span className="section-count">{versions.length}</span>
        </div>
        <VersionHistory
          activeVersionId={activeVersionId}
          businessSlug={businessSlug}
          versions={versions}
        />
      </section>
    </section>
  );
}

export interface ConfigurationChangeDetailProps {
  appliedVersion: Version | null;
  builderUndoEligible?: boolean;
  baseVersion: Version;
  businessSlug: string;
  changeSet: ChangeSet;
  notice?: ReactNode;
  preview:
    | { state: "available"; pages: Page[] }
    | { state: "empty" }
    | { state: "stale" }
    | { state: "closed" };
  rollbackTarget: Version | null;
}

export function ConfigurationChangeDetail({
  appliedVersion,
  builderUndoEligible = false,
  baseVersion,
  businessSlug,
  changeSet,
  notice,
  preview,
  rollbackTarget,
}: Readonly<ConfigurationChangeDetailProps>): ReactNode {
  const diff = changeSet.semantic_diff_json as unknown as SemanticDiff;
  const validation =
    changeSet.validation_result_json as ConfigurationValidationResult | null;

  return (
    <article className="tenant-content configuration-history-page">
      <Link className="back-link" href={`/app/${businessSlug}/changes`}>
        ← Return to Changes
      </Link>
      <header className="history-detail-header">
        <div>
          <p className="eyebrow">
            {changeSet.kind === "rollback"
              ? "Rollback proposal"
              : "Configuration change"}
          </p>
          <h1 className="runtime-title">{changeSet.title}</h1>
          {changeSet.description ? (
            <p className="lede">{changeSet.description}</p>
          ) : null}
        </div>
        <StatusBadge status={changeSet.status} />
      </header>

      {notice}

      {(() => {
        const consequence = ownerConsequence(
          changeSet.status,
          appliedVersion?.version_number ?? null,
        );
        return (
          <section
            aria-labelledby="owner-consequence-heading"
            className="history-impact"
          >
            <p className="eyebrow">{consequence.eyebrow}</p>
            <h2 id="owner-consequence-heading">{consequence.heading}</h2>
            <p>{consequence.body}</p>
          </section>
        );
      })()}

      <section
        className="change-section configuration-action-panel"
        aria-labelledby="available-actions-heading"
      >
        <p className="eyebrow">Next deliberate action</p>
        <h2 id="available-actions-heading">Available actions</h2>
        {changeSet.status === "proposed" ? (
          <div className="configuration-action-links">
            <Link
              className="button"
              href={`${pathForChange(businessSlug, changeSet.id)}/validate`}
            >
              Validate proposal
            </Link>
            <Link
              className="button button-danger"
              href={`${pathForChange(businessSlug, changeSet.id)}/abandon`}
            >
              Abandon proposal
            </Link>
          </div>
        ) : changeSet.status === "validated" ? (
          <div className="configuration-action-links">
            <Link
              className="button"
              href={`${pathForChange(businessSlug, changeSet.id)}/apply`}
            >
              Apply configuration
            </Link>
          </div>
        ) : changeSet.status === "applied" && appliedVersion ? (
          <div className="configuration-action-links">
            <Link
              className="button button-secondary"
              href={pathForVersion(businessSlug, appliedVersion.id)}
            >
              View resulting Version {appliedVersion.version_number}
            </Link>
            {builderUndoEligible ? (
              <Link
                className="button button-secondary"
                href={pathForBuilderUndo(businessSlug, appliedVersion.id)}
              >
                Undo this change in Builder
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="muted">
            This proposal is closed. No configuration action is available.
          </p>
        )}
        {(changeSet.status === "proposed" ||
          changeSet.status === "validated") &&
        preview.state === "available" ? (
          <p className="muted">
            Preview links below are read-only and do not make configuration
            live.
          </p>
        ) : null}
      </section>

      <section
        className="change-section"
        aria-labelledby="proposal-details-heading"
      >
        <h2 id="proposal-details-heading">Proposal details</h2>
        <dl className="history-metadata">
          <div>
            <dt>Kind</dt>
            <dd>{changeSet.kind === "rollback" ? "Rollback" : "Change"}</dd>
          </div>
          <div>
            <dt>Requested</dt>
            <dd>
              <Timestamp value={changeSet.created_at} />
              <span className="actor-label">Requested by an Owner/Admin</span>
            </dd>
          </div>
          <div>
            <dt>Base</dt>
            <dd>
              <Link href={pathForVersion(businessSlug, baseVersion.id)}>
                Version {baseVersion.version_number}
              </Link>
              <details className="technical-details">
                <summary>Technical revision</summary>
                <p>Base revision {changeSet.base_head_revision}</p>
              </details>
            </dd>
          </div>
          {rollbackTarget ? (
            <div>
              <dt>Rollback target</dt>
              <dd>
                <Link href={pathForVersion(businessSlug, rollbackTarget.id)}>
                  Version {rollbackTarget.version_number}
                </Link>
              </dd>
            </div>
          ) : null}
          {appliedVersion ? (
            <div>
              <dt>Applied version</dt>
              <dd>
                <Link href={pathForVersion(businessSlug, appliedVersion.id)}>
                  Version {appliedVersion.version_number}
                </Link>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Candidate</dt>
            <dd>
              <details className="technical-details">
                <summary>Technical details</summary>
                <code title={changeSet.candidate_checksum}>
                  Candidate checksum {changeSet.candidate_checksum}
                </code>
              </details>
            </dd>
          </div>
        </dl>

        <h3>Lifecycle</h3>
        <dl className="lifecycle-list">
          <div>
            <dt>Requested</dt>
            <dd>
              <Timestamp value={changeSet.created_at} />
            </dd>
          </div>
          {changeSet.validated_at ? (
            <div>
              <dt>Checked</dt>
              <dd>
                <Timestamp value={changeSet.validated_at} />
                <span className="actor-label">Checked by an Owner/Admin</span>
              </dd>
            </div>
          ) : null}
          {changeSet.applied_at ? (
            <div>
              <dt>Applied</dt>
              <dd>
                <Timestamp value={changeSet.applied_at} />
                <span className="actor-label">Applied by an Owner/Admin</span>
              </dd>
            </div>
          ) : null}
          {changeSet.closed_at ? (
            <div>
              <dt>Closed</dt>
              <dd>
                <Timestamp value={changeSet.closed_at} />
                <span className="actor-label">Closed by an Owner/Admin</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <ValidationResult
        result={validation}
        validatedAt={changeSet.validated_at}
      />
      <SemanticDiffView diff={diff} />

      <section className="change-section" aria-labelledby="preview-heading">
        <h2 id="preview-heading">Preview — not live</h2>
        {preview.state === "available" ? (
          <>
            <p className="muted">
              These candidate Pages are read-only and open inside authenticated
              preview. They do not change the live workspace.
            </p>
            <ul className="preview-page-list">
              {preview.pages.map((page) => (
                <li key={page.id}>
                  <div>
                    <strong>{page.title}</strong>
                    <span>
                      {page.audience === "public"
                        ? "Public Page"
                        : "Internal Page"}
                    </span>
                  </div>
                  <Link
                    aria-label={`Preview ${page.title} candidate Page`}
                    className="button button-secondary button-small"
                    href={previewPath(businessSlug, changeSet.id, page.key)}
                  >
                    Preview candidate
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : preview.state === "empty" ? (
          <div className="history-empty">
            This candidate has no active Pages available to preview.
          </div>
        ) : preview.state === "stale" ? (
          <div
            aria-live="polite"
            className="history-notice history-notice-warning"
            role="alert"
          >
            <strong>Things changed — Preview is unavailable</strong>
            <p>
              The active configuration moved on. Review the current Changes
              before preparing a new proposal.
            </p>
            <Link className="text-link" href={`/app/${businessSlug}/changes`}>
              Return to Changes
            </Link>
          </div>
        ) : (
          <div className="history-empty">
            Preview is available only while a proposal is proposed or validated.
          </div>
        )}
      </section>
    </article>
  );
}

export interface SnapshotCount {
  active: number;
  label: string;
  total: number;
}

export interface ConfigurationVersionDetailProps {
  active: boolean;
  builderUndoEligible?: boolean;
  businessSlug: string;
  diff: SemanticDiff | null;
  notice?: ReactNode;
  parent: Version | null;
  restoredFrom: Version | null;
  snapshotCounts: SnapshotCount[];
  sourceChangeSet: ChangeSet | null;
  sourceUnavailable: boolean;
  version: Version;
}

export function ConfigurationVersionDetail({
  active,
  builderUndoEligible = false,
  businessSlug,
  diff,
  notice,
  parent,
  restoredFrom,
  snapshotCounts,
  sourceChangeSet,
  sourceUnavailable,
  version,
}: Readonly<ConfigurationVersionDetailProps>): ReactNode {
  return (
    <article className="tenant-content configuration-history-page">
      <Link
        className="back-link"
        href={`/app/${businessSlug}/changes#version-history`}
      >
        ← Return to Version history
      </Link>
      <header className="history-detail-header">
        <div>
          <p className="eyebrow">
            {version.kind === "baseline"
              ? "Baseline"
              : version.kind === "rollback"
                ? "Rollback version"
                : "Configuration version"}
          </p>
          <h1 className="runtime-title">Version {version.version_number}</h1>
          <p className="muted">
            {active
              ? "This is the active configuration."
              : "This is an immutable historical configuration."}
          </p>
        </div>
        {active ? (
          <span className="active-version-marker">Active</span>
        ) : (
          <span className="historical-version-marker">Historical</span>
        )}
      </header>

      {notice}

      {active && builderUndoEligible ? (
        <section
          className="change-section configuration-action-panel"
          aria-labelledby="version-actions-heading"
        >
          <h2 id="version-actions-heading">Available actions</h2>
          <div className="configuration-action-links">
            <Link
              className="button button-secondary"
              href={pathForBuilderUndo(businessSlug, version.id)}
            >
              Undo this change in Builder
            </Link>
          </div>
        </section>
      ) : !active ? (
        <section
          className="change-section configuration-action-panel"
          aria-labelledby="version-actions-heading"
        >
          <h2 id="version-actions-heading">Available actions</h2>
          <div className="configuration-action-links">
            <Link
              className="button button-secondary"
              href={`${pathForVersion(businessSlug, version.id)}/rollback`}
            >
              Prepare rollback
            </Link>
          </div>
        </section>
      ) : null}

      {!active ? (
        <div className="history-notice history-notice-warning">
          <strong>Rollback is a new forward configuration change.</strong>
          <p>
            Preparing or applying it will not roll back Customers, Orders,
            Products or other ordinary business records.
          </p>
        </div>
      ) : null}

      {version.kind === "baseline" ? (
        <div className="history-notice">
          <strong>Empty configuration created with the Business.</strong>
        </div>
      ) : null}

      <section
        className="change-section"
        aria-labelledby="version-details-heading"
      >
        <h2 id="version-details-heading">Version details</h2>
        <dl className="history-metadata">
          <div>
            <dt>Created</dt>
            <dd>
              <Timestamp value={version.created_at} />
              {version.created_by ? (
                <span className="actor-label">Created by an Owner/Admin</span>
              ) : (
                <span className="actor-label">Created by SMBOS</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{titleCase(version.kind)}</dd>
          </div>
          <div>
            <dt>Parent</dt>
            <dd>
              {parent ? (
                <Link href={pathForVersion(businessSlug, parent.id)}>
                  Version {parent.version_number}
                </Link>
              ) : (
                "None — first version"
              )}
            </dd>
          </div>
          {restoredFrom ? (
            <div>
              <dt>Restored from</dt>
              <dd>
                <Link href={pathForVersion(businessSlug, restoredFrom.id)}>
                  Version {restoredFrom.version_number}
                </Link>
                <span className="actor-label">
                  History continued forward from its parent.
                </span>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Source proposal</dt>
            <dd>
              {sourceChangeSet ? (
                <Link href={pathForChange(businessSlug, sourceChangeSet.id)}>
                  {sourceChangeSet.title}
                </Link>
              ) : sourceUnavailable ? (
                "Source proposal is no longer available."
              ) : (
                "System baseline"
              )}
            </dd>
          </div>
          <div>
            <dt>Snapshot</dt>
            <dd>
              <details className="technical-details">
                <summary>Technical details</summary>
                <code>{version.snapshot_checksum}</code>
              </details>
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="change-section"
        aria-labelledby="snapshot-summary-heading"
      >
        <h2 id="snapshot-summary-heading">Stored snapshot summary</h2>
        <dl className="snapshot-counts">
          {snapshotCounts.map((count) => (
            <div key={count.label}>
              <dt>{count.label}</dt>
              <dd>
                {count.active} active
                {count.total !== count.active ? ` · ${count.total} stored` : ""}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {diff ? <SemanticDiffView diff={diff} /> : null}
    </article>
  );
}
