/*
Check the built PWA through the Docker gateway, including its service worker.
Edit when caching or production routes change; copy for another built-app browser check.
*/

import { expect, test } from "@playwright/test";

test("service worker leaves API navigation to the backend", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const response = await page.goto("/api/health");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("application/json");
  expect(await response?.json()).toEqual({ ok: true, data: { status: "ok" } });
});

test("cached game opens offline and the title screen still works", async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { name: "THE HOLLOW BELOW" })).toBeVisible();
    await expect(page.getByText(/0 explorers never came back/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter the cave" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
});
