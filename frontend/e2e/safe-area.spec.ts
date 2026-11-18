import { expect, test } from "@playwright/test";

test("safe areas protect navigation and content through phone rotation", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone safe-area layout");
  const makerResponse = await request.post("/api/v1/manufacturers", {
    data: { name: `Safe area ${crypto.randomUUID()}` },
  });
  expect(makerResponse.ok()).toBeTruthy();
  const maker = await makerResponse.json();
  const glazeResponse = await request.post("/api/v1/glazes", {
    data: { manufacturer_id: maker.id, name: "Dark Star" },
  });
  expect(glazeResponse.ok()).toBeTruthy();
  const glaze = await glazeResponse.json();
  const session = await page.context().newCDPSession(page);

  for (const { name, viewport, insets } of [
    {
      name: "portrait",
      viewport: { width: 390, height: 844 },
      insets: { top: 59, right: 0, bottom: 34, left: 0 },
    },
    {
      name: "landscape",
      viewport: { width: 844, height: 390 },
      insets: { top: 0, right: 59, bottom: 21, left: 59 },
    },
    {
      name: "compact-landscape",
      viewport: { width: 740, height: 360 },
      insets: { top: 0, right: 44, bottom: 21, left: 44 },
    },
  ]) {
    await page.setViewportSize(viewport);
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
    await page.goto(`/glazes/${glaze.id}`);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Dark Star",
    );
    const mobile = viewport.width <= 760;
    const header = (await page.locator(".app-header").boundingBox())!;
    const brand = (await page.locator(".brand").boundingBox())!;
    const workspace = (
      await page.locator(".inventory-workspace").boundingBox()
    )!;
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const navBounds = (await nav.boundingBox())!;
    const contentBottom = mobile
      ? navBounds.y
      : viewport.height - insets.bottom;

    expect(header.height).toBe(insets.top + (mobile ? 46 : 56));
    expect(brand.y).toBeGreaterThanOrEqual(insets.top);
    expect(workspace.y).toBeGreaterThanOrEqual(header.y + header.height);
    expect(workspace.x).toBeGreaterThanOrEqual(insets.left);
    expect(workspace.x + workspace.width).toBeLessThanOrEqual(
      viewport.width - insets.right,
    );
    expect(workspace.y + workspace.height).toBeLessThanOrEqual(contentBottom);
    if (mobile) {
      expect(workspace.y + workspace.height).toBe(navBounds.y);
      expect(navBounds.y + navBounds.height).toBe(viewport.height);
    }
    for (const link of await nav.getByRole("link").all()) {
      const bounds = (await link.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(insets.left);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        viewport.width - insets.right,
      );
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        viewport.height - insets.bottom,
      );
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      /viewport-fit=cover/,
    );
    await page.screenshot({
      path: testInfo.outputPath(`safe-area-${name}.png`),
    });

    const notes = page.getByLabel("Notes", { exact: true });
    await notes.scrollIntoViewIfNeeded();
    const notesBounds = (await notes.boundingBox())!;
    expect(notesBounds.y + notesBounds.height).toBeLessThanOrEqual(contentBottom);

    if (name === "portrait") {
      const input = page.getByLabel("Name", { exact: true });
      await input.fill("");
      await input.blur();
      const errors = page.locator(".autosave-status.has-errors");
      await expect(errors).toBeVisible();
      expect((await errors.boundingBox())!.y).toBe(header.y + header.height);
      await input.fill("Dark Star");
      await input.blur();
      await expect(errors).toHaveCount(0);
    }

    await nav.getByRole("link", { name: "Settings", exact: true }).click();
    const sections = page.locator(".settings-sections");
    await expect(sections).toBeVisible();
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const lastSection = (
      await sections.locator(":scope > :last-child").boundingBox()
    )!;
    expect(lastSection.x).toBeGreaterThanOrEqual(insets.left);
    expect(lastSection.x + lastSection.width).toBeLessThanOrEqual(
      viewport.width - insets.right,
    );
    expect(lastSection.y + lastSection.height).toBeLessThanOrEqual(contentBottom);
  }
});
