import { expect, test } from "@playwright/test";

test("each list remembers its order across navigation and refreshes, with explicit links taking precedence", async ({
  page,
  request,
}) => {
  const prefix = `Sort preference ${crypto.randomUUID()}`;
  const names = (...suffixes: string[]) =>
    suffixes.map((suffix) => `${prefix} ${suffix}`);
  for (const [suffix, product_line, location] of [
    ["Copper", "Matte", "Gallery"],
    ["Amber", "Satin", "Studio"],
    ["Blue", "Gloss", "Rack"],
  ]) {
    const name = `${prefix} ${suffix}`;
    const response = await request.post("/api/v1/glazes", {
      data: { name, product_line },
    });
    expect(response.ok()).toBeTruthy();
    const glaze = await response.json();
    expect((await request.post("/api/v1/containers", {
      data: { glaze_id: glaze.id },
    })).ok()).toBeTruthy();
    expect((await request.post("/api/v1/vessels", {
      data: { name, location },
    })).ok()).toBeTruthy();
  }

  const screens = [
    {
      section: "inventory",
      nav: "Inventory",
      path: "/",
      defaultColumn: "ID",
      defaultSort: "number",
      defaultNames: names("Copper", "Amber", "Blue"),
      column: "Name",
      sortedNames: names("Copper", "Blue", "Amber"),
    },
    {
      section: "glazes",
      nav: "Glazes",
      path: "/catalog",
      defaultColumn: "Name",
      defaultSort: "name",
      defaultNames: names("Amber", "Blue", "Copper"),
      column: "Product Line",
      sortedNames: names("Amber", "Copper", "Blue"),
    },
    {
      section: "vessels",
      nav: "Vessels",
      path: "/vessels",
      defaultColumn: "ID",
      defaultSort: "id",
      defaultNames: names("Copper", "Amber", "Blue"),
      column: "Location",
      sortedNames: names("Amber", "Blue", "Copper"),
    },
  ];

  for (const screen of screens) {
    await page.goto(`${screen.path}?q=${encodeURIComponent(prefix)}`);
    const list = page.locator(`#${screen.section}-list`);
    await expect(list.getByRole("columnheader", {
      name: screen.defaultColumn, exact: true,
    })).toHaveAttribute("aria-sort", "ascending");
    await expect(list.locator("tbody strong")).toHaveText(screen.defaultNames);
    const column = list.getByRole("columnheader", {
      name: screen.column, exact: true,
    });
    await column.getByRole("button").click();
    await column.getByRole("button").click();
    await expect(column).toHaveAttribute("aria-sort", "descending");
    await expect(list.locator("tbody strong")).toHaveText(screen.sortedNames);
    // Selecting the current navigation link removes the sort from the URL
    // without necessarily remounting the screen.
    await page.getByRole("navigation").getByRole("link", {
      name: screen.nav, exact: true,
    }).click();
    await expect(column).toHaveAttribute("aria-sort", "descending");
  }

  for (const screen of screens) {
    const url = `${screen.path}?q=${encodeURIComponent(prefix)}`;
    await page.goto(url);
    await page.reload();
    const list = page.locator(`#${screen.section}-list`);
    await expect(list.getByRole("columnheader", {
      name: screen.column, exact: true,
    })).toHaveAttribute("aria-sort", "descending");
    await expect(list.locator("tbody strong")).toHaveText(screen.sortedNames);

    await page.goto(`${url}&sort=${screen.defaultSort}`);
    await expect(list.getByRole("columnheader", {
      name: screen.defaultColumn, exact: true,
    })).toHaveAttribute("aria-sort", "ascending");
    await expect(list.locator("tbody strong")).toHaveText(screen.defaultNames);
  }

  for (const stored of ["{", JSON.stringify({ sort: "unknown", descending: true })]) {
    await page.evaluate((value) => {
      localStorage.setItem("glaze-manager.vessels-sort", value);
    }, stored);
    await page.goto(`/vessels?q=${encodeURIComponent(prefix)}`);
    await expect(page.getByRole("columnheader", {
      name: "ID", exact: true,
    })).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("#vessels-list tbody strong")).toHaveText(
      names("Copper", "Amber", "Blue"),
    );
  }
});
