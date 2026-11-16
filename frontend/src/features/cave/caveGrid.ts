/*
This file turns the cave map into a 3D grid of numbers: below 0 is air, above 0 is rock.
It also answers questions about that grid: is this point inside rock, can A see B, push a body out of a wall.
Edit this file when cave shapes, wall bumpiness, or collision rules change.
Do not copy this file; add new rock shapes in buildCaveGrid.
*/

import {
  BRIDGE,
  EDGES,
  EXIT_CRACK,
  GALLERY_PILLARS,
  LAKE_ISLAND,
  NODES,
  PIT_TRENCH,
  START_SHAFT,
  WORLD,
  type CaveNode,
  type Vec3,
} from "./caveLayout";
import { createNoise3D, createRandom } from "./noise";
import { FLOOR_CUT, tunnelAlcoves, tunnelPoints, type TunnelPoint } from "./tunnels";

export type CaveGrid = {
  nx: number;
  ny: number;
  nz: number;
  cell: number;
  d: Float32Array; // < 0 air, > 0 rock, roughly meters to the nearest wall
  flesh: Float32Array; // 0 = stone, 1 = living flesh walls
};

type Shape = {
  min: Vec3;
  max: Vec3;
  sdf: (x: number, y: number, z: number) => number;
  rough: number;
  flesh: number;
};

const FAR = 4;

export function gridIndex(grid: CaveGrid, x: number, y: number, z: number): number {
  return x + grid.nx * (y + grid.ny * z);
}

// ---------- Small distance functions for shapes ----------

function ellipsoidSdf(px: number, py: number, pz: number, rx: number, ry: number, rz: number): number {
  const k0 = Math.hypot(px / rx, py / ry, pz / rz);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  if (k1 === 0) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

function boxSdf(x: number, y: number, z: number, b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }): number {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const qx = Math.abs(x - cx) - (b.maxX - b.minX) / 2;
  const qy = Math.abs(y - cy) - (b.maxY - b.minY) / 2;
  const qz = Math.abs(z - cz) - (b.maxZ - b.minZ) / 2;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qy, qz), 0);
}

// A tube between two points. ry squashes it up/down so tunnels can be wide and low.
function tubeSdf(x: number, y: number, z: number, a: Vec3, b: Vec3, r: number, ry: number): number {
  const s = r / ry;
  const px = x - a.x;
  const py = (y - a.y) * s;
  const pz = z - a.z;
  const bx = b.x - a.x;
  const by = (b.y - a.y) * s;
  const bz = b.z - a.z;
  const len2 = bx * bx + by * by + bz * bz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / len2));
  const dist = Math.hypot(px - bx * t, py - by * t, pz - bz * t) - r;
  return dist * Math.min(1, 1 / s);
}

function chamberCenterY(node: CaveNode): number {
  return node.y + (node.chamber?.h ?? 0) * 0.35;
}

function chamberShape(node: CaveNode): Shape {
  const c = node.chamber!;
  const cy = chamberCenterY(node);
  return {
    min: { x: node.x - c.rx - 1, y: node.y - 1, z: node.z - c.rz - 1 },
    max: { x: node.x + c.rx + 1, y: cy + c.h + 1, z: node.z + c.rz + 1 },
    sdf: (x, y, z) => Math.max(ellipsoidSdf(x - node.x, y - cy, z - node.z, c.rx, c.h, c.rz), node.y - y),
    rough: 1,
    flesh: node.flesh ?? 0,
  };
}

function tubeShape(a: Vec3, b: Vec3, r: number, ry: number, rough: number, flesh: number): Shape {
  const pad = Math.max(r, ry) + 1;
  return {
    min: { x: Math.min(a.x, b.x) - pad, y: Math.min(a.y, b.y) - pad, z: Math.min(a.z, b.z) - pad },
    max: { x: Math.max(a.x, b.x) + pad, y: Math.max(a.y, b.y) + pad, z: Math.max(a.z, b.z) + pad },
    sdf: (x, y, z) => tubeSdf(x, y, z, a, b, r, ry),
    rough,
    flesh,
  };
}

