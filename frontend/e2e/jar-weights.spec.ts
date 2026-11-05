import { expect, test } from "@playwright/test";
import { selectOption } from "./select-option";

test("add a jar without a starting weight and update its container and glaze in detail", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const maker = await create("/manufacturers", {
    name: `Jar weights ${suffix}`,
  });
  const firstGlaze = await create("/glazes", {
    manufacturer_id: maker.id,
    name: `Blue ${suffix}`,
  });
  const secondGlaze = await create("/glazes", {
    manufacturer_id: maker.id,
    name: `Green ${suffix}`,
  });
  const firstPreset = await create("/presets", {
    name: `Small jar ${suffix}`,
    tare_g: 80,
  });
  const secondPreset = await create("/presets", {
    name: `Large jar ${suffix}`,
    tare_g: 100,
  });
  const retiredRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/glaze-sizes"))
      retiredRequests.push(request.url());
  });

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Containers", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Full weight by glaze and size" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save full weight" }),
  ).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Add a jar", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Jar", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "Container" }),
  ).toHaveText("No container");
  await expect(dialog.getByLabel("Location")).toHaveAttribute(
    "placeholder",
    "e.g. Studio, Home",
  );
  await expect(dialog.getByLabel("Starting Weight (g)")).toHaveCount(0);
  await selectOption(
    page,
    "Glaze",
    `${maker.name} · ${firstGlaze.name}`,
  );
  await selectOption(page, "Container", firstPreset.name);
  await expect(dialog.getByLabel("Container Weight (g)")).toHaveCount(0);
  await selectOption(
    page,
    "Glaze",
    `${maker.name} · ${secondGlaze.name}`,
  );
  await selectOption(page, "Container", secondPreset.name);
  await dialog.getByLabel("Cost", { exact: true }).fill("18.50");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  const pane = page.getByRole("complementary", { name: "Jar details" });
  await expect(pane.getByLabel("Container", { exact: true })).toHaveText(secondPreset.name);
  const readJar = async () => (await request.get(`/api/v1${new URL(page.url()).pathname}`)).json();
  expect(await readJar()).toMatchObject({ tare_g: 100, full_weight_g: null, cost_usd: "18.50" });
  const cost = pane.getByLabel("Cost", { exact: true });
  await expect(cost).toHaveValue("18.50");
  await cost.fill("0");
  await cost.blur();
  await expect.poll(readJar).toMatchObject({ cost_usd: "0.00" });
  await page.reload();
  await expect(cost).toHaveValue("0.00");
  await cost.fill("");
  await cost.blur();
  await expect.poll(readJar).toMatchObject({ cost_usd: null });
  await expect(pane.getByLabel("Starting weight (g)")).toHaveCount(0);
  await expect(pane.getByLabel("Empty jar (g)")).toHaveCount(0);
  await selectOption(page, "Container", firstPreset.name);
  await expect.poll(readJar).toMatchObject({ preset_id: firstPreset.id, tare_g: 80 });
  await selectOption(page, "Glaze", `${maker.name} · ${firstGlaze.name}`);
  await expect.poll(readJar).toMatchObject({ glaze_id: firstGlaze.id });
  await expect(pane.getByRole("heading", { level: 2 })).toContainText(firstGlaze.name);
  expect(retiredRequests).toEqual([]);
});

test("adjust measured weight, cancel deletion, then confirm deletion", async ({ page, request }) => {
  const manufacturer = await (await request.post("/api/v1/manufacturers", {
    data: { name: "Test studio" },
  })).json();
  const glaze = await (await request.post("/api/v1/glazes", {
    data: { name: "Copper", manufacturer_id: manufacturer.id },
  })).json();
  const jar = await (await request.post("/api/v1/containers", {
    data: { glaze_id: glaze.id, tare_g: 100, full_weight_g: 900 },
  })).json();
  const path = `/api/v1/containers/${jar.id}`;
  await page.goto(`/containers/${jar.id}`);
  const adjust = page.getByRole("button", { name: "Adjust Weight" });
  const measured = page.getByLabel("Measured weight (g)", { exact: true });
  await expect(measured).toHaveCount(0);
  await adjust.click();
  await expect(measured).toBeFocused();
  await measured.fill("500");
  // Drop the acknowledgement after the server commits the reading.
  await page.route(`**${path}/measurements`, async (route) => {
    expect((await route.fetch()).ok()).toBeTruthy();
    await route.abort();
  }, { times: 1 });
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  await apply.click();
  await expect(page.locator(".weight-adjustment").getByRole("alert")).toBeVisible();
  await apply.click();
  await expect(measured).toHaveCount(0);
  await expect(page.locator(".big-weight")).toHaveText("400 g");
  const history = await (await request.get(path + "/measurements")).json();
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ gross_g: 500, source: "web" });

  const remove = page.getByRole("button", { name: "Delete jar" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await remove.click();
  expect((await request.get(path)).ok()).toBeTruthy();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(`Copper jar #${jar.number}`);
    await dialog.accept();
  });
  await remove.click();
  await expect(page).toHaveURL(/\/$/);
  expect((await request.get(path)).status()).toBe(404);
});
