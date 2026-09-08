import type { ReactNode } from "react";

import type { PageBlock, PageLayout } from "../../core/experience/schemas";
import { PageRenderer } from "../pages/page-renderer";
import type { PageDraft } from "./page-draft-state";

const MAX_TOP_LEVEL_PREVIEW_BLOCKS = 6;
const MAX_CONTAINED_PREVIEW_BLOCKS = 4;

/**
 * Keep conflict previews useful on Pages with a large document while using
 * the same safe renderer as the rest of the Page runtime. The source layout
 * has already passed the Page grammar; this only limits what is shown in the
 * recovery surface and never changes the candidate being saved.
 */
function boundedBlocks(
  blocks: readonly PageBlock[],
  limit: number,
): PageBlock[] {
  return blocks.slice(0, limit).map((block) => {
    if (block.type !== "collapsible") return block;
    return {
      ...block,
      blocks: boundedBlocks(
        block.blocks as readonly PageBlock[],
        MAX_CONTAINED_PREVIEW_BLOCKS,
      ),
    } as PageBlock;
  });
}

export function boundedConflictLayout(layout: PageLayout): PageLayout {
  return { blocks: boundedBlocks(layout.blocks, MAX_TOP_LEVEL_PREVIEW_BLOCKS) };
}

function ConflictVersionPreview({
  draft,
  businessSlug,
  label,
}: Readonly<{
  draft: PageDraft;
  businessSlug: string;
  label: string;
}>): ReactNode {
  const layout = boundedConflictLayout(draft.layout);
  return (
    <article
      aria-label={`${label} preview`}
      className="page-editor-conflict-version"
    >
      <header className="page-editor-conflict-version-header">
        <span className="page-editor-conflict-version-label">{label}</span>
        <strong>{draft.title.trim() || "Untitled Page"}</strong>
      </header>
      <div className="page-editor-conflict-version-body">
        {layout.blocks.length > 0 ? (
          <PageRenderer
            businessSlug={businessSlug}
            layout={layout}
            previewMode
          />
        ) : (
          <p className="page-editor-conflict-empty">No content yet.</p>
        )}
      </div>
      <p className="page-editor-conflict-preview-note">
        Short preview of the Page content
      </p>
    </article>
  );
}

export function PageConflictPanel({
  businessSlug,
  latest,
  local,
  onKeepMyVersion,
  onUseLatest,
}: Readonly<{
  businessSlug: string;
  latest: PageDraft;
  local: PageDraft;
  onKeepMyVersion: () => void;
  onUseLatest: () => void;
}>): ReactNode {
  return (
    <section
      aria-describedby="page-conflict-description"
      aria-labelledby="page-conflict-title"
      className="page-editor-conflict-panel"
      role="alertdialog"
    >
      <div className="page-editor-conflict-heading">
        <div>
          <p className="eyebrow">Save paused</p>
          <h2 id="page-conflict-title">This Page changed elsewhere</h2>
          <p id="page-conflict-description">
            Your draft is safe. Compare the two versions, then choose which
            content should replace the other version.
          </p>
        </div>
      </div>
      <div className="page-editor-conflict-comparison">
        <ConflictVersionPreview
          businessSlug={businessSlug}
          draft={local}
          label="Your version"
        />
        <ConflictVersionPreview
          businessSlug={businessSlug}
          draft={latest}
          label="Latest version"
        />
      </div>
      <p className="page-editor-conflict-consequence">
        <strong>Use latest</strong> replaces your local draft with the latest
        title and content. <strong>Keep my version</strong> saves your draft
        over the latest Page as a new revision.
      </p>
      <div className="page-editor-confirm-actions">
        <button
          aria-label="Use latest Page version"
          className="button button-small"
          onClick={onUseLatest}
          type="button"
        >
          Use latest
        </button>
        <button
          aria-label="Keep my Page version"
          className="button button-secondary button-small"
          onClick={onKeepMyVersion}
          type="button"
        >
          Keep my version
        </button>
      </div>
    </section>
  );
}
