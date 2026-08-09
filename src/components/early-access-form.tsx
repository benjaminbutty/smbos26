"use client";

import { useActionState } from "react";

import {
  EARLY_ACCESS_INITIAL_STATE,
  joinEarlyAccess,
} from "../app/actions/marketing";

export function EarlyAccessForm() {
  const [state, formAction, pending] = useActionState(
    joinEarlyAccess,
    EARLY_ACCESS_INITIAL_STATE,
  );

  if (state.status === "success") {
    return (
      <div className="early-access-success" role="status" aria-live="polite">
        <span className="early-access-success-mark" aria-hidden="true">
          ✓
        </span>
        <div>
          <strong>You&apos;re on the list.</strong>
          <p>We&apos;ll let you know when early access opens up.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="early-access-form" action={formAction} noValidate>
      <div className="early-access-field">
        <label htmlFor="early-access-email">Email</label>
        <input
          id="early-access-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@yourbusiness.com"
          required
          aria-describedby="early-access-note"
        />
      </div>
      <div className="early-access-field">
        <label htmlFor="early-access-business-type">
          What kind of business do you run? <span>(optional)</span>
        </label>
        <input
          id="early-access-business-type"
          name="businessType"
          type="text"
          autoComplete="organization-title"
          placeholder="Bakery, mobile service, retailer…"
        />
      </div>
      <button className="marketing-button" type="submit" disabled={pending}>
        {pending ? "Joining…" : "Join early access"}
      </button>
      <p className="early-access-note" id="early-access-note">
        We&apos;ll only use this to contact you about early access. No account
        is created.
      </p>
      {state.status === "error" ? (
        <p className="early-access-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
