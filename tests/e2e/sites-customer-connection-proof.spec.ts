import type { Browser, Locator, Page } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });

const formName = "Customer appointment enquiry";
const submitLabel = "Send appointment enquiry";
const originalCustomerName = "Original Customer";
const changedCustomerName = "Updated profile name";
const reviewCustomerName = "Review candidate";
const sharedEmail = "Shared.Customer@Example.test";

const proofViewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function applyProposal(page: Page, businessSlug: string): Promise<void> {
  await expect(
    page.getByRole("link", { name: "Validate proposal", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Validate proposal", exact: true })
    .click();
  await page.waitForURL(
    new RegExp("/app/" + businessSlug + "/changes/[^/?#]+/validate$"),
  );
  await page
    .getByRole("button", { name: "Validate proposal", exact: true })
    .click();
  await page.waitForURL(
    new RegExp("/app/" + businessSlug + "/changes/[^/?#]+\\?notice=validated$"),
  );
  await page
    .getByRole("link", { name: "Apply configuration", exact: true })
    .click();
  await page.waitForURL(
    new RegExp("/app/" + businessSlug + "/changes/[^/?#]+/apply$"),
  );
  await page
    .getByRole("button", { name: "Apply configuration", exact: true })
    .click();
  await page.waitForURL(
    new RegExp("/app/" + businessSlug + "/changes/[^/?#]+\\?notice=applied$"),
  );
}

async function setupBooking(page: Page, businessSlug: string): Promise<void> {
  await page.goto("/app/" + businessSlug + "/setup/booking");
  await page.getByLabel("First booking", { exact: true }).fill("09:00");
  await page.getByLabel("Last booking", { exact: true }).fill("17:00");
  await page
    .getByLabel("Time between bookings (minutes)", { exact: true })
    .fill("60");
  await page.getByLabel("Bookings per slot", { exact: true }).fill("2");
  await page.getByLabel("Minimum notice (minutes)", { exact: true }).fill("0");
  await page.getByLabel("Booking horizon (days)", { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Prepare booking setup", exact: true })
    .click();
  await page.waitForURL(
    new RegExp("/app/" + businessSlug + "/changes/[^/?#]+$"),
  );
  await applyProposal(page, businessSlug);
}

async function createSiteDraft(
  page: Page,
  businessSlug: string,
): Promise<void> {
  await page.goto("/app/" + businessSlug + "/sites");
  await page
    .getByRole("button", { name: "Create Site draft", exact: true })
    .click();
  await page.waitForURL(
    new RegExp("/app/" + businessSlug + "/sites\\?notice=created$"),
  );
}

function formCard(page: Page): Locator {
  return page.locator(".site-form-card").first();
}

function formQuestion(form: Locator, index: number): Locator {
  return form.locator(".site-form-question").nth(index);
}

async function optionValueContaining(
  select: Locator,
  fragment: string,
): Promise<string> {
  const options = await select.locator("option").evaluateAll((elements) =>
    elements.map((element) => ({
      label: element.textContent?.trim() ?? "",
      value: (element as HTMLOptionElement).value,
    })),
  );
  const match = options.find((option) => option.label.includes(fragment));
  if (!match) {
    throw new Error(
      "Could not find an option containing " +
        fragment +
        " in the requested select.",
    );
  }
  return match.value;
}

async function selectOptionContaining(
  select: Locator,
  fragment: string,
): Promise<void> {
  await select.selectOption(await optionValueContaining(select, fragment));
}

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
            prefix +
              "-" +
              viewport.name +
              "-" +
              viewport.width +
              "x" +
              viewport.height +
              ".png",
          ),
      });
    }
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

async function configureCustomerForm(page: Page): Promise<void> {
  const form = formCard(page);
  await expect(form).toHaveCount(1);
  await expect(form).toBeVisible();
  const formNameInput = form.getByLabel("Form name", { exact: true });
  await expect(formNameInput).toBeVisible();
  await formNameInput.fill(formName);
  const saveResponsesIn = form.getByRole("combobox", {
    name: "Save responses in",
    exact: true,
  });
  await expect(saveResponsesIn).toBeVisible();
  await saveResponsesIn.selectOption({ label: "An existing Table" });

  const table = form.getByRole("combobox", { name: "Table", exact: true });
  await expect(table).toBeVisible();
  await selectOptionContaining(table, "Appointments");
  const tableView = form.getByRole("combobox", {
    name: "Table View",
    exact: true,
  });
  await expect(tableView).toBeVisible();
  await tableView.selectOption({ label: "Use an existing Table View" });
  const existingTableView = form.getByRole("combobox", {
    name: "Existing Table View",
    exact: true,
  });
  await expect(existingTableView).toBeVisible();
  await selectOptionContaining(existingTableView, "Appointments");
  const buttonLabel = form.getByLabel("Button label", { exact: true });
  await expect(buttonLabel).toBeVisible();
  await buttonLabel.fill(submitLabel);

  const customerNameQuestion = formQuestion(form, 0);
  await expect(customerNameQuestion).toBeVisible();
  await customerNameQuestion
    .getByLabel("Question", { exact: true })
    .fill("Customer name");
  await customerNameQuestion
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("new");
  await customerNameQuestion
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("short_text");
  await customerNameQuestion.getByRole("checkbox").check();

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(2);
  const customerEmailQuestion = formQuestion(form, 1);
  await expect(customerEmailQuestion).toBeVisible();
  await customerEmailQuestion
    .getByLabel("Question", { exact: true })
    .fill("Customer email");
  await customerEmailQuestion
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("new");
  await customerEmailQuestion
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("email");
  await customerEmailQuestion.getByRole("checkbox").check();

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(3);
  const dateQuestion = formQuestion(form, 2);
  await expect(dateQuestion).toBeVisible();
  await dateQuestion.getByLabel("Question", { exact: true }).fill("Date");
  await dateQuestion
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("existing");
  await selectOptionContaining(
    dateQuestion.getByRole("combobox", {
      name: "Existing property",
      exact: true,
    }),
    "Date",
  );

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(4);
  const startsQuestion = formQuestion(form, 3);
  await expect(startsQuestion).toBeVisible();
  await startsQuestion
    .getByLabel("Question", { exact: true })
    .fill("Starts at");
  await startsQuestion
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("existing");
  await selectOptionContaining(
    startsQuestion.getByRole("combobox", {
      name: "Existing property",
      exact: true,
    }),
    "Starts at",
  );

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(5);
  const statusQuestion = formQuestion(form, 4);
  await expect(statusQuestion).toBeVisible();
  await statusQuestion.getByLabel("Question", { exact: true }).fill("Status");
  await statusQuestion
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("existing");
  await selectOptionContaining(
    statusQuestion.getByRole("combobox", {
      name: "Existing property",
      exact: true,
    }),
    "Status",
  );

  const customerConnection = form.getByRole("combobox", {
    name: "Customer connection",
    exact: true,
  });
  await expect(customerConnection).toBeVisible();
  await selectOptionContaining(customerConnection, "Customer");
  const mappings = form.locator(".site-form-customer-mappings");
  await expect(mappings).toBeVisible();

  const nameMapping = mappings
    .locator("label")
    .filter({ hasText: /^Name/ })
    .getByRole("combobox");
  const emailMapping = mappings
    .locator("label")
    .filter({ hasText: /^Email/ })
    .getByRole("combobox");
  await expect(nameMapping).toBeVisible();
  await expect(emailMapping).toBeVisible();
  await nameMapping.selectOption({ label: "Customer name" });
  await emailMapping.selectOption({ label: "Customer email" });
  await expect(nameMapping.locator("option:checked")).toHaveText(
    "Customer name",
  );
  await expect(emailMapping.locator("option:checked")).toHaveText(
    "Customer email",
  );

  await customerConnection.focus();
  await expect(customerConnection).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(customerConnection).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    form.getByRole("combobox", {
      name: "Customer email property",
      exact: true,
    }),
  ).toBeFocused();

  await expect(
    form.getByText("Ready to publish", { exact: true }),
  ).toBeVisible();
  await captureResponsiveEvidence(page, "owner-customer-form-connection");

  await form.getByRole("button", { name: "Add to Home", exact: true }).click();
  const saveDraft = page.getByRole("button", {
    name: "Save draft",
    exact: true,
  });
  await expect(saveDraft).toBeVisible();
  await saveDraft.click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
}

