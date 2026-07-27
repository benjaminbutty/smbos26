import type { ReactNode } from "react";

import type {
  ExperienceFormBundle,
  ExperienceViewBundle,
} from "../../core/experience/service";
import type { PageLayout } from "../../core/experience/schemas";
import { FormRenderer } from "../forms/form-renderer";
import { ViewRenderer } from "../views/view-renderer";

interface ResolvedFormBlock {
  action: string | ((formData: FormData) => void | Promise<void>);
  bundle: ExperienceFormBundle;
}

interface PageRendererProps {
  layout: PageLayout;
  businessSlug?: string;
  views?: Readonly<Record<string, ExperienceViewBundle>>;
  forms?: Readonly<Record<string, ResolvedFormBlock>>;
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
              </p>
            );
          case "divider":
            return <hr className="page-divider" key={key} />;
          case "view": {
            if (publicMode) {
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
            if (publicMode) {
              return (
                <MissingBlock
                  key={key}
                  message="Online submissions are not available on this page."
                />
              );
            }
            const resolvedForm = forms[block.form_key];
            return resolvedForm ? (
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
        }
      })}
    </div>
  );
}
