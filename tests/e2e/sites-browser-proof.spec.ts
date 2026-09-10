import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

const siteName = "Browser proof customer Site";
const secondPageTitle = "Services";
const secondPageSlug = "services";
const imageAlt = "Browser proof Site image";

const proofImage = {
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4H+X7HwAGqAKm8BxW3QAAAABJRU5ErkJggg==",
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
  if (!viewMatch?.[1])
    throw new Error(`Could not identify the ${tableName} Table.`);

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

async function addSitePage(
  page: Page,
  title: string,
  slug: string,
  options: { included?: boolean; inNavigation?: boolean } = {},
): Promise<Locator> {
  const pages = page.locator(".site-composer-page");
  const nextIndex = await pages.count();
  await page.getByRole("button", { name: "Add Page", exact: true }).click();
  await expect(pages).toHaveCount(nextIndex + 1);
  const added = pages.nth(nextIndex);
  await added.getByLabel("Title").fill(title);
  await added.getByLabel("Address").fill(slug);
  await added.getByLabel("Navigation label").fill(title);
  if (options.included === false) {
    await added.getByLabel("Include in Site").uncheck();
  }
  if (options.inNavigation === false) {
    await added.getByLabel("Show in navigation").uncheck();
  }
  return added;
}

async function selectCollectionRecordType(
  collection: Locator,
  preferredObjectKey?: string,
): Promise<void> {
  const recordType = collection.getByLabel("Record type");
  const optionValue = await recordType
    .locator("option")
    .evaluateAll((options, preferred) => {
      const values = options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value) => value.length > 0);
      return values.find((value) => value === preferred) ?? values[0] ?? null;
    }, preferredObjectKey ?? "");
  if (!optionValue)
    throw new Error("The Site proof has no Record type to select.");
  await recordType.selectOption(optionValue);
}

function collectionBlocks(page: Locator): Locator {
  return page
    .locator(".site-composer-block")
    .filter({ has: page.getByLabel("Record type") });
}

async function configureCollection(
  page: Locator,
  preferredObjectKey: string | undefined,
  presentation: "cards" | "list" | "table",
  detailPageTitle?: string,
): Promise<Locator> {
  const collection = collectionBlocks(page).last();
  await selectCollectionRecordType(collection, preferredObjectKey);
  const recordOptions = collection.locator(
    ".site-composer-record-options input[type=checkbox]",
  );
  const optionCount = await recordOptions.count();
  if (optionCount === 0)
    throw new Error("The Site proof has no Records to select.");
  await recordOptions.first().check();
  if (optionCount > 1) await recordOptions.nth(1).check();
  await collection.getByLabel("Presentation").selectOption(presentation);
  if (detailPageTitle) {
    await collection
      .getByLabel("Detail Page")
      .selectOption({ label: detailPageTitle });
  }
  const filter = collection.getByLabel("Filter to Records with");
  const filterValue = await filter
    .locator("option")
    .evaluateAll(
      (options) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find(Boolean) ?? "",
    );
  if (filterValue) await filter.selectOption(filterValue);
  const sort = collection.getByLabel("Order Records by");
  const sortValue = await sort
    .locator("option")
    .evaluateAll(
      (options) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .find(Boolean) ?? "",
    );
  if (sortValue) {
    await sort.selectOption(sortValue);
    await collection.getByLabel("Direction").selectOption("ascending");
  }
  return collection;
}

async function expectSatoshi(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    const hasLoadedSatoshi = Array.from(document.fonts).some(
      (font) => font.family.includes("Satoshi") && font.status === "loaded",
    );
    const loadedFontshareStylesheet = performance
      .getEntriesByType("resource")
      .some((entry) =>
        entry.name.startsWith("https://api.fontshare.com/v2/css"),
      );
    return hasLoadedSatoshi && loadedFontshareStylesheet;
  });
}

