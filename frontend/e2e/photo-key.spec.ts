import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("glazes and vessels keep separate key photos and use them in every thumbnail", async ({
  page,
  request,
}, testInfo) => {
  const name = `Key photo ${testInfo.project.name} ${crypto.randomUUID()}`;
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const glaze = await create("/glazes", { name });
  const vessel = await create("/vessels", { name: `${name} bowl` });
  const jar = await create("/containers", { glaze_id: glaze.id });
  await create(`/vessels/${vessel.id}/applications`, { glaze_id: glaze.id });
  async function upload(path: string) {
    const response = await request.post(`/api/v1${path}/photos`, {
      multipart: {
        file: {
          name: "tile.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPElEQVR4nO3RQREAMAjEwKP+TdREXeCpEsKHX1bAMRPq3c6ms7oeDwz4A2QiZCJkImQiZCJkImQiZKKQD4HWAmQfdnzhAAAAAElFTkSuQmCC",
            "base64",
          ),
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const glazeFirst = await upload(`/glazes/${glaze.id}`);
  const glazeSecond = await upload(`/glazes/${glaze.id}`);
  const vesselFirst = await upload(`/vessels/${vessel.id}`);
  const vesselSecond = await upload(`/vessels/${vessel.id}`);
  const photos = page.getByRole("region", { name: "Photos", exact: true });
  const photo = (id: string) => photos.locator(`[data-photo-id="${id}"]`);
  const glazeThumb = page.locator(".glaze-heading img.glaze-thumb");
  const related = page.getByRole("region", { name: "Vessels", exact: true });
  const query = `?q=${encodeURIComponent(name)}`;

  await page.goto(`/glazes/${glaze.id}${query}`);
  await expect(photos.getByRole("img")).toHaveCount(4);
  await expect(glazeThumb).toHaveAttribute("src", glazeFirst.thumbnail_url);
  await photo(glazeSecond.id).getByRole("button", {
    name: "Use as key photo", exact: true,
  }).click();
  await expect(photo(glazeSecond.id).getByRole("button", {
    name: "Use as key photo", exact: true,
  })).toHaveAttribute("aria-pressed", "true");
  await expect(photo(glazeFirst.id).getByRole("button", {
    name: "Use as key photo", exact: true,
  })).toHaveAttribute("aria-pressed", "false");
  await expect(glazeThumb).toHaveAttribute("src", glazeSecond.thumbnail_url);
  if (testInfo.project.name === "desktop")
    await expect(page.locator(`#catalog-${glaze.id} img.glaze-thumb`)).toHaveAttribute(
      "src", glazeSecond.thumbnail_url,
    );

  await photo(vesselSecond.id).getByRole("button", {
    name: `Use as key photo for ${vessel.name}`, exact: true,
  }).click();
  await expect(photo(vesselSecond.id).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(photo(vesselFirst.id).getByRole("button")).toHaveAttribute("aria-pressed", "false");
  await expect(related.locator("img.glaze-thumb")).toHaveAttribute("src", vesselSecond.thumbnail_url);
  await expect(glazeThumb).toHaveAttribute("src", glazeSecond.thumbnail_url);
  await page.reload();
  await expect(glazeThumb).toHaveAttribute("src", glazeSecond.thumbnail_url);
  await expect(related.locator("img.glaze-thumb")).toHaveAttribute("src", vesselSecond.thumbnail_url);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((violation) => violation.id)).toEqual([]);
  await photos.screenshot({ path: testInfo.outputPath("key-photos.png"), scale: "css" });

  await page.goto(`/catalog${query}`);
  await expect(page.locator(`#catalog-${glaze.id} img.glaze-thumb`)).toHaveAttribute(
    "src", glazeSecond.thumbnail_url,
  );
  await page.goto(`/${query}`);
  await expect(page.locator(`#jar-${jar.id} img.glaze-thumb`)).toHaveAttribute(
    "src", glazeSecond.thumbnail_url,
  );
  await page.locator(`#jar-${jar.id}`).click();
  await expect(glazeThumb).toHaveAttribute("src", glazeSecond.thumbnail_url);

  await page.goto(`/vessels${query}`);
  await expect(page.locator(`#vessel-${vessel.id} img.glaze-thumb`)).toHaveAttribute(
    "src", vesselSecond.thumbnail_url,
  );
  await page.locator(`#vessel-${vessel.id}`).click();
  await expect(photo(vesselSecond.id).getByRole("button", {
    name: "Use as key photo", exact: true,
  })).toHaveAttribute("aria-pressed", "true");
  page.once("dialog", (dialog) => dialog.accept());
  await photo(vesselSecond.id).getByRole("button", { name: "Delete photo" }).click();
  await expect(photo(vesselSecond.id)).toHaveCount(0);
  await expect(photo(vesselFirst.id).getByRole("button", {
    name: "Use as key photo", exact: true,
  })).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/glazes/${glaze.id}${query}`);
  await expect(related.locator("img.glaze-thumb")).toHaveAttribute("src", vesselFirst.thumbnail_url);
  await expect(glazeThumb).toHaveAttribute("src", glazeSecond.thumbnail_url);
  page.once("dialog", (dialog) => dialog.accept());
  await photo(glazeSecond.id).getByRole("button", { name: "Delete photo" }).click();
  await expect(photo(glazeSecond.id)).toHaveCount(0);
  await expect(glazeThumb).toHaveAttribute("src", glazeFirst.thumbnail_url);
  await page.goto(`/${query}`);
  await expect(page.locator(`#jar-${jar.id} img.glaze-thumb`)).toHaveAttribute(
    "src", glazeFirst.thumbnail_url,
  );
});
