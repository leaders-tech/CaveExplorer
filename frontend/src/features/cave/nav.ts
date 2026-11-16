/*
This file finds paths for the monster through the cave, using the rooms and tunnels from caveLayout.ts.
Edit this file when the monster should choose routes differently.
Do not copy this file; call findPath or nearestNode.
*/

import { CREATURE_BODY_HEIGHT, EDGES, NODES, walkPoint, type Vec3 } from "./caveLayout";
import { tunnelWalk } from "./tunnels";

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

export function edgeIndexBetween(a: string, b: string): number {
  return EDGES.findIndex((edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
}

// Turns a list of node ids into points the monster can follow, bending along each winding tunnel.
export function pathPoints(ids: string[]): Vec3[] {
  if (ids.length === 0) return [];
  const points: Vec3[] = [pointOf(ids[0])];
  for (let i = 1; i < ids.length; i++) {
    const index = edgeIndexBetween(ids[i - 1], ids[i]);
    if (index >= 0) points.push(...tunnelWalk(index, ids[i - 1], CREATURE_BODY_HEIGHT));
    points.push(pointOf(ids[i]));
  }
  return points;
}

// Rooms and tunnel spots that are a few tunnels away from a node (used when the monster searches).
export function nodesWithin(id: string, hops: number): string[] {
  const seen = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const n of neighboursOf(current)) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}
