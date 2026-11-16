/*
This file tests the monster's walking math: bending a limb to reach a point, the stepping arc, and when to step.
Edit this file when creatureGait.ts changes. Copy a test here for another limb or step rule.
*/

import { describe, expect, it } from "vitest";
import { needsStep, solveTwoBone, stepArc, strideFor, type V3 } from "./creatureGait";

const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("monster limbs", () => {
  it("keeps both bones the same length and reaches a point that is close enough", () => {
    const root = { x: 0, y: 1, z: 0 };
    const target = { x: 1.2, y: 0, z: 0.3 };
    const { joint, tip } = solveTwoBone(root, target, 1, 1, { x: 0, y: 3, z: 0 });
    expect(dist(root, joint)).toBeCloseTo(1, 3);
    expect(dist(joint, tip)).toBeCloseTo(1, 3);
    expect(dist(tip, target)).toBeLessThan(0.01);
  });

  it("bends the elbow towards the pole (up, like a spider)", () => {
    const { joint } = solveTwoBone({ x: 0, y: 1, z: 0 }, { x: 1.4, y: 0, z: 0 }, 1, 1, { x: 0, y: 5, z: 0 });
    // The straight line from root to target passes y = 0.5 in the middle; the elbow sticks up above it.
    expect(joint.y).toBeGreaterThan(0.75);
  });

  it("points straight at a target that is too far away", () => {
    const { joint, tip } = solveTwoBone({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 1, 1, { x: 0, y: 1, z: 0 });
    expect(joint.x).toBeCloseTo(1, 2);
    expect(tip.x).toBeCloseTo(2, 2);
    expect(Math.abs(joint.y)).toBeLessThan(0.05);
  });
});

describe("monster steps", () => {
  it("lifts the foot in the middle of a step and lands on the target", () => {
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 1, y: 0.2, z: 0 };
    expect(stepArc(from, to, 0, 0.3)).toEqual(from);
    expect(stepArc(from, to, 0.5, 0.3).y).toBeGreaterThan(0.3);
    const end = stepArc(from, to, 1, 0.3);
    expect(dist(end, to)).toBeLessThan(0.0001);
  });

  it("steps only when the body moved away from a planted foot", () => {
    expect(needsStep({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }, 0.5)).toBe(false);
    expect(needsStep({ x: 0, y: 0, z: 0 }, { x: 0.8, y: 0, z: 0 }, 0.5)).toBe(true);
    expect(needsStep({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.5)).toBe(true);
  });

  it("takes longer and quicker steps when running", () => {
    const slow = strideFor(1);
    const fast = strideFor(5);
    expect(fast.stride).toBeGreaterThan(slow.stride);
    expect(fast.duration).toBeLessThan(slow.duration);
  });
});
