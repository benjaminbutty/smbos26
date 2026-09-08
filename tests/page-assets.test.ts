import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import sharp from "sharp";

import {
  decodePageAsset,
  PAGE_ASSET_MAX_BYTES,
  PAGE_ASSET_MAX_PIXELS,
} from "../src/runtime/media/page-assets";

describe("managed Page asset boundary", () => {
  it("decodes a supported image and preserves its dimensions", async () => {
    const source = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 238, g: 228, b: 218 },
      },
    })
      .png()
      .toBuffer();

    const decoded = await decodePageAsset({
      bytes: source,
      mimeType: "image/png",
    });

    expect(decoded).toMatchObject({
      mimeType: "image/png",
      width: 12,
      height: 8,
    });
    expect(decoded.bytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects unsupported types and byte sizes before storage", async () => {
    const bytes = new Uint8Array(8);

    await expect(
      decodePageAsset({ bytes, mimeType: "image/gif" }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(
      decodePageAsset({
        bytes: new Uint8Array(PAGE_ASSET_MAX_BYTES + 1),
        mimeType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("rejects an image whose decoded pixel count exceeds the limit", async () => {
    const width = 5_001;
    const height = Math.ceil((PAGE_ASSET_MAX_PIXELS + 1) / width);
    const source = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    await expect(
      decodePageAsset({ bytes: source, mimeType: "image/png" }),
    ).rejects.toMatchObject({ code: "too_many_pixels" });
  });

  it("reports dimensions after EXIF orientation is applied", async () => {
    const source = await sharp({
      create: {
        width: 12,
        height: 8,
        channels: 3,
        background: { r: 50, g: 100, b: 150 },
      },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    await expect(
      decodePageAsset({ bytes: source, mimeType: "image/png" }),
    ).resolves.toMatchObject({ width: 8, height: 12 });
  });
});
