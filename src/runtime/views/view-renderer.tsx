import type { ReactNode } from "react";

import type { ExperienceViewBundle } from "../../core/experience/service";
import type {
  CardsViewConfig,
  DetailViewConfig,
  ListViewConfig,
  TableViewConfig,
} from "../../core/experience/schemas";
import { normalizeTableViewConfig } from "../../core/experience/schemas";
import type { Json, Tables } from "../../db/supabase/database.types";
import { FieldValue, getSafeFileUrl } from "../fields/field-renderer";
import type { InlineEditAction } from "./inline-edit-contract";
import { InlineTable } from "./inline-table";

export interface RuntimeDetailConnectionItem {
  id: string;
  label: string;
  href?: string;
}

export interface RuntimeDetailConnectionGroup {
  key: string;
  label: string;
  items: readonly RuntimeDetailConnectionItem[];
}

interface ViewRendererProps {
  bundle: ExperienceViewBundle;
  businessSlug: string;
  record?: Tables<"records">;
  navigationViewKey?: string;
  detailConnections?: readonly RuntimeDetailConnectionGroup[];
  inlineEditAction?: InlineEditAction;
  preview?: boolean;
  readOnly?: boolean;
  showHeading?: boolean;
}

interface ViewComponentProps extends ViewRendererProps {
  fieldsByKey: Map<string, Tables<"field_definitions">>;
  recordBasePath: string;
}

type RuntimeTableColumn =
  | { kind: "field"; field: Tables<"field_definitions"> }
  | { kind: "connection"; key: string; label: string };

function connectionColumnStorageKey(
  relationshipKey: string,
  direction: "source" | "target",
): string {
  return `connection:${relationshipKey}:${direction}`;
}

function dataObject(
  record: Tables<"records">,
): Record<string, Json | undefined> {
  return typeof record.data_json === "object" &&
    record.data_json !== null &&
    !Array.isArray(record.data_json)
    ? record.data_json
    : {};
}

function friendlyPathKey(key: string): string {
  return key.replaceAll("_", "-");
}

function configuredFields(
  keys: string[],
  fieldsByKey: Map<string, Tables<"field_definitions">>,
): Tables<"field_definitions">[] {
  return keys.flatMap((key) => {
    const field = fieldsByKey.get(key);
    return field ? [field] : [];
  });
}

function EmptyView({
  singularLabel,
}: Readonly<{ singularLabel: string }>): ReactNode {
  return (
    <div className="runtime-empty">
      <p>No {singularLabel.toLowerCase()} information to show yet.</p>
    </div>
  );
}

