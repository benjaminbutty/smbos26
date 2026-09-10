import type { Browser, Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./support/pages-proof-fixture";

const firstHeading = "Browser proof first heading";
const secondHeading = "Browser proof second heading";
const firstParagraph = "Browser proof first paragraph";
const secondParagraph = "Browser proof second paragraph";
const imageDescription = "A one pixel browser proof image";

type ImageInsertionHooks = {
  beforeFileSelection?: () => Promise<void> | void;
  afterFileSelection?: () => Promise<void> | void;
};

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

async function captureDesktopAndTablet(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const states = [
    { name: "page-1440x900.png", width: 1440, height: 900 },
    { name: "page-1024x768.png", width: 1024, height: 768 },
  ];

  for (const state of states) {
    await page.setViewportSize({ width: state.width, height: state.height });
    await expectSatoshi(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(state.name),
    });
  }
}

async function blockId(block: Locator): Promise<string> {
  const blockId = await block.getAttribute("blockid");
  if (!blockId) {
    throw new Error("The Page block did not expose its persisted identity.");
  }
  return blockId;
}

async function visibleEditor(page: Page): Promise<Locator> {
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  return editor;
}

async function clearEditorCommand(page: Page, editor: Locator): Promise<void> {
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
}

async function editorCaretReadiness(editor: Locator): Promise<{
  editorFocused: boolean;
  selectionCollapsed: boolean;
  selectionWithinLastParagraph: boolean;
  atParagraphEnd: boolean;
}> {
  return editor.evaluate((element) => {
    const editorFocused =
      element instanceof HTMLElement &&
      element.isContentEditable &&
      document.activeElement === element;
    const selection = window.getSelection();
    const selectionCollapsed = Boolean(
      selection && selection.rangeCount > 0 && selection.isCollapsed,
    );
    const paragraphs =
      element instanceof HTMLElement
        ? Array.from(element.children).filter(
            (child): child is HTMLParagraphElement =>
              child instanceof HTMLParagraphElement,
          )
        : [];
    const lastParagraph = paragraphs.at(-1);
    const selectionWithinLastParagraph = Boolean(
      selectionCollapsed &&
      lastParagraph &&
      selection?.anchorNode &&
      selection.focusNode &&
      lastParagraph.contains(selection.anchorNode) &&
      lastParagraph.contains(selection.focusNode),
    );

    if (!selectionWithinLastParagraph || !lastParagraph || !selection) {
      return {
        editorFocused,
        selectionCollapsed,
        selectionWithinLastParagraph,
        atParagraphEnd: false,
      };
    }
    const focusNode = selection.focusNode;
    if (!focusNode) {
      return {
        editorFocused,
        selectionCollapsed,
        selectionWithinLastParagraph,
        atParagraphEnd: false,
      };
    }

    // An empty paragraph is rendered with ProseMirror's trailing <br>. Its
    // collapsed caret inside the paragraph is the meaningful end position.
    if (!lastParagraph.textContent) {
      return {
        editorFocused,
        selectionCollapsed,
        selectionWithinLastParagraph,
        atParagraphEnd: true,
      };
    }

    const remainingText = document.createRange();
    remainingText.selectNodeContents(lastParagraph);
    remainingText.setStart(focusNode, selection.focusOffset);
    return {
      editorFocused,
      selectionCollapsed,
      selectionWithinLastParagraph,
      atParagraphEnd: remainingText.toString() === "",
    };
  });
}

