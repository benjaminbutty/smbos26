import {
  Fragment,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import Image from "next/image";

import { sitePublicFormActionSchema } from "../../core/sites/schemas";
import type { PublicBookingCatalogue } from "../../core/booking/schemas";
import type { PublicPreorderCatalogue } from "../../core/preorder/schemas";
import { BookingExperience } from "../booking/booking-experience";
import { PreorderExperience } from "../preorder/preorder-experience";
import { SitePublicForm } from "./site-public-form";

export interface SitePublicLayout {
  blocks: unknown[];
}

export interface SitePublicRecord {
  public_id: string;
  values: Record<string, unknown>;
}

export type SitePublicRecordSelect = (
  detailPageSlug: string,
  recordToken: string,
) => void;

export type SitePublicPageSelect = (pageSlug: string) => boolean;
export type SiteOperationalPreviewAction = Record<string, unknown>;

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function displayValue(
  value: unknown,
  businessSlug?: string,
  mediaPrefix?: string,
): ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const source = mediaSource(businessSlug ?? "", value, mediaPrefix);
    return source ? (
      <Image
        alt=""
        className="site-public-record-image"
        height={240}
        src={source}
        unoptimized
        width={320}
      />
    ) : (
      value
    );
  }
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.map((item, index) => (
      <span key={index} className="site-public-value-item">
        {displayValue(item, businessSlug, mediaPrefix)}
      </span>
    ));
  }
  const object = objectValue(value);
  if (object?.token && typeof object.token === "string") {
    const source = mediaSource(businessSlug ?? "", object.token, mediaPrefix);
    return source ? (
      <Image
        alt=""
        className="site-public-record-image"
        height={240}
        src={source}
        unoptimized
        width={320}
      />
    ) : null;
  }
  return null;
}

