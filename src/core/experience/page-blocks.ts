import type { PageBlock, PageLayout } from "./schemas";

/** Walk top-level and contained Page blocks in document order. */
export function walkPageBlocks(
  layout: PageLayout | readonly PageBlock[],
): PageBlock[] {
  const blocks: readonly PageBlock[] = Array.isArray(layout)
    ? layout
    : (layout as PageLayout).blocks;
  const result: PageBlock[] = [];
  const visit = (items: readonly PageBlock[]): void => {
    for (const block of items) {
      result.push(block);
      if (block.type === "collapsible") visit(block.blocks);
    }
  };
  visit(blocks);
  return result;
}

/** Transform top-level and contained blocks while preserving the finite grammar. */
export function mapPageBlocks(
  layout: PageLayout,
  transform: (block: PageBlock) => PageBlock | null,
): PageLayout {
  const mapItems = (items: readonly PageBlock[]): PageBlock[] =>
    items.flatMap((block) => {
      const withChildren: PageBlock =
        block.type === "collapsible"
          ? ({ ...block, blocks: mapItems(block.blocks) } as PageBlock)
          : block;
      const next = transform(withChildren);
      return next ? [next] : [];
    });

  return { blocks: mapItems(layout.blocks) };
}

export function pageBlockReferencesView(
  layout: PageLayout | readonly PageBlock[],
): string[] {
  return walkPageBlocks(layout).flatMap((block) =>
    block.type === "view" ? [block.view_key] : [],
  );
}

export function pageBlockReferencesForm(
  layout: PageLayout | readonly PageBlock[],
): string[] {
  return walkPageBlocks(layout).flatMap((block) =>
    block.type === "form" || block.type === "public_form"
      ? [block.form_key]
      : [],
  );
}

export function pageBlockReferencesBooking(
  layout: PageLayout | readonly PageBlock[],
): string[] {
  return walkPageBlocks(layout).flatMap((block) =>
    block.type === "booking" ? [block.booking_key] : [],
  );
}

export function pageBlockReferencesPreorder(
  layout: PageLayout | readonly PageBlock[],
): string[] {
  return walkPageBlocks(layout).flatMap((block) =>
    block.type === "preorder" ? [block.preorder_key] : [],
  );
}

export function pageBlockReferencesMedia(
  layout: PageLayout | readonly PageBlock[],
): string[] {
  return walkPageBlocks(layout).flatMap((block) =>
    block.type === "image" && block.asset_id ? [block.asset_id] : [],
  );
}