async function insertBlock(
  page: Page,
  editor: Locator,
  command: string,
  text?: string,
): Promise<void> {
  await expect(editor).toBeFocused();
  await editor.pressSequentially(command);
  const menu = page.getByRole("listbox", { name: "Insert into Page" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Enter");
  if (text) await editor.pressSequentially(text);
}

async function nativeMoveFirstHeadingAfterSecond(page: Page): Promise<void> {
  const first = page.getByRole("heading", { name: firstHeading, exact: true });
  const second = page.getByRole("heading", {
    name: secondHeading,
    exact: true,
  });
  await first.hover();
  const handle = page.getByLabel("Drag this block or open block actions");
  await expect(handle).toBeVisible();

  const handleBox = await handle.boundingBox();
  const destinationBox = await second.boundingBox();
  if (!handleBox || !destinationBox) {
    throw new Error("The Page block drag targets were not measurable.");
  }

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    destinationBox.x + destinationBox.width / 2,
    destinationBox.y + destinationBox.height + 8,
    { steps: 12 },
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const firstBox = await first.boundingBox();
      const secondBox = await second.boundingBox();
      return firstBox && secondBox ? firstBox.y > secondBox.y : false;
    })
    .toBe(true);
}

async function keyboardMoveFirstHeadingUp(page: Page): Promise<void> {
  const first = page.getByRole("heading", { name: firstHeading, exact: true });
  const second = page.getByRole("heading", {
    name: secondHeading,
    exact: true,
  });
  await first.click();
  const keyboardActions = page.getByRole("button", {
    name: "Open actions for the current block",
  });
  await keyboardActions.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Block actions" });
  const moveUp = menu.getByRole("menuitem", { name: "Move up", exact: true });
  await expect(menu).toBeVisible();

  for (let index = 0; index < 8; index += 1) {
    if (
      await moveUp.evaluate((element) => element === document.activeElement)
    ) {
      break;
    }
    await page.keyboard.press("Shift+Tab");
  }
  await expect(moveUp).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => {
      const firstBox = await first.boundingBox();
      const secondBox = await second.boundingBox();
      return firstBox && secondBox ? firstBox.y < secondBox.y : false;
    })
    .toBe(true);
}

/**
 * BubbleMenu intentionally appears only for a ProseMirror TextSelection. Use a
 * bounded character selection to keep the link range editable on both desktop
 * Chromium and touch emulation. Select-all constructs an AllSelection and is
 * not an editable link range; character steps also avoid relying on a desktop
 * word-navigation shortcut that mobile keyboards do not expose.
 */
async function selectHeadingTextForLink(
  page: Page,
  heading: Locator,
): Promise<void> {
  await heading.click();
  await page.keyboard.press("End");
  for (let index = 0; index < 5; index += 1) {
    await page.keyboard.press("Shift+ArrowLeft");
  }

  const selectedText = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selectedText).toMatch(/\S/);
  expect(firstHeading).toContain(selectedText.trim());
}

async function verifyTransientDismissal(
  page: Page,
  editor: Locator,
): Promise<void> {
  const pageName = page.getByLabel("Page name");
  const first = page.getByRole("heading", { name: firstHeading, exact: true });
  const blockActions = page.getByLabel("Drag this block or open block actions");

  await first.hover();
  await expect(blockActions).toBeVisible();
  await blockActions.click();
  const blockMenu = page.getByRole("menu", { name: "Block actions" });
  await expect(blockMenu).toBeVisible();
  await blockMenu.getByRole("menuitem", { name: "Move down" }).focus();
  await page.keyboard.press("Escape");
  await expect(blockMenu).toBeHidden();
  await expect(blockActions).toBeFocused();

  await first.hover();
  await expect(blockActions).toBeVisible();
  await blockActions.click();
  await expect(blockMenu).toBeVisible();
  await pageName.click();
  await expect(blockMenu).toBeHidden();
  await expect(pageName).toBeFocused();

  await selectHeadingTextForLink(page, first);
  await page.getByLabel("Add or edit link").click();
  const linkDialog = page.getByRole("dialog", { name: "Add or edit link" });
  await expect(linkDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(linkDialog).toBeHidden();
  await expect(editor).toBeFocused();

  await selectHeadingTextForLink(page, first);
  await page.getByLabel("Add or edit link").click();
  await expect(linkDialog).toBeVisible();
  await pageName.click();
  await expect(linkDialog).toBeHidden();
  await expect(pageName).toBeFocused();
}

async function insertAndDescribeImage(
  page: Page,
  editor: Locator,
  hooks: ImageInsertionHooks = {},
): Promise<void> {
  await editor.click();
  await page.keyboard.press("Control+End");
  await expect
    .poll(() => editorCaretReadiness(editor))
    .toMatchObject({
      editorFocused: true,
      selectionCollapsed: true,
      selectionWithinLastParagraph: true,
      atParagraphEnd: true,
    });
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: firstHeading, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: secondHeading, exact: true }),
  ).toBeVisible();
  await insertBlock(page, editor, "/image");
  const chooseImageInput = page.getByLabel("Choose image");
  await expect(chooseImageInput).toHaveAttribute("type", "file");
  await expect(chooseImageInput.locator("xpath=..")).toBeVisible();
  await expect(chooseImageInput.locator("xpath=..")).toHaveText("Choose image");
  await hooks.beforeFileSelection?.();
  await chooseImageInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4H+X7HwAGqAKm8BxW3QAAAABJRU5ErkJggg==",
      "base64",
    ),
    mimeType: "image/png",
    name: "browser-proof.png",
  });
  await hooks.afterFileSelection?.();

  const image = page.locator('img[src*="/pages/assets/"]');
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "Edit image details" }).click();
  await page.getByLabel("Image description").fill(imageDescription);
  await page.getByLabel("Image caption").fill("Browser proof image");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

