/*
This file tests the giant skeleton in the Ossuary: it has many bones, sits in the room, and the player cannot walk
through its big bones. Edit this file when giantSkeleton.ts changes. Copy a test here for another solid prop.
*/

import { beforeAll, describe, expect, it } from "vitest";
import { buildCaveGrid, density, type CaveGrid } from "./caveGrid";
import { GIANT_SKELETON, SEED, nodeById } from "./caveLayout";
import { giantSkeleton, pushOutOfBones, skeletonBounds } from "./giantSkeleton";

const skeleton = giantSkeleton(GIANT_SKELETON.x, 14, GIANT_SKELETON.z, GIANT_SKELETON.size);
let grid: CaveGrid;

beforeAll(() => {
  grid = buildCaveGrid(SEED);
});

describe("giant skeleton", () => {
  it("has a backbone, ribs, horns, and a skull with dark eye holes", () => {
    expect(skeleton.tubes.length).toBeGreaterThan(60);
    expect(skeleton.blobs.some((blob) => blob.dark)).toBe(true);
    expect(skeleton.tubes.some((tube) => tube.solid)).toBe(true);
  });

  it("lies inside the Ossuary, mostly in open air", () => {
    const room = nodeById("ossuary");
    const box = skeletonBounds(skeleton);
    expect(box.min.x).toBeGreaterThan(room.x - room.chamber!.rx - 1);
    expect(box.max.y - box.min.y).toBeGreaterThan(3);
    const skull = skeleton.blobs[skeleton.blobs.length - 13];
    expect(density(grid, skull.c.x, skull.c.y + skull.s.y + 0.3, skull.c.z)).toBeLessThan(0);
  });

  it("pushes the player out of a solid bone but leaves them alone far away", () => {
    const rib = skeleton.tubes.find((tube) => tube.solid && tube.b.y < 15)!;
    const pushed = pushOutOfBones(rib.b.x, rib.b.z, 14, 1.7, 0.3, skeleton);
    expect(pushed.hit).toBe(true);
    expect(Math.hypot(pushed.x - rib.b.x, pushed.z - rib.b.z)).toBeGreaterThan(0.3);
    const far = pushOutOfBones(GIANT_SKELETON.x, GIANT_SKELETON.z + 30, 14, 1.7, 0.3, skeleton);
    expect(far.hit).toBe(false);
  });

  it("lets the player stand under the high middle of the ribcage", () => {
    const under = pushOutOfBones(GIANT_SKELETON.x, GIANT_SKELETON.z, 14, 1.7, 0.3, skeleton);
    expect(under.hit).toBe(false);
  });
});
