import { expect, test, type Page, type Route } from "@playwright/test";

import {
  smallDataset,
  smallDatasetWorkspaceGid,
} from "../../fixtures/asana/small-dataset/data";

const ASANA_API_BASE = "https://app.asana.com/api/1.0";
const FIXTURE_TOKEN = "fixture-e2e-landing-shell-token-1234567890";

async function mockAsanaApi(
  page: Page,
  options: {
    user?: (route: Route) => Promise<void>;
    workspaces?: (route: Route) => Promise<void>;
  } = {},
): Promise<void> {
  await page.route(`${ASANA_API_BASE}/users/me*`, async (route) => {
    if (options.user) {
      await options.user(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: smallDataset.users[0] }),
    });
  });
  await page.route(`${ASANA_API_BASE}/workspaces*`, async (route) => {
    if (options.workspaces) {
      await options.workspaces(route);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: smallDataset.workspaces, next_page: null }),
    });
  });
}

async function openFirstRun(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('[data-view-state="first_run"]')).toBeVisible();
}

async function validateToken(page: Page): Promise<void> {
  await page.getByLabel(/^token$/i).fill(FIXTURE_TOKEN);
  await page.getByRole("button", { name: /test token/i }).click();
}

async function chooseSessionOnlyMode(page: Page): Promise<void> {
  await expect(page.getByTestId("storage-mode-selector")).toBeVisible();
  await page.getByRole("radio", { name: /session[- ]only/i }).click();
}

test.describe("landing shell navigation, view states, and route guard", () => {
  test("renders app-shell navigation chrome after first-run completes", async ({
    page,
  }) => {
    await mockAsanaApi(page);
    await openFirstRun(page);
    await validateToken(page);
    await chooseSessionOnlyMode(page);
    await page
      .getByRole("combobox", { name: /workspace/i })
      .selectOption(smallDatasetWorkspaceGid);
    await page.getByRole("button", { name: /select workspace/i }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  test("redirects unauthenticated visits to protected routes back to /", async ({
    page,
  }) => {
    await mockAsanaApi(page);
    await page.goto("/settings");

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator('[data-view-state="first_run"]')).toBeVisible();
    await expect(page.getByTestId("settings-panel")).toHaveCount(0);
  });

  test("reaches current first-run loading, empty, and error states through per-test API overrides", async ({
    page,
  }) => {
    await mockAsanaApi(page, {
      user: async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: smallDataset.users[0] }),
        });
      },
    });
    await openFirstRun(page);
    await page.getByLabel(/^token$/i).fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: /test token/i }).click();
    await expect(
      page.getByRole("button", { name: /testing token/i }),
    ).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockAsanaApi(page, {
      workspaces: async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], next_page: null }),
        });
      },
    });
    await page.reload();
    await openFirstRun(page);
    await validateToken(page);
    await chooseSessionOnlyMode(page);
    await expect(
      page.getByText(/no accessible workspaces|no workspaces/i),
    ).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockAsanaApi(page, {
      user: async (route) => {
        await route.fulfill({ status: 500, body: "server error" });
      },
    });
    await page.reload();
    await openFirstRun(page);
    await validateToken(page);
    await expect(page.getByTestId("storage-mode-selector")).toHaveCount(0);
    await expect(page.getByText(/error|unable|failed/i)).toBeVisible();
  });
});