async function submitCustomerForm(
  browser: Browser,
  page: Page,
  businessSlug: string,
  input: Readonly<{
    name: string;
    email: string;
    date: string;
    startsAt: string;
  }>,
  evidencePrefix?: string,
): Promise<void> {
  const context = await browser.newContext();
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  const visitor = await context.newPage();
  await visitor.route("https://jamp.io/**", (route) => route.abort());
  try {
    await visitor.goto(
      new URL("/p/" + businessSlug + "/home", page.url()).toString(),
    );
    const publicForm = visitor.locator("section.site-public-form");
    await expect(publicForm).toBeVisible();
    await expect(
      publicForm.getByRole("heading", { name: formName, exact: true }),
    ).toBeVisible();
    if (evidencePrefix) {
      await captureResponsiveEvidence(visitor, evidencePrefix);
    }
    const customerName = publicForm.getByRole("textbox", {
      name: "Customer name",
      exact: true,
    });
    const customerEmail = publicForm.getByRole("textbox", {
      name: "Customer email",
      exact: true,
    });
    const date = publicForm.getByLabel(/^Date\s*\*?$/);
    const startsAt = publicForm.getByLabel(/^Starts at\s*\*?$/);
    const status = publicForm.getByRole("combobox", {
      name: "Status",
      exact: true,
    });
    const submit = publicForm.getByRole("button", {
      name: submitLabel,
      exact: true,
    });
    await expect(customerName).toBeVisible();
    await expect(customerEmail).toBeVisible();
    await expect(date).toBeVisible();
    await expect(startsAt).toBeVisible();
    await expect(status).toBeVisible();
    await expect(submit).toBeVisible();
    await customerName.fill(input.name);
    await customerEmail.fill(input.email);
    await date.fill(input.date);
    await startsAt.fill(input.startsAt);
    await status.selectOption({ label: "Booked" });
    await submit.click();
    await expect(publicForm.getByRole("status")).toContainText(
      "Thanks. Your reference is",
    );
  } finally {
    await context.close();
  }
}

