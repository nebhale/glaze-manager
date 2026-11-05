import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const storageKey = "glaze-manager.inventory-list-width";
const divider = (page: Page) =>
  page.getByRole("separator", { name: "Resize inventory panes" });
const listWidth = (page: Page) =>
  page
    .locator(".inventory-list")
    .evaluate((el) => el.getBoundingClientRect().width);

async function dragBy(page: Page, distance: number) {
  const bounds = (await divider(page).boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + distance, y, { steps: 8 });
  await page.mouse.up();
}

test("dragging keeps both panes usable and remembers the chosen width", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop split-pane layout");
  await page.setViewportSize({ width: 1440, height: 900 });
  const maker = await (
    await request.post("/api/v1/manufacturers", {
      data: { name: "Divider test" },
    })
  ).json();
  const glaze = await (
    await request.post("/api/v1/glazes", {
      data: {
        manufacturer_id: maker.id,
        name: "Ancient Copper",
        product_code: "PC-56",
      },
    })
  ).json();
  const jar = await (
    await request.post("/api/v1/containers", {
      data: { glaze_id: glaze.id, location: "Shelf A" },
    })
  ).json();
  await page.goto(`/?q=${encodeURIComponent(`#${jar.number}`)}`);
  await expect(page.locator(".jar-select")).toBeVisible();
  await expect.poll(() => listWidth(page)).toBe(470);
  await dragBy(page, 140);
  await expect.poll(() => listWidth(page)).toBe(610);
  await expect(divider(page)).toHaveAttribute("aria-valuenow", "610");
  await expect(page.locator("body")).not.toHaveClass(/resizing-inventory/);
  await page.locator(".jar-select").click();
  await expect(page.getByLabel("Location", { exact: true })).toHaveValue(
    "Shelf A",
  );
  await expect.poll(() => listWidth(page)).toBe(610);
  await expect(page).toHaveURL(new RegExp(`/containers/${jar.id}`));
  await page.screenshot({ path: testInfo.outputPath("resized-panes.png") });
  await page.reload();
  await expect(page.locator(".jar-select")).toBeVisible();
  await expect.poll(() => listWidth(page)).toBe(610);
  await page.getByRole("button", { name: "Close jar details" }).click();
  await expect(page.locator(".empty-detail-pane")).toBeVisible();
  await expect.poll(() => listWidth(page)).toBe(610);

  // Pointer capture keeps the drag active past either pane's limits.
  await dragBy(page, -1000);
  await expect.poll(() => listWidth(page)).toBe(360);
  await dragBy(page, 1600);
  const maximum = Number(await divider(page).getAttribute("aria-valuemax"));
  await expect.poll(() => listWidth(page)).toBe(maximum);
  expect((await page.locator(".empty-detail-pane").boundingBox())!.width).toBe(
    360,
  );

  // Viewport clamping must not overwrite the stored desktop preference.
  await page.setViewportSize({ width: 800, height: 800 });
  await expect.poll(() => listWidth(page)).toBe(404);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider(page)).toBeHidden();
  await expect.poll(() => listWidth(page)).toBe(390);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => listWidth(page)).toBe(maximum);
  await divider(page).dblclick();
  await expect.poll(() => listWidth(page)).toBe(470);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
});

test("keyboard resizing, drag cancellation, and unavailable storage work", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop split-pane layout");
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  await page.goto("/");
  await expect.poll(() => listWidth(page)).toBe(470);
  await divider(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => listWidth(page)).toBe(480);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => listWidth(page)).toBe(530);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => listWidth(page)).toBe(520);
  await page.keyboard.press("Home");
  await expect.poll(() => listWidth(page)).toBe(360);
  await page.keyboard.press("End");
  await expect
    .poll(() => listWidth(page))
    .toBe(Number(await divider(page).getAttribute("aria-valuemax")));
  await page.keyboard.press("Enter");
  await expect.poll(() => listWidth(page)).toBe(470);

  const bounds = (await divider(page).boundingBox())!;
  await page.mouse.move(bounds.x + 6, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 106, bounds.y + 100);
  await expect.poll(() => listWidth(page)).toBe(570);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => listWidth(page)).toBe(470);
  await expect(page.locator("body")).not.toHaveClass(/resizing-inventory/);
  await dragBy(page, 80);
  await expect.poll(() => listWidth(page)).toBe(550);
});

test("phones keep full-width inventory despite a saved desktop split", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Mobile navigation layout");
  await page.addInitScript(
    (key) => localStorage.setItem(key, "700"),
    storageKey,
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Inventory", exact: true }),
  ).toBeVisible();
  await expect(divider(page)).toBeHidden();
  await expect(page.locator(".empty-detail-pane")).toBeHidden();
  expect(await listWidth(page)).toBe(page.viewportSize()!.width);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe("700");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
