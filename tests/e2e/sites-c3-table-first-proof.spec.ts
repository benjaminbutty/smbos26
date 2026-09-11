import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";
import { experiencePathToKey } from "../../src/runtime/routing";

const tableName = "Feedback";
const formName = "Feedback registration";
const nameQuestion = "Your name";
const initialFollowUpQuestion = "Would you like a follow-up?";
const followUpQuestion = "Would you like a follow-up call?";
const initialCommentQuestion = "What should we know?";
const updatedCommentQuestion = "What should we know before the event?";
const submitLabel = "Submit feedback";

async function createWorkspaceTable(
  page: Page,
  businessSlug: string,
  name: string,
): Promise<string> {
  await page.goto(`/app/${businessSlug}`);
  await page
    .getByRole("button", { name: "Create Table", exact: true })
    .first()
    .click();
  const createForm = page.locator("form.sidebar-create-form");
  await createForm.getByLabel("Table name").fill(name);
  await createForm
    .getByRole("button", { name: "Create Table", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(
      `/app/${businessSlug}/workspace/[^/?#]+[?]message=Table%20created&undoVersion=.+$`,
    ),
  );
  const viewMatch = new URL(page.url()).pathname.match(/\/workspace\/([^/]+)$/);
  if (!viewMatch?.[1]) {
    throw new Error(`Could not identify the ${name} Table View.`);
  }
  return experiencePathToKey(viewMatch[1]);
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
    new RegExp(`/app/${businessSlug}/sites[?]notice=created$`),
  );
}

function formCard(page: Page): Locator {
  return page.locator(".site-form-card").first();
}

async function optionValueContaining(
  select: Locator,
  text: string,
): Promise<string> {
  const value = await select
    .locator("option")
    .evaluateAll(
      (options, needle) =>
        (
          options.find((option) => option.textContent?.includes(needle)) as
            HTMLOptionElement | undefined
        )?.value ?? null,
      text,
    );
  if (!value) {
    throw new Error(`Could not find an option containing ${text}.`);
  }
  return value;
}

async function composeExistingTableForm(
  page: Page,
  existingViewKey: string,
): Promise<void> {
  const form = formCard(page);
  await expect(form).toHaveCount(1);
  await form.getByLabel("Form name", { exact: true }).fill(formName);
  await form
    .getByRole("combobox", { name: "Save responses in", exact: true })
    .selectOption("existing");

  const tableSelect = form.getByRole("combobox", {
    name: "Table",
    exact: true,
  });
  await tableSelect.selectOption(
    await optionValueContaining(tableSelect, tableName),
  );
  await form
    .getByRole("combobox", { name: "Table View", exact: true })
    .selectOption("existing");
  await form
    .getByRole("combobox", { name: "Existing Table View", exact: true })
    .selectOption(existingViewKey);
  await form.getByLabel("Button label", { exact: true }).fill(submitLabel);

  const firstQuestion = form.locator(".site-form-question").first();
  await firstQuestion
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("existing");
  const existingProperty = firstQuestion.getByRole("combobox", {
    name: "Existing property",
    exact: true,
  });
  await existingProperty.selectOption(
    await optionValueContaining(existingProperty, "Name"),
  );
  await firstQuestion
    .getByLabel("Question", { exact: true })
    .fill(nameQuestion);

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(2);
  const followUp = form.locator(".site-form-question").nth(1);
  await followUp
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("new");
  await followUp
    .getByLabel("Question", { exact: true })
    .fill(initialFollowUpQuestion);
  await followUp
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("boolean");

  await form.getByRole("button", { name: "Add question", exact: true }).click();
  await expect(form.locator(".site-form-question")).toHaveCount(3);
  const comment = form.locator(".site-form-question").nth(2);
  await comment
    .getByRole("combobox", { name: "Property source", exact: true })
    .selectOption("new");
  await comment
    .getByLabel("Question", { exact: true })
    .fill(initialCommentQuestion);
  await comment
    .getByRole("combobox", { name: "Answer type", exact: true })
    .selectOption("long_text");
  await comment
    .getByRole("combobox", {
      name: "Show when earlier answer is",
      exact: true,
    })
    .selectOption({ label: initialFollowUpQuestion });
  await comment
    .getByRole("combobox", { name: "Answer", exact: true })
    .selectOption({ label: "Yes" });

  await expect(
    form.getByText("Ready to publish", { exact: true }),
  ).toBeVisible();
  await form.getByRole("button", { name: "Add to Home", exact: true }).click();
}

