"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import type {
  PublicPreorderCatalogue,
  PublicPreorderConfirmation,
  PublicPreorderResult,
} from "../../core/preorder/schemas";

interface PreorderExperienceProps {
  catalogue: PublicPreorderCatalogue;
  endpoint: string;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(value);
}

function formatCollection(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function resultMessage(code: string): string {
  switch (code) {
    case "sold_out":
      return "That collection slot has just sold out. Please choose another.";
    case "invalid_slot":
      return "That collection time is no longer available.";
    case "invalid_location":
      return "That collection location is no longer available.";
    case "unavailable_product":
      return "One of those products is no longer available at this location.";
    case "invalid_quantity":
      return "Choose a whole quantity between 1 and 20 for each product.";
    case "required_field":
      return "Complete all required customer details.";
    case "invalid_field":
      return "Check the customer details and try again.";
    case "rate_limited":
      return "There have been too many attempts. Please wait and try again.";
    case "retry":
      return "Your preorder is still being processed. Please try once more.";
    default:
      return "We could not place the preorder. Check the details and try again.";
  }
}

export function PreorderExperience({
  catalogue: initialCatalogue,
  endpoint,
}: Readonly<PreorderExperienceProps>): ReactNode {
  const [catalogue, setCatalogue] = useState(initialCatalogue);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [locationId, setLocationId] = useState("");
  const [collectionDate, setCollectionDate] = useState("");
  const [collectionAt, setCollectionAt] = useState("");
  const [idempotencyToken, setIdempotencyToken] = useState(() =>
    crypto.randomUUID(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] =
    useState<PublicPreorderConfirmation | null>(null);
  const [emailStatus, setEmailStatus] = useState<
    "pending" | "sending" | "delivered" | "failed"
  >("pending");

  const location = catalogue.preorder.locations.find(
    ({ id }) => id === locationId,
  );
  const availableProducts = catalogue.preorder.products.filter(
    ({ location_ids }) => !locationId || location_ids.includes(locationId),
  );
  const basket = catalogue.preorder.products.flatMap((product) => {
    const quantity = quantities[product.id] ?? 0;
    return quantity > 0 ? [{ product, quantity }] : [];
  });
  const total = basket.reduce(
    (sum, { product, quantity }) => sum + product.price * quantity,
    0,
  );
  const dates = useMemo(
    () => [...new Set(location?.slots.map(({ date }) => date) ?? [])],
    [location],
  );
  const slots =
    location?.slots.filter(({ date }) => date === collectionDate) ?? [];

  function changeLocation(value: string) {
    setLocationId(value);
    setCollectionDate("");
    setCollectionAt("");
    const allowedProducts = new Set(
      catalogue.preorder.products
        .filter(({ location_ids }) => location_ids.includes(value))
        .map(({ id }) => id),
    );
    setQuantities((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => allowedProducts.has(id)),
      ),
    );
  }

  function updateQuantity(productId: string, next: number) {
    setQuantities((current) => ({
      ...current,
      [productId]: Math.min(Math.max(next, 0), 20),
    }));
  }

  async function refreshCatalogue() {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (response.ok) {
        setCatalogue((await response.json()) as PublicPreorderCatalogue);
      }
    } catch {
      // The authoritative submission response already explains the failure.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (basket.length === 0) {
      setError("Choose at least one product.");
      return;
    }
    if (!locationId || !collectionAt) {
      setError("Choose a collection location, date and time.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const fields: {
      customer: Record<string, string | number | boolean | string[]>;
      order: Record<string, string | number | boolean | string[]>;
    } = { customer: {}, order: {} };

    for (const configuredField of catalogue.preorder.public_fields) {
      const inputName = `${configuredField.target}.${configuredField.field}`;
      const raw =
        configuredField.field_type === "multi_select"
          ? form
              .getAll(inputName)
              .filter((value): value is string => typeof value === "string")
          : form.get(inputName);
      if (configuredField.field_type === "boolean") {
        fields[configuredField.target][configuredField.field] = raw !== null;
      } else if (configuredField.field_type === "number") {
        if (typeof raw === "string" && raw !== "") {
          fields[configuredField.target][configuredField.field] = Number(raw);
        }
      } else if (Array.isArray(raw)) {
        if (raw.length > 0) {
          fields[configuredField.target][configuredField.field] = raw;
        }
      } else if (typeof raw === "string" && raw.trim() !== "") {
        fields[configuredField.target][configuredField.field] = raw.trim();
      }
    }

    setSubmitting(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_token: idempotencyToken,
          location_id: locationId,
          collection_at: collectionAt,
          items: basket.map(({ product, quantity }) => ({
            product_id: product.id,
            quantity,
          })),
          fields,
          website: form.get("website") ?? "",
        }),
      });
      const result = (await response.json()) as PublicPreorderResult;
      if (!result.ok) {
        setError(resultMessage(result.code));
        if (
          ["sold_out", "invalid_slot", "unavailable_product"].includes(
            result.code,
          )
        ) {
          await refreshCatalogue();
        }
        return;
      }

      setConfirmation(result.confirmation);
      setEmailStatus(result.email_status);
    } catch {
      setError(
        "We could not reach the bakery. Your reference token is preserved; please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <section className="preorder-confirmation" aria-live="polite">
        <p className="eyebrow">Preorder confirmed</p>
        <h2>Thank you — we’ll have it ready.</h2>
        <p className="confirmation-reference">
          Reference <strong>{confirmation.public_reference}</strong>
        </p>
        <dl>
          <div>
            <dt>Collect from</dt>
            <dd>{confirmation.collection_location}</dd>
          </div>
          <div>
            <dt>Collection</dt>
            <dd>
              {formatCollection(
                confirmation.collection_at,
                confirmation.timezone,
              )}
            </dd>
          </div>
          <div>
            <dt>Your order</dt>
            <dd>{confirmation.item_summary}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>
              {formatMoney(confirmation.total, catalogue.preorder.currency)}
            </dd>
          </div>
          <div>
            <dt>Confirmation email</dt>
            <dd>{confirmation.confirmation_email}</dd>
          </div>
        </dl>
        <p className="email-delivery-note">
          {emailStatus === "failed"
            ? "Your preorder exists, but the confirmation email could not be sent. Keep this reference."
            : "A confirmation email has been prepared for that address."}
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            setConfirmation(null);
            setEmailStatus("pending");
            setQuantities({});
            setLocationId("");
            setCollectionDate("");
            setCollectionAt("");
            setIdempotencyToken(crypto.randomUUID());
          }}
          type="button"
        >
          Place another preorder
        </button>
      </section>
    );
  }

  return (
    <form className="preorder-flow" onSubmit={submit}>
      <section className="preorder-section" aria-labelledby="products-heading">
        <div className="preorder-section-heading">
          <span>1</span>
          <div>
            <h2 id="products-heading">Choose your boxes</h2>
            <p>Prepared fresh for your collection.</p>
          </div>
        </div>
        <div className="preorder-product-grid">
          {availableProducts.map((product) => {
            const quantity = quantities[product.id] ?? 0;
            return (
              <article className="preorder-product-card" key={product.id}>
                {product.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={product.image_url} />
                ) : (
                  <div className="preorder-product-placeholder" aria-hidden>
                    BB
                  </div>
                )}
                <div className="preorder-product-copy">
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>
                  <strong>
                    {formatMoney(product.price, catalogue.preorder.currency)}
                  </strong>
                </div>
                <div
                  className="quantity-control"
                  aria-label={`${product.name} quantity`}
                >
                  <button
                    aria-label={`Remove one ${product.name}`}
                    disabled={quantity === 0}
                    onClick={() => updateQuantity(product.id, quantity - 1)}
                    type="button"
                  >
                    −
                  </button>
                  <output aria-live="polite">{quantity}</output>
                  <button
                    aria-label={`Add one ${product.name}`}
                    disabled={quantity === 20}
                    onClick={() => updateQuantity(product.id, quantity + 1)}
                    type="button"
                  >
                    +
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="preorder-section"
        aria-labelledby="collection-heading"
      >
        <div className="preorder-section-heading">
          <span>2</span>
          <div>
            <h2 id="collection-heading">Choose collection</h2>
            <p>Times are shown in the bakery’s local timezone.</p>
          </div>
        </div>
        <div className="preorder-choice-grid">
          <label>
            Location
            <select
              onChange={(event) => changeLocation(event.target.value)}
              required
              value={locationId}
            >
              <option value="">Choose a bakery…</option>
              {catalogue.preorder.locations.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <select
              disabled={!location}
              onChange={(event) => {
                setCollectionDate(event.target.value);
                setCollectionAt("");
              }}
              required
              value={collectionDate}
            >
              <option value="">Choose a date…</option>
              {dates.map((date) => (
                <option key={date} value={date}>
                  {new Intl.DateTimeFormat("en-GB", {
                    dateStyle: "full",
                    timeZone: "UTC",
                  }).format(new Date(`${date}T12:00:00Z`))}
                </option>
              ))}
            </select>
          </label>
        </div>
        {collectionDate ? (
          <fieldset className="slot-picker">
            <legend>Collection time</legend>
            <div>
              {slots.map((slot) => (
                <label
                  className={slot.available ? "" : "is-sold-out"}
                  key={slot.collection_at}
                >
                  <input
                    disabled={!slot.available}
                    name="collection-slot"
                    onChange={() => setCollectionAt(slot.collection_at)}
                    required
                    type="radio"
                    value={slot.collection_at}
                  />
                  <span>{slot.time}</span>
                  {!slot.available ? <small>Sold out</small> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </section>

      <section className="preorder-section" aria-labelledby="details-heading">
        <div className="preorder-section-heading">
          <span>3</span>
          <div>
            <h2 id="details-heading">Your details</h2>
            <p>We’ll use these only to prepare and confirm your preorder.</p>
          </div>
        </div>
        <div className="preorder-fields">
          {catalogue.preorder.public_fields.map((field) => {
            const name = `${field.target}.${field.field}`;
            return (
              <label key={name}>
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                {field.field_type === "long_text" ? (
                  <textarea name={name} required={field.required} rows={4} />
                ) : field.field_type === "select" ? (
                  <select name={name} required={field.required}>
                    <option value="">Choose…</option>
                    {field.options?.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : field.field_type === "multi_select" ? (
                  <select
                    multiple
                    name={name}
                    required={field.required}
                    size={Math.min(Math.max(field.options?.length ?? 3, 3), 6)}
                  >
                    {field.options?.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : field.field_type === "boolean" ? (
                  <input name={name} type="checkbox" />
                ) : (
                  <input
                    autoComplete={field.autocomplete}
                    name={name}
                    required={field.required}
                    type={
                      field.field_type === "email"
                        ? "email"
                        : field.field_type === "phone"
                          ? "tel"
                          : field.field_type === "date"
                            ? "date"
                            : field.field_type === "number"
                              ? "number"
                              : "text"
                    }
                  />
                )}
                {field.help_text ? <small>{field.help_text}</small> : null}
              </label>
            );
          })}
        </div>
        <label className="preorder-honeypot" aria-hidden="true">
          Website
          <input autoComplete="off" name="website" tabIndex={-1} type="text" />
        </label>
      </section>

      <aside className="preorder-summary" aria-label="Order summary">
        <div>
          <h2>Your preorder</h2>
          {basket.length > 0 ? (
            <ul>
              {basket.map(({ product, quantity }) => (
                <li key={product.id}>
                  <span>
                    {quantity} × {product.name}
                  </span>
                  <strong>
                    {formatMoney(
                      product.price * quantity,
                      catalogue.preorder.currency,
                    )}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>Your basket is empty.</p>
          )}
        </div>
        <p className="preorder-total">
          <span>Total</span>
          <strong>{formatMoney(total, catalogue.preorder.currency)}</strong>
        </p>
        <p className="preorder-collection-note">
          Your total is due when you collect.
        </p>
        {error ? (
          <p className="preorder-error" role="alert">
            {error}
          </p>
        ) : null}
        <button disabled={submitting} type="submit">
          {submitting ? "Placing preorder…" : "Place preorder"}
        </button>
      </aside>
    </form>
  );
}
