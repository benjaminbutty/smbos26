"use client";

import { useFormStatus } from "react-dom";

interface PendingSubmitButtonProps {
  className?: string;
  label: string;
  pendingLabel: string;
}

export function PendingSubmitButton({
  className = "button",
  label,
  pendingLabel,
}: Readonly<PendingSubmitButtonProps>) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-describedby="configuration-action-progress"
      className={className}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
      <span
        aria-live="polite"
        className="sr-only"
        id="configuration-action-progress"
        role="status"
      >
        {pending ? pendingLabel : ""}
      </span>
    </button>
  );
}
