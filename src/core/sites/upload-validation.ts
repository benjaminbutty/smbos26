import "server-only";

import { createHash } from "node:crypto";

import { decodePageAsset } from "../../runtime/media/page-assets";
import {
  sitePublicUploadLimits,
  sitePublicUploadMimeTypes,
  type SitePublicUploadKind,
  type SitePublicUploadMimeType,
} from "./upload-protocol";
import { SitePdfValidationError, validateSitePdfBytes } from "./pdf-validator";

export class SiteUploadValidationError extends Error {
  readonly code:
    | "too_large"
    | "invalid_header"
    | "unsupported_type"
    | "invalid_image"
    | "uninspectable_pdf"
    | "worker_timeout"
    | "provider_failed";

  constructor(
    code: SiteUploadValidationError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SiteUploadValidationError";
    this.code = code;
  }
}

export type ValidatedSiteUpload = {
  bytes: Uint8Array;
  kind: SitePublicUploadKind;
  mimeType: SitePublicUploadMimeType;
  byteSize: number;
  sha256: string;
  pages?: number;
  width?: number;
  height?: number;
};

export function detectSiteUploadMimeType(
  bytes: Uint8Array,
): SitePublicUploadMimeType | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function kindForMime(mimeType: SitePublicUploadMimeType): SitePublicUploadKind {
  return mimeType === "application/pdf" ? "pdf" : "image";
}

/**
 * Validate provider bytes using their content, never a browser-declared MIME
 * type. PDF bytes are retained unchanged; images use the existing Sharp-based
 * page validator and retain its bounded normalized output.
 */
export async function validateSiteUploadBytes(input: {
  bytes: Uint8Array;
  expectedKind: SitePublicUploadKind;
}): Promise<ValidatedSiteUpload> {
  const detectedMimeType = detectSiteUploadMimeType(input.bytes);
  if (
    !detectedMimeType ||
    !sitePublicUploadMimeTypes.includes(detectedMimeType)
  ) {
    throw new SiteUploadValidationError(
      "unsupported_type",
      "Use a valid PDF, JPEG, PNG or WebP file.",
    );
  }
  if (kindForMime(detectedMimeType) !== input.expectedKind) {
    throw new SiteUploadValidationError(
      "invalid_header",
      "The upload type does not match its reserved question.",
    );
  }

  const maximum =
    input.expectedKind === "pdf"
      ? sitePublicUploadLimits.maxPdfBytes
      : sitePublicUploadLimits.maxImageBytes;
  if (input.bytes.byteLength > maximum) {
    throw new SiteUploadValidationError(
      "too_large",
      input.expectedKind === "pdf"
        ? "PDFs must be 10 MiB or smaller."
        : "Images must be 3 MiB or smaller.",
    );
  }

  if (input.expectedKind === "pdf") {
    try {
      const parsed = await validateSitePdfBytes(input.bytes);
      return {
        bytes: input.bytes,
        byteSize: input.bytes.byteLength,
        kind: "pdf",
        mimeType: "application/pdf",
        pages: parsed.pages,
        sha256: hashBytes(input.bytes),
      };
    } catch (error) {
      if (error instanceof SitePdfValidationError) {
        throw new SiteUploadValidationError(
          error.code === "timeout" ? "worker_timeout" : "uninspectable_pdf",
          "The PDF could not be inspected safely.",
          { cause: error },
        );
      }
      throw new SiteUploadValidationError(
        "uninspectable_pdf",
        "The PDF could not be inspected safely.",
        { cause: error },
      );
    }
  }

  try {
    const decoded = await decodePageAsset({
      bytes: input.bytes,
      mimeType: detectedMimeType,
    });
    return {
      bytes: decoded.bytes,
      byteSize: decoded.bytes.byteLength,
      height: decoded.height,
      kind: "image",
      mimeType: decoded.mimeType,
      sha256: hashBytes(decoded.bytes),
      width: decoded.width,
    };
  } catch (error) {
    throw new SiteUploadValidationError(
      error instanceof Error && "code" in error && error.code === "too_large"
        ? "too_large"
        : "invalid_image",
      "The image could not be read safely.",
      { cause: error },
    );
  }
}

/**
 * Read a provider object after Storage's hard 10 MiB bucket limit has bounded
 * the provider response. The Blob-size check happens before the one retained
 * Uint8Array copy; callers must keep the bucket limit in the migration.
 */
export async function readBoundedSiteStorageObject(
  download: () => Promise<{
    data: Blob | null;
    error: unknown | null;
  }>,
  maximumBytes: number = sitePublicUploadLimits.maxPdfBytes,
): Promise<Uint8Array> {
  const response = await download();
  if (response.error || !response.data) {
    throw new SiteUploadValidationError(
      "provider_failed",
      "The upload could not be read from storage.",
      { cause: response.error },
    );
  }
  if (response.data.size > maximumBytes + 1) {
    throw new SiteUploadValidationError(
      "too_large",
      "The upload exceeds its bounded storage limit.",
    );
  }
  const bytes = new Uint8Array(await response.data.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new SiteUploadValidationError(
      "too_large",
      "The upload exceeds its bounded storage limit.",
    );
  }
  return bytes;
}
