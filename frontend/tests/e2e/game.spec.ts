/*
This file checks the real game in a browser: title screen stats, loading the 3D cave, walking with the keyboard,
climbing out of the Hollow Heart, glowsticks, taking a tape, getting caught by the monster, and saving the run.
Edit this file when the game flow across the browser and backend changes.
Copy a test pattern here when you add another end-to-end game flow.
*/

import { expect, test, type Page } from "@playwright/test";

type CaveState = { phase: string; x: number; y: number; z: number; tapes: number; creature: string; grounded: boolean; glowsticks: number };

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

// Turns the player to face a point on the map (yaw 0 looks towards -z).
async function walkTowards(page: Page, x: number, z: number, ms: number) {
  await page.keyboard.down("KeyW");
  for (let t = 0; t < ms; t += 250) {
    const now = await state(page);
    if (Math.hypot(x - now.x, z - now.z) < 1) break;
    await page.evaluate(([dx, dz]) => window.__cave.look(Math.atan2(-dx, -dz), 0), [x - now.x, z - now.z]);
    await page.waitForTimeout(250);
  }
  await page.keyboard.up("KeyW");
}

test("player can climb out of the Hollow Heart through both tunnels", async ({ page }) => {
  const errors: string[] = [];
  await enterCave(page, errors);
  for (const [x, z, minY] of [
    [20, 58, 9.5],
    [6, 36.5, 8.5],
  ]) {
    await page.evaluate(() => window.__cave.teleport(15, 6, 46));
    await page.waitForTimeout(300);
    expect((await state(page)).y).toBeLessThan(7);
    await walkTowards(page, x, z, 12_000);
    const after = await state(page);
    expect(after.y, `walking to ${x}, ${z}`).toBeGreaterThan(minY);
  }
  expect(errors).toEqual([]);
});

test("player picks up glowsticks and throws one", async ({ page }) => {
  const errors: string[] = [];
  await enterCave(page, errors);
  await expect(page.getByText("GLOW ×1 [G]")).toBeVisible();
  await page.evaluate(() => {
    window.__cave.teleport(50.4, 19, 35);
    window.__cave.look(Math.PI, -1.1);
  });
  await expect(page.getByText("[E] Take the glowsticks")).toBeVisible();
  await page.keyboard.press("KeyE");
  await expect(page.getByText("GLOW ×3 [G]")).toBeVisible();
  await page.keyboard.press("KeyG");
  await expect(page.getByText("GLOW ×2 [G]")).toBeVisible();
  expect((await state(page)).glowsticks).toBe(2);
  expect(errors).toEqual([]);
});

test("unknown addresses show the not found page", async ({ page }) => {
  await page.goto("/somewhere-dark");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
