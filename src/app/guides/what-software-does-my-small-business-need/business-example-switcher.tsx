"use client";

import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

const examples = {
  maintenance: {
    label: "Maintenance company",
    nodes: [
      {
        eyebrow: "Who",
        title: "Customer",
        description: "Contact details and the work you have done for them.",
      },
      {
        eyebrow: "What happens",
        title: "Job",
        description: "The visit, site, status and work that needs completing.",
      },
      {
        eyebrow: "What follows",
        title: "Quote",
        description: "What was priced, sent and marked as waiting for reply.",
      },
    ],
  },
  salon: {
    label: "Salon",
    nodes: [
      {
        eyebrow: "Who",
        title: "Client",
        description: "Preferences, notes and previous appointments.",
      },
      {
        eyebrow: "What happens",
        title: "Appointment",
        description: "Service, stylist, date and current status.",
      },
      {
        eyebrow: "What follows",
        title: "Rebook status",
        description: "A clear, manually tracked view of who is due to rebook.",
      },
    ],
  },
  delivery: {
    label: "Recurring delivery",
    nodes: [
      {
        eyebrow: "Who",
        title: "Customer",
        description: "Address, contact details and delivery notes.",
      },
      {
        eyebrow: "What repeats",
        title: "Standing order",
        description: "The products, quantities and agreed frequency.",
      },
      {
        eyebrow: "What follows",
        title: "Delivery day",
        description: "The useful route view the team works from.",
      },
    ],
  },
} as const;

type ExampleKey = keyof typeof examples;
const exampleKeys = Object.keys(examples) as ExampleKey[];

export function BusinessExampleSwitcher(): ReactNode {
  const [selectedKey, setSelectedKey] = useState<ExampleKey>("maintenance");
  const selected = examples[selectedKey];

  function selectFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    currentKey: ExampleKey,
  ): void {
    const currentIndex = exampleKeys.indexOf(currentKey);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % exampleKeys.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + exampleKeys.length) % exampleKeys.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = exampleKeys.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const nextKey = exampleKeys[nextIndex];
    if (!nextKey) return;
    setSelectedKey(nextKey);
    document.getElementById(`software-guide-example-${nextKey}`)?.focus();
  }

  return (
    <div className="software-guide-examples">
      <div
        className="software-guide-example-tabs"
        role="tablist"
        aria-label="Business example"
      >
        {exampleKeys.map((key) => (
          <button
            aria-controls="software-guide-example-panel"
            aria-selected={selectedKey === key}
            id={`software-guide-example-${key}`}
            key={key}
            onClick={() => setSelectedKey(key)}
            onKeyDown={(event) => selectFromKeyboard(event, key)}
            role="tab"
            tabIndex={selectedKey === key ? 0 : -1}
            type="button"
          >
            {examples[key].label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`software-guide-example-${selectedKey}`}
        className="software-guide-business-map"
        id="software-guide-example-panel"
        role="tabpanel"
      >
        {selected.nodes.map((node, index) => (
          <div className="software-guide-map-step" key={node.title}>
            {index > 0 ? (
              <span className="software-guide-map-arrow" aria-hidden="true">
                →
              </span>
            ) : null}
            <article className="software-guide-map-node">
              <span>{node.eyebrow}</span>
              <strong>{node.title}</strong>
              <p>{node.description}</p>
            </article>
          </div>
        ))}
      </div>
    </div>
  );
}
