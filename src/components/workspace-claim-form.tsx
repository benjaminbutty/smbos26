"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { PendingSubmitButton } from "./pending-submit-button";
import { TimezoneConfirmation } from "./timezone-confirmation";

function ClaimPendingState(): ReactNode {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="workspace-claim-pending"
      role="status"
    >
      <div className="workspace-claim-pending-content">
        <span aria-hidden="true" className="workspace-claim-pending-mark" />
        <p className="eyebrow">Creating your workspace</p>
        <h2>Your Lenni workspace is being created</h2>
        <p>
          Keep this page open. You&apos;ll move into the real workspace as soon
          as the create request finishes.
        </p>
        <span aria-hidden="true" className="workspace-claim-indeterminate" />
      </div>
    </div>
  );
}

export function WorkspaceClaimForm({
  action,
}: Readonly<{
  action: (formData: FormData) => void | Promise<void>;
}>): ReactNode {
  return (
    <form action={action} className="stack-form workspace-claim-form">
      <label>
        Business name
        <input
          autoComplete="organization"
          maxLength={120}
          name="businessName"
          required
        />
      </label>
      <TimezoneConfirmation />
      <PendingSubmitButton
        label="Create workspace"
        pendingLabel="Creating your workspace…"
        statusId="workspace-create-progress"
      />
      <ClaimPendingState />
    </form>
  );
}
