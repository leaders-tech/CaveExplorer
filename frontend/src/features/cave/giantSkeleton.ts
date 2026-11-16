/*
This file describes the bones of the huge dead animal in the Ossuary as simple pieces (bone tubes and round blobs),
and pushes the player out of the big bones so you cannot walk through them. No three.js, so it is easy to test.
game.ts turns these pieces into 3D shapes. Edit this file to change the skeleton's shape or size.
Copy the pattern (pieces list + pushOutOfBones) if you add another big solid prop.
*/

import type { Vec3 } from "./caveLayout";
import { createRandom } from "./noise";

export type BoneTube = { a: Vec3; b: Vec3; r0: number; r1: number; solid: boolean };
export type BoneBlob = { c: Vec3; s: Vec3; dark?: boolean; solid: boolean };
export type Skeleton = { tubes: BoneTube[]; blobs: BoneBlob[] };

// Builds the skeleton lying on the floor at (x, floorY, z). The head points to -x. size 1 = about 29 m long.
export function giantSkeleton(x: number, floorY: number, z: number, size = 1): Skeleton {
  const random = createRandom(777);
  const tubes: BoneTube[] = [];
  const blobs: BoneBlob[] = [];
  // Pieces are made around (0, 0, 0) first and moved into place at the end.
  const P = (px: number, py: number, pz: number): Vec3 => ({ x: px, y: py, z: pz });
  const chain = (points: Vec3[], r0: number, r1: number, solid: boolean) => {
    for (let i = 1; i < points.length; i++) {
      const t0 = (i - 1) / (points.length - 1);
      const t1 = i / (points.length - 1);
      tubes.push({ a: points[i - 1], b: points[i], r0: r0 + (r1 - r0) * t0, r1: r0 + (r1 - r0) * t1, solid });
    }
  };

  // Backbone: from the skull, up over the shoulders, along the back, down the long tail.
  const spineHeight = (sx: number) => {
    if (sx < -5) return 1.3 + ((sx + 10) / 5) * 2.9;
    if (sx < 5) return 4.2 + Math.sin(((sx + 5) / 10) * Math.PI) * 0.5 - (sx > 0 ? sx * 0.08 : 0);
    return Math.max(0.35, 3.8 - (sx - 5) * 0.55);
  };
  const spine: Vec3[] = [];
  for (let sx = -10; sx <= 12; sx += 1) spine.push(P(sx, spineHeight(sx), sx > 6 ? Math.sin((sx - 6) * 0.5) * 1.2 : 0));
  chain(spine, 0.3, 0.07, false);
  // Spikes on top of every vertebra.
  for (const point of spine) {
    if (point.x > 7) continue;
    tubes.push({ a: point, b: { x: point.x - 0.25, y: point.y + 0.55, z: point.z }, r0: 0.09, r1: 0.03, solid: false });
    blobs.push({ c: point, s: { x: 0.32, y: 0.26, z: 0.38 }, solid: false });
  }

  // Ribs: big arcs from the backbone down to the floor. Some are broken.
  for (let rx = -4.6; rx <= 4.4; rx += 0.85) {
    const top = spineHeight(rx);
    const width = 2.7 - Math.abs(rx) * 0.12;
    const drop = top - 0.35;
    const broken = random() < 0.25;
    for (const side of [-1, 1]) {
      const points: Vec3[] = [];
      const parts = broken && side === 1 ? 3 : 6;
      for (let k = 0; k <= parts; k++) {
        const phi = (k / 6) * Math.PI * 0.86;
        points.push(P(rx + Math.sin(phi) * 0.35, top - (drop * (1 - Math.cos(phi))) / 1.9, side * width * Math.sin(phi)));
      }
      chain(points, 0.13, 0.07, true);
      if (broken && side === 1) {
        // The broken end lies on the floor.
        tubes.push({ a: P(rx + 0.6, 0.12, width * 1.1), b: P(rx - 0.5, 0.1, width * 1.25), r0: 0.08, r1: 0.06, solid: true });
      }
    }
  }

  // Shoulder blades and hips.
  for (const side of [-1, 1]) blobs.push({ c: P(-4.3, 3.7, side * 1.25), s: { x: 1.1, y: 0.75, z: 0.12 }, solid: false });
  blobs.push({ c: P(5.2, 3.3, 0), s: { x: 1.3, y: 0.8, z: 2.0 }, solid: false });

  // Leg bones fallen on the floor.
  for (const [lx, side, angle] of [
    [-3.5, -1, 0.4],
    [-2.6, 1, -0.3],
    [5.4, -1, -0.5],
    [6.8, 1, 0.2],
  ]) {
    const c = P(lx, 0.25, side * 3.8);
    const dx = Math.cos(angle) * 1.6;
    const dz = Math.sin(angle) * 1.6;
    tubes.push({ a: { x: c.x - dx, y: c.y, z: c.z - dz }, b: { x: c.x + dx, y: c.y, z: c.z + dz }, r0: 0.22, r1: 0.18, solid: true });
    blobs.push({ c: { x: c.x - dx, y: c.y, z: c.z - dz }, s: { x: 0.36, y: 0.32, z: 0.36 }, solid: true });
    blobs.push({ c: { x: c.x + dx, y: c.y, z: c.z + dz }, s: { x: 0.3, y: 0.28, z: 0.3 }, solid: true });
  }

  // The skull, resting on the floor, staring at the entrance. Long snout, horns, tusks, a fallen jaw.
  blobs.push({ c: P(-11.4, 1.35, 0), s: { x: 1.7, y: 1.2, z: 1.35 }, solid: true });
  blobs.push({ c: P(-13.6, 0.95, 0), s: { x: 2.0, y: 0.6, z: 0.85 }, solid: true });
  blobs.push({ c: P(-11.9, 2.15, 0), s: { x: 1.2, y: 0.45, z: 1.0 }, solid: false });
  for (const side of [-1, 1]) {
    blobs.push({ c: P(-12.5, 1.65, side * 0.78), s: { x: 0.42, y: 0.36, z: 0.36 }, dark: true, solid: false });
    blobs.push({ c: P(-15.4, 1.05, side * 0.28), s: { x: 0.18, y: 0.16, z: 0.12 }, dark: true, solid: false });
    chain([P(-11, 2.1, side * 0.7), P(-10.4, 3.1, side * 1.4), P(-10.9, 4.0, side * 2.0), P(-12.2, 4.4, side * 2.2), P(-13.3, 4.0, side * 2.0)], 0.32, 0.04, false);
    chain([P(-14.8, 0.55, side * 0.45), P(-15.9, 0.35, side * 0.8), P(-16.8, 0.8, side * 0.75), P(-17.2, 1.5, side * 0.55)], 0.16, 0.03, true);
    chain([P(-11.2, 0.2, side * 0.75), P(-13.4, 0.15, side * 1.0), P(-15.2, 0.15, side * 0.85)], 0.2, 0.12, true);
  }
  const place = (p: Vec3): Vec3 => ({ x: x + p.x * size, y: floorY + p.y * size, z: z + p.z * size });
  return {
    tubes: tubes.map((t) => ({ ...t, a: place(t.a), b: place(t.b), r0: t.r0 * size, r1: t.r1 * size })),
    blobs: blobs.map((b) => ({ ...b, c: place(b.c), s: { x: b.s.x * size, y: b.s.y * size, z: b.s.z * size } })),
  };
}

