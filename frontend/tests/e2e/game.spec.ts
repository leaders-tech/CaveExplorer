/*
This file checks the real game in a browser: title screen stats, loading the 3D cave, walking with the keyboard,
taking a tape, getting caught by the monster, and saving the run on the backend.
Edit this file when the game flow across the browser and backend changes.
Copy a test pattern here when you add another end-to-end game flow.
*/

import { expect, test, type Page } from "@playwright/test";

type CaveState = { phase: string; x: number; y: number; z: number; tapes: number; creature: string; grounded: boolean };

declare global {
  interface Window {
    __cave: { state: () => CaveState; look: (yaw: number, pitch: number) => void; teleport: (x: number, y: number, z: number) => void };
  }
}

async function enterCave(page: Page, errors: string[]) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "THE HOLLOW BELOW" })).toBeVisible();
  await expect(page.getByText(/never came back/)).toBeVisible();
  await page.getByRole("button", { name: "Enter the cave" }).click();
  await expect(page.getByText("Click anywhere to open your eyes.")).toBeVisible({ timeout: 30_000 });
  await page.getByText("Click anywhere to open your eyes.").click();
  await expect(page.getByText("TAPES 0 / 4")).toBeVisible();
}

const state = (page: Page) => page.evaluate(() => window.__cave.state());

test("player walks down the first tunnel without falling through the rock", async ({ page }) => {
  const errors: string[] = [];
  await enterCave(page, errors);
  await expect(page.getByText("The rope snapped. I fell a long way down.")).toBeVisible();
  const before = await state(page);
  await page.evaluate(() => window.__cave.look(-2.18, 0));
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(3000);
  await page.keyboard.up("KeyW");
  const after = await state(page);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(4);
  expect(after.y).toBeLessThan(before.y);
  expect(after.y).toBeGreaterThan(25);
  expect(after.phase).toBe("playing");
  expect(errors).toEqual([]);
});

test("taking a tape wakes the monster, it catches you, and the death is saved", async ({ page }) => {
  const errors: string[] = [];
  await enterCave(page, errors);
  const statsBefore = await page.request.post("/api/runs/stats", { data: {} }).then((response) => response.json());

  await page.evaluate(() => {
    window.__cave.teleport(49.4, 19, 32.6);
    window.__cave.look(Math.PI, -0.9);
  });
  await expect(page.getByText("[E] Take the tape recorder")).toBeVisible();
  await page.keyboard.press("KeyE");
  await expect(page.getByText("TAPES 1 / 4")).toBeVisible();
  await expect(page.getByText(/Tape 1 - Mara/)).toBeVisible();
  expect((await state(page)).creature).toBe("wander");

  await page.evaluate(() => window.__cave.teleport(17, 6, 49));
  await expect(page.getByRole("heading", { name: "YOU BECAME PART OF THE CAVE" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Tapes found: 1 \/ 4/)).toBeVisible();

  await expect
    .poll(async () => (await page.request.post("/api/runs/stats", { data: {} }).then((response) => response.json())).data.deaths)
    .toBe(statsBefore.data.deaths + 1);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("TAPES 0 / 4")).toBeVisible();
  expect((await state(page)).creature).toBe("dormant");
  expect(errors).toEqual([]);
});

test("unknown addresses show the not found page", async ({ page }) => {
  await page.goto("/somewhere-dark");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
