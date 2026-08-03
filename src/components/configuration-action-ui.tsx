import Link from "next/link";
import type { ReactNode } from "react";

import type { ConfigurationActionNotice as ConfigurationActionNoticeValue } from "@/core/configuration/action-notices";
import type {
  ConfigurationValidationResult,
  SemanticDiff,
} from "@/core/configuration/schemas";
import type { Tables } from "@/db/supabase/database.types";

import { SemanticDiffView } from "./configuration-history-ui";
import { PendingSubmitButton } from "./pending-submit-button";

type ChangeSet = Tables<"configuration_change_sets">;
type Version = Tables<"configuration_versions">;
type Page = Tables<"pages">;

const noticePresentation: Readonly<
  Record<
    ConfigurationActionNoticeValue,
    { message: string; tone: "success" | "warning" | "error" }
  >
> = {
  validated: {
    message:
      "Validation succeeded. This proposal is ready for deliberate application.",
    tone: "success",
  },
  validation_rejected: {
    message:
      "Validation found an incompatibility. The stored errors below explain what needs a new proposal.",
    tone: "error",
  },
  validation_conflicted: {
    message:
      "Validation did not run because the active configuration moved on. This proposal is now conflicted.",
    tone: "warning",
  },
  applied: {
    message:
      "The configuration was applied and its immutable resulting version is shown below.",
    tone: "success",
  },
  application_rejected: {
    message:
      "A new incompatibility was found during application. Nothing from this candidate became live.",
    tone: "error",
  },
  application_conflicted: {
    message:
      "The active configuration moved on before application. This proposal is now conflicted.",
    tone: "warning",
  },
  abandoned: {
    message:
      "The proposal was abandoned. Live configuration and operational information were not changed.",
    tone: "success",
  },
  rollback_prepared: {
    message:
      "The rollback proposal was prepared. It must still be validated and deliberately applied.",
    tone: "success",
  },
  builder_prepared: {
    message:
      "Builder prepared this proposal. Nothing is live yet—review the changes and available previews before validating it.",
    tone: "success",
  },
  state_changed: {
    message:
      "The proposal or version changed after the confirmation screen was loaded. Review the current authoritative state before continuing.",
    tone: "warning",
  },
  input_invalid: {
    message:
      "Enter a title between 1 and 120 characters and a description no longer than 5,000 characters.",
    tone: "error",
  },
};

function changePath(businessSlug: string, changeSetId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/${encodeURIComponent(changeSetId)}`;
}

function versionPath(businessSlug: string, versionId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/versions/${encodeURIComponent(versionId)}`;
}

