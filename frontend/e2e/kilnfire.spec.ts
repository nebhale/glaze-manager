import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const origin = "https://studio.kilnfire.com";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAPElEQVR4nO3RQREAMAjEwKP+TdREXeCpEsKHX1bAMRPq3c6ms7oeDwz4A2QiZCJkImQiZCJkImQiZCJkImQiZKKQD4HWAmQfdnzhAAAAAElFTkSuQmCC",
  "base64",
);

async function kilnfire(
  page: Page,
  request: APIRequestContext,
  connected = true,
) {
  const status = {
    endpoint: connected ? origin : null,
    state: connected ? "connected" : "not_configured",
    checked_at: null,
  };
  const pieces = [
    {
      piece_id: 11,
      name: "Carved cup",
      firing_type: "Bisque",
      created_at: "2026-10-01T00:00:00Z",
      image_count: 2,
    },
    {
      piece_id: 12,
      name: "Tall vase",
      firing_type: "Glaze",
      created_at: "2026-10-03T00:00:00Z",
      image_count: 1,
    },
    {
      piece_id: 13,
      name: "Wide bowl",
      firing_type: null,
      created_at: "2026-10-02T00:00:00Z",
      image_count: 1,
    },
  ].map((p) => ({
    ...p,
    url: `${origin}/pieces/${p.piece_id}`,
    thumbnail_url: "/kilnfire-test-image.png",
    archived: false,
    vesselId: null as number | null,
  }));
  const imports: Record<string, unknown>[] = [];
  let refreshes = 0;
  let expired = false;
  let loginBody: unknown;
  await page.route("**/kilnfire-test-image.png", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route(/\/api\/v1\/vessels\/\d+(?:\/kilnfire)?$/, async (route) => {
    const url = new URL(route.request().url());
    const vesselId = Number(url.pathname.split("/")[4]);
    const linked = pieces.find((p) => p.vesselId === vesselId);
    if (
      url.pathname.endsWith("/kilnfire") &&
      route.request().method() === "DELETE"
    ) {
      if (linked) linked.vesselId = null;
      const old = await (
        await request.get(`/api/v1/vessels/${vesselId}`)
      ).json();
      return route.fulfill({
        json: { ...old, source_url: null, kilnfire_link: null },
      });
    }
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    return route.fulfill({
      json: {
        ...body,
        source_url: linked ? linked.url : null,
        kilnfire_link: linked
          ? { endpoint: origin, piece_id: linked.piece_id }
          : null,
      },
    });
  });
  await page.route(/\/api\/v1\/kilnfire(?:[/?]|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1/kilnfire", "");
    if (!path) {
      if (req.method() === "PUT") {
        status.endpoint = req.postDataJSON().endpoint;
        status.state = "signed_out";
      }
      if (req.method() === "DELETE") status.state = "signed_out";
      return route.fulfill({ json: status });
    }
    if (path === "/login") {
      loginBody = req.postDataJSON();
      status.state = "connected";
      expired = false;
      return route.fulfill({ json: status });
    }
    if (path === "/check") return route.fulfill({ json: status });
    if (path === "/pieces/refresh") {
      refreshes += 1;
      if (expired) {
        status.state = "needs_login";
        return route.fulfill({
          status: 401,
          json: {
            detail:
              "Your Kilnfire session has expired. Sign in again in Settings.",
          },
        });
      }
      return route.fulfill({ json: { count: pieces.length } });
    }
    if (path === "/vessel-options") {
      return route.fallback();
    }
    if (path === "/pieces") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const showArchived = url.searchParams.get("show_archived") === "true";
      const items = pieces.filter(
        (p) =>
          !p.vesselId &&
          (!p.archived || showArchived) &&
          p.name.toLowerCase().includes(q),
      );
      items.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return route.fulfill({
        json: { items, total: items.length, page: 1, page_size: 48 },
      });
    }
    const match = path.match(/^\/pieces\/(\d+)(\/import)?$/);
    const piece = pieces.find((p) => p.piece_id === Number(match?.[1]));
    if (piece && req.method() === "PATCH") {
      piece.archived = req.postDataJSON().archived;
      return route.fulfill({ json: piece });
    }
    if (piece && match?.[2]) {
      const body = req.postDataJSON();
      imports.push(body);
      let vessel;
      if (body.vessel_id) {
        const old = await (
          await request.get(`/api/v1/vessels/${body.vessel_id}`)
        ).json();
        vessel = await (
          await request.patch(`/api/v1/vessels/${body.vessel_id}`, {
            data: {
              changes: { name: piece.name },
              expected: { name: old.name },
            },
          })
        ).json();
      } else
        vessel = await (
          await request.post("/api/v1/vessels", {
            data: { name: piece.name },
          })
        ).json();
      for (let index = 0; index < piece.image_count; index++) {
        await request.post(`/api/v1/vessels/${vessel.id}/photos`, {
          multipart: {
            file: { name: "import.png", mimeType: "image/png", buffer: png },
          },
        });
      }
      piece.vesselId = vessel.id;
      const result = await (
        await request.get(`/api/v1/vessels/${vessel.id}`)
      ).json();
      return route.fulfill({
        json: {
          ...result,
          source_url: piece.url,
          kilnfire_link: { endpoint: origin, piece_id: piece.piece_id },
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { detail: "Unexpected test request" },
    });
  });
  return {
    imports,
    get loginBody() {
      return loginBody;
    },
    get refreshes() {
      return refreshes;
    },
    expire() {
      expired = true;
    },
  };
}

test("configure a studio and sign in without retaining credentials in the form or browser storage", async ({
  page,
  request,
}, testInfo) => {
  const remote = await kilnfire(page, request, false);
  await page.goto("/settings#kilnfire");
  const section = page.getByRole("region", { name: "Kilnfire", exact: true });
  await section.getByLabel("Studio address").fill(origin);
  await section.getByLabel("Email", { exact: true }).fill("test@example.com");
  await section
    .getByLabel("Password", { exact: true })
    .fill("private fixture password");
  await section.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Kilnfire connected", exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("banner").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("kilnfire-connected.png"),
  });
  expect(remote.loginBody).toEqual({
    email: "test@example.com",
    password: "private fixture password",
  });
  expect(
    await page.evaluate(() => JSON.stringify([localStorage, sessionStorage])),
  ).not.toMatch(/private fixture password|test@example.com/);
  await section
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(section.getByLabel("Email", { exact: true })).toBeEmpty();
  await expect(section.getByLabel("Password", { exact: true })).toBeEmpty();
  await section.screenshot({
    path: testInfo.outputPath("kilnfire-sign-in.png"),
  });
});

