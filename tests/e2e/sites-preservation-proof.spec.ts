import type { Page } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

const draftA = "Delayed Site edit A";
const draftB = "Latest Site edit B";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
  await expect(page.getByLabel("Site name")).toBeVisible();
}

function draftBrandingName(route: {
  request(): { postData(): string | null };
}): string | null {
  const postData = route.request().postData();
  if (!postData) return null;
  try {
    const body = JSON.parse(postData) as {
      draft?: { branding?: { name?: unknown } };
    };
    const name = body.draft?.branding?.name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

test("owner keeps the latest Site edit while workspace navigation flushes a save", async ({
  page,
  pagesProof,
}) => {
  const business = await pagesProof.createBusinessThroughOwnerUi(page);
  const draftUrl = new URL(
    `/api/app/${business.slug}/sites/draft`,
    page.url(),
  ).toString();
  const draftAReachedServer = deferred();
  const draftAReleased = deferred();
  const draftBReachedServer = deferred();
  const draftBReleased = deferred();

  await page.route(draftUrl, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const name = draftBrandingName(route);
    if (name === draftA) {
      const response = await route.fetch();
      draftAReachedServer.resolve();
      await draftAReleased.promise;
      await route.fulfill({ response });
      return;
    }

    if (name === draftB) {
      // If the debounced autosave starts before the navigation click, keep it
      // behind A so the real server writes still observe their revision order.
      await draftAReleased.promise;
      const response = await route.fetch();
      draftBReachedServer.resolve();
      await draftBReleased.promise;
      await route.fulfill({ response });
      return;
    }

    await route.continue();
  });

  try {
    await createSiteDraft(page, business.slug);
    const siteName = page.getByLabel("Site name");
    const autosaveStatus = page.locator(".site-composer-autosave-status");

    await siteName.fill(draftA);
    await draftAReachedServer.promise;

    await siteName.fill(draftB);
    await page
      .getByRole("link", { name: "Back to Home", exact: true })
      .click({ noWaitAfter: true });

    await expect(page).toHaveURL(
      new RegExp(`/app/${business.slug}/sites(?:\\?[^#]*)?$`),
    );
    await expect(siteName).toHaveValue(draftB);
    await expect(autosaveStatus).not.toHaveText("Saved automatically");

    draftAReleased.resolve();
    await draftBReachedServer.promise;
    await expect(page).toHaveURL(
      new RegExp(`/app/${business.slug}/sites(?:\\?[^#]*)?$`),
    );
    await expect(siteName).toHaveValue(draftB);
    await expect(autosaveStatus).not.toHaveText("Saved automatically");

    draftBReleased.resolve();
    await expect(page).toHaveURL(new RegExp(`/app/${business.slug}$`));
    await page.getByRole("link", { name: "Sites", exact: true }).click();
    await page.waitForURL(new RegExp(`/app/${business.slug}/sites$`));
    await expect(page.getByLabel("Site name")).toHaveValue(draftB);
  } finally {
    draftAReleased.resolve();
    draftBReleased.resolve();
    await page.unroute(draftUrl);
  }
});

test.describe("mobile Site composer touch proof", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("owner can dismiss and reopen Add block with touch", async ({
    page,
    pagesProof,
  }) => {
    const business = await pagesProof.createBusinessThroughOwnerUi(page);

    await createSiteDraft(page, business.slug);
    const addBlock = page.getByRole("button", {
      name: "Add block",
      exact: true,
    });
    const addBlockMenu = page.locator(".site-composer-add-menu");
    const siteName = page.getByLabel("Site name");
    const canvasBlocks = page.locator(".site-composer-canvas-block");

    await addBlock.tap();
    await expect(addBlockMenu).toBeVisible();
    await addBlock.tap();
    await expect(addBlockMenu).toBeHidden();
    await expect(addBlock).toHaveAttribute("aria-expanded", "false");

    await addBlock.tap();
    await expect(addBlockMenu).toBeVisible();
    await siteName.tap();
    await expect(addBlockMenu).toBeHidden();
    await expect(siteName).toBeFocused();

    await addBlock.tap();
    await expect(addBlockMenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(addBlockMenu).toBeHidden();
    await expect(addBlock).toBeFocused();
    await expect(addBlock).toHaveAttribute("aria-expanded", "false");

    const initialBlockCount = await canvasBlocks.count();
    await addBlock.tap();
    await addBlockMenu
      .getByRole("menuitem", { name: "Add heading", exact: true })
      .tap();
    await expect(canvasBlocks).toHaveCount(initialBlockCount + 1);
    await expect(addBlockMenu).toBeHidden();
  });
});
