import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function create(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(`/api/v1${path}`, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("glazes keep selection, search, and edits in a dedicated detail pane", async ({
  page,
  request,
}, testInfo) => {
  const phone = testInfo.project.name === "phone";
  const prefix = `Pane glaze ${testInfo.project.name} ${Date.now()}`;
  const maker = await create(request, "/manufacturers", {
    name: `${prefix} supplier`,
  });
  for (let i = 0; i < 25; i++)
    await create(request, "/glazes", {
      name: `${prefix} ${String(i).padStart(2, "0")}`,
      manufacturer_id: maker.id,
      product_code: `PC-${i}`,
    });
  await page.goto("/catalog");
  const list = page.getByRole("region", {
    name: "Glazes",
    exact: true,
    includeHidden: true,
  });
  await expect(list).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(
    page.getByText("Product information shared by your jars."),
  ).toHaveCount(0);
  const placeholder = page.locator(".empty-detail-pane");
  if (phone) await expect(placeholder).toBeHidden();
  else {
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toBeEmpty();
  }
  const searchToggle = page.getByRole("button", {
    name: "Search glazes",
    exact: true,
  });
  await expect(page.getByLabel("Search catalog")).toHaveCount(0);
  await expect(searchToggle).toHaveAttribute("aria-expanded", "false");
  await searchToggle.click();
  await expect(page.getByLabel("Search catalog")).toBeFocused();
  await page.getByLabel("Search catalog").fill(prefix);
  const links = list.locator(".catalog-select");
  await expect(links).toHaveCount(25);
  const link = links.nth(20);
  const originalName = await link.locator("strong").innerText();
  const href = (await link.getAttribute("href"))!;
  const id = href.split("/")[2].split("?")[0];
  await link.scrollIntoViewIfNeeded();
  const scroll = await list
    .locator(".inventory-table-scroll")
    .evaluate((el) => el.scrollTop);
  const listBounds = await list.boundingBox();
  const paneBounds = await placeholder.boundingBox();
  await link.click();
  const pane = page.getByRole("complementary", {
    name: "Glaze details",
  });
  await expect(
    pane.getByRole("heading", { name: originalName, exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("link", { name: "Glazes", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  if (phone) await expect(list).toBeHidden();
  else {
    await expect(list).toBeVisible();
    expect(await list.boundingBox()).toEqual(listBounds);
    expect(await pane.boundingBox()).toEqual(paneBounds);
    await expect(link).toHaveAttribute("aria-current", "true");
  }
  const input = pane.getByLabel("Name", { exact: true });
  await input.fill(`${originalName} edited`);
  await input.blur();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/v1/glazes/${id}`)).json()).name,
    )
    .toBe(`${originalName} edited`);
  await expect(link.locator("strong")).toHaveText(`${originalName} edited`);
  await page.screenshot({
    path: testInfo.outputPath("glazes-selected.png"),
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await pane
    .getByRole("button", {
      name: phone ? "Glazes" : "Close glaze details",
      exact: true,
    })
    .click();
  await expect(pane).toHaveCount(0);
  await expect(page.getByLabel("Search catalog")).toHaveValue(prefix);
  await expect
    .poll(() =>
      list.locator(".inventory-table-scroll").evaluate((el) => el.scrollTop),
    )
    .toBe(scroll);
  await link.click();
  await expect(pane).toBeVisible();
  await page.goBack();
  await expect(pane).toHaveCount(0);
  await expect(page.getByLabel("Search catalog")).toHaveValue(prefix);
  await expect
    .poll(() =>
      list.locator(".inventory-table-scroll").evaluate((el) => el.scrollTop),
    )
    .toBe(scroll);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByLabel("Search catalog")
    .fill(`No match ${crypto.randomUUID()}`);
  await expect(
    list.getByRole("heading", { name: "No matching records" }),
  ).toBeVisible();
  const query = new URL(page.url()).searchParams.get("q")!;
  await page.reload();
  await expect(searchToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Search catalog")).toHaveValue(query);
  await page.getByRole("button", { name: "Clear and close search" }).click();
  await expect(page.getByLabel("Search catalog")).toHaveCount(0);
  await expect(searchToggle).toHaveAttribute("aria-expanded", "false");
  await expect(list.locator(`#catalog-${id}`)).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  await searchToggle.click();
  await page.getByLabel("Search catalog").fill(prefix);
  await searchToggle.click();
  await expect(page.getByLabel("Search catalog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
});

test("manufacturers are listed, added, and edited inline in Settings", async ({
  page,
  request,
}) => {
  await page.goto("/catalog?tab=manufacturers");
  await expect(page).toHaveURL(/\/settings#manufacturers$/);
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Manufacturers" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const list = page.getByRole("region", { name: "Manufacturers" });
  const add = list.getByRole("button", { name: "Add", exact: true });
  await add.click();
  const form = list.getByRole("form", { name: "New manufacturer" });
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await add.click();
  const name = "Studio supplier " + crypto.randomUUID();
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  const row = list.getByRole("group", { name, exact: true });
  await expect(row.getByLabel("Name")).toHaveValue(name);
  const notes = row.getByLabel("Notes");
  await notes.fill("Local supplier");
  await notes.blur();
  const id = await row.getAttribute("data-manufacturer-id");
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/v1/manufacturers/${id}`)).json()).notes,
    )
    .toBe("Local supplier");
  await page.goto(`/manufacturers/${id}`);
  await expect(page).toHaveURL(new RegExp(`/settings#manufacturer-${id}$`));
  await expect(row).toBeFocused();
  await expect(notes).toHaveValue("Local supplier");
});
