import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

const formName = "Catering enquiry";
const tableSingular = "Enquiry";
const tablePlural = "Enquiries";
const tableViewName = "Enquiry inbox";

const proofImage = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4H+X7HwAGqAKm8BxW3QAAAABJRU5ErkJggg==",
    "base64",
  ),
  mimeType: "image/png",
};

function proofPdfBuffer(): Buffer {
  const stream = "BT\n/F1 12 Tf\n10 50 Td\n(Upload proof) Tj\nET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

const proofPdf = {
  buffer: proofPdfBuffer(),
  mimeType: "application/pdf",
};

const proofViewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function captureResponsiveEvidence(
  page: Page,
  prefix: string,
): Promise<void> {
  const originalViewport = page.viewportSize() ?? proofViewports[0];
  try {
    for (const viewport of proofViewports) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        fullPage: true,
        path: test
          .info()
          .outputPath(
            `${prefix}-${viewport.name}-${viewport.width}x${viewport.height}.png`,
          ),
      });
    }
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

async function createSiteDraft(
  page: Page,
  businessSlug: string,
): Promise<void> {
  await page.goto(`/app/${businessSlug}/sites`);
  await page
    .getByRole("button", { name: "Create Site draft", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/sites\\?notice=created$`),
  );
}

function formCard(page: Page): Locator {
  return page.locator(".site-form-card").first();
}

function formQuestion(form: Locator, index: number): Locator {
  return form.locator(".site-form-question").nth(index);
}

function referenceImageInput(form: Locator): Locator {
  return form.getByLabel(/^Reference image(?:\s*\*)?$/);
}

async function checkedReferenceImageInput(form: Locator): Promise<Locator> {
  const input = referenceImageInput(form);
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("type", "file");
  await expect(input).toBeEnabled();
  return input;
}

async function fillFormDraft(
  page: Page,
  options: Readonly<{ requiredReferenceImage?: boolean }> = {},
): Promise<void> {
  const form = formCard(page);
  await expect(form).toHaveCount(1);

  await form.getByLabel("Form name", { exact: true }).fill(formName);
  await form
    .getByLabel("Table name (singular)", { exact: true })
    .fill(tableSingular);
  await form
    .getByLabel("Table name (plural)", { exact: true })
    .fill(tablePlural);
  await form.getByLabel("View name", { exact: true }).fill(tableViewName);
  await form.getByLabel("Button label", { exact: true }).fill("Send enquiry");

  const firstQuestion = formQuestion(form, 0);
  await firstQuestion
    .getByLabel("Question", { exact: true })
    .fill("Enquiry type");
  await firstQuestion
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("select");
  await firstQuestion
    .getByLabel("Choices (one per line)", { exact: true })
    .fill("Catering\nCelebration");
  await firstQuestion.getByRole("checkbox").check();

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(2);
  const secondQuestion = formQuestion(form, 1);
  await secondQuestion
    .getByLabel("Question", { exact: true })
    .fill("Project details");
  await secondQuestion
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("long_text");
  await secondQuestion
    .getByRole("combobox", {
      name: "Show when earlier answer is",
      exact: true,
    })
    .selectOption({ label: "Enquiry type" });
  await secondQuestion
    .getByRole("combobox", { name: "Answer", exact: true })
    .selectOption({ label: "Catering" });

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(3);
  const thirdQuestion = formQuestion(form, 2);
  await thirdQuestion
    .getByLabel("Question", { exact: true })
    .fill("Preferred date");
  await thirdQuestion
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("date");
  await thirdQuestion
    .getByRole("combobox", {
      name: "Show when earlier answer is",
      exact: true,
    })
    .selectOption({ label: "Enquiry type" });
  await thirdQuestion
    .getByRole("combobox", { name: "Answer", exact: true })
    .selectOption({ label: "Catering" });

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(4);
  const fourthQuestion = formQuestion(form, 3);
  await fourthQuestion
    .getByLabel("Question", { exact: true })
    .fill("Reference image");
  await fourthQuestion
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("file");
  await fourthQuestion
    .getByRole("combobox", { name: "File kind", exact: true })
    .selectOption("image");
  if (options.requiredReferenceImage) {
    await fourthQuestion.getByRole("checkbox").check();
  }

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(5);
  const fifthQuestion = formQuestion(form, 4);
  await fifthQuestion
    .getByLabel("Question", { exact: true })
    .fill("Supporting document");
  await fifthQuestion
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("file");
  await fifthQuestion
    .getByRole("combobox", { name: "File kind", exact: true })
    .selectOption("pdf");

  await expect(
    form.getByText("Ready to publish", { exact: true }),
  ).toBeVisible();
  await form.getByRole("button", { name: "Add to Home", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
}

test("owner publishes a Forms Site and receives a protected visitor upload", async ({
  page,
  pagesProof,
}) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);

  await createSiteDraft(page, business.slug);
  await page
    .getByRole("button", { name: "Start with a Form", exact: true })
    .click();
  await fillFormDraft(page);

  const form = formCard(page);
  const formToggle = form.locator(".site-form-toggle");
  await expect(formToggle).toHaveAccessibleName("Collapse form");
  await formToggle.focus();
  await page.keyboard.press("Space");
  await expect(formToggle).toHaveAccessibleName("Edit form");
  await expect(form.getByLabel("Form name", { exact: true })).toBeHidden();
  await expect(formToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(formToggle).toHaveAccessibleName("Collapse form");
  await expect(formToggle).toBeFocused();
  await expect(form.getByLabel("Form name", { exact: true })).toHaveValue(
    formName,
  );
  await captureResponsiveEvidence(page, "owner-form-composer");

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await expect(
    page.getByRole("region", { name: "Site preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );
  await expect(
    page
      .locator(".workspace-sidebar")
      .getByRole("link", { name: tableViewName, exact: true }),
  ).toBeVisible();

  const browser = page.context().browser();
  if (!browser) throw new Error("The Sites proof needs a browser context.");
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.route("https://jamp.io/**", (route) => route.abort());
  try {
    await visitor.goto(
      new URL(`/p/${business.slug}/home`, page.url()).toString(),
    );
    const publicForm = visitor.locator("section.site-public-form");
    await expect(
      publicForm.getByRole("heading", { name: formName }),
    ).toBeVisible();

    const enquiryType = publicForm.getByRole("combobox", {
      name: "Enquiry type",
      exact: true,
    });
    await publicForm
      .getByRole("button", { name: "Send enquiry", exact: true })
      .click();
    await expect(enquiryType).toBeFocused();
    await expect(enquiryType).toHaveAttribute("aria-invalid", "true");
    await enquiryType.selectOption({ label: "Catering" });
    await expect(
      publicForm.getByLabel("Project details", { exact: true }),
    ).toBeVisible();
    await expect(
      publicForm.getByLabel("Preferred date", { exact: true }),
    ).toBeVisible();
    await expect(
      publicForm.getByLabel("Reference image", { exact: true }),
    ).toBeVisible();
    await expect(
      publicForm.getByLabel("Supporting document", { exact: true }),
    ).toBeVisible();
    await captureResponsiveEvidence(visitor, "anonymous-public-form");

    await publicForm
      .getByRole("combobox", { name: "Enquiry type", exact: true })
      .focus();
    await visitor.keyboard.press("Tab");
    await expect(
      publicForm.getByLabel("Project details", { exact: true }),
    ).toBeFocused();

    await publicForm
      .getByLabel("Project details", { exact: true })
      .fill("Please include a staffed lunch for 30 guests.");
    await publicForm
      .getByLabel("Preferred date", { exact: true })
      .fill("2026-10-15");
    await publicForm
      .getByLabel("Reference image", { exact: true })
      .setInputFiles({ ...proofImage, name: "visitor-reference.png" });
    await publicForm
      .getByLabel("Supporting document", { exact: true })
      .setInputFiles({
        ...proofPdf,
        name: "visitor-support.pdf",
      });

    await publicForm
      .getByRole("button", { name: "Send enquiry", exact: true })
      .click();
    await expect(publicForm.getByRole("status")).toContainText(
      "Thanks. Your reference is",
    );
  } finally {
    await visitorContext.close();
  }

  await page.getByRole("link", { name: "Back to Home", exact: true }).click();
  await page.waitForURL(new RegExp(`/app/${business.slug}$`));
  await page
    .getByRole("link", { name: `Open ${tableViewName}`, exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/workspace/[^/?#]+(?:\\?.*)?$`),
  );

  const openRecord = page.locator('button[aria-label^="Open record "]').first();
  await expect(openRecord).toBeVisible();
  await openRecord.click();
  const recordPanel = page.locator(".editor-record-panel");
  await expect(recordPanel).toBeVisible();
  await expect(recordPanel).toContainText("Catering");
  await expect(recordPanel).toContainText(
    "Please include a staffed lunch for 30 guests.",
  );

  await recordPanel
    .getByRole("link", { name: "Open full record", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/workspace/[^/?#]+/[^/?#]+(?:\\?.*)?$`),
  );
  const imageField = page
    .locator(".detail-grid > div")
    .filter({ hasText: "Reference image" });
  const imageAttachment = imageField.getByRole("link", {
    name: "Attachment 1",
    exact: true,
  });
  await expect(imageAttachment).toBeVisible();
  const privateAttachmentHref = await imageAttachment.getAttribute("href");
  expect(privateAttachmentHref).toBeTruthy();
  const anonymousContext = await browser.newContext();
  const anonymousAttachmentPage = await anonymousContext.newPage();
  try {
    const privateResponse = await anonymousAttachmentPage.goto(
      new URL(privateAttachmentHref!, page.url()).toString(),
    );
    expect(privateResponse?.status()).toBe(404);
  } finally {
    await anonymousContext.close();
  }
  const imageDownload = await Promise.all([
    page.waitForEvent("download"),
    imageAttachment.click(),
  ]).then(([event]) => event);
  expect(await imageDownload.failure()).toBeNull();
  expect(imageDownload.suggestedFilename()).toMatch(
    /^site-attachment-.*\.png$/,
  );

  const pdfField = page
    .locator(".detail-grid > div")
    .filter({ hasText: "Supporting document" });
  const pdfAttachment = pdfField.getByRole("link", {
    name: "Attachment 1",
    exact: true,
  });
  await expect(pdfAttachment).toBeVisible();
  const pdfDownload = await Promise.all([
    page.waitForEvent("download"),
    pdfAttachment.click(),
  ]).then(([event]) => event);
  expect(await pdfDownload.failure()).toBeNull();
  expect(pdfDownload.suggestedFilename()).toMatch(/^site-attachment-.*\.pdf$/);
});

test("visitor preserves a finalized Form upload across reload and explicit file changes", async ({
  page,
  pagesProof,
}) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);

  await createSiteDraft(page, business.slug);
  await page
    .getByRole("button", { name: "Start with a Form", exact: true })
    .click();
  await fillFormDraft(page, { requiredReferenceImage: true });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await expect(
    page.getByRole("region", { name: "Site preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );

  const browser = page.context().browser();
  if (!browser) throw new Error("The Sites proof needs a browser context.");
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.route("https://jamp.io/**", (route) => route.abort());

  let interceptFinalSubmission = true;
  const finalSubmitRequests: Array<{
    attemptId: string;
    grantIds: string[];
  }> = [];
  await visitor.route("**/api/public/sites/**", async (route) => {
    const request = route.request();
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = request.postDataJSON();
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON requests continue to the configured API/storage service.
    }
    const attemptId =
      typeof body?.submissionAttemptId === "string"
        ? body.submissionAttemptId
        : null;
    const grantIds = Array.isArray(body?.grantIds)
      ? body.grantIds.filter(
          (grantId): grantId is string => typeof grantId === "string",
        )
      : null;
    const answers =
      typeof body?.answers === "object" &&
      body.answers !== null &&
      !Array.isArray(body.answers)
        ? body.answers
        : null;
    if (request.method() === "POST" && attemptId && grantIds && answers) {
      finalSubmitRequests.push({ attemptId, grantIds });
      if (interceptFinalSubmission) {
        await route.fulfill({
          body: JSON.stringify({
            code: "temporary_submission_failure",
            message: "Temporary submission interruption.",
          }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
    }
    await route.continue();
  });

  try {
    await visitor.goto(
      new URL(`/p/${business.slug}/home`, page.url()).toString(),
    );
    const publicForm = visitor.locator("section.site-public-form");
    await expect(
      publicForm.getByRole("heading", { name: formName }),
    ).toBeVisible();

    await publicForm
      .getByRole("combobox", { name: "Enquiry type", exact: true })
      .selectOption({ label: "Catering" });
    await publicForm
      .getByLabel("Project details", { exact: true })
      .fill("Please include a staffed lunch for 30 guests.");
    await publicForm
      .getByLabel("Preferred date", { exact: true })
      .fill("2026-10-15");
    const firstReferenceImage = await checkedReferenceImageInput(publicForm);
    await firstReferenceImage.setInputFiles({
      ...proofImage,
      name: "first-reference.png",
    });
    await publicForm
      .getByLabel("Supporting document", { exact: true })
      .setInputFiles({ ...proofPdf, name: "first-support.pdf" });
    await publicForm
      .getByRole("button", { name: "Send enquiry", exact: true })
      .click();
    await expect.poll(() => finalSubmitRequests.length).toBe(1);
    await expect(
      publicForm
        .locator('[role="alert"]')
        .filter({ hasText: "Temporary submission interruption." }),
    ).toBeVisible();

    const clearedReferenceImage = await checkedReferenceImageInput(publicForm);
    await clearedReferenceImage.setInputFiles([]);
    await publicForm
      .getByLabel("Supporting document", { exact: true })
      .setInputFiles([]);
    await publicForm
      .getByRole("button", { name: "Send enquiry", exact: true })
      .click();
    await expect(
      publicForm.getByRole("button", {
        name: "Start a new response attempt",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicForm.getByText(
        "The selected files changed. Start a new response attempt before sending them.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(finalSubmitRequests).toHaveLength(1);
    expect(finalSubmitRequests[0]!.grantIds).toHaveLength(2);

    await visitor.reload();
    await expect(
      publicForm.getByLabel("Project details", { exact: true }),
    ).toHaveValue("Please include a staffed lunch for 30 guests.");
    await expect(
      publicForm.getByRole("combobox", {
        name: "Enquiry type",
        exact: true,
      }),
    ).toHaveValue("Catering");
    await publicForm
      .getByRole("button", { name: "Send enquiry", exact: true })
      .click();
    await expect(
      publicForm.getByRole("button", {
        name: "Start a new response attempt",
        exact: true,
      }),
    ).toBeVisible();
    expect(finalSubmitRequests).toHaveLength(1);

    await publicForm
      .getByRole("button", {
        name: "Start a new response attempt",
        exact: true,
      })
      .click();
    const secondReferenceImage = await checkedReferenceImageInput(publicForm);
    await secondReferenceImage.setInputFiles({
      ...proofImage,
      name: "second-reference.png",
    });
    await publicForm
      .getByLabel("Supporting document", { exact: true })
      .setInputFiles({ ...proofPdf, name: "second-support.pdf" });
    await publicForm
      .getByRole("button", { name: "Send enquiry", exact: true })
      .click();
    await expect.poll(() => finalSubmitRequests.length).toBe(2);
    const secondAttempt = finalSubmitRequests[1]!;
    expect(secondAttempt.attemptId).not.toBe(finalSubmitRequests[0]!.attemptId);

    interceptFinalSubmission = false;
    await visitor.reload();
    await expect(
      publicForm.getByLabel("Project details", { exact: true }),
    ).toHaveValue("Please include a staffed lunch for 30 guests.");
    await expect(
      publicForm.getByText(/Retained for retry: second-reference\.png/),
    ).toBeVisible();
    await expect(
      publicForm.getByText(/Retained for retry: second-support\.pdf/),
    ).toBeVisible();
    await publicForm
      .getByRole("button", { name: "Send enquiry", exact: true })
      .click();
    await expect.poll(() => finalSubmitRequests.length).toBe(3);
    const retryAttempt = finalSubmitRequests[2]!;
    expect(retryAttempt.attemptId).toBe(secondAttempt.attemptId);
    expect(retryAttempt.grantIds).toEqual(secondAttempt.grantIds);
    await expect(publicForm.getByRole("status")).toContainText(
      "Thanks. Your reference is",
    );
  } finally {
    await visitorContext.close();
  }
});