async function verifyTouchNavigation(
  browser: Browser,
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const storageState = await page.context().storageState();
  const mobileContext = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: testInfo.outputPath("mobile-video") },
    storageState,
    viewport: { height: 844, width: 390 },
  });
  try {
    const mobilePage = await mobileContext.newPage();
    await mobilePage.route("https://jamp.io/**", (route) => route.abort());
    await mobilePage.goto(page.url());
    await expectSatoshi(mobilePage);
    await mobilePage.screenshot({
      fullPage: true,
      path: testInfo.outputPath("page-390x844.png"),
    });

    const pagesButton = mobilePage.getByRole("button", {
      name: "Pages",
      exact: true,
    });
    await pagesButton.tap();
    const mobileNavigation = mobilePage.getByRole("dialog", {
      name: "Pages navigation",
    });
    await expect(mobileNavigation).toBeVisible();
    await mobilePage.keyboard.press("Escape");
    await expect(mobileNavigation).toBeHidden();
    await expect(pagesButton).toBeFocused();

    const mobileFirst = mobilePage.getByRole("heading", {
      name: firstHeading,
      exact: true,
    });
    await selectHeadingTextForLink(mobilePage, mobileFirst);
    await mobilePage.getByLabel("Add or edit link").tap();
    const mobileLinkDialog = mobilePage.getByRole("dialog", {
      name: "Add or edit link",
    });
    await expect(mobileLinkDialog).toBeVisible();
    const mobilePageName = mobilePage.getByLabel("Page name");
    await mobilePageName.tap();
    await expect(mobileLinkDialog).toBeHidden();
    await expect(mobilePageName).toBeFocused();
  } finally {
    await mobileContext.close();
  }
}

