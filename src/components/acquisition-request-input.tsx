"use client";

import { useState, type ReactNode } from "react";

import { acquisitionPromptExamples } from "../core/acquisition/schemas";

export function AcquisitionRequestInput({
  defaultValue,
}: Readonly<{ defaultValue: string }>): ReactNode {
  const [value, setValue] = useState(defaultValue);
  return (
    <label className="acquisition-request-label">
      Describe what you need
      <textarea
        maxLength={4_000}
        name="request"
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder="Tell Lenni what is becoming difficult to organise."
        required
        rows={5}
        value={value}
      />
      <small>
        Describe the process, not individual customers. Don&apos;t include
        customer names, email addresses, phone numbers or other personal
        information.
      </small>
      <span className="acquisition-example-label">Try an example</span>
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