async function captureFormStates(page: Page): Promise<void> {
  const originalViewport = page.viewportSize() ?? {
    width: 1440,
    height: 900,
  };
  try {
    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 834, height: 1112 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        fullPage: true,
        path: test
          .info()
          .outputPath(
            `table-first-owner-form-${viewport.name}-${viewport.width}x${viewport.height}.png`,
          ),
      });
    }
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

function isDraftSaveResponse(
  response: {
    url(): string;
    status(): number;
    request(): { method(): string };
  },
  businessSlug: string,
): boolean {
  return (
    response.request().method() === "POST" &&
    response.url().includes(`/api/app/${businessSlug}/sites/draft`) &&
    response.status() === 200
  );
}

test("Table-first Site Form keeps its destination through a reviewed release", async ({
  page,
  pagesProof,
}) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);
  const existingViewKey = await createWorkspaceTable(
    page,
    business.slug,
    tableName,
  );

  await createSiteDraft(page, business.slug);
  await page
    .getByRole("button", { name: "Start with a Form", exact: true })
    .click();
  await composeExistingTableForm(page, existingViewKey);

  const form = formCard(page);
  const formToggle = form.locator(".site-form-toggle");
  await formToggle.focus();
  await page.keyboard.press("Space");
  await expect(formToggle).toHaveAccessibleName("Edit form");
  await expect(form.getByLabel("Form name", { exact: true })).toBeHidden();
  await expect(formToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(formToggle).toHaveAccessibleName("Collapse form");
  await expect(formToggle).toBeFocused();

  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();

  const savedFollowUp = page
    .locator(".site-form-question")
    .nth(1)
    .getByLabel("Question", { exact: true });
  const autosave = page.waitForResponse((response) =>
    isDraftSaveResponse(response, business.slug),
  );
  await savedFollowUp.fill(followUpQuestion);
  await autosave;
  await expect(
    page.getByText("Saved automatically", { exact: true }),
  ).toBeVisible();
  await page.reload();

  const reloadedForm = formCard(page);
  await expect(
    reloadedForm
      .locator(".site-form-question")
      .nth(1)
      .getByLabel("Question", { exact: true }),
  ).toHaveValue(followUpQuestion);
  await expect(
    reloadedForm.getByRole("combobox", {
      name: "Existing Table View",
      exact: true,
    }),
  ).toHaveValue(existingViewKey);
  await expect(
    reloadedForm.getByText("Placed on 1 Page block.", { exact: true }),
  ).toBeVisible();
  await captureFormStates(page);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites[?]candidate=[^&]+$`),
  );
  await expect(
    page.getByRole("region", { name: "Site preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites[?]notice=published$`),
  );

  const browser = page.context().browser();
  if (!browser) throw new Error("The Sites proof needs a browser context.");
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.route("https://jamp.io/**", (route) => route.abort());
  const publicURL = new URL(`/p/${business.slug}/home`, page.url()).toString();

  try {
    await visitor.goto(publicURL);
    const publicForm = visitor.locator("section.site-public-form");
    await expect(
      publicForm.getByRole("heading", { name: formName, exact: true }),
    ).toBeVisible();
    const visitorName = publicForm.getByRole("textbox", {
      name: nameQuestion,
      exact: true,
    });
    const visitorFollowUp = publicForm.getByRole("combobox", {
      name: followUpQuestion,
      exact: true,
    });
    const visitorComment = publicForm.getByRole("textbox", {
      name: initialCommentQuestion,
      exact: true,
    });
    await expect(visitorComment).toBeHidden();
    await visitorName.fill("Alex Morgan");
    await visitorFollowUp.selectOption({ label: "Yes" });
    await expect(visitorComment).toBeVisible();
    await visitorComment.fill("Please send registration details.");

    await page.goto(`/app/${business.slug}/sites`);
    const draftForm = formCard(page);
    const draftComment = draftForm
      .locator(".site-form-question")
      .nth(2)
      .getByLabel("Question", { exact: true });
    const draftSave = page.waitForResponse((response) =>
      isDraftSaveResponse(response, business.slug),
    );
    await draftComment.fill(updatedCommentQuestion);
    await draftSave;
    await expect(
      page.getByText("Saved automatically", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      formCard(page)
        .locator(".site-form-question")
        .nth(2)
        .getByLabel("Question", { exact: true }),
    ).toHaveValue(updatedCommentQuestion);

    const freshVisitor = await visitorContext.newPage();
    await freshVisitor.route("https://jamp.io/**", (route) => route.abort());
    try {
      await freshVisitor.goto(publicURL);
      const freshPublicForm = freshVisitor.locator("section.site-public-form");
      await freshPublicForm
        .getByRole("combobox", {
          name: followUpQuestion,
          exact: true,
        })
        .selectOption({ label: "Yes" });
      await expect(
        freshPublicForm.getByRole("textbox", {
          name: initialCommentQuestion,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        freshPublicForm.getByRole("textbox", {
          name: updatedCommentQuestion,
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await freshVisitor.close();
    }

    await expect(visitorComment).toBeVisible();
    await expect(visitorComment).toHaveValue(
      "Please send registration details.",
    );
    await expect(
      publicForm.getByRole("textbox", {
        name: updatedCommentQuestion,
        exact: true,
      }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForURL(
      new RegExp(`/app/${business.slug}/sites[?]candidate=[^&]+$`),
    );
    await expect(
      page.getByRole("region", { name: "Site preview" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.waitForURL(
      new RegExp(`/app/${business.slug}/sites[?]notice=published$`),
    );

    await publicForm
      .getByRole("button", { name: submitLabel, exact: true })
      .click();
    await expect(
      publicForm.getByRole("button", {
        name: "Review latest Form",
        exact: true,
      }),
    ).toBeVisible();
    await publicForm
      .getByRole("button", { name: "Review latest Form", exact: true })
      .click();
    await expect(
      publicForm.getByRole("button", {
        name: "I’ve reviewed the latest Form",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      publicForm.getByRole("textbox", {
        name: updatedCommentQuestion,
        exact: true,
      }),
    ).toHaveValue("Please send registration details.");
    await expect(visitorName).toHaveValue("Alex Morgan");
    await expect(visitorFollowUp).toHaveValue("true");
    await publicForm
      .getByRole("button", {
        name: "I’ve reviewed the latest Form",
        exact: true,
      })
      .click();
    const submit = publicForm.getByRole("button", {
      name: submitLabel,
      exact: true,
    });
    await expect(submit).toBeEnabled();
    await submit.focus();
    await expect(submit).toBeFocused();
    await visitor.keyboard.press("Enter");
    await expect(publicForm.getByRole("status")).toContainText("Thanks. Your");
  } finally {
    await visitorContext.close();
  }

  await page.goto(`/app/${business.slug}`);
  const destination = page.getByRole("link", {
    name: `Open ${tableName}`,
    exact: true,
  });
  await expect(destination).toBeVisible();
  await destination.click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/workspace/[^/?#]+(?:[?].*)?$`),
  );
  const openRecord = page.locator('button[aria-label^="Open record "]').first();
  await expect(openRecord).toBeVisible();
  await openRecord.click();
  const recordPanel = page.locator(".editor-record-panel");
  await expect(recordPanel).toBeVisible();
  await recordPanel
    .getByRole("link", { name: "Open full record", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/workspace/[^/?#]+/[^/?#]+(?:\\?.*)?$`),
  );
  const detailField = (label: string): Locator =>
    page.locator(".detail-grid > div").filter({
      has: page.locator("dt").filter({ hasText: label }),
    });
  const nameField = detailField("Name");
  const followUpField = detailField(followUpQuestion);
  const commentField = detailField(initialCommentQuestion);
  await expect(nameField.locator("dt")).toHaveText("Name");
  await expect(nameField.locator("dd")).toContainText("Alex Morgan");
  await expect(followUpField.locator("dt")).toHaveText(followUpQuestion);
  await expect(followUpField.locator("dd")).toHaveText("Yes");
  await expect(commentField.locator("dt")).toHaveText(initialCommentQuestion);
  await expect(commentField.locator("dd")).toContainText(
    "Please send registration details.",
  );
});
