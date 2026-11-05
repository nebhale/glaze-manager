import { expect, test } from "@playwright/test";

test("warn by remaining grams without a full weight and edit gram thresholds", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const settings = await (await request.get("/api/v1/settings")).json();
  expect(settings.low_stock_threshold_g).toBe(150);
  const maker = await create("/manufacturers", {
    name: `Weight warnings ${suffix}`,
  });
  const glaze = await create("/glazes", {
    manufacturer_id: maker.id,
    name: `No baseline ${suffix}`,
  });
  const jar = await create("/containers", { glaze_id: glaze.id, tare_g: 100 });
  await create(`/containers/${jar.id}/measurements`, {
    request_id: crypto.randomUUID(),
    expected_revision: jar.revision,
    gross_g: 200,
  });

  try {
    await page.goto("/settings");
    const threshold = page.getByLabel("Studio low-stock threshold (g)");
    await expect(threshold).toHaveValue("150");
    await threshold.fill("250");
    await threshold.blur();
    await expect(
      page.getByText("All changes saved", { exact: true }),
    ).toBeVisible();
    await page.goto(`/?q=${encodeURIComponent(`#${jar.number}`)}`);
    await expect(page.locator(".stock-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".remaining-weight")).toHaveText("100 g");
    await expect(page.locator(".stock-table .low-stock-weight")).toBeVisible();
    await page.goto(`/glazes/${glaze.id}`);
    const jars = page.getByRole("table", { name: "Active jars" });
    await expect(jars.locator(".low-stock-weight")).toBeVisible();
    await expect(jars.locator(".stock-meter")).toHaveClass(/low/);
    await expect(page.getByText(/low-stock threshold/i)).toHaveCount(0);
    await jars.locator(".jar-select").click();
    const pane = page.getByRole("complementary", { name: "Jar details" });
    await expect(pane.locator(".big-weight .low-stock-weight")).toBeVisible();
    await expect(pane.getByText(/low-stock threshold/i)).toHaveCount(0);
    await expect(pane.getByText("Needs setup", { exact: true })).toHaveCount(0);
    const currentJar = await (await request.get(`/api/v1/containers/${jar.id}`)).json();
    await create(`/containers/${jar.id}/measurements`, {
      request_id: crypto.randomUUID(), expected_revision: currentJar.revision, gross_g: 350,
    });
    await expect(pane.locator(".big-weight")).toHaveText("250 g");
    await expect(pane.locator(".big-weight .low-stock-weight")).toHaveCount(0);
    await expect(page.locator(`tr[data-jar-id="${jar.id}"] .low-stock-weight`)).toHaveCount(0);

    const current = await (
      await request.get(`/api/v1/containers/${jar.id}`)
    ).json();
    expect(current.full_weight_g).toBeNull();
    expect(current.percentage).toBeNull();
    expect(current.incomplete).toBe(false);
  } finally {
    await request.put("/api/v1/settings", { data: settings });
  }
});
