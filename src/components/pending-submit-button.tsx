"use client";

import { useFormStatus } from "react-dom";

interface PendingSubmitButtonProps {
  className?: string;
  label: string;
  pendingLabel: string;
  statusId?: string;
}

export function PendingSubmitButton({
  className = "button",
  label,
  pendingLabel,
  statusId = "configuration-action-progress",
}: Readonly<PendingSubmitButtonProps>) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-describedby={statusId}
      className={className}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
      <span aria-live="polite" className="sr-only" id={statusId} role="status">
        {pending ? pendingLabel : ""}
      </span>
    </button>
  );
}
