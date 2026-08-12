"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function TimezoneConfirmation(): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const suggested = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (suggested && input.current && !input.current.value) {
      input.current.value = suggested;
    }
  }, []);
  return (
    <div className="acquisition-timezone-field">
      <label>
        Timezone
        <input
          maxLength={80}
          name="timezone"
          placeholder="Europe/London"
          ref={input}
          required
        />
        <small className="field-help">
          This suggestion comes from your browser. You can edit it.
        </small>
      </label>
      <label className="acquisition-timezone-confirmation">
        <input name="timezoneConfirmed" required type="checkbox" value="yes" />I
        confirm this is the timezone my business should use.
      </label>
    </div>
  );
}
