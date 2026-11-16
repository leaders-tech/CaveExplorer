/*
This file tests monster path finding, the winding tunnels, and the seeded noise helpers.
Edit this file when nav.ts, the cave tunnels, or noise.ts change. Copy a test here for another path rule.
*/

import { describe, expect, it } from "vitest";
import { EDGES, GLOW_LIGHT_SLOTS, LIGHTS, NODES, nodeById } from "./caveLayout";
import { findPath, nearestNode, neighboursOf, nodesWithin, pathPoints } from "./nav";
import { createNoise3D, createRandom } from "./noise";
import { NUM_LIGHTS } from "./shaders";
import { tunnelAlcoves, tunnelPoints, tunnelWalk } from "./tunnels";

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

  it("follows the bends of the tunnels instead of cutting through rock", () => {
    const ids = findPath("gallery", "ossuary");
    expect(ids).toEqual(["gallery", "o1", "o2", "ossuary"]);
    const points = pathPoints(ids);
    expect(points.length).toBeGreaterThan(ids.length + 4);
    for (let i = 1; i < points.length; i++) {
      expect(Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)).toBeLessThan(14);
    }
  });

  it("can loop from the giant bones back down to the lake", () => {
    expect(findPath("ossuary", "lake")).toEqual(["ossuary", "o3", "o4", "o5", "lake"]);
  });

  it("lists the rooms a few tunnels away (where the monster searches)", () => {
    const near = nodesWithin("pit", 1);
    expect(near).toContain("pit");
    expect(near).toContain("t7");
    expect(near).not.toContain("start");
  });

  it("has no tunnel pointing at a missing room", () => {
    const ids = new Set(NODES.map((node) => node.id));
    for (const edge of EDGES) {
      expect(ids.has(edge.a) && ids.has(edge.b)).toBe(true);
    }
  });
});

describe("winding tunnels", () => {
  it("bend away from the straight line between rooms, but start and end at the rooms", () => {
    let bent = 0;
    EDGES.forEach((edge, index) => {
      const points = tunnelPoints(index);
      const a = nodeById(edge.a);
      const b = nodeById(edge.b);
      const first = points[0];
      const last = points[points.length - 1];
      expect(Math.hypot(first.x - a.x, first.z - a.z)).toBeLessThan((a.chamber ? Math.max(a.chamber.rx, a.chamber.rz) : 0) + 0.01);
      expect(Math.hypot(last.x - b.x, last.z - b.z)).toBeLessThan((b.chamber ? Math.max(b.chamber.rx, b.chamber.rz) : 0) + 0.01);
      for (const p of points) {
        const t = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / ((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
        const off = Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.z - (a.z + (b.z - a.z) * t));
        if (off > 0.8) bent += 1;
      }
    });
    expect(bent).toBeGreaterThan(10);
  });

  it("gives the same tunnels every time and has side pockets to hide in", () => {
    expect(tunnelPoints(3)).toBe(tunnelPoints(3));
    const pockets = EDGES.reduce((sum, _, index) => sum + tunnelAlcoves(index).length, 0);
    expect(pockets).toBeGreaterThan(3);
  });

  it("walks a tunnel in both directions", () => {
    const forward = tunnelWalk(0, EDGES[0].a, 0.9);
    const back = tunnelWalk(0, EDGES[0].b, 0.9);
    expect(forward[0]).toEqual(back[back.length - 1]);
  });

  it("has exactly enough shader light slots for the cave lights and thrown glowsticks", () => {
    expect(LIGHTS.length + GLOW_LIGHT_SLOTS).toBe(NUM_LIGHTS);
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
