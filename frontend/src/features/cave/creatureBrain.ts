/*
This file decides what the monster wants to do: sleep, wander, check a noise, search an area, stalk you from the dark,
hunt you, or flee from your flashlight. It has no graphics, so it is easy to test. game.ts moves the monster.
The monster learns: every time your light drives it away, it takes more light to scare it the next time.
Edit this file to change how the monster sees, hears, and reacts. Do not copy it; extend stepBrain.
*/

import type { Vec3 } from "./caveLayout";

export type BrainState = "dormant" | "wander" | "investigate" | "search" | "stalk" | "hunt" | "recoil";

export type Brain = {
  state: BrainState;
  target: Vec3 | null; // where it is going (your last known place, a noise, ...)
  timer: number; // seconds left in investigate / search / stalk / recoil
  lostTimer: number; // seconds since it last saw the player
  lightExposure: number; // seconds the flashlight has been on its face
  recoils: number; // how many times the light drove it away (it gets used to the light)
  freeze: number; // seconds it stands perfectly still and stares before it charges
  lastSeen: Vec3 | null; // where it saw the player last
  velocity: Vec3; // how the player was moving when last seen (to guess where they went)
};

export type Sound = { pos: Vec3; radius: number; distance: number }; // a noise somewhere else, like a glowstick

export type Perception = {
  distance: number;
  lineOfSight: boolean;
  playerLightOn: boolean;
  beamOnCreature: boolean; // flashlight cone points at the monster
  noiseRadius: number; // how far the player's last sound carries
  playerPos: Vec3;
  playerFacing?: number; // 1 = player looks right at the monster, -1 = player has their back to it
  sound?: Sound | null;
};

export const SIGHT_WITH_LIGHT = 26;
export const SIGHT_IN_DARK = 3.5;
export const BEAM_SIGHT = 34;
export const RECOIL_DISTANCE = 9;
export const RECOIL_EXPOSURE = 1.2;
export const RECOIL_LEARNING = 0.45; // extra seconds of light needed after every recoil
export const RECOIL_EXPOSURE_MAX = 3;
export const RECOIL_SECONDS = 6;
export const HUNT_FORGET_SECONDS = 5;
export const SEARCH_SECONDS = 14;
export const STALK_DISTANCE = 11; // further than this it stalks first instead of charging
export const STALK_SECONDS = 9;
export const STALK_STRIKE_DISTANCE = 6;
export const FREEZE_SECONDS = 0.9;

export function createBrain(): Brain {
  return {
    state: "dormant",
    target: null,
    timer: 0,
    lostTimer: 0,
    lightExposure: 0,
    recoils: 0,
    freeze: 0,
    lastSeen: null,
    velocity: { x: 0, y: 0, z: 0 },
  };
}

export function sees(p: Perception): boolean {
  if (!p.lineOfSight) return false;
  if (p.beamOnCreature && p.distance < BEAM_SIGHT) return true;
  return p.distance < (p.playerLightOn ? SIGHT_WITH_LIGHT : SIGHT_IN_DARK);
}

// Sound carries less far through rock.
export function hears(p: Perception): boolean {
  const radius = p.lineOfSight ? p.noiseRadius : p.noiseRadius * 0.6;
  return p.distance < radius;
}

export function hearsSound(sound: Sound | null | undefined): boolean {
  return !!sound && sound.distance < sound.radius;
}

// How many seconds of light in its face it takes to make it flee right now.
export function exposureNeeded(brain: Brain): number {
  return Math.min(RECOIL_EXPOSURE_MAX, RECOIL_EXPOSURE + brain.recoils * RECOIL_LEARNING);
}

// Where the player probably went: the last seen place plus a bit of the way they were moving.
export function predictPlayer(brain: Brain): Vec3 | null {
  if (!brain.lastSeen) return null;
  const v = brain.velocity;
  const speed = Math.hypot(v.x, v.z);
  const ahead = Math.min(6, speed * 1.8) / (speed || 1);
  return { x: brain.lastSeen.x + v.x * ahead, y: brain.lastSeen.y, z: brain.lastSeen.z + v.z * ahead };
}

function remember(next: Brain, dt: number, pos: Vec3): void {
  if (next.lastSeen && dt > 0) {
    const k = Math.min(1, dt * 4);
    next.velocity = {
      x: next.velocity.x + ((pos.x - next.lastSeen.x) / dt - next.velocity.x) * k,
      y: 0,
      z: next.velocity.z + ((pos.z - next.lastSeen.z) / dt - next.velocity.z) * k,
    };
  }
  next.lastSeen = { ...pos };
  next.target = { ...pos };
  next.lostTimer = 0;
}

