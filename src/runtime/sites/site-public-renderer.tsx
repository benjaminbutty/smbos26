import type { CSSProperties, ElementType, ReactNode } from "react";
import Image from "next/image";

export interface SitePublicLayout {
  blocks: unknown[];
}

export interface SitePublicRecord {
  public_id: string;
  values: Record<string, unknown>;
}

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
        unoptimized={Boolean(mediaPrefix)}
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
        unoptimized={Boolean(mediaPrefix)}
        width={320}
      />
    ) : null;
  }
  return null;
}

function richTextContent(node: unknown): ReactNode {
  const object = objectValue(node);
  if (!object) return null;
  if (object.type === "paragraph" || object.type === "heading") {
    const content = Array.isArray(object.content) ? object.content : [];
    return content.map((span, index) => {
      const value = objectValue(span);
      return (
        <span key={index}>
          {typeof value?.text === "string" ? value.text : null}
        </span>
      );
    });
  }
  if (object.type === "bullet_list" || object.type === "numbered_list") {
    const items = Array.isArray(object.items) ? object.items : [];
    const List = object.type === "bullet_list" ? "ul" : "ol";
    return (
      <List>
        {items.map((item, index) => (
          <li key={index}>{richTextContent(item)}</li>
        ))}
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

function renderBlock(
  blockInput: unknown,
  businessSlug: string,
  pageSlug: string,
  mediaPrefix?: string,
  record?: SitePublicRecord,
): ReactNode {
  const block = objectValue(blockInput);
  if (!block || typeof block.type !== "string") return null;
  const key =
    typeof block.public_key === "string" ? block.public_key : block.type;
  switch (block.type) {
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
          {richTextContent(block.node)}
        </div>
      );
    case "image": {
      const source = mediaSource(businessSlug, block.media_token, mediaPrefix);
      return source ? (
        <figure key={key} className="site-public-image">
          <Image
            alt={typeof block.alt === "string" ? block.alt : ""}
            src={source}
            unoptimized={Boolean(mediaPrefix)}
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
        <div key={key} className="site-public-gallery">
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
            ),
          )}
        </div>
      );
    }
    case "button":
      return typeof block.href === "string" &&
        typeof block.label === "string" ? (
        <a key={key} className="button" href={block.href}>
          {block.label}
        </a>
      ) : null;
    case "callout":
      return (
        <aside key={key}>
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
                  const recordLink =
                    typeof block.detail_page_slug === "string" &&
                    typeof recordValue?.public_id === "string"
                      ? `/p/${encodeURIComponent(
                          businessSlug,
                        )}/${encodeURIComponent(
                          block.detail_page_slug,
                        )}/record/${encodeURIComponent(recordValue.public_id)}`
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
                          {recordLink ? (
                            <a href={recordLink}>View details</a>
                          ) : null}
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
                    {displayValue(value, businessSlug, mediaPrefix)}
                  </p>
                ))
              : null;
            const recordLink =
              detailPageSlug && typeof recordValue?.public_id === "string"
                ? `/p/${encodeURIComponent(businessSlug)}/${encodeURIComponent(
                    detailPageSlug,
                  )}/record/${encodeURIComponent(recordValue.public_id)}`
                : null;
            return (
              <article
                key={
                  typeof recordValue?.public_id === "string"
                    ? recordValue.public_id
                    : index
                }
              >
                {recordLink ? <a href={recordLink}>View details</a> : null}
                {recordContent}
              </article>
            );
          })}
        </section>
      );
    }
    case "record_detail":
      return (
        <section key={key} aria-label="Record details">
          {record
            ? Object.entries(record.values).map(([field, value]) => (
                <p key={field}>
                  <strong>{field}</strong>{" "}
                  {displayValue(value, businessSlug, mediaPrefix)}
                </p>
              ))
            : null}
        </section>
      );
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
): ReactNode {
  const blocks = Array.isArray(blocksInput) ? blocksInput : [];
  return blocks.map((block, index) => (
    <div key={index} className="site-public-block">
      {renderBlock(block, businessSlug, pageSlug, mediaPrefix, record)}
    </div>
  ));
}

export function SitePublicRenderer({
  businessSlug,
  layout,
  pageSlug,
  mediaPrefix,
  record,
}: Readonly<{
  businessSlug: string;
  layout: SitePublicLayout;
  pageSlug: string;
  mediaPrefix?: string;
  record?: SitePublicRecord;
}>): ReactNode {
  return (
    <div className="site-public-layout">
      {renderBlocks(layout.blocks, businessSlug, pageSlug, mediaPrefix, record)}
    </div>
  );
}