async function saveSiteDraft(page: Page, businessSlug: string): Promise<void> {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/sites\\?notice=saved$`),
  );
}

async function uploadSiteImage(page: Page): Promise<void> {
  const home = page.locator(".site-composer-page").first();
  await home
    .getByRole("button", { name: "Add Site image", exact: true })
    .click();
  const imageBlock = home.locator(".site-composer-block").last();
  await imageBlock.getByLabel("Choose managed image").setInputFiles({
    ...proofImage,
    name: "browser-proof-site.png",
  });
  await expect(page.getByText(/Image uploaded\./)).toBeVisible();
  await imageBlock.getByLabel("Image description").fill(imageAlt);
}

async function uploadSiteGalleryImage(
  page: Page,
  pageLocator: Locator,
  name: string,
): Promise<void> {
  await pageLocator
    .getByRole("button", { name: "Add image gallery", exact: true })
    .click();
  const galleryBlock = pageLocator.locator(".site-composer-block").last();
  await galleryBlock
    .getByLabel("Add managed gallery image")
    .setInputFiles({ ...proofImage, name });
  await expect(page.getByText(/Gallery image uploaded\./)).toBeVisible();
}

async function captureSiteStates(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  for (const state of [
    { name: "site-1440x900.png", width: 1440, height: 900 },
    { name: "site-1024x768.png", width: 1024, height: 768 },
    { name: "site-390x844.png", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: state.width, height: state.height });
    await expectSatoshi(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(state.name),
    });
  }
}

test("owner builds and publishes a multi-page Site in Chromium", async ({
  page,
  pagesProof,
}, testInfo) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);

  const catalogueView = await createWorkspaceTable(
    page,
    business.slug,
    "Catalogue",
    ["Heritage cake", "Lemon tart"],
    { fileProperty: "Photo" },
  );
  const servicesView = await createWorkspaceTable(
    page,
    business.slug,
    "Services",
    ["Wedding catering", "Corporate lunch"],
  );
  const portfolioView = await createWorkspaceTable(
    page,
    business.slug,
    "Portfolio",
    ["Summer wedding"],
  );

  await page.goto(`/app/${business.slug}/sites`);
  await page.getByRole("button", { name: "Create Site draft" }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=created$`),
  );

  await page.getByLabel("Site name").fill(siteName);
  const pages = page.locator(".site-composer-page");
  await expect(pages).toHaveCount(1);
  await page.getByLabel("Accent").selectOption("clay");

  const secondPage = await addSitePage(page, secondPageTitle, secondPageSlug);
  await secondPage
    .getByRole("button", { name: "Add 2-column section", exact: true })
    .click();
  await secondPage
    .getByRole("button", { name: "Add collapsible section", exact: true })
    .click();

  const cataloguePage = await addSitePage(page, "Catalogue", "catalogue");
  const portfolioPage = await addSitePage(page, "Portfolio", "portfolio");
  const detailPage = await addSitePage(
    page,
    "Catalogue details",
    "catalogue-details",
    { inNavigation: false },
  );
  await addSitePage(page, "Private notes", "private-notes", {
    included: false,
    inNavigation: false,
  });

  await page
    .getByRole("button", { name: "Add Record collection", exact: true })
    .first()
    .click();
  const homeCatalogueCollection = await configureCollection(
    pages.first(),
    catalogueView,
    "cards",
    "Catalogue details",
  );
  const recordImageInput = homeCatalogueCollection
    .getByLabel("Record image (photo)", { exact: true })
    .first();
  await expect(recordImageInput).toBeVisible();
  await recordImageInput.setInputFiles({
    ...proofImage,
    name: "browser-proof-record.png",
  });
  await expect(
    page.getByText("Record image attached for the next reviewed release.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add Record collection", exact: true })
    .first()
    .click();
  await configureCollection(pages.first(), servicesView, "table");

  await cataloguePage
    .getByRole("button", { name: "Add Record collection", exact: true })
    .click();
  await configureCollection(cataloguePage, catalogueView, "cards");
  await secondPage
    .getByRole("button", { name: "Add Record collection", exact: true })
    .click();
  await configureCollection(secondPage, servicesView, "list");

  await portfolioPage
    .getByRole("button", { name: "Add Record collection", exact: true })
    .click();
  await configureCollection(portfolioPage, portfolioView, "list");

  await detailPage
    .getByRole("button", { name: "Add shared Record detail", exact: true })
    .click();

  await uploadSiteGalleryImage(
    page,
    portfolioPage,
    "browser-proof-gallery.png",
  );
  await uploadSiteImage(page);

  const portfolioBlocks = portfolioPage.locator(".site-composer-block");
  const initialPortfolioBlockCount = await portfolioBlocks.count();
  await portfolioBlocks
    .first()
    .getByRole("button", { name: "↓", exact: true })
    .click();
  await portfolioBlocks
    .first()
    .getByRole("button", { name: "Duplicate", exact: true })
    .click();
  await expect(portfolioBlocks).toHaveCount(initialPortfolioBlockCount + 1);
  await portfolioBlocks
    .nth(1)
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(portfolioBlocks).toHaveCount(initialPortfolioBlockCount);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(portfolioBlocks).toHaveCount(initialPortfolioBlockCount + 1);
  await portfolioBlocks
    .nth(1)
    .getByRole("button", { name: "Remove", exact: true })
    .click();

  await saveSiteDraft(page, business.slug);

  await page
    .getByRole("button", { name: "Prepare release for review", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await expect(
    page.getByRole("region", { name: "Site preview" }),
  ).toBeVisible();
  await expect(page.getByText(siteName, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed candidate",
      exact: true,
    }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Publish reviewed candidate", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );
  await expectSatoshi(page);
  await captureSiteStates(page, testInfo);

  await page.goto(`/p/${business.slug}/home`);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText(siteName, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Powered by Lenni", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: secondPageTitle })).toBeVisible();
  await expect(page.getByRole("img", { name: imageAlt })).toBeVisible();
  await expect(page.locator("img.site-public-record-image")).toHaveCount(1);
  await expect(page.locator("img.site-public-record-image")).toBeVisible();
  await expect(page.getByText("Heritage cake", { exact: true })).toBeVisible();
  await expect(page.getByText("Lemon tart", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("table").getByText("Wedding catering", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("Corporate lunch", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: imageAlt })
        .evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
    )
    .toBeGreaterThan(0);

  await page.getByRole("link", { name: "View details" }).first().click();
  await expect(page).toHaveURL(
    new RegExp(`/p/${business.slug}/catalogue-details/record/r_[a-f0-9]{64}$`),
  );
  await expect(
    page.getByRole("heading", { name: "Catalogue details" }),
  ).toBeVisible();
  await expect(page.getByText("Heritage cake", { exact: true })).toBeVisible();
  await expect(page.locator("img.site-public-record-image")).toHaveCount(1);

  await page.getByRole("link", { name: secondPageTitle }).click();
  await expect(page).toHaveURL(
    new RegExp(`/p/${business.slug}/${secondPageSlug}$`),
  );
  await expect(
    page.getByRole("heading", { name: secondPageTitle }),
  ).toBeVisible();
  await expect(
    page.getByText("Write something useful.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Wedding catering", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Corporate lunch", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Catalogue" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${business.slug}/catalogue$`));
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  await expect(page.getByText("Heritage cake", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Portfolio" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${business.slug}/portfolio$`));
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByText("Summer wedding", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "browser-proof-gallery.png" }),
  ).toBeVisible();

  const excludedPage = await page.request.get(
    `/p/${business.slug}/private-notes`,
  );
  expect(excludedPage.status()).toBe(404);

  await page.goto(`/app/${business.slug}/sites`);
  await page.getByLabel("Site name").fill("Private draft branding");
  await saveSiteDraft(page, business.slug);
  await page.goto(`/p/${business.slug}/home`);
  await expect(page.getByText(siteName, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Private draft branding", { exact: true }),
  ).toHaveCount(0);

  await page.goto(`/app/${business.slug}/sites`);
  const availability = page.getByRole("region", {
    name: "Public availability controls",
  });
  const heritageRecord = availability
    .locator("form.site-availability-form")
    .filter({ hasText: "Heritage cake" });
  await heritageRecord.getByRole("button", { name: "Withdraw now" }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=availability_changed$`),
  );
  const withdrawnHome = await page.request.get(`/p/${business.slug}/home`);
  expect(withdrawnHome.status()).toBe(200);
  await page.goto(`/p/${business.slug}/home`);
  await expect(page.getByText("Heritage cake", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lemon tart", { exact: true })).toBeVisible();

  await page.goto(`/app/${business.slug}/sites`);
  const reenableRecord = page
    .getByRole("region", { name: "Public availability controls" })
    .locator("form.site-availability-form")
    .filter({ hasText: "Heritage cake" });
  await reenableRecord
    .getByRole("button", { name: "Re-enable for next release" })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=availability_changed$`),
  );
  await page
    .getByRole("button", { name: "Prepare release for review", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await page
    .getByRole("button", { name: "Publish reviewed candidate", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );
  await page.goto(`/p/${business.slug}/home`);
  await expect(page.getByText("Heritage cake", { exact: true })).toBeVisible();

  await page.goto(`/app/${business.slug}/sites`);
  await page
    .getByRole("button", { name: "Unpublish Site", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=unpublished$`),
  );
  const unpublished = await page.request.get(`/p/${business.slug}/home`);
  expect(unpublished.status()).toBe(404);

  // Keep an actually incomplete block through the debounced autosave and a
  // full route reload. A later ordinary workspace change must require an
  // explicit Site rebase while preserving that durable draft composition.
  await page.goto(`/app/${business.slug}/sites`);
  const draftHome = page.locator(".site-composer-page").first();
  await draftHome
    .getByRole("button", { name: "Add heading", exact: true })
    .click();
  const incompleteHeading = draftHome
    .locator(".site-composer-block")
    .last()
    .locator("input")
    .first();
  const autosave = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/app/${business.slug}/sites/draft`) &&
      response.status() === 200,
  );
  await incompleteHeading.fill("");
  await autosave;
  await page.reload();
  await expect(
    page
      .locator(".site-composer-page")
      .first()
      .locator(".site-composer-block")
      .last()
      .locator("input")
      .first(),
  ).toHaveValue("");

  await createWorkspaceTable(page, business.slug, "Recovery", []);
  await page.goto(`/app/${business.slug}/sites`);
  await expect(
    page.getByRole("region", { name: "Draft recovery" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rebase draft base", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=rebased$`),
  );
  await expect(
    page
      .locator(".site-composer-page")
      .first()
      .locator(".site-composer-block")
      .last()
      .locator("input")
      .first(),
  ).toHaveValue("");
});
