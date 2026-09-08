import "server-only";

import sharp from "sharp";

export const PAGE_ASSET_BUCKET = "page-assets";
export const PAGE_ASSET_MAX_BYTES = 3 * 1024 * 1024;
export const PAGE_ASSET_MAX_PIXELS = 20_000_000;
export const PAGE_ASSET_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PageAssetMimeType = (typeof PAGE_ASSET_MIME_TYPES)[number];

export class PageAssetError extends Error {
  readonly code:
    | "unsupported_type"
    | "too_large"
    | "invalid_image"
    | "too_many_pixels"
    | "storage_failed"
    | "registry_failed";

  constructor(
    code: PageAssetError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PageAssetError";
    this.code = code;
  }
}

export function assetErrorMessage(code: PageAssetError["code"]): string {
  switch (code) {
    case "unsupported_type":
      return "Use a JPEG, PNG or WebP image.";
    case "too_large":
      return "Images must be 3 MiB or smaller.";
    case "too_many_pixels":
      return "That image is too large to place on a Page. Choose an image under 20 megapixels.";
    case "invalid_image":
      return "Lenni could not read that image. Choose a valid JPEG, PNG or WebP file.";
    case "storage_failed":
    case "registry_failed":
      return "The image could not be uploaded. Try again.";
  }
}

export async function decodePageAsset(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<{
  bytes: Buffer;
  mimeType: PageAssetMimeType;
  width: number;
  height: number;
}> {
  if (!PAGE_ASSET_MIME_TYPES.includes(input.mimeType as PageAssetMimeType)) {
    throw new PageAssetError(
      "unsupported_type",
      assetErrorMessage("unsupported_type"),
    );
  }
  if (input.bytes.byteLength > PAGE_ASSET_MAX_BYTES) {
    throw new PageAssetError("too_large", assetErrorMessage("too_large"));
  }
  try {
    const image = sharp(input.bytes, { failOn: "error" });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) {
      throw new PageAssetError(
        "invalid_image",
        assetErrorMessage("invalid_image"),
      );
    }
    if (width * height > PAGE_ASSET_MAX_PIXELS) {
      throw new PageAssetError(
        "too_many_pixels",
        assetErrorMessage("too_many_pixels"),
      );
    }
    const mimeType = input.mimeType as PageAssetMimeType;
    const encoded = await image
      .rotate()
      .toFormat(
        mimeType === "image/jpeg"
          ? "jpeg"
          : (mimeType.slice(6) as "png" | "webp"),
      )
      .toBuffer();
    if (encoded.byteLength > PAGE_ASSET_MAX_BYTES) {
      throw new PageAssetError("too_large", assetErrorMessage("too_large"));
    }
    const encodedMetadata = await sharp(encoded, {
      failOn: "error",
    }).metadata();
    const encodedWidth = encodedMetadata.width ?? 0;
    const encodedHeight = encodedMetadata.height ?? 0;
    if (!encodedWidth || !encodedHeight) {
      throw new PageAssetError(
        "invalid_image",
        assetErrorMessage("invalid_image"),
      );
    }
    if (encodedWidth * encodedHeight > PAGE_ASSET_MAX_PIXELS) {
      throw new PageAssetError(
        "too_many_pixels",
        assetErrorMessage("too_many_pixels"),
      );
    }
    return {
      bytes: encoded,
      height: encodedHeight,
      mimeType,
      width: encodedWidth,
    };
  } catch (error) {
    if (error instanceof PageAssetError) throw error;
    throw new PageAssetError(
      "invalid_image",
      assetErrorMessage("invalid_image"),
      {
        cause: error,
      },
    );
  }
}
