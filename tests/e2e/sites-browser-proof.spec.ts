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

async function selectSitePage(page: Page, title: string): Promise<Locator> {
  const pageButton = page
    .getByRole("navigation", { name: "Choose a Page" })
    .getByRole("button", { name: title, exact: true });
  await pageButton.click();
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

async function addSitePage(
  page: Page,
  title: string,
  slug: string,
  options: { included?: boolean; inNavigation?: boolean } = {},
): Promise<Locator> {
  const pageButtons = page
    .getByRole("navigation", { name: "Choose a Page" })
    .getByRole("button");
  const nextIndex = await pageButtons.count();
  await page
    .getByRole("button", { name: "Add Page", exact: true })
    .first()
    .click();
  await expect(pageButtons).toHaveCount(nextIndex + 1);
  const added = page.locator(".site-composer-page");
  await expect(added).toHaveCount(1);
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
  return page.locator(
    ".site-composer-block:has(> .site-composer-collection-fields select)",
  );
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
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await home
    .getByRole("menuitem", { name: "Add Site image", exact: true })
    .click();
  const imageBlock = home.locator(
    ".site-composer-inspector .site-composer-block",
  );
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
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await pageLocator
    .getByRole("menuitem", { name: "Add image gallery", exact: true })
    .click();
  const galleryBlock = pageLocator.locator(
    ".site-composer-inspector .site-composer-block",
  );
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
      fullPage: false,
      path: testInfo.outputPath(state.name),
    });
  }
}

