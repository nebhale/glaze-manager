import { expect, test } from "@playwright/test";

test("glaze viscosity accepts free text, suggests saved values, and appears in the list", async ({
  page,
  request,
}, testInfo) => {
  const suffix = crypto.randomUUID();
  const name = `Viscosity glaze ${suffix}`;
  const saved = `Fluid ${suffix}`;
  const response = await request.post("/api/v1/glazes", {
    data: { name: `Source ${suffix}`, viscosity: saved },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/catalog?q=${encodeURIComponent(name)}`);
  await page.getByRole("button", { name: "Add glaze", exact: true }).click();
  const form = page.getByRole("region", { name: "Glaze", exact: true });
  await form.getByLabel("Name", { exact: true }).fill(name);
  const input = form.getByRole("combobox", { name: "Viscosity", exact: true });
  await input.click();
  await expect(page.getByRole("option", { name: saved, exact: true })).toBeVisible();
  await input.fill(suffix);
  await expect(page.getByRole("listbox", { name: "Viscosity suggestions" })
    .getByRole("option")).toHaveCount(1);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue(saved);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form).toHaveCount(0);

  const list = page.locator("#glazes-list");
  await expect(list.getByRole("columnheader", { name: "Viscosity" })).toBeVisible();
  await expect(list.getByRole("columnheader", { name: "Product Line" })).toHaveCount(0);
  await expect(list.getByRole("cell", { name: saved, exact: true })).toBeVisible();
  await list.getByRole("link", { name, exact: true }).click();
  const detail = page.getByRole("complementary", { name: "Glaze details" });
  const viscosity = detail.getByRole("combobox", { name: "Viscosity", exact: true });
  await expect(viscosity).toHaveValue(saved);
  const freeText = `45 seconds (Zahn #2) ${suffix}`;
  await viscosity.fill(freeText);
  await viscosity.blur();
  const path = new URL(page.url()).pathname;
  await expect.poll(async () =>
    (await (await request.get(`/api/v1${path}`)).json()).viscosity,
  ).toBe(freeText);
  await page.reload();
  await expect(viscosity).toHaveValue(freeText);
  await page.screenshot({ path: testInfo.outputPath("viscosity-detail.png"), fullPage: true });

  await viscosity.fill("");
  await viscosity.blur();
  await expect.poll(async () =>
    (await (await request.get(`/api/v1${path}`)).json()).viscosity,
  ).toBeNull();
  await page.getByRole("button", {
    name: testInfo.project.name === "phone" ? "Glazes" : "Close glaze details",
    exact: true,
  }).click();
  await expect(list.locator("tbody tr")).toHaveCount(1);
  await expect(list.locator("tbody td").nth(1)).toBeEmpty();
});
