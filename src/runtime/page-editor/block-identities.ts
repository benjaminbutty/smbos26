import {
  pageBlockSchema,
  type PageBlock,
  type PageLayout,
} from "../../core/experience/schemas";

/**
 * Older Page layouts may not have persisted block IDs. The editor needs a
 * stable, valid UUID before the first edit so an acknowledgement can update
 * identity without replacing the user's document.
 */
export function deterministicPageBlockId(path: string, type: string): string {
  let hash = 2166136261;
  for (const character of `${path}:${type}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (value: number): string =>
    (value >>> 0).toString(16).padStart(8, "0");
  const first = hex(hash);
  const second = hex(Math.imul(hash ^ 0x9e3779b9, 2246822519));
  const third = `4${hex(Math.imul(hash ^ 0x85ebca6b, 3266489917)).slice(1, 4)}`;
  const fourth = `8${hex(Math.imul(hash ^ 0xc2b2ae35, 668265263)).slice(1, 4)}`;
  const fifth = `${hex(Math.imul(hash ^ 0x27d4eb2f, 1597334677))}${hex(
    Math.imul(hash ^ 0x165667b1, 3812015801),
  )}`.slice(0, 12);
  return `${first}-${second.slice(0, 4)}-${third}-${fourth}-${fifth}`;
}

export function withEditorBlockIds(input: PageLayout): PageLayout {
  const assign = (inputBlock: PageBlock, path: string): PageBlock => {
    const block = pageBlockSchema.parse(inputBlock);
    const id =
      "id" in block && block.id
        ? block.id
        : deterministicPageBlockId(path, block.type);
    if (block.type !== "collapsible") return { ...block, id };
    return {
      ...block,
      id,
      blocks: block.blocks.map((child, index) =>
        assign(child, `${path}.${index}`),
      ),
    } as PageBlock;
  };
  return {
    blocks: input.blocks.map((block, index) => assign(block, `${index}`)),
  };
}