// ---------- Keeping the player out of the big bones ----------

function closestOnSegment(px: number, py: number, pz: number, a: Vec3, b: Vec3): Vec3 {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const bz = b.z - a.z;
  const len2 = bx * bx + by * by + bz * bz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * bx + (py - a.y) * by + (pz - a.z) * bz) / len2));
  return { x: a.x + bx * t, y: a.y + by * t, z: a.z + bz * t };
}

// Pushes a standing body (feet at feetY, given height and radius) sideways out of every solid bone.
export function pushOutOfBones(x: number, z: number, feetY: number, height: number, radius: number, skeleton: Skeleton): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (let iteration = 0; iteration < 2; iteration++) {
    for (const tube of skeleton.tubes) {
      if (!tube.solid) continue;
      // Check a few heights along the body and keep the closest touch.
      for (let h = radius; h <= height - radius + 0.001; h += Math.max(0.2, (height - radius * 2) / 3)) {
        const y = feetY + h;
        const c = closestOnSegment(x, y, z, tube.a, tube.b);
        const r = Math.max(tube.r0, tube.r1);
        const dy = y - c.y;
        if (Math.abs(dy) > r + radius) continue;
        const dx = x - c.x;
        const dz = z - c.z;
        const flat = Math.hypot(dx, dz);
        const reach = Math.sqrt(Math.max(0, (r + radius) ** 2 - dy * dy));
        if (flat < reach) {
          const nx = flat > 0.0001 ? dx / flat : 1;
          const nz = flat > 0.0001 ? dz / flat : 0;
          x = c.x + nx * reach;
          z = c.z + nz * reach;
          hit = true;
        }
      }
    }
    for (const blob of skeleton.blobs) {
      if (!blob.solid) continue;
      if (feetY > blob.c.y + blob.s.y || feetY + height < blob.c.y - blob.s.y) continue;
      // Treat the blob as a squashed circle seen from above.
      const dx = (x - blob.c.x) / (blob.s.x + radius);
      const dz = (z - blob.c.z) / (blob.s.z + radius);
      const k = Math.hypot(dx, dz);
      if (k < 1 && k > 0.0001) {
        x = blob.c.x + (dx / k) * (blob.s.x + radius);
        z = blob.c.z + (dz / k) * (blob.s.z + radius);
        hit = true;
      }
    }
  }
  return { x, z, hit };
}

export function skeletonBounds(skeleton: Skeleton): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const grow = (p: Vec3, r: number) => {
    min.x = Math.min(min.x, p.x - r);
    min.y = Math.min(min.y, p.y - r);
    min.z = Math.min(min.z, p.z - r);
    max.x = Math.max(max.x, p.x + r);
    max.y = Math.max(max.y, p.y + r);
    max.z = Math.max(max.z, p.z + r);
  };
  for (const tube of skeleton.tubes) {
    grow(tube.a, tube.r0);
    grow(tube.b, tube.r1);
  }
  for (const blob of skeleton.blobs) grow(blob.c, Math.max(blob.s.x, blob.s.y, blob.s.z));
  return { min, max };
}
