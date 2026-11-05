import { expect, test } from "@playwright/test";

test("first scale reading sets full weight and later scans respect a manual override", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1${path}`, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const maker = await create("/manufacturers", {
    name: `First scan ${suffix}`,
  });
  const glaze = await create("/glazes", {
    manufacturer_id: maker.id,
    name: `First scan ${suffix}`,
  });
  const jar = await create("/containers", { glaze_id: glaze.id, tare_g: 25 });
  const uid = testInfo.project.name === "desktop" ? "04BB0001" : "04BB0002";
  const binding = await request.put(`/api/v1/tags/${uid}/binding`, {
    data: { container_id: jar.id, expected_revision: jar.revision },
  });
  expect(binding.ok()).toBeTruthy();
  const bound = await binding.json();
  const firstBody = {
    request_id: crypto.randomUUID(),
    expected_revision: bound.revision,
    source: "device",
    device_id: `first-scan-${suffix}`,
    tag_uid: uid,
    gross_g: 525,
  };
  const path = `/containers/${jar.id}/measurements`;

  await page.goto(`/containers/${jar.id}`);
  const pane = page.getByRole("complementary", { name: "Jar details" });
  const full = pane.getByLabel("Starting weight (g)");
  await expect(full).toHaveCount(0);
  await expect(pane.getByText("Not used yet")).toBeVisible();
  const first = await create(path, firstBody);
  await expect(pane.locator(".big-weight")).toHaveText("500 g");
  await expect(pane.locator(".stock-baseline")).toHaveText("of 500 g remaining");

  const second = await create(path, {
    ...firstBody,
    request_id: crypto.randomUUID(),
    expected_revision: first.revision,
    gross_g: 275,
  });
  await expect(pane.locator(".big-weight")).toHaveText("250 g");
  await expect(pane.locator(".stock-baseline")).toHaveText("of 500 g remaining");
  await expect(pane.locator(".last-used")).toHaveText(/Last used .* ago/);
  await expect(pane.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await page.goto(`/?q=${encodeURIComponent("#" + jar.number)}`);
  await expect(
    page.locator(`tr[data-jar-id="${jar.id}"] [role=progressbar]`),
  ).toHaveAttribute("aria-valuenow", "50");
  await page.goto(`/glazes/${glaze.id}`);
  await expect(
    page.getByRole("table", { name: "Active jars" }).getByRole("progressbar"),
  ).toHaveAttribute("aria-valuenow", "50");
  await page.goto(`/containers/${jar.id}`);
  await expect(page.getByText("Studio connected")).toBeAttached();
  await expect(pane.locator(".big-weight")).toHaveText("250 g");
  expect((await request.patch(`/api/v1/containers/${jar.id}`, {
    data: { expected_revision: second.revision, full_weight_g: 1025 },
  })).ok()).toBeTruthy();
  await expect(pane.locator(".stock-baseline")).toContainText("1,000 g");
  const updated = await (
    await request.get(`/api/v1/containers/${jar.id}`)
  ).json();
  await create(path, {
    ...firstBody,
    request_id: crypto.randomUUID(),
    expected_revision: updated.revision,
    gross_g: 225,
  });
  await expect(pane.locator(".big-weight")).toHaveText("200 g");
  await expect(pane.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  expect(await create(path, firstBody)).toEqual(first);
  await page.reload();
  await expect(pane.locator(".big-weight")).toHaveText("200 g");
  const history = await (await request.get(`/api/v1${path}`)).json();
  expect(history).toHaveLength(3);
  expect(
    history.find(
      (reading: { id: string }) => reading.id === first.measurement_id,
    ),
  ).toMatchObject({ full_weight_g: 525, remaining_g: 500, percentage: 100 });
});