// One piece of a winding tunnel: a tube from p0 to p1 whose size changes along the way, with a flat floor.
function tunnelSegmentShape(p0: TunnelPoint, p1: TunnelPoint, scale: number, rough: number, flesh: number): Shape {
  const pad = Math.max(p0.r, p0.ry, p1.r, p1.ry) * scale + 1;
  const bx = p1.x - p0.x;
  const by = p1.y - p0.y;
  const bz = p1.z - p0.z;
  const len2 = bx * bx + by * by + bz * bz;
  return {
    min: { x: Math.min(p0.x, p1.x) - pad, y: Math.min(p0.y, p1.y) - pad, z: Math.min(p0.z, p1.z) - pad },
    max: { x: Math.max(p0.x, p1.x) + pad, y: Math.max(p0.y, p1.y) + pad, z: Math.max(p0.z, p1.z) + pad },
    sdf: (x, y, z) => {
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - p0.x) * bx + (y - p0.y) * by + (z - p0.z) * bz) / len2));
      const cx = p0.x + bx * t;
      const cy = p0.y + by * t;
      const cz = p0.z + bz * t;
      const r = (p0.r + (p1.r - p0.r) * t) * scale;
      const ry = (p0.ry + (p1.ry - p0.ry) * t) * scale;
      const tube = (Math.hypot(x - cx, ((y - cy) * r) / ry, z - cz) - r) * Math.min(1, ry / r);
      const floor = cy - ry * FLOOR_CUT;
      return Math.max(tube, floor - y);
    },
    rough,
    flesh,
  };
}

// Pieces that tidy a tunnel floor after the noise: fill = add rock up to just under the floor (fills holes,
// tapers off to the sides), keep = cut away bumps that stick up above the floor in the middle of the path.
function floorFixShapes(p0: TunnelPoint, p1: TunnelPoint): { fill: Shape; keep: Shape } {
  const bx = p1.x - p0.x;
  const bz = p1.z - p0.z;
  const len2 = bx * bx + bz * bz;
  const r = Math.max(p0.r, p1.r);
  const pad = r * 2 + 1;
  const min = { x: Math.min(p0.x, p1.x) - pad, y: Math.min(floorOf(p0), floorOf(p1)) - 2.5, z: Math.min(p0.z, p1.z) - pad };
  const max = { x: Math.max(p0.x, p1.x) + pad, y: Math.max(floorOf(p0), floorOf(p1)) + 2.5, z: Math.max(p0.z, p1.z) + pad };
  const along = (x: number, z: number) => {
    const raw = len2 === 0 ? 0 : ((x - p0.x) * bx + (z - p0.z) * bz) / len2;
    const t = Math.max(0, Math.min(1, raw));
    const floor = floorOf(p0) + (floorOf(p1) - floorOf(p0)) * t;
    const side = Math.hypot(x - p0.x - bx * t, z - p0.z - bz * t);
    const ry = p0.ry + (p1.ry - p0.ry) * t;
    const beyond = Math.max(0, -raw, raw - 1) * Math.sqrt(len2); // meters past either end of the piece
    return { floor, side, ry, rr: p0.r + (p1.r - p0.r) * t, beyond };
  };
  return {
    fill: {
      min,
      max,
      sdf: (x, y, z) => {
        const a = along(x, z);
        const top = a.floor - 0.08 - Math.max(0, a.side - a.rr * 0.5) * 0.8 - a.beyond * 0.8;
        return Math.max(y - top, a.floor - 2 - y, a.side - a.rr * 2);
      },
      rough: 0.3,
      flesh: 0,
    },
    keep: {
      min,
      max,
      sdf: (x, y, z) => {
        const a = along(x, z);
        return Math.max(a.side - a.rr * 0.6, a.floor + 0.05 + a.beyond - y, y - (a.floor + Math.min(1.9, a.ry * 1.4)));
      },
      rough: 1,
      flesh: 0,
    },
  };
}

function floorOf(p: TunnelPoint): number {
  return p.y - p.ry * FLOOR_CUT;
}

function tunnelShapes(edgeIndex: number): Shape[] {
  const edge = EDGES[edgeIndex];
  const points = tunnelPoints(edgeIndex);
  const shapes: Shape[] = [];
  for (let i = 1; i < points.length; i++) shapes.push(tunnelSegmentShape(points[i - 1], points[i], 1, edge.rough ?? 1, edge.flesh ?? 0));
  return shapes;
}

function alcoveShapes(edgeIndex: number): Shape[] {
  const edge = EDGES[edgeIndex];
  return tunnelAlcoves(edgeIndex).map((a) => ({
    min: { x: a.x - a.rx - 1, y: a.floor - 1, z: a.z - a.rz - 1 },
    max: { x: a.x + a.rx + 1, y: a.y + a.ry + 1, z: a.z + a.rz + 1 },
    sdf: (x: number, y: number, z: number) => Math.max(ellipsoidSdf(x - a.x, y - a.y, z - a.z, a.rx, a.ry, a.rz), a.floor - y),
    rough: 1.2,
    flesh: edge.flesh ?? 0,
  }));
}

