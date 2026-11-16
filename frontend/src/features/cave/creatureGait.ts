/*
This file has the small math behind the monster's walk: bending an arm or leg so the hand or foot lands on a point
("two-bone IK"), the arc a foot follows while stepping, and when a foot needs a new step. No three.js, easy to test.
Edit this file to change how limbs bend or how far the monster steps. Do not copy it; call the functions.
*/

export type V3 = { x: number; y: number; z: number };

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function scale(a: V3, s: number): V3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Bends a limb with two bones (upper l1, lower l2) from root so its tip reaches target.
// The middle joint (elbow or knee) points towards pole. If the target is too far, the limb points straight at it.
export function solveTwoBone(root: V3, target: V3, l1: number, l2: number, pole: V3): { joint: V3; tip: V3 } {
  const toTarget = sub(target, root);
  const rawDist = len(toTarget) || 0.0001;
  const dir = scale(toTarget, 1 / rawDist);
  const dist = Math.min(l1 + l2 - 0.001, Math.max(Math.abs(l1 - l2) + 0.001, rawDist));
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const toPole = sub(pole, root);
  let bend = sub(toPole, scale(dir, dot(toPole, dir)));
  if (len(bend) < 0.0001) bend = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  bend = sub(bend, scale(dir, dot(bend, dir)));
  bend = scale(bend, 1 / (len(bend) || 1));
  return { joint: add(add(root, scale(dir, along)), scale(bend, height)), tip: add(root, scale(dir, dist)) };
}

// Where a foot is during a step: t goes 0 -> 1, the foot lifts up to `lift` meters in the middle.
export function stepArc(from: V3, to: V3, t: number, lift: number): V3 {
  const k = Math.min(1, Math.max(0, t));
  const ease = k * k * (3 - 2 * k);
  return { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease + Math.sin(Math.PI * k) * lift, z: from.z + (to.z - from.z) * ease };
}

// A planted foot should step when the body has moved too far from it.
export function needsStep(planted: V3, ideal: V3, stride: number): boolean {
  return Math.hypot(planted.x - ideal.x, planted.z - ideal.z) > stride || Math.abs(planted.y - ideal.y) > stride * 1.5;
}

// Longer, faster steps when the monster moves fast. Returns stride length (m) and step time (s).
export function strideFor(speed: number): { stride: number; duration: number } {
  return { stride: 0.42 + Math.min(speed, 6) * 0.12, duration: Math.max(0.1, 0.3 - Math.min(speed, 6) * 0.033) };
}
