import type { ReactNode } from "react";

import type {
  ExperienceFormBundle,
  ExperienceViewBundle,
} from "../../core/experience/service";
import type { PageLayout } from "../../core/experience/schemas";
import type { PublicPreorderCatalogue } from "../../core/preorder/schemas";
import { FormRenderer, type FormAction } from "../forms/form-renderer";
import { PreorderExperience } from "../preorder/preorder-experience";
import { ViewRenderer } from "../views/view-renderer";

interface ResolvedFormBlock {
  action?: FormAction;
  bundle: ExperienceFormBundle;
}

interface ResolvedPreorderBlock {
  catalogue: PublicPreorderCatalogue;
  endpoint?: string;
}

interface PageRendererProps {
  layout: PageLayout;
  businessSlug?: string;
  views?: Readonly<Record<string, ExperienceViewBundle>>;
  forms?: Readonly<Record<string, ResolvedFormBlock>>;
  preorders?: Readonly<Record<string, ResolvedPreorderBlock>>;
  previewMode?: boolean;
  publicMode?: boolean;
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
  businessSlug,
  views = {},
  forms = {},
  preorders = {},
  previewMode = false,
  publicMode = false,
}: Readonly<PageRendererProps>): ReactNode {
  return (
    <div className="runtime-page-blocks">
      {layout.blocks.map((block, index) => {
        const key = `${index}-${block.type}`;

        switch (block.type) {
          case "heading":
            if (block.level === 1) {
              return <h1 key={key}>{block.text}</h1>;
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
          case "view": {
            if (publicMode && !previewMode) {
              return (
                <MissingBlock
                  key={key}
                  message="This information is not available publicly."
                />
              );
            }
            const bundle = views[block.view_key];
            return bundle && businessSlug ? (
              <ViewRenderer
                bundle={bundle}
                businessSlug={businessSlug}
                key={key}
                preview={previewMode}
                showHeading={false}
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