function boxShape(b: typeof BRIDGE, rough: number): Shape {
  return {
    min: { x: b.minX - 1, y: b.minY - 1, z: b.minZ - 1 },
    max: { x: b.maxX + 1, y: b.maxY + 1, z: b.maxZ + 1 },
    sdf: (x, y, z) => boxSdf(x, y, z, b),
    rough,
    flesh: 0,
  };
}

// Hanging rock spikes. Tip points down at (x, tipY, z).
function stalactiteShape(x: number, z: number, tipY: number, baseY: number, baseR: number): Shape {
  return {
    min: { x: x - baseR - 1, y: tipY - 1, z: z - baseR - 1 },
    max: { x: x + baseR + 1, y: baseY + 1, z: z + baseR + 1 },
    sdf: (px, py, pz) => {
      const hd = Math.hypot(px - x, pz - z);
      if (py < tipY) return Math.hypot(hd, py - tipY);
      const t = Math.min(1, (py - tipY) / (baseY - tipY));
      return (hd - baseR * t) * 0.85;
    },
    rough: 0.35,
    flesh: 0,
  };
}

function stalagmiteShape(x: number, z: number, floorY: number, height: number, baseR: number): Shape {
  const tipY = floorY + height;
  return {
    min: { x: x - baseR - 1, y: floorY - 2, z: z - baseR - 1 },
    max: { x: x + baseR + 1, y: tipY + 1, z: z + baseR + 1 },
    sdf: (px, py, pz) => {
      const hd = Math.hypot(px - x, pz - z);
      if (py > tipY) return Math.hypot(hd, py - tipY);
      const t = Math.min(1, (tipY - py) / height);
      return (hd - baseR * t) * 0.85;
    },
    rough: 0.35,
    flesh: 0,
  };
}

function distanceToSegment2D(px: number, pz: number, a: Vec3, b: Vec3): number {
  const bx = b.x - a.x;
  const bz = b.z - a.z;
  const len2 = bx * bx + bz * bz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * bx + (pz - a.z) * bz) / len2));
  return Math.hypot(px - a.x - bx * t, pz - a.z - bz * t);
}

function nearPath(x: number, z: number, minDist: number): boolean {
  return EDGES.some((_, index) => {
    const points = tunnelPoints(index);
    for (let i = 1; i < points.length; i++) if (distanceToSegment2D(x, z, points[i - 1], points[i]) < minDist) return true;
    return false;
  });
}

function spikeShapes(): Shape[] {
  const random = createRandom(4242);
  const shapes: Shape[] = [];
  for (const node of NODES) {
    if (!node.chamber || node.id === "exit") continue;
    const c = node.chamber;
    const cy = chamberCenterY(node);
    const count = Math.round((c.rx * c.rz) / 9);
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * 0.85;
      const x = node.x + Math.cos(angle) * dist * c.rx;
      const z = node.z + Math.sin(angle) * dist * c.rz;
      const inside = 1 - (dist * Math.cos(angle)) ** 2 - (dist * Math.sin(angle)) ** 2;
      const ceiling = cy + c.h * Math.sqrt(Math.max(0, inside));
      const length = 1.2 + random() * 3.2;
      const tipY = Math.max(node.y + 2.7, ceiling - length);
      if (tipY < ceiling - 0.4) shapes.push(stalactiteShape(x, z, tipY, ceiling + 2, 0.35 + random() * 0.6));
      if (random() < 0.45 && !nearPath(x, z, 2.6)) {
        shapes.push(stalagmiteShape(x + 0.3, z - 0.2, node.y, 0.6 + random() * 2.2, 0.35 + random() * 0.5));
      }
    }
  }
  return shapes;
}

function stampShape(grid: CaveGrid, rough: Float32Array, shape: Shape, carve: boolean): void {
  const c = grid.cell;
  const x0 = Math.max(0, Math.floor(shape.min.x / c));
  const y0 = Math.max(0, Math.floor(shape.min.y / c));
  const z0 = Math.max(0, Math.floor(shape.min.z / c));
  const x1 = Math.min(grid.nx - 1, Math.ceil(shape.max.x / c));
  const y1 = Math.min(grid.ny - 1, Math.ceil(shape.max.y / c));
  const z1 = Math.min(grid.nz - 1, Math.ceil(shape.max.z / c));
  for (let z = z0; z <= z1; z++) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = x + grid.nx * (y + grid.ny * z);
        const s = shape.sdf(x * c, y * c, z * c);
        if (carve) {
          if (s < grid.d[i]) grid.d[i] = s;
        } else {
          grid.d[i] = Math.max(grid.d[i], -s);
        }
        if (s < 1.2) {
          rough[i] = Math.min(rough[i], shape.rough);
          if (shape.flesh > 0) grid.flesh[i] = Math.max(grid.flesh[i], shape.flesh * Math.min(1, 1.2 - s));
        }
      }
    }
  }
}