export function TableView({
  bundle,
  fieldsByKey,
  inlineEditAction,
  recordBasePath,
  preview = false,
  readOnly = false,
}: Readonly<ViewComponentProps>): ReactNode {
  const config = normalizeTableViewConfig(bundle.config as TableViewConfig);
  const fields = configuredFields(config.fields, fieldsByKey);
  const visibleColumns: RuntimeTableColumn[] = [];
  for (const column of config.columns) {
    if (column.kind === "field") {
      const field = fieldsByKey.get(column.field_key);
      if (field) {
        visibleColumns.push({ kind: "field", field });
      }
      continue;
    }
    const relationship = bundle.relationships?.find(
      (candidate) => candidate.key === column.relationship_key,
    );
    if (relationship) {
      visibleColumns.push({
        kind: "connection",
        key: connectionColumnStorageKey(
          column.relationship_key,
          column.direction,
        ),
        label:
          column.label ??
          (column.direction === "source"
            ? relationship.source_label
            : relationship.target_label),
      });
    }
  }
  const locked = preview || readOnly;

  if (bundle.records.length === 0) {
    return <EmptyView singularLabel={bundle.object.singular_label} />;
  }

  if (
    !locked &&
    bundle.inlineEdit &&
    inlineEditAction &&
    !visibleColumns.some((column) => column.kind === "connection")
  ) {
    return (
      <InlineTable
        action={inlineEditAction}
        editableFieldKeys={bundle.inlineEdit.fieldKeys}
        fields={fields}
        recordBasePath={recordBasePath}
        records={bundle.records}
        viewKey={bundle.definition.key}
      />
    );
  }

  return (
    <div className="table-scroll">
      <table className="runtime-table">
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th
                key={column.kind === "field" ? column.field.key : column.key}
                scope="col"
              >
                {column.kind === "field" ? column.field.label : column.label}
              </th>
            ))}
            {!locked ? (
              <th className="row-action-heading" scope="col">
                <span className="sr-only">Open</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {bundle.records.map((record) => {
            const data = dataObject(record);
            const connections = bundle.connectionValues?.[record.id] ?? {};
            return (
              <tr key={record.id}>
                {visibleColumns.map((column, index) => (
                  <td
                    key={
                      column.kind === "field" ? column.field.key : column.key
                    }
                  >
                    {column.kind === "connection" ? (
                      (connections[column.key] ?? []).map(
                        (value, valueIndex) => (
                          <span key={value.id}>
                            {valueIndex > 0 ? ", " : ""}
                            {value.label}
                          </span>
                        ),
                      )
                    ) : index === 0 && !locked ? (
                      <a
                        className="primary-record-link"
                        href={`${recordBasePath}/${record.id}`}
                      >
                        <FieldValue
                          field={column.field}
                          value={data[column.field.key]}
                        />
                      </a>
                    ) : (
                      <FieldValue
                        field={column.field}
                        value={data[column.field.key]}
                      />
                    )}
                  </td>
                ))}
                {!locked ? (
                  <td className="row-action">
                    <a href={`${recordBasePath}/${record.id}`}>Open</a>
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

export function ListView({
  bundle,
  fieldsByKey,
  recordBasePath,
  preview = false,
  readOnly = false,
}: Readonly<ViewComponentProps>): ReactNode {
  const config = bundle.config as ListViewConfig;
  const primaryField = fieldsByKey.get(config.primary_field);
  const secondaryFields = configuredFields(
    config.secondary_fields,
    fieldsByKey,
  );
  const locked = preview || readOnly;

  if (!primaryField || bundle.records.length === 0) {
    return <EmptyView singularLabel={bundle.object.singular_label} />;
  }

  return (
    <div className="runtime-list">
      {bundle.records.map((record) => {
        const data = dataObject(record);
        const content = (
          <>
            <strong>
              <FieldValue field={primaryField} value={data[primaryField.key]} />
            </strong>
            {secondaryFields.length > 0 ? (
              <span className="list-supporting">
                {secondaryFields.map((field) => (
                  <span key={field.key}>
                    <span className="supporting-label">{field.label}</span>
                    <FieldValue field={field} value={data[field.key]} />
                  </span>
                ))}
              </span>
            ) : null}
            {!locked ? (
              <span aria-hidden="true" className="open-chevron">
                →
              </span>
            ) : null}
          </>
        );
        return locked ? (
          <div className="runtime-list-item" key={record.id}>
            {content}
          </div>
        ) : (
          <a
            className="runtime-list-item"
            href={`${recordBasePath}/${record.id}`}
            key={record.id}
          >
            {content}
          </a>
        );
      })}
    </div>
  );
}

export function CardsView({
  bundle,
  fieldsByKey,
  recordBasePath,
  preview = false,
  readOnly = false,
}: Readonly<ViewComponentProps>): ReactNode {
  const config = bundle.config as CardsViewConfig;
  const titleField = fieldsByKey.get(config.title_field);
  const subtitleField = config.subtitle_field
    ? fieldsByKey.get(config.subtitle_field)
    : undefined;
  const imageField = config.image_field
    ? fieldsByKey.get(config.image_field)
    : undefined;
  const supportingFields = configuredFields(
    config.supporting_fields,
    fieldsByKey,
  );
  const locked = preview || readOnly;

  if (!titleField || bundle.records.length === 0) {
    return <EmptyView singularLabel={bundle.object.singular_label} />;
  }

  return (
    <div className="runtime-card-grid">
      {bundle.records.map((record) => {
        const data = dataObject(record);
        const imageUrl = imageField
          ? getSafeFileUrl(data[imageField.key])
          : null;

        return (
          <article className="runtime-card" key={record.id}>
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${bundle.object.singular_label} image`}
                className="runtime-card-image"
                src={imageUrl}
              />
            ) : null}
            <div className="runtime-card-body">
              <h2>
                {locked ? (
                  <span>
                    <FieldValue
                      field={titleField}
                      value={data[titleField.key]}
                    />
                  </span>
                ) : (
                  <a href={`${recordBasePath}/${record.id}`}>
                    <FieldValue
                      field={titleField}
                      value={data[titleField.key]}
                    />
                  </a>
                )}
              </h2>
              {subtitleField ? (
                <p className="card-subtitle">
                  <FieldValue
                    field={subtitleField}
                    value={data[subtitleField.key]}
                  />
                </p>
              ) : null}
              {supportingFields.length > 0 ? (
                <dl className="card-supporting">
                  {supportingFields.map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>
                        <FieldValue field={field} value={data[field.key]} />
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function DetailView({
  bundle,
  businessSlug,
  record,
  navigationViewKey,
  fieldsByKey,
  recordBasePath,
  detailConnections,
  preview = false,
  readOnly = false,
}: Readonly<ViewComponentProps>): ReactNode {
  const config = bundle.config as DetailViewConfig;
  const selectedRecord = record ?? bundle.records[0];
  const fields = configuredFields(config.fields, fieldsByKey);
  const locked = preview || readOnly;

  if (!selectedRecord) {
    return <EmptyView singularLabel={bundle.object.singular_label} />;
  }

  const data = dataObject(selectedRecord);
  const titleField = config.title_field
    ? fieldsByKey.get(config.title_field)
    : fields[0];

  return (
    <div className="runtime-detail-layout">
      <article className="runtime-detail">
        <header className="detail-header">
          <div>
            <p className="eyebrow">{bundle.object.singular_label}</p>
            <h1 className="runtime-title">
              {titleField ? (
                <FieldValue field={titleField} value={data[titleField.key]} />
              ) : (
                bundle.object.singular_label
              )}
            </h1>
          </div>
          {config.edit_form_key && !locked ? (
            <a
              className="button"
              href={`/app/${businessSlug}/workspace/${friendlyPathKey(
                navigationViewKey ?? bundle.definition.key,
              )}/${selectedRecord.id}/edit`}
            >
              Edit
            </a>
          ) : null}
        </header>

        <dl className="detail-grid">
          {fields.map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                <FieldValue field={field} value={data[field.key]} />
              </dd>
            </div>
          ))}
        </dl>

        {selectedRecord.record_status === "archived" ? (
          <p className="archived-note">This item is archived.</p>
        ) : null}
        {!locked ? (
          <a className="back-link" href={recordBasePath}>
            ← Back to {bundle.object.plural_label}
          </a>
        ) : null}
      </article>

      {detailConnections && detailConnections.length > 0 ? (
        <aside
          aria-label="Connected records"
          className="runtime-detail-connections"
        >
          <div className="runtime-detail-connections-heading">
            <p className="eyebrow">Context</p>
            <h2>Connected records</h2>
          </div>
          <div className="runtime-detail-connection-groups">
            {detailConnections.map((group) => (
              <section
                className="runtime-detail-connection-group"
                key={group.key}
              >
                <h3>{group.label}</h3>
                {group.items.length > 0 ? (
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.id}>
                        {item.href ? (
                          <a href={item.href}>{item.label}</a>
                        ) : (
                          <span>{item.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-value">None connected yet.</p>
                )}
              </section>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

export function ViewRenderer({
  bundle,
  businessSlug,
  record,
  navigationViewKey,
  detailConnections,
  inlineEditAction,
  preview = false,
  readOnly = false,
  showHeading = true,
}: Readonly<ViewRendererProps>): ReactNode {
  const fieldsByKey = new Map(bundle.fields.map((field) => [field.key, field]));
  const routeViewKey = navigationViewKey ?? bundle.definition.key;
  const locked = preview || readOnly;
  const recordBasePath = `/app/${businessSlug}/workspace/${friendlyPathKey(
    routeViewKey,
  )}`;
  const config = bundle.config;
  const createFormKey =
    "create_form_key" in config ? config.create_form_key : undefined;

  return (
    <section className="runtime-view">
      {showHeading && bundle.definition.view_type !== "detail" ? (
        <header className="view-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1 className="runtime-title">{bundle.definition.name}</h1>
          </div>
          {createFormKey && !locked ? (
            <a className="button" href={`${recordBasePath}/new`}>
              + New {bundle.object.singular_label.toLowerCase()}
            </a>
          ) : null}
        </header>
      ) : null}

      {bundle.warnings?.map((warning) => (
        <p className="runtime-preview-warning" key={warning} role="status">
          {warning}
        </p>
      ))}

      {bundle.definition.view_type === "table" ? (
        <TableView
          bundle={bundle}
          businessSlug={businessSlug}
          fieldsByKey={fieldsByKey}
          preview={preview}
          readOnly={readOnly}
          recordBasePath={recordBasePath}
          {...(inlineEditAction ? { inlineEditAction } : {})}
        />
      ) : null}
      {bundle.definition.view_type === "list" ? (
        <ListView
          bundle={bundle}
          businessSlug={businessSlug}
          fieldsByKey={fieldsByKey}
          preview={preview}
          readOnly={readOnly}
          recordBasePath={recordBasePath}
        />
      ) : null}
      {bundle.definition.view_type === "cards" ? (
        <CardsView
          bundle={bundle}
          businessSlug={businessSlug}
          fieldsByKey={fieldsByKey}
          preview={preview}
          readOnly={readOnly}
          recordBasePath={recordBasePath}
        />
      ) : null}
      {bundle.definition.view_type === "detail" ? (
        <DetailView
          bundle={bundle}
          businessSlug={businessSlug}
          fieldsByKey={fieldsByKey}
          navigationViewKey={routeViewKey}
          preview={preview}
          readOnly={readOnly}
          recordBasePath={recordBasePath}
          {...(detailConnections ? { detailConnections } : {})}
          {...(record ? { record } : {})}
        />
      ) : null}
    </section>
  );
}

export function viewFieldKeys(bundle: ExperienceViewBundle): string[] {
  const { config } = bundle;

  if (bundle.definition.view_type === "table") {
    return (config as TableViewConfig).fields;
  }
  if (bundle.definition.view_type === "list") {
    const list = config as ListViewConfig;
    return [list.primary_field, ...list.secondary_fields];
  }
  if (bundle.definition.view_type === "cards") {
    const cards = config as CardsViewConfig;
    return [
      cards.title_field,
      ...(cards.subtitle_field ? [cards.subtitle_field] : []),
      ...(cards.image_field ? [cards.image_field] : []),
      ...cards.supporting_fields,
    ];
  }

  return (config as DetailViewConfig).fields;
}
