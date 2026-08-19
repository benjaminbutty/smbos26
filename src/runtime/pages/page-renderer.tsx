import type { ReactNode } from "react";

import type {
  ExperienceFormBundle,
  ExperienceViewBundle,
} from "../../core/experience/service";
import type { PageLayout } from "../../core/experience/schemas";
import type { PublicBookingCatalogue } from "../../core/booking/schemas";
import type { PublicPreorderCatalogue } from "../../core/preorder/schemas";
import type {
  EditorCapabilities,
  EditorTable,
} from "../editor-kernel/contracts";
import type { ProductionConfigurationCurrentness } from "../editor-kernel/production/action-types";
import type {
  ProductionRecordPanelContextAction,
  ProductionScopedCellEditAction,
  ProductionScopedConnectionCreateAction,
  ProductionScopedConnectionEditAction,
  ProductionScopedConnectionSearchAction,
} from "../editor-kernel/production/action-types";
import type { ProductionTableAdapterActions } from "../editor-kernel/production/production-table-adapter";
import { ProductionTableWorkspace } from "../editor-kernel/production/production-table-workspace";
import { FormRenderer, type FormAction } from "../forms/form-renderer";
import { BookingExperience } from "../booking/booking-experience";
import { PreorderExperience } from "../preorder/preorder-experience";
import { CandidateTableWorkspace } from "../../components/candidate-table-workspace";
import { experienceKeyToPath } from "../routing";
import type { InlineEditAction } from "../views/inline-edit-contract";
import { ViewRenderer } from "../views/view-renderer";

interface ResolvedFormBlock {
  action?: FormAction;
  bundle: ExperienceFormBundle;
  hiddenFields?: ReadonlyArray<{ name: string; value: string }>;
  honeypotName?: string;
}

interface ResolvedBookingBlock {
  catalogue: PublicBookingCatalogue;
  endpoint?: string;
}

interface ResolvedPreorderBlock {
  catalogue: PublicPreorderCatalogue;
  endpoint?: string;
}

interface PageRendererProps {
  layout: PageLayout;
  pageTitle?: string;
  businessSlug?: string;
  views?: Readonly<Record<string, ExperienceViewBundle>>;
  forms?: Readonly<Record<string, ResolvedFormBlock>>;
  inlineEditAction?: InlineEditAction;
  preorders?: Readonly<Record<string, ResolvedPreorderBlock>>;
  bookings?: Readonly<Record<string, ResolvedBookingBlock>>;
  previewMode?: boolean;
  publicMode?: boolean;
  tableEmbeds?: Readonly<Record<string, PageRendererTableEmbed>>;
  candidateTables?: Readonly<Record<string, CandidatePreviewTableEmbed>>;
}

export interface CandidatePreviewTableEmbed {
  table: EditorTable;
  name: string;
  objectLabel: string;
  recordTypeLabel: string;
}

export interface PageRendererTableEmbed {
  table: EditorTable;
  actions: ProductionTableAdapterActions;
  capabilities: EditorCapabilities;
  currentness?: ProductionConfigurationCurrentness | undefined;
  creationFallbackHref?: string | undefined;
  recordTypeLabel?: string;
  recordCountLabel?: string;
  fullRecordPath?: string;
  readConnectedRecord?: ProductionRecordPanelContextAction;
  updateConnectedRecordCell?: ProductionScopedCellEditAction;
  updateConnectedRecordConnection?: ProductionScopedConnectionEditAction;
  searchConnectedRecordTargets?: ProductionScopedConnectionSearchAction;
  createConnectedRecordTarget?: ProductionScopedConnectionCreateAction;
}

function MissingBlock({ message }: Readonly<{ message: string }>): ReactNode {
  return (
    <div className="runtime-unavailable" role="status">
      {message}
    </div>
  );
}

