/*
This file tests the cave builder: rooms and tunnels are open air, items sit on real floors,
the bridge exists over the pit, the mesh is built, and collision pushes bodies out of rock.
Edit this file when the cave map or the grid rules change. Copy a test here for another map rule.
*/

import { beforeAll, describe, expect, it } from "vitest";
import { buildCaveGrid, density, findFloor, isSolid, lineOfSight, pushOutSphere, raycast, type CaveGrid } from "./caveGrid";
import { BRIDGE, EDGES, EXIT_TRIGGER, ITEMS, NODES, PIT_TRENCH, PLAYER_START, SEED, WORLD, nodeById, walkPoint } from "./caveLayout";
import { buildCaveMesh } from "./surfaceNets";
import { floorOf, tunnelPoints } from "./tunnels";

// Walks along a tunnel in 0.4 m steps and returns the floor height at every step.
function tunnelFloors(edgeIndex: number): { x: number; z: number; floor: number }[] {
  const points = tunnelPoints(edgeIndex);
  const floors: { x: number; z: number; floor: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 0.4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = p0.x + (p1.x - p0.x) * t;
      const z = p0.z + (p1.z - p0.z) * t;
      const top = floorOf(p0) + (floorOf(p1) - floorOf(p0)) * t + 1.2;
      floors.push({ x, z, floor: findFloor(grid, x, top, z) });
    }
  }
  return floors;
}

let grid: CaveGrid;

beforeAll(() => {
  grid = buildCaveGrid(SEED);
});

describe("cave grid", () => {
  it("has the expected size and solid outer border", () => {
    expect(grid.nx).toBe(Math.round(WORLD.sizeX / WORLD.cell) + 1);
    expect(isSolid(grid, { x: 0, y: 10, z: 10 })).toBe(true);
    expect(isSolid(grid, { x: -5, y: 10, z: 10 })).toBe(true);
  });

  it("builds the same cave from the same seed", () => {
    const again = buildCaveGrid(SEED);
    expect(again.d[123456]).toBe(grid.d[123456]);
  });

  it("keeps every room and tunnel node open for walking", () => {
    for (const node of NODES) {
      expect(density(grid, node.x, node.y + 0.8, node.z), node.id).toBeLessThan(0);
    }
  });

  it("keeps the middle of every winding tunnel open", () => {
    EDGES.forEach((edge, index) => {
      for (const p of tunnelPoints(index)) {
        expect(density(grid, p.x, floorOf(p) + 0.5, p.z), `${edge.a}-${edge.b}`).toBeLessThan(0);
      }
    });
  });

  it("lets the player walk every tunnel both ways (no step is too high to climb or jump)", () => {
    EDGES.forEach((edge, index) => {
      const floors = tunnelFloors(index);
      for (let i = 1; i < floors.length; i++) {
        const step = Math.abs(floors[i].floor - floors[i - 1].floor);
        expect(step, `${edge.a}-${edge.b} at x=${floors[i].x.toFixed(1)} z=${floors[i].z.toFixed(1)}`).toBeLessThan(0.55);
      }
    });
  });

  it("starts every tunnel on the floor of its room, so there is no ledge at the door", () => {
    EDGES.forEach((edge, index) => {
      const floors = tunnelFloors(index);
      for (const [id, spot] of [
        [edge.a, floors[0]],
        [edge.b, floors[floors.length - 1]],
      ] as const) {
        const node = nodeById(id);
        if (!node.chamber) continue;
        expect(Math.abs(spot.floor - node.y), `${edge.a}-${edge.b} at ${id}`).toBeLessThan(0.7);
      }
    });
  });

  it("has a walkable floor under the start and solid ground under every item", () => {
    const floor = findFloor(grid, PLAYER_START.x, PLAYER_START.y + 2, PLAYER_START.z);
    expect(Math.abs(floor - PLAYER_START.y)).toBeLessThan(2);
    for (const item of ITEMS) {
      const itemFloor = findFloor(grid, item.x, item.y + 1.5, item.z);
      expect(Math.abs(itemFloor - item.y), item.id).toBeLessThan(2.5);
    }
  });

  it("has a bridge over a deep pit", () => {
    const middleX = (BRIDGE.minX + BRIDGE.maxX) / 2;
    const middleZ = (BRIDGE.minZ + BRIDGE.maxZ) / 2;
    expect(isSolid(grid, { x: middleX, y: BRIDGE.maxY - 0.5, z: middleZ })).toBe(true);
    expect(isSolid(grid, { x: middleX, y: BRIDGE.maxY + 0.5, z: middleZ })).toBe(false);
    const pitFloor = findFloor(grid, middleX, BRIDGE.minY - 0.5, middleZ + 3);
    expect(pitFloor).toBeLessThan(PIT_TRENCH.minY + 3);
  });

  it("lets the exit trigger sit in open air", () => {
    expect(density(grid, EXIT_TRIGGER.x, EXIT_TRIGGER.y, EXIT_TRIGGER.z)).toBeLessThan(0.5);
  });

  it("answers line of sight and ray questions", () => {
    const gallery = walkPoint(nodeById("gallery"));
    const lake = walkPoint(nodeById("lake"));
    expect(lineOfSight(grid, gallery, { ...gallery, x: gallery.x + 2 })).toBe(true);
    expect(lineOfSight(grid, gallery, lake)).toBe(false);
    expect(raycast(grid, gallery, { x: 0, y: -1, z: 0 }, 10)).toBeGreaterThan(0.5);
  });

  it("pushes a ball out of a wall", () => {
    const start = nodeById("start");
    const floor = findFloor(grid, start.x, start.y + 2, start.z);
    const pushed = pushOutSphere(grid, start.x, floor + 0.1, start.z, 0.3);
    expect(pushed.hit).toBe(true);
    expect(pushed.groundNormalY).toBeGreaterThan(0.5);
    expect(density(grid, pushed.x, pushed.y, pushed.z)).toBeLessThan(-0.15);
  });
});

describe("cave mesh", () => {
  it("builds a closed surface with faces near the walls", () => {
    const mesh = buildCaveMesh(grid);
    const vertexCount = mesh.positions.length / 3;
    expect(vertexCount).toBeGreaterThan(10000);
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices.slice(0, 3000))).toBeLessThan(vertexCount);
    for (let v = 0; v < vertexCount; v += 997) {
      const d = density(grid, mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
      expect(Math.abs(d)).toBeLessThan(grid.cell);
    }
  });
});
