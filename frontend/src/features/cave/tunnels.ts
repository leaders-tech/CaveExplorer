/*
This file turns each tunnel line from caveLayout.ts into a winding passage: a chain of points that bends left and right,
gets wider and narrower, and starts on the floor of a room (so there is a ramp, never a ledge you cannot climb).
caveGrid.ts carves the passages from these points and nav.ts lets the monster walk along them.
Edit this file to change how twisty or wide the tunnels are. Do not copy it; call tunnelPoints or tunnelAlcoves.
*/

import { EDGES, nodeById, type CaveNode, type Vec3 } from "./caveLayout";
import { createRandom } from "./noise";

// x/y/z = middle of the passage, r = half width, ry = half height. The floor is at y - ry * FLOOR_CUT.
export type TunnelPoint = { x: number; y: number; z: number; r: number; ry: number };

export const FLOOR_CUT = 0.75;

// How far inside a room (from its wall) a tunnel begins. The tunnel floor meets the room floor there.
const ROOM_INSET = 2.5;

// Where a tunnel touches a node: inside rooms it starts near the wall, on the room floor.
function tunnelEnd(node: CaveNode, toward: CaveNode, ry: number): Vec3 {
  const centerY = node.y + ry * FLOOR_CUT;
  if (!node.chamber) return { x: node.x, y: centerY, z: node.z };
  const dx = toward.x - node.x;
  const dz = toward.z - node.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const wallDist = 1 / Math.hypot(ux / node.chamber.rx, uz / node.chamber.rz);
  const inset = Math.max(0, Math.min(len * 0.5, wallDist - ROOM_INSET));
  return { x: node.x + ux * inset, y: centerY, z: node.z + uz * inset };
}

const cache = new Map<number, TunnelPoint[]>();

// The middle line of tunnel number edgeIndex, from edge.a to edge.b.
export function tunnelPoints(edgeIndex: number): TunnelPoint[] {
  const cached = cache.get(edgeIndex);
  if (cached) return cached;
  const edge = EDGES[edgeIndex];
  const na = nodeById(edge.a);
  const nb = nodeById(edge.b);
  const a = tunnelEnd(na, nb, edge.ry);
  const b = tunnelEnd(nb, na, edge.ry);
  const random = createRandom(9001 + edgeIndex * 977);
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const segments = Math.max(1, Math.round(len / 4));
  const wiggle = edge.wiggle ?? 1;
  const amp = Math.min(2.4, len * 0.13) * wiggle;
  const hx = b.x - a.x;
  const hz = b.z - a.z;
  const hLen = Math.hypot(hx, hz) || 1;
  const side = { x: -hz / hLen, z: hx / hLen };
  const phase = random() * Math.PI * 2;
  const points: TunnelPoint[] = [{ ...a, r: edge.r, ry: edge.ry }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const envelope = Math.sin(Math.PI * t);
    const bend = (Math.sin(phase + t * Math.PI * 2.2) * 0.7 + (random() - 0.5) * 0.6) * amp * envelope;
    const lift = (random() - 0.5) * 0.4 * envelope * wiggle;
    points.push({
      x: a.x + hx * t + side.x * bend,
      y: a.y + (b.y - a.y) * t + lift,
      z: a.z + hz * t + side.z * bend,
      r: edge.r * (0.85 + random() * 0.45 * wiggle),
      ry: edge.ry * (0.9 + random() * 0.3 * wiggle),
    });
  }
  points.push({ ...b, r: edge.r, ry: edge.ry });
  cache.set(edgeIndex, points);
  return points;
}

export function floorOf(point: TunnelPoint): number {
  return point.y - point.ry * FLOOR_CUT;
}

export type Alcove = { x: number; y: number; z: number; rx: number; ry: number; rz: number; floor: number };

// Small side pockets so tunnels do not look like perfect pipes. Good places to hide.
export function tunnelAlcoves(edgeIndex: number): Alcove[] {
  const edge = EDGES[edgeIndex];
  const points = tunnelPoints(edgeIndex);
  if (points.length < 3 || (edge.wiggle ?? 1) < 0.5) return [];
  const random = createRandom(31337 + edgeIndex * 131);
  const alcoves: Alcove[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    if (random() > 0.45) continue;
    const prev = points[i - 1];
    const next = points[i + 1];
    const p = points[i];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const sign = random() < 0.5 ? -1 : 1;
    const out = p.r + 0.6;
    const size = 1.2 + random() * 0.9;
    const floor = floorOf(p);
    const ry = 1.0 + random() * 0.6;
    alcoves.push({ x: p.x + (-dz / len) * out * sign, y: floor + ry * 0.55, z: p.z + (dx / len) * out * sign, rx: size, ry, rz: size, floor });
  }
  return alcoves;
}

// Points for the monster to follow through a tunnel, from node `from` to the other end.
export function tunnelWalk(edgeIndex: number, from: string, bodyHeight: number): Vec3[] {
  const points = tunnelPoints(edgeIndex).map((p) => ({ x: p.x, y: floorOf(p) + Math.min(bodyHeight, p.ry * 1.1), z: p.z }));
  return EDGES[edgeIndex].a === from ? points : points.reverse();
}