function DiffSummary({ diff }: Readonly<{ diff: SemanticDiff }>): ReactNode {
  return (
    <dl className="change-counts" aria-label="Semantic difference summary">
      {(["created", "updated", "restored", "archived"] as const).map(
        (changeType) => (
          <div key={changeType}>
            <dt>{changeType}</dt>
            <dd>{diff.counts[changeType]}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

function ConfirmationHeader({
  backHref,
  eyebrow,
  title,
}: Readonly<{
  backHref: string;
  eyebrow: string;
  title: string;
}>): ReactNode {
  return (
    <>
      <Link className="back-link" href={backHref}>
        ← Return without making a change
      </Link>
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="runtime-title">{title}</h1>
      </header>
    </>
  );
}

export function ConfigurationActionNotice({
  notice,
}: Readonly<{
  notice: ConfigurationActionNoticeValue | null;
}>): ReactNode {
  if (!notice) {
    return null;
  }
  const presentation = noticePresentation[notice];
  return (
    <div
      aria-live="polite"
      className={`history-notice history-notice-${presentation.tone}`}
      role={presentation.tone === "error" ? "alert" : "status"}
    >
      <strong>{presentation.message}</strong>
    </div>
  );
}

interface ProposalConfirmationProps {
  action: (formData: FormData) => Promise<void>;
  baseVersion: Version;
  businessSlug: string;
  changeSet: ChangeSet;
}

export function ValidateConfigurationConfirmation({
  action,
  baseVersion,
  businessSlug,
  changeSet,
  previewPages,
}: Readonly<
  ProposalConfirmationProps & {
    previewPages: Page[];
  }
>): ReactNode {
  const diff = changeSet.semantic_diff_json as unknown as SemanticDiff;
  const detailPath = changePath(businessSlug, changeSet.id);

  return (
    <article className="tenant-content configuration-confirmation-page">
      <ConfirmationHeader
        backHref={detailPath}
        eyebrow={
          changeSet.kind === "rollback"
            ? "Validate rollback proposal"
            : "Validate configuration proposal"
        }
        title="Validate this proposal?"
      />
      <div className="history-notice history-notice-warning">
        <strong>Validation does not make configuration live.</strong>
        <p>
          SMBOS checks this candidate against current operational information.
          Success makes it ready to apply. An incompatibility permanently
          rejects it, while configuration movement may close it as conflicted.
        </p>
      </div>
      <section className="change-section" aria-labelledby="validate-summary">
        <h2 id="validate-summary">Proposal summary</h2>
        <dl className="history-metadata">
          <div>
            <dt>Proposal</dt>
            <dd>{changeSet.title}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{changeSet.kind === "rollback" ? "Rollback" : "Change"}</dd>
          </div>
          <div>
            <dt>Base</dt>
            <dd>
              Version {baseVersion.version_number} · revision{" "}
              {changeSet.base_head_revision}
            </dd>
          </div>
          <div>
            <dt>Validation</dt>
            <dd>Not run</dd>
          </div>
          <div>
            <dt>Candidate checksum</dt>
            <dd>
              <code>{changeSet.candidate_checksum.slice(0, 12)}</code>
            </dd>
          </div>
        </dl>
        <DiffSummary diff={diff} />
      </section>
      {previewPages.length > 0 ? (
        <nav aria-label="Candidate preview links">
          <p className="muted">Review candidate Pages before validating:</p>
          <div className="configuration-action-links">
            {previewPages.map((page) => (
              <Link
                className="button button-secondary button-small"
                href={`${detailPath}/preview/${encodeURIComponent(page.key)}`}
                key={page.id}
              >
                Preview {page.title}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
      <form action={action} className="confirmation-form">
        <PendingSubmitButton
          label="Validate proposal"
          pendingLabel="Validating proposal…"
        />
        <Link className="button button-secondary" href={detailPath}>
          Cancel
        </Link>
      </form>
    </article>
  );
}

export function ApplyConfigurationConfirmation({
  action,
  businessSlug,
  changeSet,
}: Readonly<ProposalConfirmationProps>): ReactNode {
  const detailPath = changePath(businessSlug, changeSet.id);
  const diff = changeSet.semantic_diff_json as unknown as SemanticDiff;
  const validation =
    changeSet.validation_result_json as ConfigurationValidationResult;

  return (
    <article className="tenant-content configuration-confirmation-page">
      <ConfirmationHeader
        backHref={detailPath}
        eyebrow={
          changeSet.kind === "rollback"
            ? "Apply rollback configuration"
            : "Apply configuration"
        }
        title="Make this configuration live?"
      />
      <div className="history-notice history-notice-warning">
        <strong>This advances the active configuration.</strong>
        <p>
          The candidate becomes the live normalized configuration, one immutable
          version is created, and the active head advances. Operational Records
          are not rewritten. A later rollback creates another forward version
          instead of undoing history.
        </p>
      </div>
      <div className="history-notice history-notice-success">
        <strong>Validation succeeded.</strong>
        <p>
          {validation.warnings.length === 0
            ? "No validation warnings were stored."
            : `${validation.warnings.length} validation warning${
                validation.warnings.length === 1 ? " was" : "s were"
              } stored.`}
        </p>
      </div>
      <SemanticDiffView diff={diff} />
      <form action={action} className="confirmation-form">
        <PendingSubmitButton
          label="Apply configuration"
          pendingLabel="Applying configuration…"
        />
        <Link className="button button-secondary" href={detailPath}>
          Cancel
        </Link>
      </form>
    </article>
  );
}

export function AbandonConfigurationConfirmation({
  action,
  businessSlug,
  changeSet,
}: Readonly<ProposalConfirmationProps>): ReactNode {
  const detailPath = changePath(businessSlug, changeSet.id);
  const diff = changeSet.semantic_diff_json as unknown as SemanticDiff;

  return (
    <article className="tenant-content configuration-confirmation-page">
      <ConfirmationHeader
        backHref={detailPath}
        eyebrow="Abandon configuration proposal"
        title="Abandon this proposal?"
      />
      <div className="history-notice history-notice-error">
        <strong>Abandonment is final.</strong>
        <p>
          No live configuration or operational information will change. A new
          proposal is required to revisit this idea.
        </p>
      </div>
      <section className="change-section" aria-labelledby="abandon-summary">
        <h2 id="abandon-summary">{changeSet.title}</h2>
        <DiffSummary diff={diff} />
      </section>
      <form action={action} className="confirmation-form">
        <PendingSubmitButton
          className="button button-danger"
          label="Abandon proposal"
          pendingLabel="Abandoning proposal…"
        />
        <Link className="button button-secondary" href={detailPath}>
          Keep proposal
        </Link>
      </form>
    </article>
  );
}

interface RollbackConfirmationProps {
  action: (formData: FormData) => Promise<void>;
  activeVersion: Version;
  businessSlug: string;
  notice: ConfigurationActionNoticeValue | null;
  targetVersion: Version;
}

export function PrepareRollbackConfirmation({
  action,
  activeVersion,
  businessSlug,
  notice,
  targetVersion,
}: Readonly<RollbackConfirmationProps>): ReactNode {
  const detailPath = versionPath(businessSlug, targetVersion.id);

  return (
    <article className="tenant-content configuration-confirmation-page">
      <ConfirmationHeader
        backHref={detailPath}
        eyebrow="Prepare configuration rollback"
        title={`Restore from Version ${targetVersion.version_number}?`}
      />
      <ConfigurationActionNotice notice={notice} />
      <div className="history-notice history-notice-warning">
        <strong>This creates a proposal only.</strong>
        <p>
          Live configuration and operational Records stay unchanged. Later
          configuration identities remain archived instead of deleted. If this
          proposal is later validated and applied, SMBOS creates a new version
          after Version {activeVersion.version_number}; history does not rewind.
        </p>
      </div>
      <form
        action={action}
        className="confirmation-form confirmation-form-fields"
      >
        <label>
          Proposal title
          <input
            defaultValue={`Restore configuration from Version ${targetVersion.version_number}`}
            maxLength={120}
            minLength={1}
            name="title"
            required
          />
        </label>
        <label>
          Description <span className="muted">(optional)</span>
          <textarea maxLength={5000} name="description" rows={5} />
        </label>
        <div className="configuration-action-links">
          <PendingSubmitButton
            label="Prepare rollback proposal"
            pendingLabel="Preparing rollback proposal…"
          />
          <Link className="button button-secondary" href={detailPath}>
            Cancel
          </Link>
        </div>
      </form>
    </article>
  );
}