export function stepBrain(brain: Brain, dt: number, p: Perception): Brain {
  const next: Brain = { ...brain };
  if (next.state === "dormant") return next;

  if (next.state === "recoil") {
    next.timer -= dt;
    if (next.timer <= 0) {
      // It does not give up: it comes back to search where it last saw you.
      next.state = "search";
      next.target = predictPlayer(next) ?? next.target;
      next.timer = SEARCH_SECONDS;
    }
    return next;
  }

  // Too much light in its face makes it flee. Each time, it needs more light to be scared.
  if (p.beamOnCreature && p.lineOfSight && p.distance < RECOIL_DISTANCE) next.lightExposure += dt;
  else next.lightExposure = Math.max(0, next.lightExposure - dt * 0.5);
  if (next.lightExposure >= exposureNeeded(next)) {
    return { ...next, state: "recoil", target: null, timer: RECOIL_SECONDS, lostTimer: 0, lightExposure: 0, freeze: 0, recoils: next.recoils + 1 };
  }

  if (next.freeze > 0) {
    next.freeze = Math.max(0, next.freeze - dt);
    if (next.freeze === 0 && next.state === "stalk") next.state = "hunt";
    if (sees(p)) remember(next, dt, p.playerPos);
    return next;
  }

  if (sees(p)) {
    const wasHunting = next.state === "hunt";
    const wasStalking = next.state === "stalk";
    remember(next, dt, p.playerPos);
    if (wasHunting) return next;
    if (wasStalking) {
      next.timer -= dt;
      const behind = (p.playerFacing ?? 1) < -0.2;
      if (p.beamOnCreature) {
        next.freeze = FREEZE_SECONDS; // caught in the light: it goes still... then charges
      } else if (p.distance < STALK_STRIKE_DISTANCE || (behind && p.distance < STALK_DISTANCE + 3) || next.timer <= 0) {
        next.state = "hunt";
      }
      return next;
    }
    // First sight: far away it stalks you from the dark, close up it stares for a moment, then charges.
    if (p.distance > STALK_DISTANCE) {
      next.state = "stalk";
      next.timer = STALK_SECONDS;
    } else {
      next.state = "hunt";
      next.freeze = FREEZE_SECONDS * 0.6;
    }
    return next;
  }

  if (next.state === "hunt" || next.state === "stalk") {
    next.lostTimer += dt;
    next.target = predictPlayer(next) ?? next.target;
    if (next.lostTimer > (next.state === "stalk" ? 2.5 : HUNT_FORGET_SECONDS)) {
      next.state = "search";
      next.timer = SEARCH_SECONDS;
    }
    if (next.state === "hunt" || next.state === "stalk") {
      if (hearsSound(p.sound)) return { ...next, state: "investigate", target: { ...p.sound!.pos }, timer: 12 };
      return next;
    }
  }

  if (hears(p)) {
    next.state = "investigate";
    next.target = { ...p.playerPos };
    next.timer = 10;
    return next;
  }

  if (hearsSound(p.sound)) {
    next.state = "investigate";
    next.target = { ...p.sound!.pos };
    next.timer = 12;
    return next;
  }

  if (next.state === "investigate" || next.state === "search") {
    next.timer -= dt;
    if (next.timer <= 0) {
      if (next.state === "investigate") {
        next.state = "search";
        next.timer = SEARCH_SECONDS * 0.6;
      } else {
        next.state = "wander";
        next.target = null;
      }
    }
  }
  return next;
}

// Meters per second. Every tape the player takes makes it a little faster.
export function brainSpeed(state: BrainState, tapesFound: number): number {
  switch (state) {
    case "hunt":
      return 3.8 + tapesFound * 0.25;
    case "investigate":
      return 2.6 + tapesFound * 0.1;
    case "search":
      return 2.1 + tapesFound * 0.1;
    case "stalk":
      return 2.2;
    case "recoil":
      return 5.5;
    case "wander":
      return 1.5;
    default:
      return 0;
  }
}

// How loud the player is, in meters the sound carries.
export function noiseRadius(moving: boolean, sprinting: boolean, crouching: boolean, inWater: boolean): number {
  if (!moving) return 0;
  let radius = crouching ? 2 : sprinting ? 20 : 7;
  if (inWater) radius *= 1.6;
  return radius;
}
