import "server-only";

import { Worker } from "node:worker_threads";

import { sitePublicUploadLimits } from "./upload-protocol";

const PDF_MAGIC = new TextEncoder().encode("%PDF-");

export const sitePdfWorkerResourceLimits = {
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  codeRangeSizeMb: 16,
  stackSizeMb: 4,
} as const;

export class SitePdfValidationError extends Error {
  readonly code:
    | "too_large"
    | "invalid_header"
    | "uninspectable"
    | "timeout"
    | "worker_failed"
    | "page_limit";

  constructor(
    code: SitePdfValidationError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SitePdfValidationError";
    this.code = code;
  }
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((value, index) => bytes[index] === value);
}

/**
 * Parses a bounded PDF in a fixed code worker. Node worker resourceLimits are
 * V8 heap limits and a hard execution deadline; they are not a claim of total
 * process or external ArrayBuffer isolation.
 */
export async function validateSitePdfBytes(
  input: Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<{ pages: number }> {
  if (input.byteLength > sitePublicUploadLimits.maxPdfBytes) {
    throw new SitePdfValidationError(
      "too_large",
      "PDFs must be 10 MiB or smaller.",
    );
  }
  if (!hasPdfMagic(input)) {
    throw new SitePdfValidationError(
      "invalid_header",
      "The upload is not a PDF document.",
    );
  }

  const worker = new Worker(
    new URL("./pdf-validator-worker.mjs", import.meta.url),
    { resourceLimits: sitePdfWorkerResourceLimits },
  );
  const timeoutMs = Math.min(options.timeoutMs ?? 5_000, 5_000);
  // Always transfer a dedicated copy. Transferring input.buffer directly can
  // detach a caller's Buffer/Uint8Array before the finalizer hashes or stores
  // it.
  const transferable = Uint8Array.from(input).buffer;

  return new Promise<{ pages: number }>((resolve, reject) => {
    let settled = false;
    const finish = (error?: SitePdfValidationError, pages?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      if (error) reject(error);
      else resolve({ pages: pages! });
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(
        new SitePdfValidationError(
          "timeout",
          "PDF validation exceeded its five-second deadline.",
        ),
      );
    }, timeoutMs);

    worker.once("message", (message: unknown) => {
      if (typeof message !== "object" || message === null) {
        finish(
          new SitePdfValidationError(
            "worker_failed",
            "The PDF validator returned an invalid result.",
          ),
        );
        return;
      }
      const result = message as {
        ok?: unknown;
        message?: unknown;
        pages?: unknown;
      };
      if (typeof result.ok !== "boolean") {
        finish(
          new SitePdfValidationError(
            "worker_failed",
            "The PDF validator returned an invalid result.",
          ),
        );
        return;
      }
      if (!result.ok) {
        const code =
          result.message === "pdf_page_limit" ? "page_limit" : "uninspectable";
        finish(
          new SitePdfValidationError(code, "The PDF could not be inspected."),
        );
        return;
      }
      if (typeof result.pages !== "number") {
        finish(
          new SitePdfValidationError(
            "worker_failed",
            "The PDF validator returned no page count.",
          ),
        );
        return;
      }
      finish(undefined, result.pages);
    });
    worker.once("error", (error) => {
      finish(
        new SitePdfValidationError(
          "worker_failed",
          "The PDF validator failed.",
          {
            cause: error,
          },
        ),
      );
    });
    worker.once("exit", (code) => {
      if (code !== 0 && !settled) {
        finish(
          new SitePdfValidationError(
            "worker_failed",
            "The PDF validator stopped unexpectedly.",
          ),
        );
      }
    });
    try {
      worker.postMessage({ bytes: transferable }, [transferable]);
    } catch (error) {
      finish(
        new SitePdfValidationError(
          "worker_failed",
          "The PDF validator could not start.",
          {
            cause: error,
          },
        ),
      );
    }
  });
}
