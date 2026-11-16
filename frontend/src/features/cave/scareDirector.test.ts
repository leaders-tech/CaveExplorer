/*
This file tests when and where the monster shows itself: it comes more often with more tapes, and it appears
in front of the player, at a fair distance, only where the player can see it.
Edit this file when scareDirector.ts changes. Copy a test here for another appearance rule.
*/

import { describe, expect, it } from "vitest";
import { appearDelay, pickAppearSpot } from "./scareDirector";

const eye = { x: 0, y: 1.5, z: 0 };
const lookNorth = { x: 0, y: 0, z: -1 };
const spots = [
  { x: 0, y: 1, z: -12 }, // in front, good distance
  { x: 0, y: 1, z: 12 }, // behind
  { x: 0, y: 1, z: -3 }, // too close
  { x: 0, y: 1, z: -40 }, // too far
  { x: 12, y: 1, z: 0 }, // to the side
];

describe("scare director", () => {
  it("shows the monster more often when the player carries more tapes", () => {
    expect(appearDelay(4)).toBeLessThan(appearDelay(0));
    expect(appearDelay(10)).toBeGreaterThanOrEqual(12);
  });

  it("picks a spot in front of the player at a fair distance", () => {
    expect(pickAppearSpot(spots, eye, lookNorth, 9, 17, () => true)).toEqual(spots[0]);
  });

  it("never picks a spot the player cannot see", () => {
    expect(pickAppearSpot(spots, eye, lookNorth, 9, 17, () => false)).toBeNull();
  });

  it("finds nothing when the player looks at a wall with no spots ahead", () => {
    expect(pickAppearSpot(spots, eye, { x: -1, y: 0, z: 0 }, 9, 17, () => true)).toBeNull();
  });
});