export function buildCaveGrid(seed: number): CaveGrid {
  const cell = WORLD.cell;
  const nx = Math.round(WORLD.sizeX / cell) + 1;
  const ny = Math.round(WORLD.sizeY / cell) + 1;
  const nz = Math.round(WORLD.sizeZ / cell) + 1;
  const total = nx * ny * nz;
  const grid: CaveGrid = { nx, ny, nz, cell, d: new Float32Array(total).fill(FAR), flesh: new Float32Array(total) };
  const rough = new Float32Array(total).fill(1);

  // 1. Carve air: rooms, tunnels, the pit, the hole above the start, the exit crack.
  for (const node of NODES) if (node.chamber) stampShape(grid, rough, chamberShape(node), true);
  EDGES.forEach((_, index) => {
    for (const shape of tunnelShapes(index)) stampShape(grid, rough, shape, true);
    for (const shape of alcoveShapes(index)) stampShape(grid, rough, shape, true);
  });
  stampShape(grid, rough, boxShape(PIT_TRENCH, 0.6), true);
  stampShape(
    grid,
    rough,
    tubeShape({ x: START_SHAFT.x, y: START_SHAFT.y0, z: 14 }, { x: START_SHAFT.x, y: START_SHAFT.y1, z: 14 }, START_SHAFT.r, START_SHAFT.r, 0.8, 0),
    true,
  );
  stampShape(grid, rough, tubeShape(EXIT_CRACK.from, EXIT_CRACK.to, EXIT_CRACK.r, EXIT_CRACK.r * 1.3, 0.3, 0), true);

  // 2. Add rock back: pillars, the bridge, the island, spikes.
  for (const pillar of GALLERY_PILLARS) {
    stampShape(grid, rough, tubeShape({ x: pillar.x, y: 14, z: pillar.z }, { x: pillar.x, y: 36, z: pillar.z }, pillar.r, pillar.r, 0.7, 0), false);
  }
  stampShape(grid, rough, boxShape(BRIDGE, 0.08), false);
  stampShape(
    grid,
    rough,
    {
      min: { x: LAKE_ISLAND.x - 4, y: LAKE_ISLAND.y - 3, z: LAKE_ISLAND.z - 4 },
      max: { x: LAKE_ISLAND.x + 4, y: LAKE_ISLAND.y + 3, z: LAKE_ISLAND.z + 4 },
      sdf: (x, y, z) => ellipsoidSdf(x - LAKE_ISLAND.x, y - LAKE_ISLAND.y, z - LAKE_ISLAND.z, LAKE_ISLAND.rx, LAKE_ISLAND.ry, LAKE_ISLAND.rz),
      rough: 0.4,
      flesh: 0,
    },
    false,
  );
  for (const spike of spikeShapes()) stampShape(grid, rough, spike, false);

  // 3. Make the walls bumpy with noise, and grow ribs in the flesh rooms.
  const noise = createNoise3D(seed);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = x + nx * (y + ny * z);
        const d = grid.d[i];
        if (d > 2.4 || d < -2.4) continue;
        const wx = x * cell;
        const wy = y * cell;
        const wz = z * cell;
        let n = noise(wx * 0.09, wy * 0.11, wz * 0.09) * 0.7 + noise(wx * 0.23, wy * 0.27, wz * 0.23) * 0.3 + noise(wx * 0.6, wy * 0.6, wz * 0.6) * 0.1;
        n -= 0.08;
        // Layers of rock, like the pages of a book, make ledges and grooves along the walls.
        n += 0.16 * Math.sin(wy * 2.1 + noise(wx * 0.05, wy * 0.05, wz * 0.05) * 4);
        const flesh = grid.flesh[i];
        if (flesh > 0) n += flesh * 0.5 * Math.max(0, Math.sin(wx * 1.3 + wy * 0.6 + noise(wx * 0.2, wy * 0.2, wz * 0.2) * 3));
        grid.d[i] = d + n * rough[i];
      }
    }
  }

  // 4. Make sure every tunnel stays walkable even if the noise pinched it.
  EDGES.forEach((_, index) => {
    const points = tunnelPoints(index);
    for (let i = 1; i < points.length; i++) {
      const { fill, keep } = floorFixShapes(points[i - 1], points[i]);
      stampShape(grid, rough, fill, false);
      stampShape(grid, rough, keep, true);
    }
  });

  // 5. The outer border of the world is always rock.
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) {
          const i = x + nx * (y + ny * z);
          grid.d[i] = Math.max(grid.d[i], 1);
        }
      }
    }
  }
  return grid;
}

