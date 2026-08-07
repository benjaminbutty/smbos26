"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { BuilderUndoPresentation } from "../core/configuration/builder-undo/contracts";
import { BUILDER_INITIAL_STATE, type BuilderUiState } from "./builder-ui-state";
import { PendingSubmitButton } from "./pending-submit-button";

type BuilderAction = (
  previousState: BuilderUiState,
  formData: FormData,
) => Promise<BuilderUiState>;
type BuilderFormAction = (formData: FormData) => void | Promise<void>;

interface BuilderUiProps {
  action: BuilderAction;
  businessSlug: string;
}

function proposalPath(businessSlug: string, proposalId: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes/${encodeURIComponent(proposalId)}?notice=builder_prepared`;
}

function locationsPath(businessSlug: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/locations`;
}

export function BuilderResultPanel({
  action,
  businessSlug,
  state,
}: Readonly<{
  action?: BuilderFormAction;
  businessSlug: string;
  state: BuilderUiState;
}>) {
  if (state.state === "idle") {
    return null;
  }

  if (state.state === "input_invalid") {
    return (
      <div className="builder-result builder-result-error" role="alert">
        <strong>{state.message}</strong>
      </div>
    );
  }

  if (state.state === "context_required") {
    return (
      <section
        aria-labelledby="builder-context-required-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <h2 id="builder-context-required-heading">
          Open the change to undo it
        </h2>
        <p>{state.message}</p>
      </section>
    );
  }

  if (state.state === "unavailable") {
    return (
      <div className="builder-result builder-result-error" role="alert">
        <strong>{state.message}</strong>
      </div>
    );
  }

  if (state.state === "unsupported") {
    return (
      <section
        aria-labelledby="builder-unsupported-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <h2 id="builder-unsupported-heading">
          This request needs a smaller first step
        </h2>
        <p>{state.message}</p>
        <p>
          Builder currently prepares configuration proposals such as Business
          information types, questions and fields, connections, forms, screens
          and pages, plus selected operational actions such as adding one
          Location. Try one complete request at a time.
        </p>
      </section>
    );
  }

  if (state.state === "location_confirmation") {
    return (
      <section
        aria-labelledby="builder-location-confirmation-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <p className="eyebrow">Ready for confirmation</p>
        <h2 id="builder-location-confirmation-heading">
          Add {state.location_name} as a new Location?
        </h2>
        <p>
          SMBOS will add one new Location named{" "}
          <strong>{state.location_name}</strong> using the{" "}
          <strong>{state.timezone}</strong> timezone
          {state.timezone_source === "business_timezone"
            ? " from your Business settings."
            : "."}
        </p>
        <p className="builder-safety-note">
          Warning: confirming changes your live Business setup immediately. This
          creates ordinary operational Business data and will not appear in
          configuration history or Changes. It creates one Location only; it
          does not reactivate or rename an existing Location.
        </p>
        <p className="builder-safety-note">
          No Products, preorder settings, staff, opening hours or other setup
          will be added.
        </p>
        <form action={action} className="builder-request-panel">
          <input
            name="confirmationKind"
            type="hidden"
            value="create_location"
          />
          <input
            name="confirmationToken"
            type="hidden"
            value={state.confirmation_token}
          />
          <PendingSubmitButton
            label="Confirm and add Location"
            pendingLabel="Adding Location…"
          />
          <Link
            className="button button-secondary"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            Cancel
          </Link>
        </form>
      </section>
    );
  }

  if (state.state === "location_conflict") {
    return (
      <section
        aria-labelledby="builder-location-conflict-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <h2 id="builder-location-conflict-heading">
          This Location needs your attention
        </h2>
        <p>{state.message}</p>
        <Link className="button" href={locationsPath(businessSlug)}>
          Review Locations
        </Link>
      </section>
    );
  }

  if (state.state === "record_confirmation") {
    return (
      <section
        aria-labelledby="builder-record-confirmation-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <p className="eyebrow">Ready for confirmation</p>
        <h2 id="builder-record-confirmation-heading">
          Add {state.object_label}
        </h2>
        <dl className="builder-confirmation-fields">
          {state.explicit_fields.map((field) => (
            <div key={`explicit-${field.label}`}>
              <dt>{field.label}</dt>
              <dd>{field.formatted_value}</dd>
            </div>
          ))}
          {state.default_fields.map((field) => (
            <div key={`default-${field.label}`}>
              <dt>{field.label}</dt>
              <dd>
                {field.formatted_value} <span className="muted">(default)</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="builder-safety-note">
          This creates one new {state.object_label}. It is ordinary business
          data and will not appear in configuration history.
        </p>
        <form action={action} className="builder-request-panel">
          <input name="confirmationKind" type="hidden" value="create_record" />
          <input
            name="confirmationToken"
            type="hidden"
            value={state.confirmation_token}
          />
          <PendingSubmitButton
            label="Confirm and create"
            pendingLabel="Creating…"
          />
          <Link
            className="button button-secondary"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            Cancel
          </Link>
        </form>
      </section>
    );
  }

  if (state.state === "record_update_confirmation") {
    return (
      <section
        aria-labelledby="builder-record-update-confirmation-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <p className="eyebrow">Ready for confirmation</p>
        <h2 id="builder-record-update-confirmation-heading">
          Update {state.object_label}?
        </h2>
        <p>SMBOS found one active {state.object_label} matching:</p>
        <dl className="builder-confirmation-fields">
          <div>
            <dt>{state.selector_presentation.label}</dt>
            <dd>{state.selector_presentation.formatted_value}</dd>
          </div>
        </dl>
        <p>It will change:</p>
        <dl className="builder-confirmation-fields">
          {state.change_rows.map((change) => (
            <div key={`change-${change.label}`}>
              <dt>{change.label}</dt>
              <dd>
                {change.formatted_before} <span aria-hidden="true">→</span>{" "}
                <strong>{change.formatted_after}</strong>
              </dd>
            </div>
          ))}
        </dl>
        <p className="builder-safety-note">
          Confirming changes this one existing {state.object_label} Record. It
          will not appear in configuration history.
        </p>
        <form action={action} className="builder-request-panel">
          <input
            name="recordUpdateConfirmationToken"
            type="hidden"
            value={state.confirmation_token}
          />
          <PendingSubmitButton
            label="Confirm and update"
            pendingLabel="Updating…"
          />
          <Link
            className="button button-secondary"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            Cancel
          </Link>
        </form>
      </section>
    );
  }

  if (state.state === "record_location_confirmation") {
    const actionLabel =
      state.action === "link" ? "Make available" : "Remove availability";
    const actionDescription =
      state.action === "link"
        ? `${state.object_label} will be available at ${state.location_name}.`
        : `${state.object_label} will no longer be available at ${state.location_name}.`;

    return (
      <section
        aria-labelledby="builder-record-location-confirmation-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <p className="eyebrow">Ready for confirmation</p>
        <h2 id="builder-record-location-confirmation-heading">
          {actionLabel} {state.object_label} at {state.location_name}?
        </h2>
        <p>{actionDescription}</p>
        <dl className="builder-confirmation-fields">
          <div>
            <dt>{state.selector_presentation.label}</dt>
            <dd>{state.selector_presentation.formatted_value}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{state.location_name}</dd>
          </div>
        </dl>
        <p className="builder-safety-note">
          Confirming changes live availability for this one existing Record. It
          is ordinary business data and does not create a configuration version
          or change history entry.
        </p>
        <form action={action} className="builder-request-panel">
          <input
            name="recordLocationConfirmationToken"
            type="hidden"
            value={state.confirmation_token}
          />
          <PendingSubmitButton
            label={
              state.action === "link"
                ? "Confirm and make available"
                : "Confirm and remove"
            }
            pendingLabel={
              state.action === "link" ? "Making available…" : "Removing…"
            }
          />
          <Link
            className="button button-secondary"
            href={`/app/${encodeURIComponent(businessSlug)}/builder`}
          >
            Cancel
          </Link>
        </form>
      </section>
    );
  }

  if (
    state.state === "record_update_not_found" ||
    state.state === "record_update_ambiguous" ||
    state.state === "record_update_ineligible" ||
    state.state === "record_update_no_change"
  ) {
    return (
      <section
        aria-labelledby="builder-record-update-result-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <h2 id="builder-record-update-result-heading">{state.object_label}</h2>
        <p>{state.message}</p>
      </section>
    );
  }

  if (state.state === "record_location_unavailable") {
    return (
      <section
        aria-labelledby="builder-record-location-result-heading"
        className="builder-result builder-result-warning"
        role="status"
      >
        <h2 id="builder-record-location-result-heading">Availability update</h2>
        <p>{state.message}</p>
      </section>
    );
  }

  if (state.state === "location_created") {
    return (
      <section
        aria-labelledby="builder-location-created-heading"
        className="builder-result builder-result-success"
        role="status"
      >
        <p className="eyebrow">Location added</p>
        <h2 id="builder-location-created-heading">{state.location_name}</h2>
        <p>
          {state.location_name} has been added using timezone {state.timezone}.
        </p>
        <Link className="button" href={locationsPath(businessSlug)}>
          Open Locations
        </Link>
      </section>
    );
  }

  if (state.state === "record_created") {
    return (
      <section
        aria-labelledby="builder-record-created-heading"
        className="builder-result builder-result-success"
        role="status"
      >
        <p className="eyebrow">Record added</p>
        <h2 id="builder-record-created-heading">{state.object_label} added</h2>
        <p>{state.message}</p>
        <Link
          className="button"
          href={
            state.destination_path ?? `/app/${encodeURIComponent(businessSlug)}`
          }
        >
          {state.destination_path
            ? `Open ${state.object_label}`
            : "Open workspace"}
        </Link>
      </section>
    );
  }

  if (state.state === "record_updated") {
    return (
      <section
        aria-labelledby="builder-record-updated-heading"
        className="builder-result builder-result-success"
        role="status"
      >
        <p className="eyebrow">Record updated</p>
        <h2 id="builder-record-updated-heading">{state.object_label}</h2>
        <p>{state.message}</p>
        <Link
          className="button"
          href={
            state.destination_path ?? `/app/${encodeURIComponent(businessSlug)}`
          }
        >
          {state.destination_path
            ? `Open ${state.object_label}`
            : "Open workspace"}
        </Link>
      </section>
    );
  }

  if (state.state === "record_location_updated") {
    return (
      <section
        aria-labelledby="builder-record-location-complete-heading"
        className="builder-result builder-result-success"
        role="status"
      >
        <p className="eyebrow">Availability updated</p>
        <h2 id="builder-record-location-complete-heading">
          {state.object_label} at {state.location_name}
        </h2>
        <p>{state.message}</p>
        <Link
          className="button"
          href={
            state.destination_path ?? `/app/${encodeURIComponent(businessSlug)}`
          }
        >
          {state.destination_path
            ? `Open ${state.object_label}`
            : "Open workspace"}
        </Link>
      </section>
    );
  }

  if (state.state === "proposed") {
    return (
      <section
        aria-labelledby="builder-proposed-heading"
        className="builder-result builder-result-success"
        role="status"
      >
        <p className="eyebrow">Proposal ready</p>
        <h2 id="builder-proposed-heading">Review the prepared change</h2>
        <p>{state.summary}</p>
        <p>
          {state.operation_count} configuration change
          {state.operation_count === 1 ? "" : "s"} is ready for review.
        </p>
        <p className="builder-safety-note">
          Nothing is live yet. Review the proposal, preview any available pages,
          then validate and apply it deliberately when ready.
        </p>
        <Link
          className="button"
          href={proposalPath(businessSlug, state.proposal_id)}
        >
          Review proposed change
        </Link>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="builder-clarification-heading"
      className="builder-result builder-result-clarification"
      role="status"
    >
      <h2 id="builder-clarification-heading">A little more detail will help</h2>
      <p>{state.understanding}</p>

      {state.known_requirements.length > 0 ? (
        <div className="builder-result-section">
          <h3>What SMBOS already understands</h3>
          <ul>
            {state.known_requirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.assumptions.length > 0 ? (
        <div className="builder-result-section">
          <h3>Assumptions to check</h3>
          <ul>
            {state.assumptions.map((assumption) => (
              <li key={assumption.statement}>
                {assumption.statement}
                {assumption.requires_owner_confirmation ? (
                  <span className="builder-detail-note">
                    Confirmation needed
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="builder-result-section">
        <h3>Questions to answer</h3>
        <ol className="builder-question-list">
          {state.questions.map((question) => (
            <li key={question.question}>
              <strong>{question.question}</strong>
              <p>{question.reason}</p>
              {question.options.length > 0 ? (
                <ul className="builder-option-list">
                  {question.options.map((option) => (
                    <li key={option}>{option}</li>
                  ))}
                </ul>
              ) : (
                <span className="builder-detail-note">Free-text answer</span>
              )}
            </li>
          ))}
        </ol>
      </div>

      {state.unsupported_requirements.length > 0 ? (
        <div className="builder-result-section">
          <h3>Not included in this phase</h3>
          <ul>
            {state.unsupported_requirements.map((requirement) => (
              <li key={requirement.requirement}>
                <strong>{requirement.requirement}</strong>
                <span className="builder-detail-note">
                  {requirement.explanation}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="builder-safety-note">
        Add these details to your request above, then submit the complete
        request again.
      </p>
    </section>
  );
}

export function BuilderUi({ action, businessSlug }: Readonly<BuilderUiProps>) {
  const [state, formAction] = useActionState(action, BUILDER_INITIAL_STATE);
  const [ownerRequest, setOwnerRequest] = useState("");

  return (
    <section className="tenant-content builder-page">
      <p className="eyebrow">Business Builder</p>
      <h1 className="runtime-title">
        What would you like your business to do?
      </h1>
      <p className="lede">
        Describe a safe setup change or one selected operational action you
        need. SMBOS will prepare a proposal or ask for confirmation before
        anything changes.
      </p>

      <div className="builder-safety-banner" role="note">
        <strong>Keep the request about your setup.</strong>
        <p>
          Describe the setup you need, not individual customer or staff
          information. Your request is used to prepare this result and is not
          stored as a Builder conversation.
        </p>
      </div>

      <form action={formAction} className="builder-request-panel">
        <label htmlFor="builder-owner-request">What do you need?</label>
        <textarea
          aria-describedby="builder-request-help builder-request-count"
          id="builder-owner-request"
          maxLength={4_000}
          name="ownerRequest"
          onChange={(event) => setOwnerRequest(event.target.value)}
          placeholder="Add Cambridge as a new Location."
          required
          rows={8}
          value={ownerRequest}
        />
        <div className="builder-request-footer">
          <span id="builder-request-help" className="muted">
            One complete request at a time. You can revise it after questions
            appear.
          </span>
          <output aria-live="polite" id="builder-request-count">
            {ownerRequest.length.toLocaleString("en-GB")} / 4,000 characters
          </output>
        </div>
        <PendingSubmitButton
          label="Prepare request"
          pendingLabel="Preparing request…"
        />
      </form>

      <section
        aria-labelledby="builder-examples-heading"
        className="builder-examples"
      >
        <div>
          <h2 id="builder-examples-heading">Ideas to get started</h2>
          <p className="muted">These are examples, not automatic actions.</p>
        </div>
        <ul>
          <li>Create a catering enquiry form and internal enquiry list.</li>
          <li>Create an equipment maintenance workspace.</li>
          <li>Add marketing consent to Customer information.</li>
        </ul>
      </section>

      <BuilderResultPanel
        action={formAction}
        businessSlug={businessSlug}
        state={state}
      />
    </section>
  );
}

type BuilderUndoAction = (formData: FormData) => Promise<void>;

interface BuilderUndoUiProps {
  action: BuilderUndoAction;
  businessSlug: string;
  context: BuilderUndoPresentation;
}

function changesPath(businessSlug: string): string {
  return `/app/${encodeURIComponent(businessSlug)}/changes`;
}

function versionHistoryPath(businessSlug: string): string {
  return `${changesPath(businessSlug)}#version-history`;
}

export function BuilderUndoUi({
  action,
  businessSlug,
  context,
}: Readonly<BuilderUndoUiProps>) {
  const sourceTitle =
    context.state === "eligible"
      ? (context.source_proposal_title ?? "Latest configuration change")
      : null;

  return (
    <section className="tenant-content builder-page">
      <p className="eyebrow">Business Builder</p>
      <h1 className="runtime-title">Undo the latest setup change</h1>

      {context.state === "eligible" ? (
        <section
          aria-labelledby="builder-undo-heading"
          className="builder-result builder-result-warning"
        >
          <p className="eyebrow">Latest applied configuration change</p>
          <h2 id="builder-undo-heading">{sourceTitle}</h2>
          <p>
            Version {context.source_version_number} is selected. SMBOS will
            restore the setup from immediately before this Version, which is
            Version {context.previous_version_number}.
          </p>
          <p>
            Existing Orders, Customers, Products and Locations will not be
            rolled back. Nothing changes until this rollback proposal is
            validated and deliberately applied in Changes.
          </p>
          <p className="builder-undo-phrase">
            <strong>Undo that.</strong>
          </p>
          <form action={action} className="builder-request-panel">
            <PendingSubmitButton
              label="Prepare undo proposal"
              pendingLabel="Preparing undo proposal…"
            />
            <Link
              className="button button-secondary"
              href={changesPath(businessSlug)}
            >
              Cancel
            </Link>
          </form>
        </section>
      ) : context.state === "superseded" ? (
        <section
          aria-labelledby="builder-undo-superseded-heading"
          className="builder-result builder-result-warning"
          role="status"
        >
          <h2 id="builder-undo-superseded-heading">The setup has moved on</h2>
          <p>
            Version {context.source_version_number} is no longer the active
            setup. SMBOS will not silently choose a newer change.
          </p>
          <p>Review the current Changes and Version history instead.</p>
        </section>
      ) : context.state === "baseline" ? (
        <section
          aria-labelledby="builder-undo-baseline-heading"
          className="builder-result builder-result-warning"
          role="status"
        >
          <h2 id="builder-undo-baseline-heading">
            There is no preceding setup to restore
          </h2>
          <p>
            Version {context.source_version_number} is the starting
            configuration, or it has no preceding configuration available.
          </p>
        </section>
      ) : (
        <section
          aria-labelledby="builder-undo-rollback-heading"
          className="builder-result builder-result-warning"
          role="status"
        >
          <h2 id="builder-undo-rollback-heading">
            This Version is already a rollback
          </h2>
          <p>
            Contextual undo is available only for the latest ordinary
            configuration change. Use Changes history to choose a Version
            deliberately.
          </p>
        </section>
      )}

      <nav aria-label="Configuration history" className="builder-undo-links">
        <Link
          className="button button-secondary"
          href={changesPath(businessSlug)}
        >
          Open Changes
        </Link>
        <Link className="text-link" href={versionHistoryPath(businessSlug)}>
          View Version history
        </Link>
      </nav>
    </section>
  );
}
