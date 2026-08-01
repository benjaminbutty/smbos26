import { ConfigurationDraftCompilerError } from "./errors";

export const DRAFT_COMPILER_MAX_KEY_ALLOCATION_ATTEMPTS = 1_000;
export const DRAFT_COMPILER_MAX_IDENTITY_LENGTH = 80;

function removeCombiningMarks(value: string): string {
  return value.replace(/\p{M}/gu, "");
}

function normaliseAscii(value: string): string {
  return removeCombiningMarks(value.normalize("NFKD")).toLocaleLowerCase("en");
}

export function normaliseGraphKeyBase(value: string, fallback: string): string {
  const normalisedFallback = normaliseAscii(fallback)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeFallback = /^[a-z]/.test(normalisedFallback)
    ? normalisedFallback
    : `key_${normalisedFallback || "value"}`;

  const normalised = normaliseAscii(value)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const withFallback = /^[a-z]/.test(normalised)
    ? normalised
    : normalised
      ? `${safeFallback}_${normalised}`
      : safeFallback;

  return withFallback.slice(0, DRAFT_COMPILER_MAX_IDENTITY_LENGTH);
}

export const normalizeGraphKeyBase = normaliseGraphKeyBase;

export function normalisePageSlugBase(value: string): string {
  const normalised = normaliseAscii(value)
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (
    normalised
      .slice(0, DRAFT_COMPILER_MAX_IDENTITY_LENGTH)
      .replace(/-+$/, "") || "page"
  );
}

export const normalizePageSlugBase = normalisePageSlugBase;

function candidateWithSuffix(
  base: string,
  suffix: string,
  separator: "_" | "-",
): string {
  const maximumBaseLength = DRAFT_COMPILER_MAX_IDENTITY_LENGTH - suffix.length;
  const shortenedBase = base
    .slice(0, maximumBaseLength)
    .replace(new RegExp(`${separator}+$`), "");
  return `${shortenedBase}${suffix}`;
}

abstract class DeterministicAllocator {
  readonly #reserved: Set<string>;

  constructor(reserved: Iterable<string>) {
    this.#reserved = new Set(reserved);
  }

  protected allocateCandidate(
    base: string,
    separator: "_" | "-",
    error: "key" | "slug",
  ): string {
    for (
      let attempt = 1;
      attempt <= DRAFT_COMPILER_MAX_KEY_ALLOCATION_ATTEMPTS;
      attempt += 1
    ) {
      const suffix = attempt === 1 ? "" : `${separator}${attempt}`;
      const candidate = candidateWithSuffix(base, suffix, separator);
      if (!this.#reserved.has(candidate)) {
        this.#reserved.add(candidate);
        return candidate;
      }
    }

    throw new ConfigurationDraftCompilerError(
      error === "key"
        ? "configuration_draft_compile_key_unavailable"
        : "configuration_draft_compile_slug_unavailable",
    );
  }

  reserve(value: string): void {
    this.#reserved.add(value);
  }
}

export class GraphKeyAllocator extends DeterministicAllocator {
  allocate(value: string, fallback: string): string {
    return this.allocateCandidate(
      normaliseGraphKeyBase(value, fallback),
      "_",
      "key",
    );
  }
}

export class PageSlugAllocator extends DeterministicAllocator {
  allocate(value: string): string {
    return this.allocateCandidate(normalisePageSlugBase(value), "-", "slug");
  }
}

export function createGraphKeyAllocator(
  reserved: Iterable<string> = [],
): GraphKeyAllocator {
  return new GraphKeyAllocator(reserved);
}

export function createPageSlugAllocator(
  reserved: Iterable<string> = [],
): PageSlugAllocator {
  return new PageSlugAllocator(reserved);
}