export function PageRenderer({
  layout,
  pageTitle,
  businessSlug,
  views = {},
  forms = {},
  inlineEditAction,
  preorders = {},
  bookings = {},
  previewMode = false,
  publicMode = false,
  tableEmbeds = {},
  candidateTables = {},
}: Readonly<PageRendererProps>): ReactNode {
  return (
    <div className="runtime-page-blocks">
      {layout.blocks.map((block, index) => {
        const key = block.id ?? `${index}-${block.type}`;

        switch (block.type) {
          case "heading":
            if (
              publicMode &&
              block.level === 1 &&
              pageTitle !== undefined &&
              block.text.trim().toLocaleLowerCase("en") ===
                pageTitle.trim().toLocaleLowerCase("en")
            ) {
              return null;
            }
            if (block.level === 1) {
              return publicMode ? (
                <h2 key={key}>{block.text}</h2>
              ) : (
                <h1 key={key}>{block.text}</h1>
              );
            }
            if (block.level === 3) {
              return <h3 key={key}>{block.text}</h3>;
            }
            return <h2 key={key}>{block.text}</h2>;
          case "text":
            return (
              <p className="page-text-block" key={key}>
                {block.text}
              </p>
            );
          case "image":
            return (
              <figure className="page-image-block" key={key}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={block.alt} src={block.src} />
                {block.caption ? (
                  <figcaption>{block.caption}</figcaption>
                ) : null}
              </figure>
            );
          case "button":
            return (
              <p className="page-button-block" key={key}>
                {previewMode ? (
                  <span
                    aria-disabled="true"
                    className={
                      block.style === "secondary"
                        ? "button button-secondary"
                        : "button"
                    }
                  >
                    {block.label}
                  </span>
                ) : (
                  <a
                    className={
                      block.style === "secondary"
                        ? "button button-secondary"
                        : "button"
                    }
                    href={block.href}
                  >
                    {block.label}
                  </a>
                )}
              </p>
            );
          case "divider":
            return <hr className="page-divider" key={key} />;
          case "callout":
            return (
              <aside
                className={`page-callout page-callout-${block.tone}`}
                key={key}
                role="note"
              >
                {block.text}
              </aside>
            );
          case "view": {
            if (publicMode && !previewMode) {
              return (
                <MissingBlock
                  key={key}
                  message="This information is not available publicly."
                />
              );
            }
            const candidateTable = candidateTables[block.view_key];
            if (candidateTable && previewMode) {
              return (
                <section className="page-view-block" key={key}>
                  <header className="page-view-block-header">
                    <div>
                      <p className="eyebrow">Table</p>
                      <strong>{candidateTable.name}</strong>
                      <span>Example {candidateTable.objectLabel}</span>
                    </div>
                  </header>
                  <CandidateTableWorkspace
                    recordTypeLabel={candidateTable.recordTypeLabel}
                    table={candidateTable.table}
                  />
                </section>
              );
            }
            const bundle = views[block.view_key];
            const tableEmbed = tableEmbeds[block.view_key];
            if (tableEmbed && bundle?.definition.view_type === "table") {
              const capabilities: EditorCapabilities = {
                ...tableEmbed.capabilities,
                ...(block.read_only
                  ? {
                      rowCreation: "unavailable" as const,
                      rowCreationMessage:
                        "This Table is read-only on this Page.",
                    }
                  : {}),
              };
              const tablePath =
                tableEmbed.fullRecordPath ??
                `/app/${encodeURIComponent(
                  businessSlug ?? "",
                )}/workspace/${experienceKeyToPath(tableEmbed.table.key)}`;
              return (
                <section className="page-view-block" key={key}>
                  <header className="page-view-block-header">
                    <div>
                      <p className="eyebrow">Saved View</p>
                      <strong>{bundle.definition.name}</strong>
                      <span>From {bundle.object.plural_label}</span>
                    </div>
                    <a
                      className="button button-secondary button-small"
                      href={tablePath}
                    >
                      Open Table
                    </a>
                  </header>
                  <ProductionTableWorkspace
                    actions={tableEmbed.actions}
                    {...(businessSlug !== undefined ? { businessSlug } : {})}
                    capabilities={capabilities}
                    currentness={tableEmbed.currentness}
                    creationFallbackHref={tableEmbed.creationFallbackHref}
                    {...(tableEmbed.createConnectedRecordTarget
                      ? {
                          createConnectedRecordTarget:
                            tableEmbed.createConnectedRecordTarget,
                        }
                      : {})}
                    fullRecordPath={tablePath}
                    key={`${key}-table`}
                    {...(tableEmbed.recordCountLabel
                      ? { recordCountLabel: tableEmbed.recordCountLabel }
                      : {})}
                    {...(tableEmbed.recordTypeLabel
                      ? { recordTypeLabel: tableEmbed.recordTypeLabel }
                      : {})}
                    {...(tableEmbed.readConnectedRecord
                      ? { readConnectedRecord: tableEmbed.readConnectedRecord }
                      : {})}
                    readOnly={block.read_only ?? false}
                    {...(tableEmbed.searchConnectedRecordTargets
                      ? {
                          searchConnectedRecordTargets:
                            tableEmbed.searchConnectedRecordTargets,
                        }
                      : {})}
                    surface="embedded"
                    table={tableEmbed.table}
                    {...(tableEmbed.updateConnectedRecordCell
                      ? {
                          updateConnectedRecordCell:
                            tableEmbed.updateConnectedRecordCell,
                        }
                      : {})}
                    {...(tableEmbed.updateConnectedRecordConnection
                      ? {
                          updateConnectedRecordConnection:
                            tableEmbed.updateConnectedRecordConnection,
                        }
                      : {})}
                  />
                </section>
              );
            }
            return bundle && businessSlug ? (
              <ViewRenderer
                bundle={bundle}
                businessSlug={businessSlug}
                key={key}
                preview={previewMode}
                readOnly={block.read_only ?? false}
                showHeading={false}
                {...(!previewMode && inlineEditAction
                  ? { inlineEditAction }
                  : {})}
              />
            ) : (
              <MissingBlock
                key={key}
                message="This section is temporarily unavailable."
              />
            );
          }
          case "form": {
            if (publicMode && !previewMode) {
              return (
                <MissingBlock
                  key={key}
                  message="Online submissions are not available on this page."
                />
              );
            }
            const resolvedForm = forms[block.form_key];
            if (!resolvedForm) {
              return (
                <MissingBlock
                  key={key}
                  message="This form is temporarily unavailable."
                />
              );
            }
            return previewMode ? (
              <FormRenderer
                bundle={resolvedForm.bundle}
                key={key}
                mode="preview"
                showHeading={false}
              />
            ) : resolvedForm.action ? (
              <FormRenderer
                action={resolvedForm.action}
                bundle={resolvedForm.bundle}
                key={key}
                showHeading={false}
              />
            ) : (
              <MissingBlock
                key={key}
                message="This form is temporarily unavailable."
              />
            );
          }
          case "public_form": {
            if (!publicMode && !previewMode) {
              return (
                <MissingBlock
                  key={key}
                  message="This public Form is only available on its Site."
                />
              );
            }
            const resolvedForm = forms[block.form_key];
            if (!resolvedForm) {
              return (
                <MissingBlock
                  key={key}
                  message="This public Form is temporarily unavailable."
                />
              );
            }
            return previewMode ? (
              <FormRenderer
                bundle={resolvedForm.bundle}
                key={key}
                mode="preview"
                showHeading={false}
              />
            ) : resolvedForm.action ? (
              <FormRenderer
                action={resolvedForm.action}
                bundle={resolvedForm.bundle}
                key={key}
                showHeading={false}
                {...(resolvedForm.hiddenFields
                  ? { hiddenFields: resolvedForm.hiddenFields }
                  : {})}
                {...(resolvedForm.honeypotName
                  ? { honeypotName: resolvedForm.honeypotName }
                  : {})}
              />
            ) : (
              <MissingBlock
                key={key}
                message="This public Form is temporarily unavailable."
              />
            );
          }
          case "booking": {
            if (!publicMode && !previewMode) {
              return (
                <MissingBlock
                  key={key}
                  message="This Booking Site is only available publicly."
                />
              );
            }
            const resolvedBooking = bookings[block.booking_key];
            if (!resolvedBooking) {
              return (
                <MissingBlock
                  key={key}
                  message={
                    previewMode
                      ? "This draft Booking Site will be available to customers after publication."
                      : "This Booking Site is temporarily unavailable."
                  }
                />
              );
            }
            return previewMode ? (
              <BookingExperience
                catalogue={resolvedBooking.catalogue}
                key={key}
                mode="preview"
              />
            ) : resolvedBooking.endpoint ? (
              <BookingExperience
                catalogue={resolvedBooking.catalogue}
                endpoint={resolvedBooking.endpoint}
                key={key}
                mode="live"
              />
            ) : (
              <MissingBlock
                key={key}
                message={
                  previewMode
                    ? "This draft Booking Site will be available to customers after publication."
                    : "This Booking Site is temporarily unavailable."
                }
              />
            );
          }
          case "preorder": {
            if (!publicMode && !previewMode) {
              return (
                <MissingBlock
                  key={key}
                  message="Preorder checkout is available only on the published customer page."
                />
              );
            }
            const resolvedPreorder = preorders[block.preorder_key];
            if (!resolvedPreorder) {
              return (
                <MissingBlock
                  key={key}
                  message="Preordering is temporarily unavailable."
                />
              );
            }
            return previewMode ? (
              <PreorderExperience
                catalogue={resolvedPreorder.catalogue}
                key={key}
                mode="preview"
              />
            ) : resolvedPreorder.endpoint ? (
              <PreorderExperience
                catalogue={resolvedPreorder.catalogue}
                endpoint={resolvedPreorder.endpoint}
                key={key}
              />
            ) : (
              <MissingBlock
                key={key}
                message="Preordering is temporarily unavailable."
              />
            );
          }
        }
      })}
    </div>
  );
}
