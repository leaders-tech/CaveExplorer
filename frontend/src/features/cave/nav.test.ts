/*
This file tests monster path finding and the seeded noise helpers.
Edit this file when nav.ts, the cave tunnels, or noise.ts change. Copy a test here for another path rule.
*/

import { describe, expect, it } from "vitest";
import { EDGES, NODES } from "./caveLayout";
import { findPath, nearestNode, neighboursOf } from "./nav";
import { createNoise3D, createRandom } from "./noise";

describe("monster paths", () => {
  it("connects every room to every other room", () => {
    for (const node of NODES) {
      const path = findPath("nest", node.id);
      expect(path[0]).toBe("nest");
      expect(path[path.length - 1]).toBe(node.id);
    }
  });

  it("only walks along real tunnels", () => {
    const path = findPath("start", "exit");
    for (let i = 1; i < path.length; i++) {
      expect(neighboursOf(path[i - 1])).toContain(path[i]);
    }
  });

  it("uses the shortcut from the big hall to the pit", () => {
    expect(findPath("gallery", "pit")).toEqual(["gallery", "s1", "s2", "pit"]);
  });

  it("finds the nearest node and can prefer visible ones", () => {
    expect(nearestNode({ x: 46, y: 20, z: 27 })).toBe("gallery");
    expect(nearestNode({ x: 46, y: 20, z: 27 }, (point) => point.x > 60)).not.toBe("gallery");
  });

  it("has no tunnel pointing at a missing room", () => {
    const ids = new Set(NODES.map((node) => node.id));
    for (const edge of EDGES) {
      expect(ids.has(edge.a) && ids.has(edge.b)).toBe(true);
    }
  });
});

describe("noise helpers", () => {
  it("repeats the same numbers for the same seed", () => {
    const a = createRandom(5);
    const b = createRandom(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("makes smooth noise between -1 and 1", () => {
    const noise = createNoise3D(1);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const value = noise(i * 0.37, i * 0.11, i * 0.73);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBeGreaterThanOrEqual(-1.05);
    expect(max).toBeLessThanOrEqual(1.05);
    expect(max - min).toBeGreaterThan(0.8);
    expect(Math.abs(noise(1, 2, 3) - noise(1.001, 2, 3))).toBeLessThan(0.01);
  });
});
