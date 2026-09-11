import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

const initialRecordName = "Original release item";
const updatedRecordName = "Updated release item";

const initialRecordImage = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4H+X7HwAGqAKm8BxW3QAAAABJRU5ErkJggg==",
    "base64",
  ),
  mimeType: "image/png",
};

const updatedRecordImage = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
  mimeType: "image/png",
};

async function createWorkspaceTable(
  page: Page,
  businessSlug: string,
  tableName: string,
  records: readonly string[],
  options: { fileProperty?: string } = {},
): Promise<string> {
  await page.goto(`/app/${businessSlug}`);
  await page
    .getByRole("button", { name: "Create Table", exact: true })
    .first()
    .click();
  const createForm = page.locator("form.sidebar-create-form");
  await createForm.getByLabel("Table name").fill(tableName);
  await createForm
    .getByRole("button", { name: "Create Table", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(
      `/app/${businessSlug}/workspace/[^/?#]+\\?message=Table%20created&undoVersion=.+$`,
    ),
  );
  const viewMatch = new URL(page.url()).pathname.match(/\/workspace\/([^/]+)$/);
  if (!viewMatch?.[1]) {
    throw new Error(`Could not identify the ${tableName} Table.`);
  }

  if (options.fileProperty) {
    await page
      .getByRole("button", { name: "Add property", exact: true })
      .click();
    const propertyEditor = page.locator(".editor-property-editor");
    await expect(propertyEditor).toBeVisible();
    await propertyEditor
      .getByLabel("Property name", { exact: true })
      .fill(options.fileProperty);
    await propertyEditor.getByRole("menuitem", { name: /^File\b/ }).click();
    await propertyEditor
      .getByRole("button", { name: "Add property", exact: true })
      .click();
    await expect(propertyEditor).toHaveCount(0);
  }

  for (const recordName of records) {
    await page.locator("button.editor-new-record-action").first().click();
    const nameInput = page.getByRole("textbox", {
      name: "Edit Name",
      exact: true,
    });
    await expect(nameInput).toBeVisible();
    await nameInput.fill(recordName);
    await nameInput.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: `Added ${recordName}.` }),
    ).toBeVisible();
  }

  return decodeURIComponent(viewMatch[1]);
}

async function selectSitePage(page: Page, title: string): Promise<Locator> {
  await page
    .getByRole("navigation", { name: "Choose a Page" })
    .getByRole("button", { name: title, exact: true })
    .click();
  const selected = page.locator(".site-composer-page");
  await expect(selected).toHaveCount(1);
  await expect(
    selected
      .locator(".site-composer-page-header")
      .getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  return selected;
}

async function addSiteBlock(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

async function selectCollectionRecordType(
  collection: Locator,
  preferredObjectKey: string,
): Promise<void> {
  const recordType = collection.getByLabel("Record type");
  const optionValue = await recordType
    .locator("option")
    .evaluateAll((options, preferred) => {
      const values = options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value) => value.length > 0);
      return values.find((value) => value === preferred) ?? values[0] ?? null;
    }, preferredObjectKey);
  if (!optionValue) {
    throw new Error("The Site proof has no Record type to select.");
  }
  await recordType.selectOption(optionValue);
}

async function configureCollection(
  page: Locator,
  objectKey: string,
): Promise<Locator> {
  const collection = page
    .locator(
      ".site-composer-block:has(> .site-composer-collection-fields select)",
    )
    .last();
  await selectCollectionRecordType(collection, objectKey);
  const recordOptions = collection.locator(
    ".site-composer-record-options input[type=checkbox]",
  );
  await expect(recordOptions).toHaveCount(1);
  await recordOptions.first().check();
  await collection.getByLabel("Presentation").selectOption("cards");
  return collection;
}

async function saveSiteDraft(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
}

