import { expect, test, type APIRequestContext } from "@playwright/test";

async function setup(request: APIRequestContext) {
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const maker = await create("/manufacturers", {
    name: "AMACO",
    website: "https://amaco.com",
  });
  const glaze = await create("/glazes", {
    manufacturer_id: maker.id,
    name: "Ancient Copper",
    product_code: "PC-56",
    product_line: "Potter’s Choice",
    cone: "5/6",
  });
  const preset = await create("/presets", {
    name: `Pint jar ${crypto.randomUUID().slice(0, 6)}`,
    tare_g: 80,
  });
  const jar = await create("/containers", {
    glaze_id: glaze.id,
    tare_g: 80,
    full_weight_g: 800,
    location: "Shelf A",
    preset_id: preset.id,
  });
  await create(`/containers/${jar.id}/measurements`, {
    request_id: crypto.randomUUID(),
    expected_revision: jar.revision,
    gross_g: 680,
  });
  const read = async (path = `/containers/${jar.id}`) =>
    (await request.get(`/api/v1${path}`)).json();
  return { maker, glaze, preset, jar, read };
}

test("idle, blur and navigation save directly editable fields", async ({
  page,
  request,
}, testInfo) => {
  const { jar, glaze, maker, preset, read } = await setup(request);
  await page.goto(`/containers/${jar.id}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  const location = page.getByLabel("Location", { exact: true });
  await location.fill("Glaze shelf");
  await expect.poll(async () => (await read()).location).toBe("Glaze shelf");
  await expect(location).toBeFocused(); // The idle timer saves without a blur.
  await page.goto(`/glazes/${glaze.id}`);
  await page.getByLabel("Product code").fill("PC-56A");
  await page
    .getByLabel("Notes", { exact: true })
    .fill("Three coats on white stoneware.");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Glazes", exact: true })
    .click();
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).notes)
    .toBe("Three coats on white stoneware.");
  expect((await read(`/glazes/${glaze.id}`)).product_code).toBe("PC-56A");
  await page.locator(`a.catalog-select[href="/glazes/${glaze.id}"]`).click();
  await page.getByLabel("Product line", { exact: true }).fill("Celadon");
  await page.getByLabel("Product line", { exact: true }).blur();
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).product_line)
    .toBe("Celadon");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  const manufacturer = page.locator(`[data-manufacturer-id="${maker.id}"]`);
  await manufacturer
    .getByLabel("Notes", { exact: true })
    .fill("Local pottery supplier");
  await manufacturer.getByLabel("Notes", { exact: true }).blur();
  await expect
    .poll(async () => (await read(`/manufacturers/${maker.id}`)).notes)
    .toBe("Local pottery supplier");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  const presetRow = page
    .locator(".settings-preset-row")
    .filter({ has: page.locator(`input[value="${preset.name}"]`) });
  await presetRow.getByLabel("Empty weight (g)").fill("85");
  await presetRow.getByLabel("Empty weight (g)").blur();
  await expect
    .poll(async () => (await read(`/presets/${preset.id}`)).tare_g)
    .toBe(85);
  await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("settings-inline.png"),
    fullPage: true,
  });
  await page.goto(`/containers/${jar.id}`);
  await expect(page.getByLabel("Location", { exact: true })).toHaveValue(
    "Glaze shelf",
  );
  await page.screenshot({
    path: testInfo.outputPath("jar-inline.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("failed saves retain drafts, retry successfully, and validate before writing", async ({
  page,
  request,
}) => {
  const { jar, read } = await setup(request);
  let failing = true;
  await page.route(`**/api/v1/containers/${jar.id}`, async (route) => {
    if (failing && route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        json: { detail: "Studio temporarily unavailable" },
      });
    else await route.continue();
  });
  await page.goto(`/containers/${jar.id}`);
  const location = page.getByLabel("Location", { exact: true });
  await location.fill("Kiln room");
  await location.blur();
  const field = page.locator(".inline-field").filter({ has: location });
  await expect(field.getByRole("alert")).toContainText(
    "Studio temporarily unavailable",
  );
  expect((await read()).location).toBe("Shelf A");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Location: not saved" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Location: not saved" }).click();
  await expect(location).toHaveValue("Kiln room");
  failing = false;
  await field.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(async () => (await read()).location).toBe("Kiln room");
  await page.getByLabel("Location", { exact: true }).fill("");
  await page.getByLabel("Location", { exact: true }).blur();
  await expect.poll(async () => (await read()).location).toBeNull();
});

test("live updates preserve drafts and same-field conflicts require review", async ({
  page,
  request,
}) => {
  const { jar, read } = await setup(request);
  await page.goto(`/containers/${jar.id}`);
  const location = page.getByLabel("Location", { exact: true });
  await location.fill("My shelf");
  const current = await read();
  await request.patch(`/api/v1/containers/${jar.id}`, {
    data: { expected_revision: current.revision, location: "Other shelf" },
  });
  await expect(location).toHaveValue("My shelf");
  await location.blur();
  const field = page.locator(".inline-field").filter({ has: location });
  await expect(field.getByRole("alert")).toContainText(
    "Saved value: Other shelf",
  );
  expect((await read()).location).toBe("Other shelf");
  await field.getByRole("button", { name: "Save my value" }).click();
  await expect.poll(async () => (await read()).location).toBe("My shelf");
  // A live measurement changes the revision without conflicting with a note.
  await page
    .getByRole("region", { name: "Jar fields", exact: true })
    .getByLabel("Notes", { exact: true })
    .fill("Keep near the kiln");
  const updated = await read();
  await request.post(`/api/v1/containers/${jar.id}/measurements`, {
    data: {
      request_id: crypto.randomUUID(),
      expected_revision: updated.revision,
      gross_g: 500,
    },
  });
  await page
    .getByRole("region", { name: "Jar fields", exact: true })
    .getByLabel("Notes", { exact: true })
    .blur();
  await expect
    .poll(async () => (await read()).notes)
    .toBe("Keep near the kiln");
  await expect(page.locator(".big-weight")).toContainText("420 g");
});

test("typing during a pending save and quick edits to other fields are serialized", async ({
  page,
  request,
}) => {
  const { jar, read } = await setup(request);
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route(`**/api/v1/containers/${jar.id}`, async (route) => {
    if (route.request().method() === "PATCH" && first) {
      first = false;
      started!();
      await gate;
    }
    await route.continue();
  });
  await page.goto(`/containers/${jar.id}`);
  const location = page.getByLabel("Location", { exact: true });
  await location.fill("First draft");
  await location.blur();
  await waiting;
  await location.fill("Final draft");
  await page
    .getByRole("region", { name: "Jar fields", exact: true })
    .getByLabel("Notes", { exact: true })
    .fill("Updated notes");
  await page
    .getByRole("region", { name: "Jar fields", exact: true })
    .getByLabel("Notes", { exact: true })
    .blur();
  release!();
  await expect
    .poll(async () => {
      const current = await read();
      return [current.location, current.tare_g, current.notes];
    })
    .toEqual(["Final draft", 80, "Updated notes"]);
  await expect(location).toHaveValue("Final draft");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("cone text edits inline without dialogs", async ({
  page,
  request,
}) => {
  const { glaze, read } = await setup(request);
  const otherCone = "05½/04";
  const other = await request.post("/api/v1/glazes", {
    data: {
      manufacturer_id: glaze.manufacturer_id,
      name: "Reference glaze",
      cone: otherCone,
    },
  });
  expect(other.ok()).toBeTruthy();
  await page.goto(`/glazes/${glaze.id}`);
  const cone = page.getByRole("combobox", { name: "Cone", exact: true });
  await expect(cone).toHaveValue("5/6");
  await cone.click();
  await cone.fill("05½");
  await page.getByRole("option", { name: otherCone, exact: true }).click();
  await expect(cone).toHaveValue(otherCone);
  await cone.fill("06 reduction");
  await cone.blur();
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).cone)
    .toBe("06 reduction");
  await cone.fill("");
  await cone.blur();
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).cone)
    .toBeNull();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("create a container preset inline and edit it in place", async ({
  page,
}, testInfo) => {
  const name = `Pint jar ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/settings");
  const presets = page.getByRole("region", { name: "Containers" });
  const add = presets.getByRole("button", { name: "Add", exact: true });
  await add.click();
  const form = presets.getByRole("form", { name: "New container" });
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(presets.getByText("No containers yet.")).toHaveCount(0);
  await expect(form.getByRole("heading")).toHaveCount(0);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await add.click();
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  const saved = presets
    .locator(".settings-preset-row")
    .filter({ has: page.locator(`input[value="${name}"]`) });
  const weight = saved.getByLabel("Empty weight (g)");
  await expect(weight).toHaveValue("");
  await weight.fill("75");
  await weight.blur();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(weight).toHaveValue("75");
});
