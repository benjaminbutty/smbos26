import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

const siteName = "Browser proof customer Site";
const secondPageTitle = "Services";
const secondPageSlug = "services";
const imageAlt = "Browser proof Site image";

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
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4H+X7HwAGqAKm8BxW3QAAAABJRU5ErkJggg==",
      "base64",
    ),
    mimeType: "image/png",
    name: "browser-proof-site.png",
  });
  await expect(page.getByText(/Image uploaded\./)).toBeVisible();
  await imageBlock.getByLabel("Image description").fill(imageAlt);
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
  await page.goto(`/app/${business.slug}/sites`);
  await page.getByRole("button", { name: "Create Site draft" }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=created$`),
  );

  await page.getByLabel("Site name").fill(siteName);
  await page.getByRole("button", { name: "Add Page", exact: true }).click();
  const pages = page.locator(".site-composer-page");
  await expect(pages).toHaveCount(2);
  const secondPage = pages.nth(1);
  await secondPage.getByLabel("Title").fill(secondPageTitle);
  await secondPage.getByLabel("Address").fill(secondPageSlug);
  await secondPage.getByLabel("Navigation label").fill(secondPageTitle);
  await secondPage
    .getByRole("button", { name: "Add 2-column section", exact: true })
    .click();
  await uploadSiteImage(page);
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
  await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
  await expect(page.getByRole("link", { name: secondPageTitle })).toBeVisible();
  await expect(page.getByRole("img", { name: imageAlt })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: imageAlt })
        .evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
    )
    .toBeGreaterThan(0);

  await page.getByRole("link", { name: secondPageTitle }).click();
  await expect(page).toHaveURL(
    new RegExp(`/p/${business.slug}/${secondPageSlug}$`),
  );
  await expect(
    page.getByRole("heading", { name: secondPageTitle }),
  ).toBeVisible();

  await page.goto(`/app/${business.slug}/sites`);
  await page
    .getByRole("button", { name: "Unpublish Site", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=unpublished$`),
  );
  const unpublished = await page.request.get(`/p/${business.slug}/home`);
  expect(unpublished.status()).toBe(404);
});
