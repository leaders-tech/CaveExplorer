/*
This file finds paths for the monster through the cave, using the rooms and tunnels from caveLayout.ts.
Edit this file when the monster should choose routes differently.
Do not copy this file; call findPath or nearestNode.
*/

import { EDGES, NODES, walkPoint, type Vec3 } from "./caveLayout";

const neighbours = new Map<string, string[]>();
for (const node of NODES) neighbours.set(node.id, []);
for (const edge of EDGES) {
  neighbours.get(edge.a)!.push(edge.b);
  neighbours.get(edge.b)!.push(edge.a);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pointOf(id: string): Vec3 {
  return walkPoint(NODES.find((node) => node.id === id)!);
}

export function neighboursOf(id: string): string[] {
  return neighbours.get(id) ?? [];
}

export function nearestNode(p: Vec3, canSee?: (node: Vec3) => boolean): string {
  let best = NODES[0].id;
  let bestDist = Infinity;
  for (const node of NODES) {
    const point = walkPoint(node);
    let dist = distance(p, point);
    if (canSee && !canSee(point)) dist += 40;
    if (dist < bestDist) {
      bestDist = dist;
      best = node.id;
    }
  }
  return best;
}

// A* search. Returns node ids from start to goal (both included).
export function findPath(start: string, goal: string): string[] {
  if (start === goal) return [start];
  const open = new Set([start]);
  const cameFrom = new Map<string, string>();
  const g = new Map<string, number>([[start, 0]]);
  const f = new Map<string, number>([[start, distance(pointOf(start), pointOf(goal))]]);
  while (open.size > 0) {
    let current = "";
    let bestF = Infinity;
    for (const id of open) {
      const score = f.get(id) ?? Infinity;
      if (score < bestF) {
        bestF = score;
        current = id;
      }
    }
    if (current === goal) {
      const path = [current];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current)!;
        path.unshift(current);
      }
      return path;
    }
    open.delete(current);
    for (const next of neighboursOf(current)) {
      const tentative = (g.get(current) ?? Infinity) + distance(pointOf(current), pointOf(next));
      if (tentative < (g.get(next) ?? Infinity)) {
        cameFrom.set(next, current);
        g.set(next, tentative);
        f.set(next, tentative + distance(pointOf(next), pointOf(goal)));
        open.add(next);
      }
    }
  }
  return [start];
}

export function pathPoints(ids: string[]): Vec3[] {
  return ids.map(pointOf);
}
