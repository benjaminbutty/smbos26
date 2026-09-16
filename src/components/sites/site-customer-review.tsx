import type { ReactNode } from "react";

export type CustomerResolutionCase = {
  kind: "form" | "booking" | "preorder";
  receipt_id: string;
  public_reference: string | null;
  match_count: number;
  candidate_ids: string[];
  candidate_profiles: Array<{
    id: string;
    label: string;
    profile: Record<string, unknown>;
  }>;
  submitted_details: Record<string, unknown>;
  submitted_detail_rows: Array<{
    label: string;
    value: unknown;
  }>;
  original_customer_record_id: string | null;
  customer_record_id: string | null;
  resolution_state: string | null;
  resolution_revision: number;
};

type ResolveAction = (formData: FormData) => void | Promise<void>;

function activityLabel(kind: CustomerResolutionCase["kind"]): string {
  if (kind === "booking") return "Booking";
  if (kind === "preorder") return "Preorder";
  return "Form response";
}

export function SiteCustomerReview({
  cases,
  resolveAction,
}: Readonly<{
  cases: readonly CustomerResolutionCase[];
  resolveAction: ResolveAction;
}>): ReactNode {
  if (cases.length === 0) return null;
  return (
    <section
      className="panel site-customer-review"
      aria-label="Customer review"
    >
      <div>
        <p className="eyebrow">Customer review</p>
        <h2>Check possible duplicate Customers</h2>
        <p className="muted">
          A few responses matched more than one existing Customer. Choose the
          right existing profile for each activity. Profiles are never merged or
          overwritten.
        </p>
      </div>
      <div className="site-customer-review-list">
        {cases.map((customerCase) => (
          <form
            action={resolveAction}
            className="site-customer-review-card"
            key={`${customerCase.kind}:${customerCase.receipt_id}`}
          >
            <input name="kind" type="hidden" value={customerCase.kind} />
            <input
              name="receiptId"
              type="hidden"
              value={customerCase.receipt_id}
            />
            <input
              name="expectedResolutionRevision"
              type="hidden"
              value={customerCase.resolution_revision}
            />
            <div>
              <strong>{activityLabel(customerCase.kind)}</strong>
              <span className="muted">
                {customerCase.public_reference
                  ? ` · ${customerCase.public_reference}`
                  : " · Visitor response"}
              </span>
            </div>
            <p className="muted">
              Submitted details:{" "}
              {formatDetails(
                customerCase.submitted_detail_rows,
                customerCase.submitted_details,
              )}
            </p>
            <label>
              Existing Customer
              <select
                defaultValue={customerCase.customer_record_id ?? ""}
                name="customerRecordId"
              >
                <option value="" disabled>
                  Choose a Customer
                </option>
                {customerCase.candidate_ids.map((candidateId, index) => {
                  const profile = customerCase.candidate_profiles.find(
                    (candidate) => candidate.id === candidateId,
                  );
                  return (
                    <option key={candidateId} value={candidateId}>
                      {profile?.label ?? `Customer ${index + 1}`}
                      {candidateId === customerCase.original_customer_record_id
                        ? " (selected automatically)"
                        : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <button type="submit">Save Customer choice</button>
          </form>
        ))}
      </div>
    </section>
  );
}

function formatDetails(
  detailRows: ReadonlyArray<{ label: string; value: unknown }>,
  details: Record<string, unknown>,
): string {
  const entries = detailRows.length
    ? detailRows.map(({ label, value }) => [label, value] as const)
    : Object.entries(details).map(
        ([key, value], index) =>
          [formatDetailLabel(key, index), value] as const,
      );
  const presentEntries = entries.filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (presentEntries.length === 0) return "None recorded";
  return presentEntries
    .slice(0, 8)
    .map(([label, value]) => `${label}: ${formatDetailValue(value)}`)
    .join(" · ");
}

function formatDetailLabel(key: string, index: number): string {
  const raw = key.trim();
  const normalized = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (
    !normalized ||
    /^[a-f0-9-]{16,}$/i.test(raw) ||
    /(?:^|[_-])[a-f0-9]{16,}(?:$|[_-])/i.test(raw) ||
    /(?:^|[_-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:$|[_-])/i.test(
      raw,
    )
  ) {
    return `Submitted answer ${index + 1}`;
  }
  return normalized.charAt(0).toLocaleUpperCase("en") + normalized.slice(1);
}

function formatDetailValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    return value.map(formatDetailValue).join(", ");
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.attachment_ids)) {
      const count = object.attachment_ids.length;
      return `${count} file${count === 1 ? "" : "s"}`;
    }
    for (const key of ["label", "name", "title", "value"]) {
      if (typeof object[key] === "string") return object[key] as string;
    }
    return "Details recorded";
  }
  return "Details recorded";
}
