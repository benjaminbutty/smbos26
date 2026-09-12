import type { Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { expect, test } from "./support/pages-proof-fixture";
import type { Database } from "../../src/db/supabase/database.types";

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

type LegacyFixtureCredentials = Readonly<{
  email: string;
  password: string;
}>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the isolated Page browser proof.`);
  }
  return value;
}

async function readServedImage(
  page: Page,
  image: Locator,
): Promise<{ source: string; bytes: Buffer }> {
  await expect
    .poll(() =>
      image.evaluate((element) =>
        element instanceof HTMLImageElement && element.complete
          ? element.naturalWidth
          : 0,
      ),
    )
    .toBeGreaterThan(0);
  const source = await image.getAttribute("src");
  if (!source) throw new Error("The released Site image had no source URL.");
  const response = await page.request.get(
    new URL(source, page.url()).toString(),
  );
  expect(response.status()).toBe(200);
  return { source, bytes: await response.body() };
}

async function seedLegacyPublicPage(
  businessId: string,
  credentials: LegacyFixtureCredentials,
): Promise<void> {
  const client = createClient<Database>(
    requiredEnvironment("SMBOS_PAGES_PROOF_API_URL"),
    requiredEnvironment("SMBOS_PAGES_PROOF_PUBLISHABLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const signedIn = await client.auth.signInWithPassword(credentials);
  if (signedIn.error || !signedIn.data.user) {
    throw (
      signedIn.error ?? new Error("Could not sign in the legacy fixture owner.")
    );
  }

  try {
    const actorId = signedIn.data.user.id;
    const head = await client
      .from("business_configuration_heads")
      .select("active_version_id,head_revision")
      .eq("business_id", businessId)
      .maybeSingle();
    if (head.error || !head.data) {
      throw (
        head.error ??
        new Error("Could not load the legacy fixture configuration head.")
      );
    }

    const proposal = await client.rpc("propose_configuration_change", {
      expected_business_id: businessId,
      expected_actor_id: actorId,
      expected_base_version_id: head.data.active_version_id,
      expected_head_revision: head.data.head_revision,
      requested_title: "Seed legacy public Page for Sites proof",
      requested_description: "CI fixture state for legacy Sites adoption.",
      requested_operations: [
        {
          op: "set_page",
          key: "legacy_content_proof",
          title: "Legacy welcome",
          slug: "legacy-content-proof",
          audience: "public",
          layout_json: {
            blocks: [
              {
                id: crypto.randomUUID(),
                type: "heading",
                text: "Legacy welcome",
                level: 1,
              },
              {
                id: crypto.randomUUID(),
                type: "text",
                text: "This content belongs to the legacy Page.",
              },
            ],
          },
          status: "published",
          is_active: true,
        },
      ],
    });
    if (proposal.error || !proposal.data) {
      throw (
        proposal.error ??
        new Error("Could not propose the legacy fixture Page.")
      );
    }
    if (proposal.data.status !== "proposed") {
      throw new Error(`Legacy fixture proposal was ${proposal.data.status}.`);
    }

    const validated = await client.rpc("validate_configuration_change", {
      expected_business_id: businessId,
      expected_actor_id: actorId,
      requested_change_set_id: proposal.data.id,
    });
    if (validated.error || !validated.data) {
      throw (
        validated.error ??
        new Error("Could not validate the legacy fixture Page.")
      );
    }
    if (validated.data.status !== "validated") {
      throw new Error(
        `Legacy fixture validation was ${validated.data.status}.`,
      );
    }

    const applied = await client.rpc("apply_configuration_change", {
      expected_business_id: businessId,
      expected_actor_id: actorId,
      requested_change_set_id: proposal.data.id,
    });
    if (applied.error || !applied.data) {
      throw (
        applied.error ?? new Error("Could not apply the legacy fixture Page.")
      );
    }
    if (applied.data.status !== "applied") {
      throw new Error(`Legacy fixture application was ${applied.data.status}.`);
    }
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}

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
  const initialServedImage = await readServedImage(page, releasedImage);

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
  await expect(recordPanel).toHaveCount(0);
  const updatedRecordRow = page.locator('[role="row"]').filter({
    has: page.getByRole("button", {
      name: `Open record ${updatedRecordName}`,
      exact: true,
    }),
  });
  const updatedRecordNameCell = updatedRecordRow.locator(
    '[role="gridcell"][aria-colindex="2"]',
  );
  await expect(updatedRecordRow).toHaveCount(1);
  await expect(updatedRecordNameCell).toBeFocused();

  await page.goto(`/app/${business.slug}/sites`);
  const updatedHome = await selectSitePage(page, "Home");
  const updatedCollectionCanvas = updatedHome
    .locator(".site-composer-canvas-block-type")
    .filter({ hasText: /^Collection$/ })
    .locator("..");
  await expect(updatedCollectionCanvas).toHaveCount(1);
  await updatedCollectionCanvas.click();
  const updatedCollection = updatedHome
    .locator(
      ".site-composer-inspector .site-composer-block:has(> .site-composer-collection-fields select)",
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
  const unchangedServedImage = await readServedImage(page, stillReleasedImage);
  expect(unchangedServedImage.source).toBe(initialServedImage.source);
  expect(unchangedServedImage.bytes).toEqual(initialServedImage.bytes);

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
  const republishedServedImage = await readServedImage(page, republishedImage);
  expect(republishedServedImage.source).not.toBe(initialServedImage.source);
  expect(republishedServedImage.bytes).not.toEqual(initialServedImage.bytes);
});

test("legacy public content keeps its address through Site adoption", async ({
  page,
  pagesProof,
}) => {
  const business = await pagesProof.createBusinessThroughOwnerUi(page);
  const legacyPath = `/p/${business.slug}/legacy-content-proof`;

  await seedLegacyPublicPage(business.id, {
    email: pagesProof.email,
    password: pagesProof.password,
  });

  await page.goto(`/app/${business.slug}/sites`);
  await page.getByRole("button", { name: "Create Site draft" }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=created$`),
  );
  await page.reload();
  const adoptionPanel = page.locator(".site-adoption-panel");
  await expect(adoptionPanel).toBeVisible();
  await adoptionPanel
    .getByRole("button", { name: "Bring Pages into this Site", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=adopted$`),
  );

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  const initialCandidate = page.getByRole("region", { name: "Site preview" });
  await expect(
    initialCandidate
      .locator(".site-public-layout")
      .getByText("This content belongs to the legacy Page.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );

  await page.goto(legacyPath);
  await expect(
    page
      .locator(".site-public-layout")
      .getByText("This content belongs to the legacy Page.", { exact: true }),
  ).toBeVisible();

  await page.goto(`/app/${business.slug}/sites`);
  const adoptedPage = await selectSitePage(page, "Legacy welcome");
  const adoptedCanvas = adoptedPage.locator(".site-composer-canvas-block");
  await expect(adoptedCanvas).toHaveCount(2);
  await adoptedCanvas.first().click();
  const adoptedHeading = adoptedPage
    .locator(".site-composer-inspector .site-composer-block")
    .getByRole("textbox")
    .first();
  await expect(adoptedHeading).toHaveValue("Legacy welcome");
  const autosave = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/app/${business.slug}/sites/draft`) &&
      response.status() === 200,
  );
  await adoptedHeading.fill("Updated adopted welcome");
  await autosave;
  await saveSiteDraft(page);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?candidate=[^&]+$`),
  );
  const editedCandidate = page.getByRole("region", { name: "Site preview" });
  await expect(
    editedCandidate
      .locator(".site-public-layout")
      .getByText("Updated adopted welcome", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=published$`),
  );

  await page.goto(legacyPath);
  const liveLayout = page.locator(".site-public-layout");
  await expect(
    liveLayout.getByText("Updated adopted welcome", { exact: true }),
  ).toBeVisible();
  await expect(
    liveLayout.getByText("Legacy welcome", { exact: true }),
  ).toHaveCount(0);

  await page.goto(`/app/${business.slug}/sites`);
  await page
    .getByRole("button", { name: "Unpublish Site", exact: true })
    .click();
  await page.waitForURL(
    new RegExp(`/app/${business.slug}/sites\\?notice=unpublished$`),
  );
  const unpublished = await page.request.get(legacyPath);
  expect(unpublished.status()).toBe(404);
});