async function waitForImages(page: Page): Promise<void> {
  await page.locator("img").evaluateAll(async (images) => {
    await Promise.all(
      images.map(async (image) => {
        if (!(image instanceof HTMLImageElement)) return;
        if (image.complete && image.naturalWidth > 0) {
          await image.decode().catch(() => undefined);
          return;
        }
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }),
    );
  });
}

test("published Site keeps source Record changes private until republish", async ({
  page,
  pagesProof,
}) => {
  const business = await pagesProof.createBusinessThroughOwnerUi(page);
  const catalogueView = await createWorkspaceTable(
    page,
    business.slug,
    "Catalogue",
    [initialRecordName],
    { fileProperty: "Photo" },
  );

  await page.goto(`/app/${business.slug}/sites`);
  await page.getByRole("button", { name: "Create Site draft" }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=created$`),
  );

  await page.getByLabel("Site name").fill("Release preservation proof");
  const home = await selectSitePage(page, "Home");
  await addSiteBlock(page, "Add Record collection");
  const collection = await configureCollection(home, catalogueView);
  await collection
    .getByLabel("Record image (Photo)", { exact: true })
    .setInputFiles({
      ...initialRecordImage,
      name: "release-preservation-initial.png",
    });
  await expect(
    page.getByText("Record image is ready for your next Site update.", {
      exact: true,
    }),
  ).toBeVisible();
  await saveSiteDraft(page);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );

  await page.goto(`/p/${business.slug}/home`);
  await expect(
    page.getByText(initialRecordName, { exact: true }),
  ).toBeVisible();
  const releasedImage = page.locator("img.site-public-record-image");
  await expect(releasedImage).toHaveCount(1);
  await waitForImages(page);
  const initialImageSource = await releasedImage.getAttribute("src");
  expect(initialImageSource).toBeTruthy();

  await page.goto(`/app/${business.slug}/workspace/${catalogueView}`);
  await page
    .getByRole("button", {
      name: `Open record ${initialRecordName}`,
      exact: true,
    })
    .click();
  const recordPanel = page.getByRole("dialog", { name: "Catalogue record" });
  await recordPanel
    .getByRole("button", { name: "Edit Name", exact: true })
    .click();
  const recordNameEditor = recordPanel.getByRole("textbox", {
    name: "Edit Name",
    exact: true,
  });
  await recordNameEditor.fill(updatedRecordName);
  await recordNameEditor.press("Enter");
  await expect(page.locator(".editor-save-state")).toContainText("Saved");
  await recordPanel.getByRole("button", { name: "Close record panel" }).click();

  await page.goto(`/app/${business.slug}/sites`);
  const updatedHome = await selectSitePage(page, "Home");
  const updatedCollection = updatedHome
    .locator(
      ".site-composer-block:has(> .site-composer-collection-fields select)",
    )
    .first();
  await updatedCollection
    .getByLabel("Record image (Photo)", { exact: true })
    .setInputFiles({
      ...updatedRecordImage,
      name: "release-preservation-updated.png",
    });
  await expect(
    page.getByText("Record image is ready for your next Site update.", {
      exact: true,
    }),
  ).toBeVisible();
  await saveSiteDraft(page);

  await page.goto(`/p/${business.slug}/home`);
  await expect(
    page.getByText(initialRecordName, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(updatedRecordName, { exact: true })).toHaveCount(
    0,
  );
  const stillReleasedImage = page.locator("img.site-public-record-image");
  await expect(stillReleasedImage).toHaveCount(1);
  await expect(stillReleasedImage).toHaveAttribute("src", initialImageSource!);

  await page.goto(`/app/${business.slug}/sites`);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );

  await page.goto(`/p/${business.slug}/home`);
  await expect(
    page.getByText(updatedRecordName, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(initialRecordName, { exact: true })).toHaveCount(
    0,
  );
  const republishedImage = page.locator("img.site-public-record-image");
  await expect(republishedImage).toHaveCount(1);
  await expect(republishedImage).not.toHaveAttribute(
    "src",
    initialImageSource!,
  );
});
