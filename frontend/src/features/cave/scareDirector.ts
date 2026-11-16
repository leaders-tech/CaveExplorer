/*
This file decides when and where the monster should show itself, so the player sees it often enough to stay scared.
If the player has not seen it for a while, game.ts moves it to a spot in front of them, out of reach but in view.
No three.js here, so it is easy to test. Edit this file to make the monster appear more or less often.
Do not copy it; call appearDelay and pickAppearSpot.
*/

import type { Vec3 } from "./caveLayout";

export const FIRST_GHOST_SECONDS = 35; // before the monster wakes: first far-away glimpse
export const GHOST_EVERY_SECONDS = 45; // ... and then about this often

// Seconds without seeing the monster before it shows itself again. More tapes = it comes more often.
export function appearDelay(tapes: number): number {
  return Math.max(12, 28 - tapes * 4);
}

// Picks a place to appear: between minDist and maxDist away, visible from the player's eye, and in front of them.
export function pickAppearSpot(
  candidates: Vec3[],
  eye: Vec3,
  look: Vec3,
  minDist: number,
  maxDist: number,
  canSee: (spot: Vec3) => boolean,
  random: () => number = Math.random,
): Vec3 | null {
  const scored: { spot: Vec3; score: number }[] = [];
  for (const spot of candidates) {
    const dx = spot.x - eye.x;
    const dy = spot.y - eye.y;
    const dz = spot.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < minDist || dist > maxDist) continue;
    const ahead = (dx * look.x + dz * look.z) / (Math.hypot(dx, dz) * Math.hypot(look.x, look.z) || 1);
    if (ahead < 0.35) continue; // behind or far to the side: the player would miss it
    scored.push({ spot, score: ahead + random() * 0.5 });
  }
  scored.sort((a, b) => b.score - a.score);
  // Line of sight is the slow check, so only test the best few.
  for (const { spot } of scored.slice(0, 12)) if (canSee(spot)) return spot;
  return null;
}
