import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("inventory and settings remain readable and fit the viewport", async ({
  page,
}, testInfo) => {
  for (const path of ["/", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Loading your studio")).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    if (path === "/")
      await page.screenshot({
        path: testInfo.outputPath("inventory.png"),
        fullPage: true,
      });
  }
});
