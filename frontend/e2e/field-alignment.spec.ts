import { expect, test, type Locator } from "@playwright/test";

async function fieldPositions(panel: Locator) {
  return panel.locator(".field > label").evaluateAll((labels) =>
    Object.fromEntries(
      labels.map((label) => {
        const pane = label.closest(".jar-detail-pane")!;
        const top = pane.getBoundingClientRect().top - pane.scrollTop;
        const control = (label as HTMLLabelElement).control!;
        return [
          label.textContent!,
          [
            label.getBoundingClientRect().top - top,
            control.getBoundingClientRect().top - top,
          ],
        ];
      }),
    ),
  );
}

test("shared fields align between create and detail", async ({
  page,
  request,
}) => {
  async function create(resource: string, data: object) {
    const res = await request.post("/api/v1/" + resource, { data });
    expect(res.ok()).toBeTruthy();
    return res.json();
  }
  const maker = await create("manufacturers", { name: "AMACO" });
  const glaze = await create("glazes", {
    name: "Ancient Copper",
    manufacturer_id: maker.id,
    product_line: "Potter's Choice",
  });
  const jar = await create("containers", { glaze_id: glaze.id });

  for (const [kind, list, detail, button] of [
    ["Glaze", "/catalog", `/glazes/${glaze.id}`, "Add glaze"],
    ["Jar", "/", `/containers/${jar.id}`, "Add a jar"],
  ]) {
    await page.goto(list);
    await page.getByRole("button", { name: button, exact: true }).click();
    const form = page.getByRole("region", { name: kind, exact: true });
    await expect(form.getByLabel("Notes", { exact: true })).toBeVisible();
    const creation = await fieldPositions(form);
    await page.goto(detail);
    const panel =
      kind === "Jar"
        ? page.getByRole("region", { name: "Jar fields", exact: true })
        : page.getByRole("complementary", { name: kind + " details" });
    await expect(panel.getByLabel("Notes", { exact: true })).toBeVisible();
    const saved = await fieldPositions(panel);
    if (kind === "Glaze") {
      const order = [
        "Name",
        "Product code",
        "Cone",
        "Classification",
        "Manufacturer",
        "Product line",
        "Product page",
        "Notes",
      ];
      expect(Object.keys(creation)).toEqual(order);
      expect(Object.keys(saved)).toEqual(order);
      await expect(panel.getByRole("heading", { level: 2 })).toHaveText(
        glaze.name,
      );
    }
    if (kind === "Jar") {
      expect(Object.keys(creation)).toEqual([
        "Glaze",
        "Container",
        "Location",
        "Cost",
        "Notes",
      ]);
      expect(Object.keys(saved)).toEqual(["Glaze", "Container", "Location", "Cost", "Notes", "NFC Tag"]);
      // The jar detail includes a weight summary above its fields. Compare the
      // spacing between each shared field's label and its control.
      for (const [addName, detailName] of [
        ["Location", "Location"],
        ["Cost", "Cost"],
        ["Container", "Container"],
        ["Notes", "Notes"],
      ]) {
        const [addLabel, addControl] = creation[addName];
        const [editLabel, editControl] = saved[detailName];
        expect(
          Math.abs(addControl - addLabel - (editControl - editLabel)),
        ).toBeLessThan(1);
      }
      continue;
    }
    for (const [name, [label, control]] of Object.entries(creation)) {
      expect(
        Math.abs(saved[name][0] - label),
        kind + " " + name + " label",
      ).toBeLessThan(1);
      expect(
        Math.abs(saved[name][1] - control),
        kind + " " + name + " control",
      ).toBeLessThan(1);
    }
  }
});
