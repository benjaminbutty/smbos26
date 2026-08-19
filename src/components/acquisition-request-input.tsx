"use client";

import { useState, type ReactNode } from "react";

import { acquisitionPromptExamples } from "../core/acquisition/schemas";

export function AcquisitionRequestInput({
  defaultValue,
}: Readonly<{ defaultValue: string }>): ReactNode {
  const [value, setValue] = useState(defaultValue);
  return (
    <label className="acquisition-request-label">
      <span>Describe your business</span>
      <textarea
        maxLength={4_000}
        name="request"
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder="I run a dog-grooming business and need to keep track of customers, dogs, appointments and services."
        required
        rows={5}
        value={value}
      />
      <small>
        Tell Lenni what you run, what you keep track of, and what feels messy.
        Real customer names, numbers and other personal details are not needed.
      </small>
      <span className="acquisition-example-label">Try a real example</span>
      <span className="acquisition-example-list">
        {acquisitionPromptExamples.map((example) => (
          <button key={example} onClick={() => setValue(example)} type="button">
            {example}
          </button>
        ))}
      </span>
    </label>
  );
}
