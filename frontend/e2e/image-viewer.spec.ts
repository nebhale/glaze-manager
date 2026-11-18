import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPElEQVR4nO3RQREAMAjEwKP+TdREXeCpEsKHX1bAMRPq3c6ms7oeDwz4A2QiZCJkImQiZCJkImQiZKKQD4HWAmQfdnzhAAAAAElFTkSuQmCC",
  "base64",
);

test("photos open in place throughout inventory, glazes, and vessels", async ({
  page, request, context,
}, testInfo) => {
  const name = `Photo viewer ${testInfo.project.name} ${crypto.randomUUID()}`;
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  async function upload(path: string) {
    const response = await request.post(`/api/v1${path}/photos`, {
      multipart: { file: { name: "tile.png", mimeType: "image/png", buffer: png } },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const glaze = await create("/glazes", { name });
  const vessel = await create("/vessels", { name: `${name} bowl` });
  const jar = await create("/containers", { glaze_id: glaze.id });
  await create(`/vessels/${vessel.id}/applications`, { glaze_id: glaze.id });
  const glazePhoto = await upload(`/glazes/${glaze.id}`);
  const vesselPhoto = await upload(`/vessels/${vessel.id}`);
  const query = `?q=${encodeURIComponent(name)}`;
  const dialog = page.getByRole("dialog");
  const close = page.getByRole("button", { name: "Close photo", exact: true });
  const thumbnail = (id: string) => page.locator(`#${id}`).locator("..").getByRole("button");
  const galleryPhoto = (id: string) => page.locator(`[data-photo-id="${id}"] .image-button`);

  async function preview(trigger: Locator, src: string, dismiss = "button") {
    const url = page.url();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("img")).toHaveAttribute("src", src);
    await expect(close).toBeFocused();
    expect(page.url()).toBe(url);
    expect(context.pages()).toHaveLength(1);
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await dialog.locator("img").click();
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    if (dismiss === "escape") await page.keyboard.press("Escape");
    else if (dismiss === "backdrop") await page.mouse.click(2, 2);
    else await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    expect(page.url()).toBe(url);
  }

  await page.goto(`/${query}`);
  await preview(thumbnail(`jar-${jar.id}`), glazePhoto.url);
  await page.locator(`#jar-${jar.id}`).click();
  await preview(page.locator(".glaze-heading .image-button"), glazePhoto.url, "escape");

  await page.goto(`/catalog${query}`);
  await preview(thumbnail(`catalog-${glaze.id}`), glazePhoto.url, "backdrop");
  await page.locator(`#catalog-${glaze.id}`).click();
  await preview(page.locator(".glaze-heading .image-button"), glazePhoto.url);
  await preview(galleryPhoto(glazePhoto.id), glazePhoto.url);
  await preview(galleryPhoto(vesselPhoto.id), vesselPhoto.url);
  await preview(thumbnail(`vessel-${vessel.id}`), vesselPhoto.url);

  await page.goto(`/vessels${query}`);
  await preview(thumbnail(`vessel-${vessel.id}`), vesselPhoto.url);
  await page.locator(`#vessel-${vessel.id}`).click();
  const trigger = galleryPhoto(vesselPhoto.id);
  await preview(trigger, vesselPhoto.url);

  // Use a large portrait to check proportional fitting on a phone and desktop.
  await page.route(`**${vesselPhoto.url}`, (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800"><rect width="1200" height="1800" fill="#70439c"/></svg>',
  }));
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const image = dialog.locator("img");
  await expect(image).toHaveJSProperty("naturalHeight", 1800);
  const imageBounds = (await image.boundingBox())!;
  expect(imageBounds.width / imageBounds.height).toBeCloseTo(2 / 3);
  expect(imageBounds.height).toBeLessThan(page.viewportSize()!.height);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("image-modal.png"), scale: "css" });
  await close.click();

  await page.unroute(`**${vesselPhoto.url}`);
  await page.route(`**${vesselPhoto.url}`, (route) => route.fulfill({ status: 404 }));
  // Reload to discard WebKit's decoded image from the preceding preview.
  await page.reload();
  await trigger.click();
  await expect(dialog.getByRole("alert")).toContainText("couldn’t be loaded");
  await close.click();
  await expect(trigger).toBeFocused();
});
