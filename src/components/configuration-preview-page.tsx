import type { ReactNode } from "react";

import type { RenderedConfigurationPreview } from "../core/configuration/rendered-preview";
import { PageRenderer } from "../runtime/pages/page-renderer";
import { ConfigurationPreviewShell } from "./configuration-preview-shell";

interface ConfigurationPreviewPageProps {
  businessSlug: string;
  rendered: RenderedConfigurationPreview;
}

export function ConfigurationPreviewPage({
  businessSlug,
  rendered,
}: Readonly<ConfigurationPreviewPageProps>): ReactNode {
  const { preview, page } = rendered;

  return (
    <ConfigurationPreviewShell
      businessSlug={businessSlug}
      candidateChecksum={preview.candidateChecksum}
      changeSetId={preview.proposalId}
      currentPageKey={page.definition.key}
      kind={preview.kind}
      navigationPages={rendered.navigationPages}
      status={preview.status}
      title={preview.title}
    >
      <section className="tenant-content runtime-page configuration-preview-page">
        <header className="page-preview-header">
          <div>
            <p className="eyebrow">
              {page.definition.audience === "public"
                ? "Customer page"
                : "Workspace page"}
            </p>
            <h2 className="runtime-title">{page.definition.title}</h2>
          </div>
        </header>
        <PageRenderer
          businessSlug={businessSlug}
          forms={rendered.forms}
          layout={page.layout}
          preorders={rendered.preorders}
          previewMode
          publicMode={page.definition.audience === "public"}
          views={rendered.views}
        />
      </section>
    </ConfigurationPreviewShell>
  );
}
