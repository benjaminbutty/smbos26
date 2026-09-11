"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Image from "next/image";

import {
  type SitePublicProjection,
  sitePublicProjectionSchema,
} from "../../core/sites/schemas";
import {
  type SitePublicRecord,
  SitePublicRenderer,
} from "../../runtime/sites/site-public-renderer";
import { sitePublicAccentStyle } from "../../runtime/sites/site-public-theme";

interface CandidateRecord {
  collectionPublicKey: string;
  record: SitePublicRecord;
}

function collectRecords(
  blocksInput: unknown,
  records: Map<string, CandidateRecord>,
): void {
  if (!Array.isArray(blocksInput)) return;
  for (const blockInput of blocksInput) {
    if (!blockInput || typeof blockInput !== "object") continue;
    const block = blockInput as Record<string, unknown>;
    if (block.type === "collection" && Array.isArray(block.records)) {
      for (const recordInput of block.records) {
        if (!recordInput || typeof recordInput !== "object") continue;
        const record = recordInput as Record<string, unknown>;
        if (
          typeof record.public_id === "string" &&
          record.values &&
          typeof record.values === "object" &&
          !Array.isArray(record.values)
        ) {
          if (typeof block.public_key === "string") {
            records.set(record.public_id, {
              collectionPublicKey: block.public_key,
              record: {
                public_id: record.public_id,
                values: record.values as Record<string, unknown>,
              },
            });
          }
        }
      }
    }
    collectRecords(block.blocks, records);
    if (Array.isArray(block.columns)) {
      for (const columnInput of block.columns) {
        if (!columnInput || typeof columnInput !== "object") continue;
        collectRecords(
          (columnInput as Record<string, unknown>).blocks,
          records,
        );
      }
    }
  }
}

function recordsInProjection(
  projection: SitePublicProjection,
): Map<string, CandidateRecord> {
  const records = new Map<string, CandidateRecord>();
  projection.pages.forEach((page) =>
    collectRecords(page.layout.blocks, records),
  );
  return records;
}

function recordDetailCollectionKey(blocksInput: unknown): string | null {
  if (!Array.isArray(blocksInput)) return null;
  for (const blockInput of blocksInput) {
    if (!blockInput || typeof blockInput !== "object") continue;
    const block = blockInput as Record<string, unknown>;
    if (
      block.type === "record_detail" &&
      typeof block.collection_public_key === "string"
    ) {
      return block.collection_public_key;
    }
    const nested = recordDetailCollectionKey(block.blocks);
    if (nested) return nested;
    if (Array.isArray(block.columns)) {
      for (const columnInput of block.columns) {
        if (!columnInput || typeof columnInput !== "object") continue;
        const columnNested = recordDetailCollectionKey(
          (columnInput as Record<string, unknown>).blocks,
        );
        if (columnNested) return columnNested;
      }
    }
  }
  return null;
}

export function SiteCandidatePreview({
  businessSlug,
  candidateId,
  projection,
}: Readonly<{
  businessSlug: string;
  candidateId: string;
  projection: SitePublicProjection;
}>): ReactNode {
  const safeProjection = useMemo(
    () => sitePublicProjectionSchema.parse(projection),
    [projection],
  );
  const homePage =
    safeProjection.pages.find((page) => page.is_home) ??
    safeProjection.pages[0]!;
  const [selectedPageSlug, setSelectedPageSlug] = useState(homePage.slug);
  const [selectedRecordToken, setSelectedRecordToken] = useState<string | null>(
    null,
  );
  const records = useMemo(
    () => recordsInProjection(safeProjection),
    [safeProjection],
  );
  const selectedPage =
    safeProjection.pages.find((page) => page.slug === selectedPageSlug) ??
    homePage;
  const detailCollectionKey = recordDetailCollectionKey(
    selectedPage.layout.blocks,
  );
  const selectedRecordCandidate = selectedRecordToken
    ? records.get(selectedRecordToken)
    : undefined;
  const representativeRecord = [...records.values()].find(
    (candidate) => candidate.collectionPublicKey === detailCollectionKey,
  );
  const selectedRecord =
    selectedRecordCandidate?.collectionPublicKey === detailCollectionKey
      ? selectedRecordCandidate.record
      : representativeRecord?.record;
  const mediaPrefix = `/api/app/${encodeURIComponent(
    businessSlug,
  )}/sites/media/${encodeURIComponent(candidateId)}`;
  const logoSource = safeProjection.branding.logo_media_token
    ? `${mediaPrefix}/${safeProjection.branding.logo_media_token}`
    : null;

  return (
    <section
      className="panel site-candidate-preview site-public-branded-surface"
      aria-label="Site preview"
      style={sitePublicAccentStyle(safeProjection.branding.accent)}
    >
      <div className="site-candidate-preview-heading">
        <div>
          {logoSource ? (
            <Image
              alt=""
              className="site-preview-logo"
              height={64}
              src={logoSource}
              unoptimized
              width={160}
            />
          ) : null}
          <p className="eyebrow">Preview of your Site update</p>
          <h2>{safeProjection.branding.name}</h2>
        </div>
        <span className="muted">Review before publishing</span>
      </div>
      <nav
        aria-label="Preview Pages"
        className="site-candidate-preview-navigation"
      >
        {safeProjection.pages.map((page) => (
          <button
            aria-current={page.slug === selectedPage.slug ? "page" : undefined}
            className={
              page.slug === selectedPage.slug
                ? "site-candidate-preview-page-link is-selected"
                : "site-candidate-preview-page-link"
            }
            key={page.public_key}
            onClick={() => {
              setSelectedPageSlug(page.slug);
              setSelectedRecordToken(null);
            }}
            type="button"
          >
            {page.navigation_label || page.title}
          </button>
        ))}
      </nav>
      <article
        className="site-candidate-preview-page"
        data-page-slug={selectedPage.slug}
      >
        <header>
          <p className="eyebrow">{selectedPage.navigation_label}</p>
          <h3>{selectedPage.title}</h3>
        </header>
        <SitePublicRenderer
          businessSlug={businessSlug}
          layout={selectedPage.layout}
          mediaPrefix={mediaPrefix}
          onRecordSelect={(detailPageSlug, recordToken) => {
            const detailPage = safeProjection.pages.find(
              (page) => page.slug === detailPageSlug,
            );
            const detailKey = detailPage
              ? recordDetailCollectionKey(detailPage.layout.blocks)
              : null;
            const candidateRecord = records.get(recordToken);
            if (
              detailKey &&
              candidateRecord?.collectionPublicKey === detailKey
            ) {
              setSelectedPageSlug(detailPageSlug);
              setSelectedRecordToken(recordToken);
            }
          }}
          pageSlug={selectedPage.slug}
          record={selectedRecord}
        />
      </article>
    </section>
  );
}
