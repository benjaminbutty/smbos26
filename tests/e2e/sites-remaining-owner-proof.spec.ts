import type { Page } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

test.setTimeout(240_000);

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

async function applyProposal(page: Page, businessSlug: string): Promise<void> {
  await expect(
    page.getByRole("link", { name: "Validate proposal", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Validate proposal", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/changes/[^/?#]+/validate$`),
  );
  await page
    .getByRole("button", { name: "Validate proposal", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/changes/[^/?#]+\\?notice=validated$`),
  );
  await page
    .getByRole("link", { name: "Apply configuration", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/changes/[^/?#]+/apply$`),
  );
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/changes/[^/?#]+\\?notice=applied$`),
  );
}

async function createLocationAndPreorder(
  page: Page,
  businessSlug: string,
): Promise<void> {
  await page.goto(`/app/${businessSlug}/locations`);
  const locations = page.locator("#locations");
  await locations
    .getByLabel("Name", { exact: true })
    .first()
    .fill("Main studio");
  await locations
    .getByRole("button", { name: "Add location", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/locations\\?.*message=`),
  );
  await expect(
    locations.getByRole("heading", { name: "Main studio", exact: true }),
  ).toBeVisible();

  await page.goto(`/app/${businessSlug}/setup`);
  await page.getByLabel("Main studio (UTC)", { exact: true }).check();
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) {
    await page.getByLabel(day, { exact: true }).check();
  }
  await page.getByLabel("First collection", { exact: true }).fill("09:00");
  await page.getByLabel("Last collection", { exact: true }).fill("17:00");
  await page
    .getByLabel("Time between collection slots (minutes)", { exact: true })
    .fill("60");
  await page.getByLabel("Maximum orders per slot", { exact: true }).fill("3");
  await page
    .getByLabel("Notice required before collection (hours)", { exact: true })
    .fill("0");
  await page
    .getByLabel("How far ahead customers can order (days)", { exact: true })
    .fill("30");
  await page
    .getByRole("button", { name: "Set up preorders", exact: true })
    .click();
  await page.waitForURL(new RegExp(`/app/${businessSlug}/changes/[^/?#]+$`));
  await applyProposal(page, businessSlug);
}

async function createProduct(page: Page, businessSlug: string): Promise<void> {
  await page.goto(`/app/${businessSlug}`);
  await page
    .getByRole("link", { name: "Products", exact: true })
    .first()
    .click();
  await page.waitForURL(new RegExp(`/app/${businessSlug}/workspace/products`));
  const configuredCreate = page.getByRole("link", {
    name: "Open the configured creation screen",
    exact: true,
  });
  if (await configuredCreate.count()) {
    await configuredCreate.click();
  } else {
    await page.goto(`/app/${businessSlug}/workspace/products/new`);
  }
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/workspace/products/new`),
  );
  const form = page.locator("form.runtime-form");
  await expect(
    page.getByRole("heading", { name: "Add product", exact: true }),
  ).toBeVisible();
  await form.locator('input[name="name"]').fill("Morning studio box");
  await form
    .locator('textarea[name="description"]')
    .fill("A small collection box.");
  await form.locator('input[name="price"]').fill("12.50");
  await form.locator('select[name="status"]').selectOption({ label: "Active" });
  await form.getByRole("button", { name: "Save product", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/workspace/products\\?.*message=`),
  );
  await expect(
    page
      .locator(".editor-desktop-grid")
      .getByText("Morning studio box", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: "Open record Morning studio box",
      exact: true,
    })
    .click();
  await page
    .getByRole("link", { name: "Open full record", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/workspace/products/[^/?#]+`),
  );
  const availability = page.getByRole("heading", {
    name: "Availability by Location",
    exact: true,
  });
  await expect(availability).toBeVisible();
  await page
    .getByLabel("Make available at", { exact: true })
    .selectOption({ label: "Main studio" });
  await page
    .getByRole("button", { name: "Make available", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/workspace/products/[^/?#]+\\?.*message=`),
  );
  await expect(page.getByText("Main studio", { exact: true })).toBeVisible();
}

async function setupBooking(
  page: Page,
  businessSlug: string,
  lastTime: string,
): Promise<void> {
  await page.goto(`/app/${businessSlug}/setup/booking`);
  await page.getByLabel("First booking", { exact: true }).fill("09:00");
  await page.getByLabel("Last booking", { exact: true }).fill(lastTime);
  await page
    .getByLabel("Time between bookings (minutes)", { exact: true })
    .fill("60");
  await page.getByLabel("Bookings per slot", { exact: true }).fill("2");
  await page.getByLabel("Minimum notice (minutes)", { exact: true }).fill("0");
  await page.getByLabel("Booking horizon (days)", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Prepare booking setup", exact: true })
    .click();
  await page.waitForURL(new RegExp(`/app/${businessSlug}/changes/[^/?#]+$`));
  await applyProposal(page, businessSlug);
}

async function amendPublishedBooking(
  page: Page,
  businessSlug: string,
  lastTime: string,
): Promise<void> {
  await page.goto(`/app/${businessSlug}/setup/booking`);
  await expect(
    page.getByRole("heading", {
      name: "Update appointment booking hours",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Last booking", { exact: true }).fill(lastTime);
  await page
    .getByRole("button", { name: "Save booking settings", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${businessSlug}/sites\\?notice=saved$`),
  );
  await expect(
    page.getByRole("link", { name: "Edit booking settings", exact: true }),
  ).toBeVisible();
}

async function expectPublishedBookingLastTime(
  page: Page,
  publicUrl: string,
  expectedTime: string,
  absentTime?: string,
): Promise<void> {
  await page.goto(publicUrl);
  const booking = page.locator(".booking-experience");
  await expect(
    booking.getByRole("heading", { name: "Request a booking" }),
  ).toBeVisible();
  await booking.getByLabel("Date", { exact: true }).selectOption({ index: 1 });
  await expect(
    booking.getByLabel(`${expectedTime}, Available`, { exact: true }),
  ).toBeVisible();
  if (absentTime) {
    await expect(
      booking.getByLabel(`${absentTime}, Available`, { exact: true }),
    ).toHaveCount(0);
  }
}

async function addOperationalBlock(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  const menuItem = page.getByRole("menuitem", { name });
  await expect(menuItem).toBeVisible();
  await menuItem.click();
}

test("owner configures booking and preorder journeys through the Site", async ({
  page,
  pagesProof,
}) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);
  const sharedEmail = "Shared.Customer@Example.test";

  await createLocationAndPreorder(page, business.slug);
  await createProduct(page, business.slug);
  await setupBooking(page, business.slug, "17:00");

  await page.goto(`/app/${business.slug}/sites`);
  await page
    .getByRole("button", { name: "Create Site draft", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=created$`),
  );

  await addOperationalBlock(page, /^Add Booking ·/);
  await page.getByRole("button", { name: "Add Page", exact: true }).click();
  const pageSettings = page.getByRole("region", {
    name: "Page settings",
    exact: true,
  });
  await expect(pageSettings).toBeVisible();
  await pageSettings.getByLabel("Title", { exact: true }).fill("Collection");
  await pageSettings.getByLabel("Address", { exact: true }).fill("collection");
  await pageSettings
    .getByLabel("Navigation label", { exact: true })
    .fill("Collection");
  await addOperationalBlock(page, /^Add Preorder/);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();

  await setupBooking(page, business.slug, "18:00");
  await page.goto(`/app/${business.slug}/sites`);
  await page
    .getByLabel("Site name", { exact: true })
    .fill("Configured customer site");
  await page
    .getByRole("button", { name: "Refresh booking settings", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=saved$`),
  );
  await expect(page.getByLabel("Site name", { exact: true })).toHaveValue(
    "Configured customer site",
  );

  const addBlock = page.getByRole("button", { name: "Add block", exact: true });
  await addBlock.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(addBlock).toBeFocused();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  const preview = page.getByRole("region", { name: "Site preview" });
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole("region", { name: "Booking preview", exact: true }),
  ).toContainText("Booking for visitors");
  await expect(
    preview.getByRole("region", { name: "Preorder preview", exact: true }),
  ).toContainText("Preorder for visitors");
  await captureResponsiveEvidence(page, "owner-booking-preorder-preview");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );

  const browser = page.context().browser();
  if (!browser) throw new Error("The owner journey needs a browser context.");
  await amendPublishedBooking(page, business.slug, "19:00");
  const beforeRepublishContext = await browser.newContext();
  const beforeRepublishVisitor = await beforeRepublishContext.newPage();
  await beforeRepublishVisitor.route("https://jamp.io/**", (route) =>
    route.abort(),
  );
  try {
    await expectPublishedBookingLastTime(
      beforeRepublishVisitor,
      new URL(`/p/${business.slug}/home`, page.url()).toString(),
      "17:00",
      "18:00",
    );
  } finally {
    await beforeRepublishContext.close();
  }

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.route("https://jamp.io/**", (route) => route.abort());
  try {
    await expectPublishedBookingLastTime(
      visitor,
      new URL(`/p/${business.slug}/home`, page.url()).toString(),
      "18:00",
    );
    await visitor.goto(
      new URL(`/p/${business.slug}/home`, page.url()).toString(),
    );
    const booking = visitor.locator(".booking-experience");
    await expect(
      booking.getByRole("heading", { name: "Request a booking" }),
    ).toBeVisible();
    const service = booking.getByLabel("Service", { exact: true });
    if ((await service.count()) > 0) {
      const serviceOptions = service.locator("option");
      if ((await serviceOptions.count()) > 1) {
        await service.selectOption({ index: 1 });
      }
    }
    await captureResponsiveEvidence(visitor, "visitor-booking");
    await booking
      .getByLabel("Date", { exact: true })
      .selectOption({ index: 1 });
    await booking.locator('input[name="booking-slot"]:enabled').first().check();
    await booking
      .getByLabel("Customer name", { exact: true })
      .fill("Shared Customer");
    await booking.getByLabel("Email", { exact: true }).fill(sharedEmail);
    await booking
      .getByRole("button", { name: "Request booking", exact: true })
      .click();
    await expect(
      booking.getByRole("heading", { name: "Your time is reserved." }),
    ).toBeVisible();

    await visitor
      .getByRole("link", { name: "Collection", exact: true })
      .click();
    await visitor.waitForURL(new RegExp(`/p/${business.slug}/collection$`));
    const preorder = visitor.locator(".preorder-flow");
    await captureResponsiveEvidence(visitor, "visitor-preorder");
    await preorder
      .getByRole("button", { name: "Add one Morning studio box", exact: true })
      .click();
    await preorder
      .getByLabel("Location", { exact: true })
      .selectOption({ label: "Main studio" });
    await preorder
      .getByLabel("Date", { exact: true })
      .selectOption({ index: 1 });
    await preorder
      .locator('input[name="collection-slot"]:enabled')
      .first()
      .check();
    await preorder
      .locator('input[name="customer.name"]')
      .fill("Shared Customer");
    await preorder
      .locator('input[name="customer.email"]')
      .fill("shared.customer@example.test");
    await preorder
      .getByRole("button", { name: "Place preorder", exact: true })
      .click();
    await expect(
      preorder.getByRole("heading", { name: /Thank you/ }),
    ).toBeVisible();
  } finally {
    await visitorContext.close();
  }

  await page.getByRole("link", { name: "Back to Home", exact: true }).click();
  await page.waitForURL(new RegExp(`/app/${business.slug}$`));
  await expect(
    page.getByRole("link", { name: "Orders", exact: true }),
  ).toBeVisible();
  const bookingWorkspaceLink = page.getByRole("link", {
    name: /^(Appointments|Bookings)$/,
  });
  await expect(bookingWorkspaceLink).toBeVisible();
  await page.getByRole("link", { name: "Orders", exact: true }).first().click();
  await page.waitForURL(new RegExp(`/app/${business.slug}/workspace/orders`));
  await expect(
    page.getByText(/Shared\.Customer@example\.test/i).first(),
  ).toBeVisible();
  await expect(
    page
      .locator(".editor-desktop-grid")
      .getByText("Morning studio box", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".table-workbench-toolbar-status")).toContainText(
    /1 of 1/,
  );

  await page.getByRole("link", { name: "Back to Home", exact: true }).click();
  await page.waitForURL(new RegExp(`/app/${business.slug}$`));
  await bookingWorkspaceLink.click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/workspace/(appointments|bookings)`),
  );
  await expect(page.getByText(/Appointments|Bookings/i).first()).toBeVisible();
  await expect(page.locator(".table-workbench-toolbar-status")).toContainText(
    /1 of 1/,
  );
});
