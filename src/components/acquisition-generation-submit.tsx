"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  acquisitionGenerationProgressMessage,
  acquisitionGenerationProgressStages,
} from "./acquisition-generation-progress";

interface AcquisitionGenerationSubmitProps {
  className?: string;
  label: string;
  statusId: string;
}

export function AcquisitionGenerationSubmit({
  className = "button",
  label,
  statusId,
}: Readonly<AcquisitionGenerationSubmitProps>) {
  const { pending } = useFormStatus();
  return (
    <div className="acquisition-generation-submit">
      <button
        aria-describedby={pending ? statusId : undefined}
        className={className}
        disabled={pending}
        type="submit"
      >
        {pending ? "Shaping your workspace…" : label}
      </button>
      {pending ? <AcquisitionGenerationProgress statusId={statusId} /> : null}
    </div>
  );
}

function AcquisitionGenerationProgress({
  statusId,
}: Readonly<{ statusId: string }>) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const timers = acquisitionGenerationProgressStages
      .filter(({ afterMs }) => afterMs > 0)
      .map(({ afterMs }) =>
        window.setTimeout(() => setElapsedMs(afterMs), afterMs),
      );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <p
      aria-live="polite"
      className="acquisition-generation-progress"
      id={statusId}
      role="status"
    >
      {acquisitionGenerationProgressMessage(elapsedMs)}
    </p>
  );
}
