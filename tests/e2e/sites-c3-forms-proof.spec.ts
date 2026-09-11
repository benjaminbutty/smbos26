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

async function fillFormDraft(page: Page): Promise<void> {
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
    .getByLabel("Answer type", { exact: true })
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
    .getByLabel("Answer type", { exact: true })
    .selectOption("long_text");
  await secondQuestion
    .getByLabel("Show when earlier answer is", { exact: true })
    .selectOption({ label: "Enquiry type" });
  await secondQuestion
    .getByLabel("Answer", { exact: true })
    .selectOption({ label: "Catering" });

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(3);
  const thirdQuestion = formQuestion(form, 2);
  await thirdQuestion
    .getByLabel("Question", { exact: true })
    .fill("Preferred date");
  await thirdQuestion
    .getByLabel("Answer type", { exact: true })
    .selectOption("date");
  await thirdQuestion
    .getByLabel("Show when earlier answer is", { exact: true })
    .selectOption({ label: "Enquiry type" });
  await thirdQuestion
    .getByLabel("Answer", { exact: true })
    .selectOption({ label: "Catering" });

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(4);
  const fourthQuestion = formQuestion(form, 3);
  await fourthQuestion
    .getByLabel("Question", { exact: true })
    .fill("Reference image");
  await fourthQuestion
    .getByLabel("Answer type", { exact: true })
    .selectOption("file");
  await fourthQuestion
    .getByLabel("File kind", { exact: true })
    .selectOption("image");

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
  try {
    await visitor.goto(
      new URL(`/p/${business.slug}/home`, page.url()).toString(),
    );
    const publicForm = visitor.locator("section.site-public-form");
    await expect(
      publicForm.getByRole("heading", { name: formName }),
    ).toBeVisible();

    await publicForm
      .getByLabel("Enquiry type", { exact: true })
      .selectOption({ label: "Catering" });
    await expect(
      publicForm.getByLabel("Project details", { exact: true }),
    ).toBeVisible();
    await expect(
      publicForm.getByLabel("Preferred date", { exact: true }),
    ).toBeVisible();
    await publicForm
      .getByLabel("Project details", { exact: true })
      .fill("Please include a staffed lunch for 30 guests.");
    await publicForm
      .getByLabel("Preferred date", { exact: true })
      .fill("2026-10-15");
    await publicForm
      .getByLabel("Reference image", { exact: true })
      .setInputFiles({
        ...proofImage,
        name: "visitor-reference.png",
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

  await page.goto(`/app/${business.slug}`);
  await page
    .getByRole("link", { name: `Open ${tablePlural}`, exact: true })
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
  const attachment = page.getByRole("link", {
    name: "Attachment 1",
    exact: true,
  });
  await expect(attachment).toBeVisible();
  const download = await Promise.all([
    page.waitForEvent("download"),
    attachment.click(),
  ]).then(([event]) => event);
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/^site-attachment-.*\.png$/);
});
