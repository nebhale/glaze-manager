import { expect, test } from "@playwright/test";

test("the website edits inline and opens its current URL from the adjacent icon", async ({
  page,
  context,
  request,
}, testInfo) => {
  const response = await request.post("/api/v1/manufacturers", {
    data: { name: "Website control", website: "https://example.test/original" },
  });
  expect(response.ok()).toBeTruthy();
  const maker = await response.json();
  const read = async () =>
    (await (await request.get(`/api/v1/manufacturers/${maker.id}`)).json())
      .website;
  await context.route("https://example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Manufacturer site</h1>",
    }),
  );
  await page.goto(`/manufacturers/${maker.id}`);
  const row = page.locator(`#manufacturer-${maker.id}`);
  const website = row.getByRole("textbox", { name: "Website", exact: true });
  const open = row.getByRole("link", { name: "Open website in a new tab" });
  await expect(website).toHaveValue("https://example.test/original");
  await expect(
    page.getByRole("link", { name: "Website", exact: true }),
  ).toHaveCount(0);
  await expect(open).toHaveAttribute("href", "https://example.test/original");
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");

  await website.click();
  await expect(website).toBeFocused();
  expect(context.pages()).toHaveLength(1);
  await website.fill("https://example.test/idle");
  await expect.poll(read).toBe("https://example.test/idle");
  await expect(website).toBeFocused();
  await expect(open).toHaveAttribute("href", "https://example.test/idle");

  await website.fill("javascript:alert(1)");
  await expect(open).toHaveCount(0);
  await website.blur();
  await expect(page.getByRole("alert")).toContainText(
    "Use an http:// or https:// URL.",
  );
  expect(await read()).toBe("https://example.test/idle");

  await website.fill("https://example.test/updated");
  await expect(open).toHaveAttribute("href", "https://example.test/updated");
  const opened = page.waitForEvent("popup");
  await open.click();
  const popup = await opened;
  await expect(popup).toHaveURL("https://example.test/updated");
  await expect(
    popup.getByRole("heading", { name: "Manufacturer site" }),
  ).toBeVisible();
  await expect.poll(read).toBe("https://example.test/updated");
  await popup.close();
  await expect(page).toHaveURL(new RegExp(`/settings#manufacturer-${maker.id}$`));
  await expect(
    row.getByRole("textbox", { name: "Notes", exact: true }),
  ).toHaveAttribute("placeholder", "");
  await page.screenshot({
    path: testInfo.outputPath("website-field.png"),
    scale: "css",
  });

  await website.fill("");
  await website.blur();
  await expect(open).toHaveCount(0);
  await expect.poll(read).toBeNull();
  await page.reload();
  await expect(website).toHaveValue("");
  await expect(open).toHaveCount(0);
});
