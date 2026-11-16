/*
This file decides what the monster wants to do: sleep, wander, check a noise, hunt the player, or flee from light.
It has no graphics, so it is easy to test. game.ts moves the monster based on these decisions.
Edit this file to change how the monster sees, hears, and reacts. Do not copy it; extend stepBrain.
*/

import type { Vec3 } from "./caveLayout";

export type BrainState = "dormant" | "wander" | "investigate" | "hunt" | "recoil";

export type Brain = {
  state: BrainState;
  target: Vec3 | null;
  timer: number; // seconds left in investigate / recoil
  lostTimer: number; // seconds since the monster last saw the player
  lightExposure: number; // seconds the flashlight has been on its face
};

export type Perception = {
  distance: number;
  lineOfSight: boolean;
  playerLightOn: boolean;
  beamOnCreature: boolean; // flashlight cone points at the monster
  noiseRadius: number; // how far the player's last sound carries
  playerPos: Vec3;
};

export const SIGHT_WITH_LIGHT = 26;
export const SIGHT_IN_DARK = 3.5;
export const BEAM_SIGHT = 34;
export const RECOIL_DISTANCE = 9;
export const RECOIL_EXPOSURE = 1.2;
export const RECOIL_SECONDS = 6;
export const HUNT_FORGET_SECONDS = 5;

export function createBrain(): Brain {
  return { state: "dormant", target: null, timer: 0, lostTimer: 0, lightExposure: 0 };
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

export function stepBrain(brain: Brain, dt: number, p: Perception): Brain {
  const next: Brain = { ...brain };
  if (next.state === "dormant") return next;

  if (next.state === "recoil") {
    next.timer -= dt;
    if (next.timer <= 0) {
      next.state = "wander";
      next.target = null;
    }
    return next;
  }

  // Too much light in its face makes it flee.
  if (p.beamOnCreature && p.lineOfSight && p.distance < RECOIL_DISTANCE) next.lightExposure += dt;
  else next.lightExposure = Math.max(0, next.lightExposure - dt * 0.5);
  if (next.lightExposure >= RECOIL_EXPOSURE) {
    return { state: "recoil", target: null, timer: RECOIL_SECONDS, lostTimer: 0, lightExposure: 0 };
  }

  if (sees(p)) {
    next.state = "hunt";
    next.target = { ...p.playerPos };
    next.lostTimer = 0;
    return next;
  }

  if (next.state === "hunt") {
    next.lostTimer += dt;
    if (next.lostTimer > HUNT_FORGET_SECONDS) {
      next.state = "investigate";
      next.timer = 8;
    }
    return next;
  }

  if (hears(p)) {
    next.state = "investigate";
    next.target = { ...p.playerPos };
    next.timer = 10;
    return next;
  }

  if (next.state === "investigate") {
    next.timer -= dt;
    if (next.timer <= 0) {
      next.state = "wander";
      next.target = null;
    }
  }
  return next;
}

// Meters per second. Every tape the player takes makes it a little faster.
export function brainSpeed(state: BrainState, tapesFound: number): number {
  switch (state) {
    case "hunt":
      return 3.7 + tapesFound * 0.25;
    case "investigate":
      return 2.5 + tapesFound * 0.1;
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
