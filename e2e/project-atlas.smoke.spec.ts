import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/vue-nuxt", import.meta.url),
);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", {
    name: "Project Atlas navigation",
  });
  if (!(await navigation.isVisible())) {
    await page.locator("#launcher-project-path").fill(fixtureRoot);
    await page.getByRole("button", { name: "Review destination" }).click();
    await page.getByRole("button", { name: "Open project" }).click();
  }
  await expect(navigation).toBeVisible({ timeout: 30_000 });
});

test("opens the configured project and completes a repository rescan", async ({
  page,
}) => {
  const graphResponse = await page.request.get("/api/graph");
  expect(graphResponse.ok()).toBeTruthy();
  expect((await graphResponse.json()).project.name).toBe("atlas-vue-fixture");

  const refresh = page.getByRole("button", { name: "Rescan code" }).first();
  const refreshResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/refresh")
      && response.request().method() === "POST",
  );
  await refresh.click();
  await expect((await refreshResponse).ok()).toBeTruthy();
  await expect(page.getByText("Code Atlas rescanned this checkout."))
    .toBeVisible();
});

test("shows the scanned Code Atlas catalog", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Project Atlas navigation" })
    .getByRole("button", { name: "Code", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What can I reuse, change, or test?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Code catalog results")).toBeVisible();
  await expect(page.getByLabel("Code catalog results").getByRole("button"))
    .not.toHaveCount(0);
});

test("prepares a compact task and produces a resume capsule", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "Project Atlas navigation" })
    .getByRole("button", { name: "Codex handoff", exact: true })
    .click();
  await page.locator(".workbench-intent textarea").fill(
    "Change the helper copy in the existing notification banner.",
  );
  const prepareTask = page.getByRole("button", {
    name: "Prepare task",
    exact: true,
  });
  await expect(prepareTask).toBeEnabled();
  await prepareTask.click();

  await expect(page.getByText("Reviewed local brief")).toBeVisible();
  await expect(page.locator(".checkpoint-disclosure")).toContainText(
    "Resume capsule",
  );
  await expect(page.locator(".token-total")).toContainText("tokens");
});

test("navigates the explicitly cached Figma Design Index", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Project Atlas navigation" })
    .getByRole("button", { name: "Design", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Where does this flow live?" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "Design catalog" })
      .getByRole("combobox"),
  ).toContainText("Personal shop");
  await expect(page.getByLabel("Design catalog results")).toBeVisible();

  const checkoutFrame = page.getByRole("option", {
    name: /Checkout \/ Promo code/,
  });
  await checkoutFrame.click();
  await expect(checkoutFrame).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#design-node-detail")).toContainText(
    "Checkout / Promo code",
  );
});