// ---------- Questions about the grid ----------

function clampIndex(value: number, max: number): number {
  return value < 0 ? 0 : value > max ? max : value;
}

// Smoothly read the grid at any world point. Outside the world counts as rock.
export function sampleField(grid: CaveGrid, field: Float32Array, x: number, y: number, z: number): number {
  const gx = x / grid.cell;
  const gy = y / grid.cell;
  const gz = z / grid.cell;
  if (gx < 0 || gy < 0 || gz < 0 || gx > grid.nx - 1 || gy > grid.ny - 1 || gz > grid.nz - 1) return field === grid.d ? 2 : 0;
  const x0 = clampIndex(Math.floor(gx), grid.nx - 2);
  const y0 = clampIndex(Math.floor(gy), grid.ny - 2);
  const z0 = clampIndex(Math.floor(gz), grid.nz - 2);
  const fx = gx - x0;
  const fy = gy - y0;
  const fz = gz - z0;
  const sx = 1;
  const sy = grid.nx;
  const sz = grid.nx * grid.ny;
  const i = x0 + sy * y0 + sz * z0;
  const c00 = field[i] * (1 - fx) + field[i + sx] * fx;
  const c10 = field[i + sy] * (1 - fx) + field[i + sy + sx] * fx;
  const c01 = field[i + sz] * (1 - fx) + field[i + sz + sx] * fx;
  const c11 = field[i + sz + sy] * (1 - fx) + field[i + sz + sy + sx] * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

export function density(grid: CaveGrid, x: number, y: number, z: number): number {
  return sampleField(grid, grid.d, x, y, z);
}

export function isSolid(grid: CaveGrid, p: Vec3): boolean {
  return density(grid, p.x, p.y, p.z) > 0;
}

// Points from rock towards air (the wall's outward direction).
export function surfaceNormal(grid: CaveGrid, x: number, y: number, z: number): Vec3 {
  const h = grid.cell * 0.5;
  const nx = density(grid, x - h, y, z) - density(grid, x + h, y, z);
  const ny = density(grid, x, y - h, z) - density(grid, x, y + h, z);
  const nz = density(grid, x, y, z - h) - density(grid, x, y, z + h);
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

// True when the straight line from a to b stays in air.
export function lineOfSight(grid: CaveGrid, a: Vec3, b: Vec3, step = 0.4): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(dist / step);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (density(grid, a.x + dx * t, a.y + dy * t, a.z + dz * t) > 0.1) return false;
  }
  return true;
}

// Distance along a ray until it hits rock, or null if nothing is hit before maxDist.
export function raycast(grid: CaveGrid, from: Vec3, dir: Vec3, maxDist: number, step = 0.2): number | null {
  for (let t = step; t <= maxDist; t += step) {
    if (density(grid, from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t) > 0) return t;
  }
  return null;
}

// Height of the floor under (x, z), searching down from startY.
export function findFloor(grid: CaveGrid, x: number, startY: number, z: number): number {
  const hit = raycast(grid, { x, y: startY, z }, { x: 0, y: -1, z: 0 }, 20, 0.05);
  return hit === null ? startY - 20 : startY - hit;
}

export type PushResult = { x: number; y: number; z: number; groundNormalY: number; ceilingHit: boolean; hit: boolean };

// Moves a ball of radius r out of the rock. groundNormalY > 0.5 means the ball stands on a floor.
export function pushOutSphere(grid: CaveGrid, x: number, y: number, z: number, r: number): PushResult {
  let groundNormalY = 0;
  let ceilingHit = false;
  let hit = false;
  for (let iteration = 0; iteration < 4; iteration++) {
    const d = density(grid, x, y, z);
    const penetration = d + r;
    if (penetration <= 0) break;
    const n = surfaceNormal(grid, x, y, z);
    x += n.x * penetration * 0.9;
    y += n.y * penetration * 0.9;
    z += n.z * penetration * 0.9;
    hit = true;
    if (n.y > groundNormalY) groundNormalY = n.y;
    if (n.y < -0.5) ceilingHit = true;
  }
  return { x, y, z, groundNormalY, ceilingHit, hit };
}