test("search and archive image tiles, import photos, then unlink the vessel", async ({
  page,
  request,
}, testInfo) => {
  const remote = await kilnfire(page, request);
  await page.goto("/vessels");
  await page
    .getByRole("link", { name: "Import from Kilnfire", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(3);
  expect(remote.refreshes).toBe(1);
  const names = page.getByRole("article").getByRole("heading");
  await expect(names).toHaveText(["Tall vase", "Wide bowl", "Carved cup"]);
  await expect(page.getByRole("article").getByRole("img")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Items", exact: true }),
  ).toBeVisible();
  const searchToggle = page.getByRole("button", {
    name: "Search items",
    exact: true,
  });
  const search = page.getByRole("textbox", {
    name: "Search items",
    exact: true,
  });
  await expect(searchToggle).toHaveAttribute("aria-expanded", "false");
  await expect(search).toHaveCount(0);
  await searchToggle.click();
  await search.fill("cup");
  await expect(names).toHaveText(["Carved cup"]);
  await page.getByRole("button", { name: "Clear and close search" }).click();
  await expect(names).toHaveText(["Tall vase", "Wide bowl", "Carved cup"]);
  await page.getByRole("button", { name: "Archive Tall vase" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  const showArchived = page.getByRole("checkbox", { name: "Show archived" });
  await showArchived.click();
  await expect(showArchived).toBeChecked();
  await expect(
    page
      .getByRole("article", { name: "Tall vase", exact: true })
      .getByText("Archived", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore Tall vase" }).click();
  await showArchived.click();
  await expect(showArchived).not.toBeChecked();
  const cup = page.getByRole("article", { name: "Carved cup", exact: true });
  await cup
    .getByRole("button", { name: "Import Carved cup", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Carved cup",
    exact: true,
  });
  await expect(
    dialog.getByRole("radio", { name: "New vessel", exact: true }),
  ).toBeChecked();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
  const dialogBounds = await dialog.boundingBox();
  let finishImport!: () => void;
  const pendingImport = new Promise<void>((resolve) => {
    finishImport = resolve;
  });
  await page.route(
    "**/api/v1/kilnfire/pieces/11/import",
    async (route) => {
      await pendingImport;
      await route.fallback();
    },
    { times: 1 },
  );
  await dialog.screenshot({ path: testInfo.outputPath("import-dialog.png") });
  const importButton = dialog.getByRole("button", {
    name: "Import",
    exact: true,
  });
  await importButton.click();
  try {
    await expect(importButton).toHaveAttribute("aria-busy", "true");
    await expect(importButton).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    expect(await dialog.boundingBox()).toEqual(dialogBounds);
    await dialog.screenshot({
      path: testInfo.outputPath("import-dialog-pending.png"),
    });
  } finally {
    finishImport();
  }
  await expect(dialog).toHaveCount(0);
  await expect(cup).toHaveCount(0);
  expect(remote.imports[0]).toEqual({
    endpoint: origin,
    vessel_id: null,
    expected_name: null,
  });
  await page.getByRole("link", { name: /Open vessel #/ }).click();
  const detail = page.getByRole("complementary", { name: "Vessel details" });
  const kilnfireSection = detail.getByRole("region", {
    name: "Kilnfire",
    exact: true,
  });
  await expect(kilnfireSection).toContainText(`${origin}/pieces/11`);
  await expect(kilnfireSection.getByRole("textbox")).toHaveCount(0);
  await expect(
    kilnfireSection.getByRole("link", { name: "Open kilnfire in a new tab" }),
  ).toHaveAttribute("href", `${origin}/pieces/11`);
  await kilnfireSection.screenshot({
    path: testInfo.outputPath("kilnfire-link.png"),
  });
  await expect(
    detail
      .getByRole("region", { name: "Photos", exact: true })
      .getByRole("img"),
  ).toHaveCount(2);
  await kilnfireSection
    .getByRole("button", { name: "Unlink", exact: true })
    .click();
  await expect(kilnfireSection).toHaveCount(0);
  await expect(
    detail.getByRole("link", { name: "Open kilnfire in a new tab" }),
  ).toHaveCount(0);
  await page.goto("/vessels/import");
  await expect(page.getByRole("article")).toHaveCount(3);
  expect(remote.refreshes).toBe(2);
  await page.screenshot({
    path: testInfo.outputPath("kilnfire-import.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("choose an existing vessel in the import dialog and prompt for expired sign-in", async ({
  page,
  request,
}, testInfo) => {
  const remote = await kilnfire(page, request);
  const vessel = await (
    await request.post("/api/v1/vessels", {
      data: {
        name: `Before import ${testInfo.project.name}`,
        location: "Studio shelf",
      },
    })
  ).json();
  for (const [name, archived] of [
    ["Alpha bowl", true],
    ["Zulu bowl", false],
  ] as const) {
    const extra = await (
      await request.post("/api/v1/vessels", { data: { name } })
    ).json();
    if (archived)
      await request.patch(`/api/v1/vessels/${extra.id}`, {
        data: { changes: { archived: true }, expected: { archived: false } },
      });
  }
  await page.goto("/vessels/import");
  await page
    .getByRole("button", { name: "Import Tall vase", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Tall vase",
    exact: true,
  });
  await dialog
    .getByRole("radio", { name: "Existing vessel", exact: true })
    .check();
  const picker = dialog.getByRole("combobox", {
    name: "Existing vessel",
    exact: true,
  });
  const importButton = dialog.getByRole("button", {
    name: "Import",
    exact: true,
  });
  await expect(importButton).toBeDisabled();
  await picker.click();
  const list = dialog.getByRole("listbox", { name: "Vessels", exact: true });
  await expect(list.getByRole("option").first()).toContainText("Alpha bowl");
  const names = await list.locator(".vessel-picker-name").allTextContents();
  expect(names).toEqual(
    [...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    ),
  );
  await picker.fill("no matching vessel");
  await expect(list).toHaveText("No matching vessels.");
  await picker.fill("Before import");
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option").click();
  await expect(picker).toHaveValue(vessel.name);
  await expect(importButton).toBeEnabled();
  await picker.fill(`#${vessel.id}`);
  await expect(importButton).toBeDisabled();
  await expect(list.getByRole("option")).toHaveText(
    `${vessel.name}#${vessel.id}`,
  );
  await dialog.screenshot({
    path: testInfo.outputPath("vessel-picker-search.png"),
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
  await picker.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(list).toHaveCount(0);
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await expect(picker).toHaveValue(vessel.name);
  await dialog.screenshot({
    path: testInfo.outputPath("vessel-picker-selected.png"),
  });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(remote.imports[0]).toEqual({
    endpoint: origin,
    vessel_id: vessel.id,
    expected_name: vessel.name,
  });
  const updated = await (
    await request.get(`/api/v1/vessels/${vessel.id}`)
  ).json();
  expect(updated.name).toBe("Tall vase");
  expect(updated.location).toBe("Studio shelf");
  expect(updated.photos).toHaveLength(1);
  remote.expire();
  await page
    .getByRole("button", { name: "Refresh items", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Sign in in Settings" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in in Settings" }).click();
  await expect(
    page.getByRole("link", { name: "Kilnfire sign-in required", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
