import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function create(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(`/api/v1${path}`, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("manage 50 jars in a persistent inventory and edit related records directly", async ({
  page,
  request,
}, testInfo) => {
  const prefix = `Workspace-${testInfo.project.name}-${Date.now()}`;
  const makers = [];
  for (const name of ["First", "Second", "Third"])
    makers.push(
      await create(request, "/manufacturers", { name: `${name} ${prefix}` }),
    );
  const glazes = [];
  for (let i = 0; i < 6; i++)
    glazes.push(
      await create(request, "/glazes", {
        name: `Glaze ${i}`,
        product_code: `G-${i}`,
        manufacturer_id: makers[i % 3].id,
        cone: "5/6",
      }),
    );
  for (let i = 0; i < 50; i++) {
    const jar = await create(request, "/containers", {
      glaze_id: glazes[i % 6].id,
      location: "Shelf A",
      tare_g: 100,
      full_weight_g: 500,
    });
    await create(request, `/containers/${jar.id}/measurements`, {
      request_id: crypto.randomUUID(),
      expected_revision: jar.revision,
      gross_g: 100 + i * 10,
    });
  }
  await page.goto(`/?q=${prefix}`);
  const rows = page.locator(".stock-table tbody tr");
  await expect(rows).toHaveCount(50);
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  const visibleRows = await rows.evaluateAll(
    (elements) =>
      elements.filter((el) => {
        const r = el.getBoundingClientRect();
        const parent = el
          .closest(".inventory-table-scroll")!
          .getBoundingClientRect();
        const headerHeight = el
          .closest("table")!
          .querySelector("thead")!
          .getBoundingClientRect().height;
        return r.top >= parent.top + headerHeight && r.bottom <= parent.bottom;
      }).length,
  );
  expect(visibleRows).toBeGreaterThanOrEqual(
    testInfo.project.name === "phone" ? 8 : 10,
  );
  await expect(page.locator(".stock-table thead th")).toHaveCount(5);
  await expect(rows.first().locator("td")).toHaveCount(5);
  await expect(rows.locator(".badge")).toHaveCount(0);
  await expect(rows.first().locator("td").nth(4)).toHaveText("Shelf A");
  const numbers = await rows.locator(".stock-id-column").allTextContents();
  expect(new Set(numbers).size).toBe(50);
  expect(numbers.every((n) => /^#\d+$/.test(n))).toBeTruthy();
  await expect(page.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
  await page.getByLabel("Search jars").fill(makers[0].name);
  await expect(rows).toHaveCount(17);
  await page.getByLabel("Search jars").fill(prefix);
  await expect(rows).toHaveCount(50);
  const selected = rows.nth(12);
  const jarId = await selected.getAttribute("data-jar-id");
  const jarNumber = await selected.locator(".stock-id-column").innerText();
  const link = selected.getByRole("link");
  await link.scrollIntoViewIfNeeded();
  const scroll = await page
    .locator(".inventory-table-scroll")
    .evaluate((el) => el.scrollTop);
  await link.click();
  const pane = page.getByRole("complementary", { name: "Jar details" });
  await expect(pane).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/containers/${jarId}\\?q=${prefix}`),
  );
  if (testInfo.project.name === "phone")
    await expect(
      page.getByRole("region", { name: "Jar inventory" }),
    ).toBeHidden();
  else {
    await expect(
      page.getByRole("region", { name: "Jar inventory" }),
    ).toBeVisible();
    await expect(selected).toHaveClass("selected-row");
    const bounds = await pane.boundingBox();
    const list = await page.locator(".inventory-list").boundingBox();
    expect(bounds!.x).toBeGreaterThan(list!.x + list!.width);
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const chosen = await (await request.get(`/api/v1/containers/${jarId}`)).json();
  await create(request, `/containers/${jarId}/measurements`, {
    expected_revision: chosen.revision, request_id: crypto.randomUUID(), gross_g: 125,
  });
  await expect(pane.locator(".big-weight .remaining-weight")).toHaveText("25 g");
  await expect(selected.locator(".remaining-weight")).toHaveText("25 g");
  const selectedGlaze = chosen.glaze.name;
  await expect(
    pane.getByRole("region", { name: "Manufacturer", exact: true }),
  ).toHaveCount(0);
  await expect(pane.locator(".detail-code a")).toHaveAttribute(
    "href", /^\/settings#manufacturer-/,
  );
  await expect(
    page.locator(`[data-jar-id="${jarId}"] .stock-id-column`),
  ).toHaveText(jarNumber);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  // Closing and browser back both preserve the inventory query and scroll position.
  await pane
    .getByRole("button", {
      name:
        testInfo.project.name === "phone" ? "Inventory" : "Close jar details",
      exact: true,
    })
    .click();
  await expect(pane).toHaveCount(0);
  await expect(page.getByLabel("Search jars")).toHaveValue(prefix);
  // Selecting again and using browser back preserves the same list position.
  const currentLink = rows.nth(12).getByRole("link");
  await currentLink.scrollIntoViewIfNeeded();
  const currentScroll = await page
    .locator(".inventory-table-scroll")
    .evaluate((el) => el.scrollTop);
  await currentLink.click();
  await expect(pane).toBeVisible();
  await page.goBack();
  await expect(pane).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator(".inventory-table-scroll").evaluate((el) => el.scrollTop),
    )
    .toBe(currentScroll);
  expect(scroll).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Glazes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Search glazes", exact: true })
    .click();
  await page.getByLabel("Search catalog").fill(selectedGlaze);
  await page
    .locator(`#catalog-${chosen.glaze_id}`)
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    selectedGlaze,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a jar stays selected when an edit removes it from search results", async ({
  page,
  request,
}, testInfo) => {
  const maker = await create(request, "/manufacturers", {
    name: "Low stock test",
  });
  const glaze = await create(request, "/glazes", {
    name: `Refill ${testInfo.project.name}`,
    manufacturer_id: maker.id,
  });
  const searchLocation = `Selected jar ${crypto.randomUUID()}`;
  const jar = await create(request, "/containers", {
    glaze_id: glaze.id,
    location: searchLocation,
  });
  await page.goto(`/?q=${encodeURIComponent(searchLocation)}`);
  await expect(page.locator(".stock-table tbody tr")).toHaveCount(1);
  await page.locator(".jar-select").click();
  await page.getByLabel("Location", { exact: true }).fill("Other shelf");
  await page.getByLabel("Location", { exact: true }).blur();
  await expect(
    page.getByText("This jar is not in the current list."),
  ).toBeVisible();
  await expect(page.locator(".stock-table tbody tr")).toHaveCount(0);
  await page
    .getByRole("complementary")
    .getByRole("button", {
      name:
        testInfo.project.name === "phone" ? "Inventory" : "Close jar details",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching jars" }),
  ).toBeVisible();
});

test("desktop keeps a narrow list and reserves the same detail space before selection", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop split-pane layout");
  const maker = await create(request, "/manufacturers", {
    name: "Pane layout test",
  });
  const glaze = await create(request, "/glazes", {
    manufacturer_id: maker.id,
    name: "Blue Surf",
  });
  const jar = await create(request, "/containers", {
    glaze_id: glaze.id,
    tare_g: 100,
    full_weight_g: 500,
  });
  await create(request, `/containers/${jar.id}/measurements`, {
    request_id: crypto.randomUUID(),
    expected_revision: jar.revision,
    gross_g: 350,
  });
  for (const [width, height] of [
    [800, 800],
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/?q=${encodeURIComponent(`#${jar.number}`)}`);
    await expect(page.locator(".jar-select")).toBeVisible();
    const list = page.locator(".inventory-list");
    const placeholder = page.locator(".empty-detail-pane");
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toBeEmpty();
    const beforeList = await list.boundingBox();
    const beforePane = await placeholder.boundingBox();
    expect(beforeList!.width).toBeLessThanOrEqual(470);
    if (width >= 1024) expect(beforeList!.width).toBe(470);
    expect(beforePane!.width).toBeGreaterThanOrEqual(360);
    expect(beforePane!.x).toBeGreaterThan(beforeList!.x + beforeList!.width);
    const beforeColumns = await page
      .locator(".stock-table thead th")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().width),
      );
    await page.locator(".jar-select").click();
    const pane = page.getByRole("complementary", { name: "Jar details" });
    await expect(pane).toBeVisible();
    await expect(pane.locator(".big-weight")).toHaveText("250 g");
    expect(await list.boundingBox()).toEqual(beforeList);
    expect(await pane.boundingBox()).toEqual(beforePane);
    const contentWidth = await pane
      .locator(".pane-content")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(contentWidth).toBe(
      await pane.evaluate((element) => element.clientWidth),
    );
    expect(
      await page
        .locator(".stock-table thead th")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().width),
        ),
    ).toEqual(beforeColumns);
    await pane.getByRole("button", { name: "Close jar details" }).click();
    await expect(placeholder).toBeVisible();
    expect(await list.boundingBox()).toEqual(beforeList);
    expect(await placeholder.boundingBox()).toEqual(beforePane);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
});

test("jar heading links open the selected glaze and manufacturer", async ({
  page,
  request,
}) => {
  const maker = await create(request, "/manufacturers", {
    name: "AMACO Brent",
  });
  const glaze = await create(request, "/glazes", {
    manufacturer_id: maker.id,
    name: "Ancient Copper",
    product_code: "PC-56",
  });
  const jar = await create(request, "/containers", { glaze_id: glaze.id });
  await page.goto(`/containers/${jar.id}`);
  const header = page.locator(".jar-detail-pane .detail-heading");
  await expect(header.getByRole("heading")).toHaveText(
    `Ancient Copper #${jar.number}`,
  );
  await expect(header.locator(".detail-code")).toHaveText(
    "AMACO Brent · PC-56",
  );
  await expect(
    header.getByRole("link", { name: "Ancient Copper", exact: true }),
  ).toHaveAttribute("href", `/glazes/${glaze.id}`);
  await header
    .getByRole("link", { name: "Ancient Copper", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/glazes/${glaze.id}$`));
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Glazes", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Ancient Copper",
  );
  await expect(
    page.locator(`.catalog-select[href="/glazes/${glaze.id}"]`),
  ).toHaveAttribute("aria-current", "true");
  await page.goBack();
  await expect(header.getByRole("heading")).toHaveText(
    `Ancient Copper #${jar.number}`,
  );
  await expect(
    header.getByRole("link", { name: "AMACO Brent", exact: true }),
  ).toHaveAttribute("href", `/settings#manufacturer-${maker.id}`);
  await header.getByRole("link", { name: "AMACO Brent", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/settings#manufacturer-${maker.id}$`),
  );
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Settings", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const manufacturer = page.locator(`#manufacturer-${maker.id}`);
  await expect(manufacturer).toBeFocused();
  await expect(manufacturer.getByLabel("Name", { exact: true })).toHaveValue(
    "AMACO Brent",
  );
});

test("search narrows inventory without filter controls or hidden URL filters", async ({
  page,
  request,
}) => {
  const suffix = crypto.randomUUID();
  const maker = await create(request, "/manufacturers", {
    name: `Search maker ${suffix}`,
  });
  const glaze = await create(request, "/glazes", {
    manufacturer_id: maker.id,
    name: `Blue Rutile ${suffix}`,
    product_code: `PC-20-${suffix}`,
    product_line: `Potter's Choice ${suffix}`,
  });
  const jar = await create(request, "/containers", {
    glaze_id: glaze.id,
    location: `Kiln shelf ${suffix}`,
  });
  const total = (await (await request.get("/api/v1/containers")).json()).total;
  await page.goto("/");
  const rows = page.locator(".stock-table tbody tr");
  await expect(rows).toHaveCount(Math.min(100, total));
  await expect(
    page.getByRole("button", { name: /Filters|Filter inventory/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Search inventory", exact: true })
    .click();
  const search = page.getByLabel("Search jars");
  for (const query of [
    glaze.name,
    glaze.product_code,
    maker.name,
    jar.location,
    glaze.product_line,
    `#${jar.number}`,
  ]) {
    await search.fill(query.toUpperCase());
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-jar-id", jar.id);
  }
  await search.fill(`No match ${suffix}`);
  await expect(
    page.getByRole("heading", { name: "No matching jars", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear and close search" }).click();
  await expect(rows).toHaveCount(Math.min(100, total));
  await expect(search).toBeHidden();
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);

  await page.goto(
    `/?q=${encodeURIComponent(glaze.name)}&status=archived&manufacturer_id=missing&glaze_id=missing&location=missing&cone=06&page=9`,
  );
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-jar-id", jar.id);
  await expect(search).toHaveValue(glaze.name);
  await expect
    .poll(() => [...new URL(page.url()).searchParams.keys()])
    .toEqual(["q"]);
  // Collapsing search cannot leave an invisible search restriction behind.
  await page
    .getByRole("button", { name: "Search inventory", exact: true })
    .click();
  await expect(search).toBeHidden();
  await expect(rows).toHaveCount(Math.min(100, total));
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
});
