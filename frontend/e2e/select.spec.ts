import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("opaque menus support validation, keyboard selection, clearing, and dismissal", async ({
  page,
  request,
}, testInfo) => {
  const makerName = `Opaque ${testInfo.project.name} ${Date.now()}`;
  const response = await request.post("/api/v1/manufacturers", {
    data: { name: makerName },
  });
  expect(response.ok()).toBeTruthy();
  const maker = await response.json();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Add glaze", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Glaze", exact: true });
  const manufacturer = page.getByRole("combobox", {
    name: "Manufacturer",
    exact: true,
  });
  await page.getByLabel("Name", { exact: true }).fill("Opaque menu check");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(manufacturer).toBeFocused();
  await expect(manufacturer).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Please choose an option.")).toBeVisible();

  await manufacturer.press("ArrowDown");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(menu).toHaveCSS("opacity", "1");
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.type(makerName);
  await expect(
    page.getByRole("option", { name: makerName, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(manufacturer).toHaveText(makerName);
  await expect(manufacturer).toBeFocused();
  await expect(page.getByText("Please choose an option.")).toHaveCount(0);
  expect(
    await dialog
      .locator("form")
      .evaluate((form) =>
        new FormData(form as HTMLFormElement).get("manufacturer_id"),
      ),
  ).toBe(maker.id);

  const cone = dialog.getByRole("combobox", { name: "Cone", exact: true });
  await expect(cone).toHaveValue("");
  await cone.fill("06/04");
  expect(
    await dialog
      .locator("form")
      .evaluate((form) => new FormData(form as HTMLFormElement).get("cone")),
  ).toBe("06/04");

  await manufacturer.click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(manufacturer).toBeFocused();
  await manufacturer.click();
  await page.screenshot({
    path: testInfo.outputPath("opaque-menu.png"),
    fullPage: true,
  });
  // The menu can open over the heading. Its collision padding keeps the
  // viewport corner outside the menu on both desktop and mobile.
  await page.mouse.click(2, 2);
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
