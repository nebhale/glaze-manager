import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("show archived includes searchable jars that can be reopened and restored", async ({
  page,
  request,
}, testInfo) => {
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const maker = await create("/manufacturers", {
    name: "Archive visibility test",
  });
  const glaze = await create("/glazes", {
    manufacturer_id: maker.id,
    name: `Archived copper ${crypto.randomUUID()}`,
  });
  const active = await create("/containers", {
    glaze_id: glaze.id,
    location: "Shelf A",
  });
  const archived = await create("/containers", {
    glaze_id: glaze.id,
    location: "Storage",
  });
  const response = await request.patch(`/api/v1/containers/${archived.id}`, {
    data: { expected_revision: archived.revision, archived: true },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/?q=${encodeURIComponent(glaze.name)}`);
  const toggle = page.getByRole("checkbox", {
    name: "Show archived",
    exact: true,
  });
  const rows = page.locator(".stock-table tbody tr");
  await expect(toggle).not.toBeChecked();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-jar-id", active.id);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(rows).toHaveCount(2);
  await expect(
    page.locator(`[data-jar-id="${archived.id}"] .jar-archive-marker`),
  ).toHaveAttribute("title", "Archived");
  await expect(
    page.locator(`[data-jar-id="${archived.id}"] .jar-select`),
  ).toHaveAccessibleName(new RegExp("archived$"));
  await expect(page.getByLabel("Search jars")).toHaveValue(glaze.name);
  await page.screenshot({
    path: testInfo.outputPath("archived-jars.png"),
    scale: "css",
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);

  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: "Name", exact: true }).click();
  await expect(toggle).toBeChecked();
  await page.getByLabel("Search jars").fill(`#${archived.number}`);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-jar-id", archived.id);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(rows).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No matching jars", exact: true }),
  ).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole("link").click();
  const pane = page.getByRole("complementary", { name: "Jar details" });
  await expect(pane.getByRole("button", { name: "Restore jar" })).toBeVisible();
  await pane
    .getByRole("button", {
      name:
        testInfo.project.name === "phone" ? "Inventory" : "Close jar details",
      exact: true,
    })
    .click();
  await expect(toggle).toBeChecked();
  await expect(page.getByLabel("Search jars")).toHaveValue(
    `#${archived.number}`,
  );
  await rows.first().getByRole("link").click();
  await pane.getByRole("button", { name: "Restore jar", exact: true }).click();
  await expect(pane.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  await expect(page.locator(".jar-archive-marker")).toHaveCount(0);
  await pane
    .getByRole("button", {
      name:
        testInfo.project.name === "phone" ? "Inventory" : "Close jar details",
      exact: true,
    })
    .click();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-jar-id", archived.id);
  const restored = await (
    await request.get(`/api/v1/containers/${archived.id}`)
  ).json();
  expect(restored.archived).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
