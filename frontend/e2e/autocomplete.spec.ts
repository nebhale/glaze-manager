import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type APIRequestContext,
} from "@playwright/test";
import { selectOption } from "./select-option";

async function enter(input: Locator, value: string) {
  // Click as a user would so off-screen fields scroll into view in WebKit.
  await input.click();
  await input.fill(value);
}

async function setup(request: APIRequestContext) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const create = async (path: string, data: object) => {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const maker = await create("/manufacturers", {
    name: `Autocomplete ${suffix}`,
  });
  const productLine = `Potter’s Choice ${suffix}`;
  const location = `West shelf ${suffix}`;
  const other = await create("/glazes", {
    manufacturer_id: maker.id,
    name: `Stored glaze ${suffix}`,
    product_line: productLine,
  });
  await create("/glazes", {
    manufacturer_id: maker.id,
    name: `Duplicate value ${suffix}`,
    product_line: productLine.toLowerCase(),
  });
  const storedJar = await create("/containers", {
    glaze_id: other.id,
    location,
  });
  await request.patch(`/api/v1/containers/${storedJar.id}`, {
    data: { expected_revision: storedJar.revision, archived: true },
  });
  const glaze = await create("/glazes", {
    manufacturer_id: maker.id,
    name: `Editable glaze ${suffix}`,
  });
  const jar = await create("/containers", { glaze_id: glaze.id });
  const read = async (path: string) =>
    (await request.get(`/api/v1${path}`)).json();
  return { suffix, create, read, maker, productLine, location, glaze, jar };
}

test("inline fields filter saved values and support keyboard, pointer and free text", async ({
  page,
  request,
}, testInfo) => {
  const { suffix, read, productLine, location, glaze, jar } =
    await setup(request);
  await page.goto(`/containers/${jar.id}`);
  const locationInput = page.getByRole("combobox", {
    name: "Location",
    exact: true,
  });
  await enter(locationInput, `WEST SHELF ${suffix}`);
  const option = page.getByRole("option", { name: location, exact: true });
  await expect(option).toBeVisible();
  await locationInput.press("ArrowDown");
  await locationInput.press("Enter");
  await expect(locationInput).toHaveValue(location);
  await expect(locationInput).toBeFocused();
  await expect
    .poll(async () => (await read(`/containers/${jar.id}`)).location)
    .toBe(location);
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await page.goto(`/glazes/${glaze.id}`);
  const line = page.getByRole("combobox", {
    name: "Product line",
    exact: true,
  });
  await enter(line, `CHOICE ${suffix}`);
  const lines = page.getByRole("listbox", { name: "Product line suggestions" });
  await expect(lines.getByRole("option")).toHaveCount(1);
  await expect(lines).toHaveCSS("background-color", "rgb(255, 255, 255)");
  if (testInfo.project.name === "phone") await lines.getByRole("option").tap();
  else await lines.getByRole("option").click();
  await expect(line).toHaveValue(productLine);
  await expect(line).toBeFocused();
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).product_line)
    .toBe(productLine);
  await enter(line, `New line ${suffix}`);
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).product_line)
    .toBe(`New line ${suffix}`);
  await enter(line, "");
  await line.blur();
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).product_line)
    .toBeNull();

  await page.goto(`/containers/${jar.id}`);
  await enter(locationInput, location);
  await locationInput.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(
    page.getByRole("listbox", { name: "Location suggestions" }),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("location-suggestions.png"),
    fullPage: true,
  });
  await locationInput.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(locationInput).toHaveValue(location);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("suggestions update from other saved records without reloading or replacing a draft", async ({
  page,
  request,
}) => {
  const { suffix, create, read, maker, glaze, jar } = await setup(request);
  await page.goto(`/containers/${jar.id}`);
  const input = page.getByRole("combobox", { name: "Location", exact: true });
  const next = `Fresh shelf ${suffix}`;
  await enter(input, `Fresh ${suffix}`);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const match = `Fresh ${suffix} shelf`;
  await create("/containers", { glaze_id: glaze.id, location: match });
  await expect(
    page.getByRole("option", { name: match, exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue(`Fresh ${suffix}`);
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect
    .poll(async () => (await read(`/containers/${jar.id}`)).location)
    .toBe(match);

  await page.goto(`/glazes/${glaze.id}`);
  const line = page.getByRole("combobox", {
    name: "Product line",
    exact: true,
  });
  await enter(line, next);
  await create("/glazes", {
    manufacturer_id: maker.id,
    name: "New source",
    product_line: `${next} line`,
  });
  await expect(
    page.getByRole("option", { name: `${next} line`, exact: true }),
  ).toBeVisible();
  await expect(line).toHaveValue(next);
  await line.press("ArrowDown");
  await line.press("Enter");
  await expect
    .poll(async () => (await read(`/glazes/${glaze.id}`)).product_line)
    .toBe(`${next} line`);
});

test("glaze and jar creation forms use the same autocomplete", async ({
  page,
  request,
}) => {
  const { suffix, read, maker, productLine, location, glaze } =
    await setup(request);
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Add glaze", exact: true }).click();
  const form = page.getByRole("region", { name: "Glaze", exact: true });
  await selectOption(page, "Manufacturer", maker.name);
  await form.getByLabel("Name", { exact: true }).fill(`New glaze ${suffix}`);
  await enter(form.getByLabel("Product line"), suffix);
  await page.getByRole("option", { name: productLine, exact: true }).click();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form).toHaveCount(0);
  const glazes = await read(
    `/glazes?q=${encodeURIComponent(`New glaze ${suffix}`)}`,
  );
  expect(glazes.items[0].product_line).toBe(productLine);

  await page.goto(`/glazes/${glaze.id}`);
  await page.getByRole("button", { name: "Add a jar", exact: true }).click();
  const jarForm = page.getByRole("region", {
    name: "Jar",
    exact: true,
  });
  await enter(jarForm.getByLabel("Location", { exact: true }), suffix);
  await page.getByRole("option", { name: location, exact: true }).click();
  await jarForm.getByRole("button", { name: "Add", exact: true }).click();
  await expect(jarForm).toHaveCount(0);
  const jars = await read(`/containers?glaze_id=${glaze.id}`);
  expect(
    jars.items.some((item: { location: string }) => item.location === location),
  ).toBeTruthy();
});