function candidateSitePageSlug(
  businessSlug: string,
  href: string,
): string | null {
  const canonicalPrefix = `/p/${encodeURIComponent(businessSlug)}/`;
  const canonicalPath = href.startsWith(canonicalPrefix)
    ? href.slice(canonicalPrefix.length).split(/[?#]/, 1)[0]
    : null;
  if (!canonicalPath || canonicalPath.includes("/")) return null;
  try {
    return decodeURIComponent(canonicalPath);
  } catch {
    return null;
  }
}

function richTextInline(
  contentInput: unknown,
  businessSlug: string,
  onPageSelect?: SitePublicPageSelect,
): ReactNode {
  if (!Array.isArray(contentInput)) return null;
  return contentInput.map((spanInput, index) => {
    const span = objectValue(spanInput);
    if (typeof span?.text !== "string") return null;
    let rendered: ReactNode = span.text;
    const marks = Array.isArray(span.marks) ? span.marks : [];
    for (const markInput of marks) {
      const mark = objectValue(markInput);
      if (mark?.type === "bold") rendered = <strong>{rendered}</strong>;
      if (mark?.type === "italic") rendered = <em>{rendered}</em>;
      if (
        mark?.type === "link" &&
        typeof mark.href === "string" &&
        /^(?:https?:\/\/|\/|mailto:|tel:)[^\s]+$/i.test(mark.href)
      ) {
        const pageSlug = onPageSelect
          ? candidateSitePageSlug(businessSlug, mark.href)
          : null;
        rendered = (
          <a
            href={mark.href}
            onClick={
              pageSlug
                ? (event) => {
                    if (onPageSelect?.(pageSlug)) event.preventDefault();
                  }
                : undefined
            }
          >
            {rendered}
          </a>
        );
      }
    }
    return <Fragment key={`${index}-${span.text}`}>{rendered}</Fragment>;
  });
}

function richTextContent(
  node: unknown,
  businessSlug: string,
  onPageSelect?: SitePublicPageSelect,
): ReactNode {
  const object = objectValue(node);
  if (!object) return null;
  if (object.type === "paragraph") {
    return richTextInline(object.content, businessSlug, onPageSelect);
  }
  if (object.type === "heading") {
    const content = richTextInline(object.content, businessSlug, onPageSelect);
    if (object.level === 1) return <h1>{content}</h1>;
    if (object.level === 3) return <h3>{content}</h3>;
    return <h2>{content}</h2>;
  }
  if (object.type === "bullet_list" || object.type === "numbered_list") {
    const items = Array.isArray(object.items) ? object.items : [];
    const List = object.type === "bullet_list" ? "ul" : "ol";
    return (
      <List>
        {items.map((item, index) => {
          const content = objectValue(item)?.content;
          return (
            <li key={index}>
              {richTextInline(content, businessSlug, onPageSelect)}
            </li>
          );
        })}
      </List>
    );
  }
  return null;
}

function mediaSource(
  businessSlug: string,
  token: unknown,
  mediaPrefix?: string,
): string | null {
  if (typeof token !== "string" || !/^m_[a-f0-9]{64}$/.test(token)) {
    return null;
  }
  return mediaPrefix
    ? `${mediaPrefix}/${token}`
    : `/api/public/sites/${encodeURIComponent(businessSlug)}/media/${token}`;
}

function recordLink(
  businessSlug: string,
  detailPageSlug: string,
  recordToken: string,
  onRecordSelect?: SitePublicRecordSelect,
): ReactNode {
  if (onRecordSelect) {
    return (
      <button
        className="site-public-record-link"
        onClick={() => onRecordSelect(detailPageSlug, recordToken)}
        type="button"
      >
        View details
      </button>
    );
  }
  return (
    <a
      href={`/p/${encodeURIComponent(businessSlug)}/${encodeURIComponent(
        detailPageSlug,
      )}/record/${encodeURIComponent(recordToken)}`}
    >
      View details
    </a>
  );
}

function OperationalPreviewBlock({
  action,
  kind,
}: Readonly<{
  action: SiteOperationalPreviewAction | undefined;
  kind: "booking" | "preorder";
}>): ReactNode {
  const label = kind === "booking" ? "Booking" : "Preorder";
  const frozenOffer = objectValue(action?.frozen_offer);
  const products = Array.isArray(frozenOffer?.products)
    ? frozenOffer.products
        .map((value) => objectValue(value))
        .filter((value): value is Record<string, unknown> => value !== null)
    : [];
  const config = objectValue(action?.config);
  const schedule = objectValue(config?.schedule);
  return (
    <section
      aria-label={`${label} preview`}
      className="site-operational-preview"
    >
      <p className="eyebrow">{label}</p>
      <h3>{label} for visitors</h3>
      {products.length ? (
        <ul>
          {products.slice(0, 20).map((product, index) => (
            <li key={String(product.id ?? index)}>
              <strong>
                {typeof product.name === "string"
                  ? product.name
                  : "Available item"}
              </strong>
              {typeof product.price === "number" ? ` · ${product.price}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {schedule ? (
        <p className="muted">
          {typeof schedule.timezone === "string"
            ? `Appointments use ${schedule.timezone}. `
            : "Appointment times load from the published schedule. "}
          Visitor responses are saved to your workspace after publication.
        </p>
      ) : (
        <p className="muted">
          This is a read-only preview. Visitor availability and submission are
          enabled after publication.
        </p>
      )}
    </section>
  );
}

function renderBlock(
  blockInput: unknown,
  businessSlug: string,
  pageSlug: string,
  mediaPrefix?: string,
  record?: SitePublicRecord,
  onRecordSelect?: SitePublicRecordSelect,
  onPageSelect?: SitePublicPageSelect,
  bookings?: Readonly<
    Record<string, { catalogue: PublicBookingCatalogue; endpoint: string }>
  >,
  preorders?: Readonly<
    Record<string, { catalogue: PublicPreorderCatalogue; endpoint: string }>
  >,
  operationalPreviewActions?: readonly SiteOperationalPreviewAction[],
  preview = false,
): ReactNode {
  const block = objectValue(blockInput);
  if (!block || typeof block.type !== "string") return null;
  const key =
    typeof block.public_key === "string" ? block.public_key : block.type;
  switch (block.type) {
    case "form": {
      const action = sitePublicFormActionSchema.safeParse(block.action);
      return action.success ? (
        <SitePublicForm
          action={action.data}
          businessSlug={businessSlug}
          key={`${action.data.action_key}:${action.data.release_token}`}
          pageSlug={pageSlug}
          preview={preview}
        />
      ) : null;
    }
    case "heading": {
      const level =
        typeof block.level === "number" && block.level >= 1 && block.level <= 6
          ? block.level
          : 2;
      const Heading = `h${level}` as ElementType;
      return (
        <Heading key={key}>
          {displayValue(block.text, businessSlug, mediaPrefix)}
        </Heading>
      );
    }
    case "text":
      return (
        <p key={key}>{displayValue(block.text, businessSlug, mediaPrefix)}</p>
      );
    case "rich_text":
      return (
        <div key={key} className="site-public-rich-text">
          {richTextContent(block.node, businessSlug, onPageSelect)}
        </div>
      );
    case "image": {
      const source = mediaSource(businessSlug, block.media_token, mediaPrefix);
      return source ? (
        <figure
          key={key}
          className={
            block.presentation === "wide"
              ? "site-public-image site-public-image-wide"
              : "site-public-image"
          }
        >
          <Image
            alt={typeof block.alt === "string" ? block.alt : ""}
            src={source}
            unoptimized
            width={1200}
            height={800}
            sizes="(max-width: 720px) 100vw, 1200px"
          />
          {typeof block.caption === "string" ? (
            <figcaption>{block.caption}</figcaption>
          ) : null}
        </figure>
      ) : null;
    }
    case "gallery": {
      const images = Array.isArray(block.images) ? block.images : [];
      return (
        <div
          key={key}
          className={
            block.presentation === "carousel"
              ? "site-public-gallery site-public-gallery-carousel"
              : "site-public-gallery"
          }
        >
          {images.map((image, index) =>
            renderBlock(
              {
                ...objectValue(image),
                type: "image",
                public_key: `${key}-${index}`,
              },
              businessSlug,
              pageSlug,
              mediaPrefix,
              record,
              onRecordSelect,
              onPageSelect,
              bookings,
              preorders,
              operationalPreviewActions,
              preview,
            ),
          )}
        </div>
      );
    }
    case "button": {
      const pageTarget =
        typeof block.href === "string" && onPageSelect
          ? candidateSitePageSlug(businessSlug, block.href)
          : null;
      return typeof block.href === "string" &&
        typeof block.label === "string" ? (
        <a
          key={key}
          className={
            block.style === "secondary" ? "button button-secondary" : "button"
          }
          href={block.href}
          onClick={
            pageTarget
              ? (event) => {
                  if (onPageSelect?.(pageTarget)) event.preventDefault();
                }
              : undefined
          }
        >
          {block.label}
        </a>
      ) : null;
    }
    case "callout":
      return (
        <aside
          key={key}
          className={`site-public-callout site-public-callout-${
            block.tone === "neutral" ||
            block.tone === "success" ||
            block.tone === "warning"
              ? block.tone
              : "info"
          }`}
        >
          {displayValue(block.text, businessSlug, mediaPrefix)}
        </aside>
      );
    case "divider":
      return <hr key={key} />;
    case "collapsible":
      return (
        <details key={key} open={block.open === true}>
          <summary>
            {displayValue(block.summary, businessSlug, mediaPrefix)}
          </summary>
          <div>
            {renderBlocks(
              block.blocks,
              businessSlug,
              pageSlug,
              mediaPrefix,
              record,
              onRecordSelect,
              onPageSelect,
              bookings,
              preorders,
              operationalPreviewActions,
              preview,
            )}
          </div>
        </details>
      );
    case "section": {
      const columns = Array.isArray(block.columns) ? block.columns : [];
      return (
        <div
          key={key}
          className="site-public-section"
          data-alignment={
            block.alignment === "center" || block.alignment === "end"
              ? block.alignment
              : "start"
          }
          data-background={block.background === "tint" ? "tint" : "plain"}
          data-spacing={
            block.spacing === "compact" || block.spacing === "spacious"
              ? block.spacing
              : "comfortable"
          }
          data-width={block.width === "wide" ? "wide" : "content"}
          style={
            {
              "--site-public-column-count": Math.min(
                Math.max(columns.length, 1),
                3,
              ),
            } as CSSProperties
          }
        >
          {columns.map((column, index) => {
            const columnValue = objectValue(column);
            return (
              <div key={index} className="site-public-column">
                {renderBlocks(
                  columnValue?.blocks,
                  businessSlug,
                  pageSlug,
                  mediaPrefix,
                  record,
                  onRecordSelect,
                  onPageSelect,
                  bookings,
                  preorders,
                  operationalPreviewActions,
                  preview,
                )}
              </div>
            );
          })}
        </div>
      );
    }
    case "collection": {
      const records = Array.isArray(block.records) ? block.records : [];
      const presentation =
        block.presentation === "list" || block.presentation === "table"
          ? block.presentation
          : "cards";
      const fieldKeys = [
        ...new Set(
          records.flatMap((record) => {
            const values = objectValue(objectValue(record)?.values);
            return values ? Object.keys(values) : [];
          }),
        ),
      ];
      if (presentation === "table") {
        return (
          <div key={key} className="site-public-collection-table">
            <table>
              <thead>
                <tr>
                  {fieldKeys.map((field) => (
                    <th key={field} scope="col">
                      {field}
                    </th>
                  ))}
                  {typeof block.detail_page_slug === "string" ? (
                    <th scope="col">Details</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {records.map((record, index) => {
                  const recordValue = objectValue(record);
                  const values = objectValue(recordValue?.values);
                  const recordToken =
                    typeof block.detail_page_slug === "string" &&
                    typeof recordValue?.public_id === "string"
                      ? recordValue.public_id
                      : null;
                  return (
                    <tr
                      key={
                        typeof recordValue?.public_id === "string"
                          ? recordValue.public_id
                          : index
                      }
                    >
                      {fieldKeys.map((field) => (
                        <td key={field}>
                          {displayValue(
                            values?.[field],
                            businessSlug,
                            mediaPrefix,
                          )}
                        </td>
                      ))}
                      {typeof block.detail_page_slug === "string" ? (
                        <td>
                          {recordToken &&
                          typeof block.detail_page_slug === "string"
                            ? recordLink(
                                businessSlug,
                                block.detail_page_slug,
                                recordToken,
                                onRecordSelect,
                              )
                            : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
      return (
        <section
          key={key}
          className={
            presentation === "list"
              ? "site-public-collection site-public-collection-list"
              : "site-public-collection"
          }
        >
          {records.map((record, index) => {
            const recordValue = objectValue(record);
            const values = objectValue(recordValue?.values);
            const detailPageSlug =
              typeof block.detail_page_slug === "string"
                ? block.detail_page_slug
                : null;
            const recordContent = values
              ? Object.entries(values).map(([field, value]) => (
                  <p key={field}>
                    <strong>{field}</strong>{" "}
                    <span className="site-public-record-value">
                      {displayValue(value, businessSlug, mediaPrefix)}
                    </span>
                  </p>
                ))
              : null;
            const recordToken =
              detailPageSlug && typeof recordValue?.public_id === "string"
                ? recordValue.public_id
                : null;
            return (
              <article
                key={
                  typeof recordValue?.public_id === "string"
                    ? recordValue.public_id
                    : index
                }
              >
                {recordToken && detailPageSlug
                  ? recordLink(
                      businessSlug,
                      detailPageSlug,
                      recordToken,
                      onRecordSelect,
                    )
                  : null}
                {recordContent}
              </article>
            );
          })}
        </section>
      );
    }
    case "record_detail": {
      const requestedFields = Array.isArray(block.display_field_keys)
        ? block.display_field_keys.filter(
            (field): field is string => typeof field === "string",
          )
        : Object.keys(record?.values ?? {});
      const detailFields = requestedFields.filter((field) =>
        Object.prototype.hasOwnProperty.call(record?.values ?? {}, field),
      );
      return (
        <section key={key} aria-label="Record details">
          {record
            ? detailFields.map((field) => (
                <p key={field}>
                  <strong>{field}</strong>{" "}
                  <span className="site-public-record-value">
                    {displayValue(
                      record.values[field],
                      businessSlug,
                      mediaPrefix,
                    )}
                  </span>
                </p>
              ))
            : null}
        </section>
      );
    }
    case "booking": {
      const bookingKey =
        typeof block.booking_key === "string" ? block.booking_key : null;
      const actionKey =
        typeof block.action_key === "string" ? block.action_key : null;
      const resolved = bookingKey ? bookings?.[bookingKey] : undefined;
      return resolved ? (
        <BookingExperience
          catalogue={resolved.catalogue}
          endpoint={resolved.endpoint}
          key={`${bookingKey}:${String(block.action_key ?? "")}`}
          mode="live"
        />
      ) : preview ? (
        <OperationalPreviewBlock
          action={operationalPreviewActions?.find(
            (candidate) =>
              candidate.kind === "booking" &&
              candidate.booking_key === bookingKey &&
              (actionKey === null || candidate.action_key === actionKey),
          )}
          kind="booking"
          key={`${bookingKey}:${String(block.action_key ?? "")}`}
        />
      ) : null;
    }
    case "preorder": {
      const preorderKey =
        typeof block.preorder_key === "string" ? block.preorder_key : null;
      const actionKey =
        typeof block.action_key === "string" ? block.action_key : null;
      const resolved = preorderKey ? preorders?.[preorderKey] : undefined;
      return resolved ? (
        <PreorderExperience
          catalogue={resolved.catalogue}
          endpoint={resolved.endpoint}
          key={`${preorderKey}:${String(block.action_key ?? "")}`}
        />
      ) : preview ? (
        <OperationalPreviewBlock
          action={operationalPreviewActions?.find(
            (candidate) =>
              candidate.kind === "preorder" &&
              candidate.preorder_key === preorderKey &&
              (actionKey === null || candidate.action_key === actionKey),
          )}
          kind="preorder"
          key={`${preorderKey}:${String(block.action_key ?? "")}`}
        />
      ) : null;
    }
    default:
      return null;
  }
}

function renderBlocks(
  blocksInput: unknown,
  businessSlug: string,
  pageSlug: string,
  mediaPrefix?: string,
  record?: SitePublicRecord,
  onRecordSelect?: SitePublicRecordSelect,
  onPageSelect?: SitePublicPageSelect,
  bookings?: Readonly<
    Record<string, { catalogue: PublicBookingCatalogue; endpoint: string }>
  >,
  preorders?: Readonly<
    Record<string, { catalogue: PublicPreorderCatalogue; endpoint: string }>
  >,
  operationalPreviewActions?: readonly SiteOperationalPreviewAction[],
  preview = false,
): ReactNode {
  const blocks = Array.isArray(blocksInput) ? blocksInput : [];
  return blocks.map((block, index) => (
    <div key={index} className="site-public-block">
      {renderBlock(
        block,
        businessSlug,
        pageSlug,
        mediaPrefix,
        record,
        onRecordSelect,
        onPageSelect,
        bookings,
        preorders,
        operationalPreviewActions,
        preview,
      )}
    </div>
  ));
}

export function SitePublicRenderer({
  businessSlug,
  layout,
  pageSlug,
  mediaPrefix,
  record,
  onRecordSelect,
  onPageSelect,
  bookings,
  preorders,
  operationalPreviewActions,
  preview,
}: Readonly<{
  businessSlug: string;
  layout: SitePublicLayout;
  pageSlug: string;
  mediaPrefix?: string;
  record?: SitePublicRecord | undefined;
  onRecordSelect?: SitePublicRecordSelect;
  onPageSelect?: SitePublicPageSelect;
  bookings?: Readonly<
    Record<string, { catalogue: PublicBookingCatalogue; endpoint: string }>
  >;
  preorders?: Readonly<
    Record<string, { catalogue: PublicPreorderCatalogue; endpoint: string }>
  >;
  operationalPreviewActions?:
    readonly SiteOperationalPreviewAction[] | undefined;
  preview?: boolean;
}>): ReactNode {
  return (
    <div className="site-public-layout">
      {renderBlocks(
        layout.blocks,
        businessSlug,
        pageSlug,
        mediaPrefix,
        record,
        onRecordSelect,
        onPageSelect,
        bookings,
        preorders,
        operationalPreviewActions,
        preview,
      )}
    </div>
  );
}
