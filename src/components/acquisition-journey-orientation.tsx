import type { ReactNode } from "react";

const journeySteps = [
  { key: "understanding", label: "Understanding your business" },
  { key: "shaping", label: "Shaping your workspace" },
  { key: "preview", label: "Preview" },
  { key: "create", label: "Create" },
] as const;

export type AcquisitionJourneyStep = (typeof journeySteps)[number]["key"];

export function AcquisitionJourneyOrientation({
  current,
}: Readonly<{ current: AcquisitionJourneyStep }>): ReactNode {
  const currentIndex = journeySteps.findIndex((step) => step.key === current);
  const currentLabel =
    journeySteps[currentIndex]?.label ?? journeySteps[0].label;

  return (
    <aside
      aria-label="Journey orientation"
      className="acquisition-journey-orientation"
    >
      <p className="acquisition-journey-label">Your journey</p>
      <p className="acquisition-journey-compact">
        Step {currentIndex + 1} of {journeySteps.length} · {currentLabel}
      </p>
      <ol>
        {journeySteps.map((step, index) => {
          const state =
            index < currentIndex
              ? "complete"
              : index === currentIndex
                ? "current"
                : "upcoming";
          return (
            <li
              aria-current={state === "current" ? "step" : undefined}
              key={step.key}
            >
              <span
                aria-hidden="true"
                className="acquisition-journey-marker"
                data-state={state}
              />
              <span className="acquisition-journey-step-label">
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