async function openWorkspaceDestination(
  page: Page,
  businessSlug: string,
  label: string,
): Promise<void> {
  await page.goto("/app/" + businessSlug);
  const destination = page.getByRole("link", { name: label, exact: true });
  await expect(destination).toBeVisible();
  await destination.click();
  await page.waitForURL(
    new RegExp("/app/" + businessSlug + "/workspace/[^/?#]+(?:\\?.*)?$"),
  );
}

async function inspectAppointmentRecord(
  page: Page,
  input: Readonly<{
    dateLabel: string;
    name: string;
    email: string;
  }>,
): Promise<void> {
  const row = page.getByRole("row").filter({
    has: page.getByRole("gridcell", { name: input.dateLabel, exact: true }),
  });
  await expect(row).toHaveCount(1);
  const openRecord = row.getByRole("button", {
    name: "Open record",
    exact: true,
  });
  await expect(openRecord).toBeVisible();
  await openRecord.click();

  const panel = page.getByRole("dialog", {
    name: "Appointments record",
    exact: true,
  });
  await expect(panel).toBeVisible();

  const expectProperty = async (
    label: string,
    value: string,
  ): Promise<void> => {
    const property = panel.locator(".editor-record-property").filter({
      has: page
        .locator(".editor-record-property-label")
        .filter({ hasText: new RegExp("^" + label + "$") }),
    });
    await expect(property).toHaveCount(1);
    await expect(
      property.locator(".editor-record-property-value"),
    ).toContainText(value);
  };

  await expectProperty("Customer name", input.name);
  await expectProperty("Customer email", input.email);
  await expectProperty("Date", input.dateLabel);
  await expectProperty("Status", "Booked");
  await expect(
    panel.getByRole("button", { name: "Close record panel", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Close record panel", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
}

async function createDuplicateCustomer(
  page: Page,
  businessSlug: string,
): Promise<void> {
  await openWorkspaceDestination(page, businessSlug, "Customers");
  await page.setViewportSize({ width: 390, height: 844 });
  const newCustomer = page.getByRole("button", {
    name: "New customer",
    exact: true,
  });
  await expect(newCustomer).toBeVisible();
  await newCustomer.click();
  const createRecord = page.locator("form.editor-mobile-create");
  await expect(createRecord).toBeVisible();
  await createRecord
    .getByLabel("New record name", { exact: true })
    .fill(reviewCustomerName);
  await createRecord
    .getByRole("button", { name: "Add record", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Added " + reviewCustomerName,
  );
  const openRecord = page.getByRole("button", {
    name: "Open record " + reviewCustomerName,
    exact: true,
  });
  await expect(openRecord).toBeVisible();
  await openRecord.click();
  const recordPanel = page.locator(".editor-record-panel");
  await expect(recordPanel).toBeVisible();
  const editEmail = recordPanel.getByRole("button", {
    name: "Edit Email",
    exact: true,
  });
  await expect(editEmail).toBeVisible();
  await editEmail.click();
  const emailInput = recordPanel.getByRole("textbox", {
    name: "Edit Email",
    exact: true,
  });
  await expect(emailInput).toBeVisible();
  await emailInput.fill(sharedEmail);
  await emailInput.press("Enter");
  await expect(page.locator(".editor-save-state")).toContainText("Saved");
  const closeRecord = recordPanel.getByRole("button", {
    name: "Close record panel",
    exact: true,
  });
  await expect(closeRecord).toBeVisible();
  await closeRecord.click();
  await expect(recordPanel).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("owner connects a public Form to Customers and preserves review relinks", async ({
  page,
  pagesProof,
}) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);
  await setupBooking(page, business.slug);

  await createSiteDraft(page, business.slug);
  await page
    .getByRole("button", { name: "Start with a Form", exact: true })
    .click();
  await configureCustomerForm(page);

  const preview = page.getByRole("button", { name: "Preview", exact: true });
  await expect(preview).toBeVisible();
  await preview.click();
  await page.waitForURL(
    new RegExp("/app/" + business.slug + "/sites\\?candidate=[^&]+$"),
  );
  const sitePreview = page.getByRole("region", {
    name: "Site preview",
    exact: true,
  });
  await expect(sitePreview).toBeVisible();
  const publish = page.getByRole("button", { name: "Publish", exact: true });
  await expect(publish).toBeVisible();
  await publish.click();
  await page.waitForURL(
    new RegExp("/app/" + business.slug + "/sites\\?notice=published$"),
  );

  const browser = page.context().browser();
  if (!browser) {
    throw new Error("The Customer connection proof needs a browser context.");
  }

  await submitCustomerForm(
    browser,
    page,
    business.slug,
    {
      name: originalCustomerName,
      email: sharedEmail,
      date: "2026-10-15",
      startsAt: "2026-10-15T09:00",
    },
    "anonymous-customer-form",
  );
  await submitCustomerForm(browser, page, business.slug, {
    name: changedCustomerName,
    email: "SHARED.CUSTOMER@EXAMPLE.TEST",
    date: "2026-10-16",
    startsAt: "2026-10-16T10:00",
  });

  await openWorkspaceDestination(page, business.slug, "Appointments");
  const appointmentsGrid = page.getByRole("grid", {
    name: "Appointments editor",
    exact: true,
  });
  await expect(
    appointmentsGrid
      .locator(".editor-table-connection-value")
      .filter({ hasText: originalCustomerName }),
  ).toHaveCount(2);
  await inspectAppointmentRecord(page, {
    dateLabel: "15 Oct 2026",
    name: originalCustomerName,
    email: sharedEmail,
  });
  await inspectAppointmentRecord(page, {
    dateLabel: "16 Oct 2026",
    name: changedCustomerName,
    email: "SHARED.CUSTOMER@EXAMPLE.TEST",
  });
  await captureResponsiveEvidence(page, "owner-appointment-activity");

  await openWorkspaceDestination(page, business.slug, "Customers");
  await expect(
    page.getByText(originalCustomerName, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(sharedEmail, { exact: true })).toBeVisible();
  await expect(
    page.getByText(changedCustomerName, { exact: true }),
  ).toHaveCount(0);
  await captureResponsiveEvidence(page, "owner-customer-records");

  await createDuplicateCustomer(page, business.slug);
  await submitCustomerForm(browser, page, business.slug, {
    name: "Ambiguous visitor",
    email: "shared.customer@example.test",
    date: "2026-10-17",
    startsAt: "2026-10-17T11:00",
  });

  await page.goto("/app/" + business.slug + "/sites");
  const review = page.getByRole("region", {
    name: "Customer review",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(
    review.getByRole("heading", {
      name: "Check possible duplicate Customers",
      exact: true,
    }),
  ).toBeVisible();
  await captureResponsiveEvidence(page, "owner-customer-review");

  const customerChoice = review.getByRole("combobox", {
    name: "Existing Customer",
    exact: true,
  });
  await expect(customerChoice).toBeVisible();
  const reviewCustomerValue = await optionValueContaining(
    customerChoice,
    reviewCustomerName,
  );
  await customerChoice.focus();
  await expect(customerChoice).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(customerChoice).toBeFocused();
  await customerChoice.selectOption(reviewCustomerValue);
  const saveCustomerChoice = review.getByRole("button", {
    name: "Save Customer choice",
    exact: true,
  });
  await expect(saveCustomerChoice).toBeVisible();
  await saveCustomerChoice.click();
  await page.waitForURL(
    new RegExp("/app/" + business.slug + "/sites\\?notice=customer_reviewed$"),
  );
  await expect(
    page.getByText("Customer choice saved.", { exact: true }),
  ).toBeVisible();

  await page.reload();
  const reviewAfterReload = page.getByRole("region", {
    name: "Customer review",
    exact: true,
  });
  await expect(reviewAfterReload).toBeVisible();
  await expect(
    reviewAfterReload.getByRole("combobox", {
      name: "Existing Customer",
      exact: true,
    }),
  ).toHaveValue(reviewCustomerValue);
});
