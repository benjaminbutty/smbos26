import { parentPort } from "node:worker_threads";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 100;

// PDF.js disables nested workers in Node and otherwise dynamically imports a
// relative `./pdf.worker.mjs`. Turbopack bundles this file into a generated
// chunk, so that relative path is not present beside the chunk at runtime.
// Installing the bundled handler lets PDF.js use its in-process fake-worker
// path without depending on an emitted sibling asset.
globalThis.pdfjsWorker = { WorkerMessageHandler };

async function validate(bytes) {
  let loadingTask;
  try {
    loadingTask = getDocument({
      data: bytes,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
      useWorkerFetch: false,
    });
    // No password callback is supplied. PDF.js rejects a password request
    // instead of allowing an uninspectable encrypted document through.
    const document = await loadingTask.promise;
    if (
      !Number.isInteger(document.numPages) ||
      document.numPages < 1 ||
      document.numPages > MAX_PDF_PAGES
    ) {
      return { ok: false, message: "pdf_page_limit" };
    }
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      page.cleanup();
    }
    return { ok: true, pages: document.numPages };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "pdf_uninspectable",
    };
  } finally {
    try {
      await loadingTask?.destroy();
    } catch {
      // The worker is disposable; parser cleanup failure still rejects through
      // the worker result or hard deadline.
    }
  }
}

if (!parentPort) {
  throw new Error("pdf_validator_worker_requires_parent_port");
}

parentPort.on("message", async (message) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !(message.bytes instanceof ArrayBuffer)
  ) {
    parentPort.postMessage({
      ok: false,
      message: "pdf_invalid_worker_request",
    });
    return;
  }
  const bytes = new Uint8Array(message.bytes);
  if (bytes.byteLength > MAX_PDF_BYTES) {
    parentPort.postMessage({ ok: false, message: "pdf_too_large" });
    return;
  }
  parentPort.postMessage(await validate(bytes));
});
