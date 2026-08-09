import {
  ConfigurationIdentityAllocationError,
  GraphKeyAllocator as NeutralGraphKeyAllocator,
  PageSlugAllocator as NeutralPageSlugAllocator,
  CONFIGURATION_IDENTITY_MAX_ALLOCATION_ATTEMPTS,
  CONFIGURATION_IDENTITY_MAX_LENGTH,
  normaliseGraphKeyBase,
  normalisePageSlugBase,
} from "../identity-allocation";
import { ConfigurationDraftCompilerError } from "./errors";

export const DRAFT_COMPILER_MAX_KEY_ALLOCATION_ATTEMPTS =
  CONFIGURATION_IDENTITY_MAX_ALLOCATION_ATTEMPTS;
export const DRAFT_COMPILER_MAX_IDENTITY_LENGTH =
  CONFIGURATION_IDENTITY_MAX_LENGTH;

export { normaliseGraphKeyBase, normalisePageSlugBase };
export const normalizeGraphKeyBase = normaliseGraphKeyBase;
export const normalizePageSlugBase = normalisePageSlugBase;

function mapAllocationError(error: unknown): never {
  if (error instanceof ConfigurationIdentityAllocationError) {
    throw new ConfigurationDraftCompilerError(
      error.code === "configuration_identity_key_unavailable"
        ? "configuration_draft_compile_key_unavailable"
        : "configuration_draft_compile_slug_unavailable",
    );
  }
  throw error;
}

export class GraphKeyAllocator extends NeutralGraphKeyAllocator {
  override allocate(value: string, fallback: string): string {
    try {
      return super.allocate(value, fallback);
    } catch (error) {
      return mapAllocationError(error);
    }
  }
}

export class PageSlugAllocator extends NeutralPageSlugAllocator {
  override allocate(value: string): string {
    try {
      return super.allocate(value);
    } catch (error) {
      return mapAllocationError(error);
    }
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