test("owner creates, edits, moves, archives, and revisits a Page in Chromium", async ({
  browser,
  page,
  pagesProof,
}, testInfo) => {
  await page.route("https://jamp.io/**", (route) => route.abort());
  const business = await pagesProof.createBusinessThroughOwnerUi(page);

  await page.getByRole("button", { name: "Create Page" }).click();
  await page.getByRole("button", { name: "New Page", exact: true }).click();
  await page.waitForURL(new RegExp(`/app/${business.slug}/pages/[^/?#]+$`));

  const title = "Browser proof Page";
  const pageName = page.getByLabel("Page name");
  await pageName.fill(title);
  const editor = await visibleEditor(page);

  await editor.click();
  await editor.pressSequentially("/heading");
  const insertMenu = page.getByRole("listbox", { name: "Insert into Page" });
  await expect(insertMenu).toBeVisible();
  await pageName.click();
  await expect(insertMenu).toBeHidden();
  await expect(pageName).toBeFocused();
  await clearEditorCommand(page, editor);

  await editor.pressSequentially("/heading");
  await expect(insertMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(insertMenu).toBeHidden();
  await expect(editor).toBeFocused();
  await clearEditorCommand(page, editor);

  await insertBlock(page, editor, "/heading", firstHeading);
  await page.keyboard.press("Enter");
  await insertBlock(page, editor, "/heading", secondHeading);
  await page.keyboard.press("Enter");
  await editor.pressSequentially(firstParagraph);
  const firstParagraphBlock = page.getByText(firstParagraph, { exact: true });
  const firstParagraphId = await blockId(firstParagraphBlock);
  await page.keyboard.press("Enter");
  await editor.pressSequentially(secondParagraph);
  const secondParagraphBlock = page.getByText(secondParagraph, {
    exact: true,
  });
  const secondParagraphId = await blockId(secondParagraphBlock);
  await expect(page.getByText(firstHeading, { exact: true })).toBeVisible();
  await expect(page.getByText(secondHeading, { exact: true })).toBeVisible();
  expect(firstParagraphId).not.toBe(secondParagraphId);

  const first = page.getByRole("heading", { name: firstHeading, exact: true });
  const second = page.getByRole("heading", {
    name: secondHeading,
    exact: true,
  });
  const firstId = await blockId(first);
  const secondId = await blockId(second);
  expect(firstId).not.toBe(secondId);

  await nativeMoveFirstHeadingAfterSecond(page);
  await keyboardMoveFirstHeadingUp(page);
  await verifyTransientDismissal(page, editor);
  const uploadRoute = new URL(
    `/api/app/${business.slug}/pages/assets`,
    page.url(),
  ).toString();
  let uploadStarted!: () => void;
  let uploadResponseReady!: () => void;
  let releaseUpload!: () => void;
  const uploadHasStarted = new Promise<void>((resolve) => {
    uploadStarted = resolve;
  });
  const uploadHasResponse = new Promise<void>((resolve) => {
    uploadResponseReady = resolve;
  });
  const uploadRelease = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route(uploadRoute, async (route) => {
    uploadStarted();
    const response = await route.fetch();
    uploadResponseReady();
    await uploadRelease;
    await route.fulfill({ response });
  });
  let pageSaveResponse!: Promise<unknown>;
  await insertAndDescribeImage(page, editor, {
    beforeFileSelection: () => {
      pageSaveResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response
            .url()
            .endsWith(`/app/${business.slug}/pages/untitled-page`) &&
          response.status() === 200,
      );
    },
    afterFileSelection: async () => {
      await Promise.all([
        uploadHasStarted,
        uploadHasResponse,
        pageSaveResponse,
      ]);
      await expect(
        page.locator('[data-upload-status="uploading"]'),
      ).toBeVisible();
      releaseUpload();
    },
  });
  await page.unroute(uploadRoute);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const pageUrl = page.url();
  await page.reload();
  await expect(pageName).toHaveValue(title);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(await blockId(first)).toBe(firstId);
  expect(await blockId(second)).toBe(secondId);
  expect(await blockId(firstParagraphBlock)).toBe(firstParagraphId);
  expect(await blockId(secondParagraphBlock)).toBe(secondParagraphId);
  const managedImage = page.getByRole("img", { name: imageDescription });
  await expect(managedImage).toBeVisible();
  await expect
    .poll(() =>
      managedImage.evaluate((image) =>
        image instanceof HTMLImageElement ? image.naturalWidth : 0,
      ),
    )
    .toBeGreaterThan(0);

  await captureDesktopAndTablet(page, testInfo);
  await verifyTouchNavigation(browser, page, testInfo);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("More Page actions").click();
  await page
    .getByRole("menuitem", { name: "Archive Page", exact: true })
    .click();
  await page.waitForURL(new RegExp(`/app/${business.slug}$`));
  await page.getByRole("button", { name: /Archived Pages/ }).click();
  const archivedPages = page.getByRole("dialog", { name: "Archived Pages" });
  await expect(archivedPages).toBeVisible();
  await expect(archivedPages.getByText(title, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(
    new URL(`/app/${business.slug}`, pageUrl).toString(),
  );
});
