import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateSitePdfBytes } from "../src/core/sites/pdf-validator";

function proofPdfBytes(encrypted = false): Uint8Array {
  const stream = "BT\n/F1 12 Tf\n10 50 Td\n(Upload proof) Tj\nET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}endstream`,
  ];
  if (encrypted) {
    objects.push(
      "<< /Filter /Standard /V 1 /R 2 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>",
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1}${encrypted ? " /Encrypt 6 0 R /ID [<00112233445566778899aabbccddeeff>]" : ""} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf, "binary"));
}

describe("validateSitePdfBytes", () => {
  it("parses a one-page PDF through the fixed worker", async () => {
    await expect(validateSitePdfBytes(proofPdfBytes())).resolves.toEqual({
      pages: 1,
    });
  });

  it("rejects malformed and password-protected documents", async () => {
    const malformed = Uint8Array.from(Buffer.from("%PDF-1.4\n", "binary"));
    await expect(validateSitePdfBytes(malformed)).rejects.toMatchObject({
      code: "uninspectable",
    });
    await expect(
      validateSitePdfBytes(proofPdfBytes(true)),
    ).rejects.toMatchObject({
      code: "uninspectable",
    });
  });

  it("terminates validation at the bounded deadline", async () => {
    await expect(
      validateSitePdfBytes(proofPdfBytes(), { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
