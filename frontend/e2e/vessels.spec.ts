import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { selectOption } from "./select-option";

const tile = {
  name: "sample.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPElEQVR4nO3RQREAMAjEwKP+TdREXeCpEsKHX1bAMRPq3c6ms7oeDwz4A2QiZCJkImQiZCJkImQiZKKQD4HWAmQfdnzhAAAAAElFTkSuQmCC",
    "base64",
  ),
};

test("vessels and inventory align their ID, thumbnail, and name", async ({
  page,
  request,
}) => {
  const name = `Layout ${crypto.randomUUID()}`;
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1/${path}`, { data });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
  const maker = await create("manufacturers", { name });
  const glaze = await create("glazes", { manufacturer_id: maker.id, name });
  await create("containers", { glaze_id: glaze.id });
  await create("vessels", { name });

  async function layout(path: string) {
    await page.goto(`${path}?q=${encodeURIComponent(name)}`);
    const table = page.getByRole("table");
    await expect(table.getByRole("link")).toBeVisible();
    return table.evaluate((element: HTMLTableElement) => {
      const headers = element.tHead!.rows[0].cells;
      const cells = element.tBodies[0].rows[0].cells;
      const left = (node: Element) =>
        node.getBoundingClientRect().left -
        element.getBoundingClientRect().left;
      return {
        idWidth: headers[0].getBoundingClientRect().width,
        nameHeading: left(headers[1].querySelector("button")!),
        thumbnail: left(cells[1].querySelector(".glaze-thumb")!),
        name: left(cells[1].querySelector("strong")!),
        locationWidth:
          headers[headers.length - 1].getBoundingClientRect().width,
      };
    });
  }
  const inventory = await layout("/");
  expect(await layout("/vessels")).toEqual(inventory);
});

test("sort vessels by ID and name and keep the order when opening a vessel", async ({
  page,
  request,
}) => {
  const prefix = `Sort ${crypto.randomUUID()}`;
  for (const [suffix, location] of [
    ["Cup", "Studio"],
    ["Bowl", "Rack"],
    ["Vase", "Gallery"],
  ]) {
    const response = await request.post("/api/v1/vessels", {
      data: { name: `${prefix} ${suffix}`, location },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.goto(`/vessels?q=${encodeURIComponent(prefix)}`);
  const table = page.getByRole("table", { name: "Vessels" });
  await expect(table.getByRole("columnheader")).toHaveText([
    "ID",
    "Name",
    "Location",
  ]);
  const name = table.getByRole("columnheader", { name: "Name" });
  const id = table.getByRole("columnheader", { name: "ID" });
  const links = table.getByRole("link");
  const expected = (...suffixes: string[]) =>
    suffixes.map((suffix) => `${prefix} ${suffix}`);
  await expect(links).toHaveText(expected("Bowl", "Cup", "Vase"));
  await name.getByRole("button").click();
  await expect(name).toHaveAttribute("aria-sort", "descending");
  await expect(links).toHaveText(expected("Vase", "Cup", "Bowl"));
  await id.getByRole("button").click();
  await expect(id).toHaveAttribute("aria-sort", "ascending");
  await expect(links).toHaveText(expected("Cup", "Bowl", "Vase"));
  await id.getByRole("button").press("Enter");
  await expect(id).toHaveAttribute("aria-sort", "descending");
  await expect(links).toHaveText(expected("Vase", "Bowl", "Cup"));
  await links.first().click();
  await expect(
    page.getByRole("complementary", { name: "Vessel details" }),
  ).toBeVisible();
  await page.goBack();
  await expect(id).toHaveAttribute("aria-sort", "descending");
  await expect(links).toHaveText(expected("Vase", "Bowl", "Cup"));
  const location = table.getByRole("columnheader", { name: "Location" });
  await location.getByRole("button").click();
  await expect(location).toHaveAttribute("aria-sort", "ascending");
  await expect(links).toHaveText(expected("Vase", "Bowl", "Cup"));
  await location.getByRole("button").click();
  await expect(location).toHaveAttribute("aria-sort", "descending");
  await expect(links).toHaveText(expected("Cup", "Bowl", "Vase"));
});

test("locate, archive, and restore a vessel with type-specific suggestions", async ({
  page,
  request,
}, testInfo) => {
  const prefix = crypto.randomUUID();
  const shelf = `${prefix} display`;
  const cabinet = `${prefix} supplies`;
  const name = `Bowl ${prefix}`;
  const maker = await (
    await request.post("/api/v1/manufacturers", { data: { name: prefix } })
  ).json();
  const glaze = await (
    await request.post("/api/v1/glazes", {
      data: { name: prefix, manufacturer_id: maker.id },
    })
  ).json();
  const jar = await (
    await request.post("/api/v1/containers", {
      data: { glaze_id: glaze.id, location: cabinet },
    })
  ).json();
  await request.post("/api/v1/vessels", {
    data: { name: "Plate", location: shelf },
  });

  await page.goto(`/vessels/new?q=${encodeURIComponent(name)}`);
  const pane = page.getByRole("complementary", { name: "Vessel details" });
  await pane.getByLabel("Name", { exact: true }).fill(name);
  const location = page.getByRole("combobox", {
    name: "Location",
    exact: true,
  });
  await location.fill(prefix);
  const suggestions = page.getByRole("listbox", {
    name: "Location suggestions",
  });
  await expect(suggestions.getByRole("option")).toHaveText([shelf]);
  await suggestions.getByRole("option").click();
  await pane.getByRole("button", { name: "Add vessel" }).click();
  await expect(
    pane.getByRole("heading", { name: new RegExp(name) }),
  ).toBeVisible();
  await expect(location).toHaveValue(shelf);
  await location.click();
  await expect(suggestions.getByRole("option")).toHaveText([shelf]);
  await location.press("Escape");

  await pane.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    pane.getByRole("button", { name: "Restore vessel" }),
  ).toBeVisible();
  const close = pane.getByRole("button", {
    name:
      testInfo.project.name === "phone" ? "Vessels" : "Close vessel details",
    exact: true,
  });
  await close.click();
  const table = page.getByRole("table", { name: "Vessels" });
  await expect(table.getByRole("link")).toHaveCount(0);
  const toggle = page.getByRole("checkbox", { name: "Show archived" });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(toggle).toBeChecked();
  await table.getByRole("link", { name: /, archived$/ }).click();
  await pane.getByRole("button", { name: "Restore vessel" }).click();
  await expect(
    pane.getByRole("button", { name: "Archive", exact: true }),
  ).toBeVisible();
  await close.click();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(table.getByRole("cell", { name: shelf })).toBeVisible();

  await page.goto(`/containers/${jar.id}`);
  await location.fill(prefix);
  await expect(suggestions.getByRole("option")).toHaveText([cabinet]);
});

test("record a numbered vessel and navigate its photos from a glaze", async ({
  page,
  request,
}, testInfo) => {
  const maker = await (
    await request.post("/api/v1/manufacturers", {
      data: { name: `Test studio ${testInfo.project.name}` },
    })
  ).json();
  const glaze = await (
    await request.post("/api/v1/glazes", {
      data: {
        manufacturer_id: maker.id,
        name: "Rutile blue",
        product_code: "RB",
      },
    })
  ).json();
  await request.post(`/api/v1/glazes/${glaze.id}/photos`, {
    multipart: { file: tile },
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Vessels" })
    .click();
  await page.getByRole("link", { name: "Add vessel" }).click();
  const pane = page.getByRole("complementary", { name: "Vessel details" });
  await pane.getByLabel("Name", { exact: true }).fill("Carved bowl");
  const shelf = `Workshop shelf ${testInfo.project.name}`;
  await pane.getByLabel("Location", { exact: true }).fill(shelf);
  await pane.getByRole("button", { name: "Add vessel" }).click();
  await expect(page).toHaveURL(/\/vessels\/\d+$/);
  const number = new URL(page.url()).pathname.split("/").pop();
  const title = `Carved bowl #${number}`;
  await expect(pane.getByRole("heading", { name: title })).toBeVisible();
  const photos = page.getByRole("region", { name: "Photos", exact: true });
  await photos.getByLabel("Add vessel photo").setInputFiles(tile);
  await expect(photos.getByRole("img")).toHaveCount(1);
  const used = pane.getByRole("region", { name: "Glazes", exact: true });
  await expect(used.getByRole("heading")).toHaveText("Glazes 0");
  await expect(photos).toHaveCSS("border-bottom-width", "1px");
  const add = used.getByRole("button", { name: "Add", exact: true });
  const right = (element: Element) => element.getBoundingClientRect().right;
  expect(await add.evaluate(right)).toBe(await used.evaluate(right));
  await add.click();
  const form = used.getByRole("form", { name: "New glaze application" });
  await selectOption(page, "Glaze", `${maker.name} · Rutile blue (RB)`);
  await form.getByLabel("Application note").fill("3 coats");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(used.getByLabel("Application note")).toHaveValue("3 coats");
  await expect(used.getByLabel("Application note")).toHaveCSS(
    "border-bottom-style",
    "solid",
  );
  await add.click();
  await form.getByLabel("Application note").fill("coa");
  await expect(page.getByRole("option", { name: "3 coats" })).toBeVisible();
  await page.getByRole("option", { name: "3 coats" }).click();
  await expect(form.getByLabel("Application note")).toHaveValue("3 coats");
  await form.getByRole("button", { name: "Cancel" }).click();

  await used.getByRole("link", { name: glaze.name }).click();
  const reverse = page.getByRole("region", { name: "Vessels", exact: true });
  await expect(reverse.getByRole("link", { name: title })).toBeVisible();
  await expect(reverse.getByRole("cell", { name: shelf })).toBeVisible();
  await expect(photos.getByRole("img")).toHaveCount(2);
  await expect(
    photos.getByRole("button", { name: "Delete photo" }),
  ).toHaveCount(1);
  const source = photos.getByRole("link", {
    name: "Carved bowl",
    exact: true,
  });
  await expect(source).toHaveAttribute("href", `/vessels/${number}`);
  page.once("dialog", (d) => d.accept());
  await photos.getByRole("button", { name: "Delete photo" }).click();
  await expect(photos.getByRole("img")).toHaveCount(1);
  await expect(
    photos.getByRole("button", { name: "Delete photo" }),
  ).toHaveCount(0);
  await source.click();
  await expect(pane.getByRole("heading", { name: title })).toBeVisible();
  await expect(
    photos.getByRole("button", { name: "Delete photo" }),
  ).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await pane
    .getByRole("button", {
      name:
        testInfo.project.name === "phone" ? "Vessels" : "Close vessel details",
      exact: true,
    })
    .click();
  const toggle = page.getByRole("button", { name: "Search vessels" });
  const search = page.getByRole("textbox", { name: "Search vessels" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(search).toHaveCount(0);
  await toggle.click();
  await expect(search).toBeFocused();
  await search.fill(`#${number}`);
  await page.reload();
  await expect(search).toHaveValue(`#${number}`);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  const list = page.getByRole("table", { name: "Vessels" });
  await expect(list.getByRole("row")).toHaveCount(2);
  await expect(
    list.getByRole("cell", { name: `#${number}`, exact: true }),
  ).toBeVisible();
  await expect(list.locator("img")).toBeVisible();
  await page.getByRole("button", { name: "Clear and close search" }).click();
  await expect(toggle).toBeFocused();
  await expect(search).toHaveCount(0);
  await expect(page).toHaveURL(/\/vessels$/);
  await page.getByRole("link", { name: title }).click();
  page.once("dialog", (d) => d.accept());
  await used
    .getByRole("button", { name: "Remove Rutile blue application" })
    .click();
  await expect(used.getByText("No glazes recorded.")).toBeVisible();
  await page.goto(`/glazes/${glaze.id}`);
  await expect(
    reverse.getByText("No vessels use this glaze yet."),
  ).toBeVisible();
  await expect(photos.getByRole("img")).toHaveCount(0);
});