test("owner can review the compact Site editor", async ({
  page,
  pagesProof,
}, testInfo) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);

  await page.goto(`/app/${business.slug}/sites`);
  await page.getByRole("button", { name: "Create Site draft" }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=created$`),
  );

  const home = await selectSitePage(page, "Home");
  await page.getByRole("button", { name: "Add Page", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Choose a Page" }).getByRole("button"),
  ).toHaveCount(2);
  await selectSitePage(page, "Home");

  const headingBlock = home.locator(".site-composer-canvas-block").first();
  await expect(
    headingBlock.locator(".site-composer-canvas-block-type"),
  ).toHaveText("Heading");
  await headingBlock.click();
  const headingInput = home
    .locator(".site-composer-inspector .site-composer-block")
    .getByRole("textbox")
    .first();
  await expect(headingInput).toBeVisible();
  const autosave = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/app/${business.slug}/sites/draft`) &&
      response.status() === 200,
  );
  await headingInput.fill("A welcoming home page");
  await autosave;
  await expect(
    page.getByText("Saved automatically", { exact: true }),
  ).toBeVisible();

  for (const state of [
    { name: "first-draft-editor-1440x900.png", width: 1440, height: 900 },
    { name: "first-draft-editor-1024x768.png", width: 1024, height: 768 },
    { name: "first-draft-editor-390x844.png", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: state.width, height: state.height });
    await expectSatoshi(page);
    await page.screenshot({
      fullPage: false,
      path: testInfo.outputPath(state.name),
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await expect(
    page.getByRole("region", { name: "Site preview" }),
  ).toBeVisible();
  await page.screenshot({
    fullPage: false,
    path: testInfo.outputPath("first-draft-preview-1440x900.png"),
  });
});

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
  await page.getByText("Site identity", { exact: true }).click();
  await page.getByLabel("Accent").selectOption("clay");

  const secondPage = await addSitePage(page, secondPageTitle, secondPageSlug);
  await addSiteBlock(page, "Add 2-column section");
  await addSiteBlock(page, "Add collapsible section");

  const cataloguePage = await addSitePage(page, "Catalogue", "catalogue");
  const portfolioPage = await addSitePage(page, "Portfolio", "portfolio");
  await addSitePage(page, "Catalogue details", "catalogue-details", {
    inNavigation: false,
  });
  await addSitePage(page, "Private notes", "private-notes", {
    included: false,
    inNavigation: false,
  });

  const homePage = await selectSitePage(page, "Home");
  await addSiteBlock(page, "Add Record collection");
  const homeCatalogueCollection = await configureCollection(
    homePage,
    catalogueView,
    "cards",
    "Catalogue details",
  );
  const recordImageInput = homeCatalogueCollection
    .getByLabel("Record image (Photo)", { exact: true })
    .first();
  await expect(recordImageInput).toBeVisible();
  await recordImageInput.setInputFiles({
    ...proofImage,
    name: "browser-proof-record.png",
  });
  await expect(
    page.getByText("Record image is ready for your next Site update.", {
      exact: true,
    }),
  ).toBeVisible();
  await addSiteBlock(page, "Add Record collection");
  await configureCollection(homePage, servicesView, "table");

  await selectSitePage(page, "Catalogue");
  await addSiteBlock(page, "Add Record collection");
  await configureCollection(cataloguePage, catalogueView, "cards");
  await selectSitePage(page, secondPageTitle);
  await addSiteBlock(page, "Add Record collection");
  await configureCollection(secondPage, servicesView, "list");

  await selectSitePage(page, "Portfolio");
  await addSiteBlock(page, "Add Record collection");
  await configureCollection(portfolioPage, portfolioView, "list");

  await selectSitePage(page, "Catalogue details");
  await addSiteBlock(page, "Add shared Record detail");

  await selectSitePage(page, "Portfolio");
  await uploadSiteGalleryImage(
    page,
    portfolioPage,
    "browser-proof-gallery.png",
  );
  await selectSitePage(page, "Home");
  await uploadSiteImage(page);

  const portfolio = await selectSitePage(page, "Portfolio");
  const portfolioBlocks = portfolio.locator(".site-composer-canvas-block");
  const portfolioInspector = portfolio.locator(".site-composer-inspector");
  const initialPortfolioBlockCount = await portfolioBlocks.count();
  await portfolioBlocks.first().click();
  await portfolioInspector
    .getByRole("button", { name: "↓", exact: true })
    .click();
  await portfolioInspector
    .getByRole("button", { name: "Duplicate", exact: true })
    .click();
  await expect(portfolioBlocks).toHaveCount(initialPortfolioBlockCount + 1);
  await portfolioInspector
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(portfolioBlocks).toHaveCount(initialPortfolioBlockCount);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(portfolioBlocks).toHaveCount(initialPortfolioBlockCount + 1);
  await portfolioInspector
    .getByRole("button", { name: "Remove", exact: true })
    .click();

  await saveSiteDraft(page, business.slug);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await expect(
    page.getByRole("region", { name: "Site preview" }),
  ).toBeVisible();
  await expect(page.getByText(siteName, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Publish",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
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
  const siteImage = page.getByRole("img", { name: imageAlt });
  await expect(siteImage).toBeVisible();
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
  await siteImage.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      siteImage.evaluate((image) =>
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
    page.getByText("Write something useful.", { exact: true }).first(),
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
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
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
  await addSiteBlock(page, "Add heading");
  const incompleteHeadingCard = draftHome
    .locator(".site-composer-canvas-block")
    .last();
  await expect(
    incompleteHeadingCard.locator(".site-composer-canvas-block-type"),
  ).toHaveText("Heading");
  await incompleteHeadingCard.click();
  const incompleteHeading = draftHome
    .locator(".site-composer-inspector .site-composer-block")
    .getByRole("textbox")
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
  const reloadedHome = page.locator(".site-composer-page").first();
  const reloadedIncompleteHeading = reloadedHome
    .locator(".site-composer-canvas-block")
    .last();
  await expect(
    reloadedIncompleteHeading.locator(".site-composer-canvas-block-type"),
  ).toHaveText("Heading");
  await reloadedIncompleteHeading.click();
  await expect(
    reloadedHome
      .locator(".site-composer-inspector .site-composer-block")
      .getByRole("textbox")
      .first(),
  ).toHaveValue("");

  // The responsive capture intentionally leaves the page at the mobile
  // viewport. Table creation is exercised through the visible desktop
  // workspace control before returning to the Site recovery journey.
  await page.setViewportSize({ width: 1440, height: 900 });
  await createWorkspaceTable(page, business.slug, "Recovery", []);
  await page.goto(`/app/${business.slug}/sites`);
  await expect(
    page.getByRole("region", { name: "Draft recovery" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Update draft", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=rebased$`),
  );
  const rebasedHome = page.locator(".site-composer-page").first();
  const rebasedIncompleteHeading = rebasedHome
    .locator(".site-composer-canvas-block")
    .last();
  await expect(
    rebasedIncompleteHeading.locator(".site-composer-canvas-block-type"),
  ).toHaveText("Heading");
  await rebasedIncompleteHeading.click();
  await expect(
    rebasedHome
      .locator(".site-composer-inspector .site-composer-block")
      .getByRole("textbox")
      .first(),
  ).toHaveValue("");
});
