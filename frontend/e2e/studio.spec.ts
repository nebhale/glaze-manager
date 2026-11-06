import { test, expect } from "@playwright/test";
import { selectOption } from "./select-option";

test("create a catalog and jar, weigh, archive and restore while retaining readings", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await page.goto("/settings");
  await page
    .getByRole("region", { name: "Manufacturers" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page
    .getByRole("form", { name: "New manufacturer" })
    .getByLabel("Name", { exact: true })
    .fill(`Studio maker ${suffix}`);
  await page
    .getByRole("form", { name: "New manufacturer" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Glazes", exact: true })
    .click();
  await page.getByRole("button", { name: "Add glaze", exact: true }).click();
  await selectOption(page, "Manufacturer", `Studio maker ${suffix}`);
  await page.getByLabel("Name", { exact: true }).fill(`Lilac glaze ${suffix}`);
  await page.getByRole("combobox", { name: "Cone", exact: true }).fill("5/6");
  await page
    .getByRole("region", { name: "Glaze", exact: true })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("link", { name: `Lilac glaze ${suffix}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Add a jar" }).click();
  await page.getByLabel("Location", { exact: true }).fill("Top shelf");
  await page
    .getByRole("region", { name: "Jar", exact: true })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const activeJars = page.getByRole("table", { name: "Jars" });
  await expect(activeJars.getByRole("columnheader")).toHaveText([
    "ID",
    "Name",
    "Remaining",
    "Weight",
    "Location",
  ]);
  await activeJars
    .getByRole("link", { name: `Lilac glaze ${suffix}, jar #`, exact: false })
    .click();
  const historyPath = `/api/v1${new URL(page.url()).pathname}/measurements`;
  await expect(
    page.locator(".stock-detail .notice"),
  ).toBeVisible();
  const jarPath = `/api/v1${new URL(page.url()).pathname}`;
  const createdJar = await (await request.get(jarPath)).json();
  const weighedJar = await (await request.patch(jarPath, {
    data: { expected_revision: createdJar.revision, tare_g: 100 },
  })).json();
  const first = await (await request.post(historyPath, {
    data: { request_id: crypto.randomUUID(), expected_revision: weighedJar.revision, gross_g: 150 },
  })).json();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.locator(".big-weight .low-stock-weight"),
  ).toBeVisible();
  await expect(page.locator(".big-weight")).toContainText("50 g");
  expect((await request.post(historyPath, {
    data: { request_id: crypto.randomUUID(), expected_revision: first.revision, gross_g: 250 },
  })).ok()).toBeTruthy();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".big-weight")).toContainText("150 g");
  await expect(page.getByText("Weight history", { exact: false })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Correct", exact: true }),
  ).toHaveCount(0);
  const history = await (await request.get(historyPath)).json();
  expect(history).toHaveLength(2);
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ gross_g: 150, remaining_g: 50 }),
      expect.objectContaining({ gross_g: 250, remaining_g: 150 }),
    ]),
  );
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore jar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore jar" }).click();
  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".big-weight")).toContainText("150 g");
  expect(await (await request.get(historyPath)).json()).toEqual(history);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("register unknown NFC tag and receive live device measurements", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const manufacturer = await (
    await request.post("/api/v1/manufacturers", {
      data: { name: "Device test" },
    })
  ).json();
  const glaze = await (
    await request.post("/api/v1/glazes", {
      data: { manufacturer_id: manufacturer.id, name: `Scale glaze ${suffix}` },
    })
  ).json();
  const jar = await (
    await request.post("/api/v1/containers", {
      data: {
        glaze_id: glaze.id,
        tare_g: 100,
        full_weight_g: 500,
      },
    })
  ).json();
  const uid = testInfo.project.name === "desktop" ? "04A2B3C401" : "04A2B3C402";
  await page.goto(`/register?container=${jar.id}`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Tag setup" })).toHaveCount(0);
  await page.goto(`/containers/${jar.id}`);
  await expect(page.getByLabel("NFC Tag")).toHaveText("Not linked");
  await request.post("/api/v1/scans", {
    data: { device_id: `scale-${suffix}`, uid },
  });
  const binding = await request.put(`/api/v1/tags/${uid}/binding`, {
    data: { container_id: jar.id, expected_revision: jar.revision },
  });
  expect(binding.ok()).toBeTruthy();
  await expect(page.getByLabel("NFC Tag")).toHaveText(uid);
  const lookup = await (await request.get(`/api/v1/tags/${uid}`)).json();
  const body = {
    request_id: `${suffix}-reading`,
    gross_g: 250,
    expected_revision: lookup.container.revision,
    source: "device",
    device_id: `scale-${suffix}`,
    tag_uid: uid,
  };
  const path = `/api/v1/containers/${jar.id}/measurements`;
  const first = await (await request.post(path, { data: body })).json();
  const replay = await (await request.post(path, { data: body })).json();
  expect(first).toEqual(replay);
  await expect(page.locator(".big-weight")).toContainText("150 g");
  await expect(page.locator(".history-row")).toHaveCount(0);
  const history = await (await request.get(path)).json();
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    gross_g: 250,
    source: "device",
    device_id: body.device_id,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("manage photos as square tiles above the jar list", async ({
  page,
  request,
}, testInfo) => {
  const maker = await (
    await request.post("/api/v1/manufacturers", {
      data: { name: "Photo maker" },
    })
  ).json();
  const glaze = await (
    await request.post("/api/v1/glazes", {
      data: {
        manufacturer_id: maker.id,
        name: `Photo glaze ${testInfo.project.name}`,
      },
    })
  ).json();
  await page.goto(`/glazes/${glaze.id}`);
  const photos = page.getByRole("region", { name: "Photos", exact: true });
  const upload = photos.getByLabel("Add glaze photo", { exact: true });
  await expect(photos).toBeVisible();
  await expect(photos.locator(".photo-tile")).toHaveCount(1);
  await expect(photos.locator("summary")).toHaveCount(0);
  const tile = {
    name: "test-tile.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPElEQVR4nO3RQREAMAjEwKP+TdREXeCpEsKHX1bAMRPq3c6ms7oeDwz4A2QiZCJkImQiZCJkImQiZKKQD4HWAmQfdnzhAAAAAElFTkSuQmCC",
      "base64",
    ),
  };
  await upload.setInputFiles(tile);
  await expect(photos.getByRole("img")).toHaveCount(1);
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({ ...tile, name: "second-tile.png" });
  await expect(photos.getByRole("img")).toHaveCount(2);
  await expect(photos.locator(".photo-tile")).toHaveCount(3);
  await expect(photos.getByLabel("Caption", { exact: true })).toHaveCount(0);
  await expect(
    photos.getByRole("button", { name: /cover photo/i }),
  ).toHaveCount(0);
  await photos.scrollIntoViewIfNeeded();
  const tiles = await photos.locator(".photo-tile").evaluateAll((elements) =>
    elements.map((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    }),
  );
  for (const bounds of tiles) {
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
    expect(bounds.width).toBeCloseTo(tiles[0].width, 0);
  }
  const photosBounds = await photos.boundingBox();
  const jarsBounds = await page
    .getByRole("heading", { name: /^Jars/ })
    .boundingBox();
  expect(photosBounds!.y + photosBounds!.height).toBeLessThan(jarsBounds!.y);
  await page.screenshot({
    path: testInfo.outputPath("photo-tiles.png"),
    scale: "css",
  });
  await page.reload();
  await expect(photos.getByRole("img")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.dismiss());
  await photos
    .getByRole("button", { name: "Delete photo", exact: true })
    .first()
    .click();
  await expect(photos.getByRole("img")).toHaveCount(2);
  for (const remaining of [1, 0]) {
    page.once("dialog", (dialog) => dialog.accept());
    await photos
      .getByRole("button", { name: "Delete photo", exact: true })
      .first()
      .click();
    await expect(photos.getByRole("img")).toHaveCount(remaining);
  }
  await expect(photos.locator(".photo-tile")).toHaveCount(1);
  await expect(upload).toBeEnabled();
  const deleteGlaze = page.getByRole("button", { name: "Delete glaze" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await deleteGlaze.click();
  await expect(page.getByRole("heading", { name: glaze.name })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await deleteGlaze.click();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByRole("link", { name: glaze.name, exact: true })).toHaveCount(0);
});
