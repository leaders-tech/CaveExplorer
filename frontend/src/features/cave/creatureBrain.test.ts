/*
This file tests how the monster decides: seeing, hearing, hunting, forgetting, and fleeing from the flashlight.
Edit this file when monster rules in creatureBrain.ts change. Copy a test here for another monster rule.
*/

import { describe, expect, it } from "vitest";
import {
  HUNT_FORGET_SECONDS,
  RECOIL_SECONDS,
  brainSpeed,
  createBrain,
  hears,
  noiseRadius,
  sees,
  stepBrain,
  type Brain,
  type Perception,
} from "./creatureBrain";

const player = { x: 1, y: 2, z: 3 };

function perception(overrides: Partial<Perception> = {}): Perception {
  return { distance: 15, lineOfSight: true, playerLightOn: false, beamOnCreature: false, noiseRadius: 0, playerPos: player, ...overrides };
}

function awake(state: Brain["state"] = "wander"): Brain {
  return { ...createBrain(), state };
}

describe("monster senses", () => {
  it("sees a lit flashlight from far away but a dark player only up close", () => {
    expect(sees(perception({ playerLightOn: true, distance: 20 }))).toBe(true);
    expect(sees(perception({ playerLightOn: false, distance: 20 }))).toBe(false);
    expect(sees(perception({ playerLightOn: false, distance: 2 }))).toBe(true);
    expect(sees(perception({ playerLightOn: true, distance: 20, lineOfSight: false }))).toBe(false);
  });

  it("hears loud steps further when nothing is in between", () => {
    expect(hears(perception({ distance: 15, noiseRadius: 20 }))).toBe(true);
    expect(hears(perception({ distance: 15, noiseRadius: 20, lineOfSight: false }))).toBe(false);
    expect(hears(perception({ distance: 1.5, noiseRadius: 2, lineOfSight: false }))).toBe(false);
  });

  it("gives running, walking, crouching, and water different loudness", () => {
    expect(noiseRadius(false, false, false, false)).toBe(0);
    expect(noiseRadius(true, true, false, false)).toBeGreaterThan(noiseRadius(true, false, false, false));
    expect(noiseRadius(true, false, true, false)).toBeLessThan(noiseRadius(true, false, false, false));
    expect(noiseRadius(true, false, false, true)).toBeGreaterThan(noiseRadius(true, false, false, false));
  });
});

describe("monster decisions", () => {
  it("stays asleep while dormant", () => {
    expect(stepBrain(createBrain(), 1, perception({ playerLightOn: true, distance: 2 })).state).toBe("dormant");
  });

  it("hunts a player it can see and remembers where it saw them", () => {
    const brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true }));
    expect(brain.state).toBe("hunt");
    expect(brain.target).toEqual(player);
  });

  it("goes to check a noise", () => {
    const brain = stepBrain(awake(), 0.1, perception({ noiseRadius: 20 }));
    expect(brain.state).toBe("investigate");
    expect(brain.target).toEqual(player);
  });

  it("forgets the hunt after losing sight for a while", () => {
    let brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true }));
    const hidden = perception({ lineOfSight: false });
    for (let t = 0; t < HUNT_FORGET_SECONDS - 0.5; t += 0.5) brain = stepBrain(brain, 0.5, hidden);
    expect(brain.state).toBe("hunt");
    brain = stepBrain(brain, 1, hidden);
    expect(brain.state).toBe("investigate");
    for (let t = 0; t < 9; t += 1) brain = stepBrain(brain, 1, hidden);
    expect(brain.state).toBe("wander");
  });

  it("flees after the flashlight shines in its face long enough, then comes back", () => {
    let brain = awake("hunt");
    const beam = perception({ beamOnCreature: true, playerLightOn: true, distance: 5 });
    brain = stepBrain(brain, 0.6, beam);
    expect(brain.state).toBe("hunt");
    brain = stepBrain(brain, 0.7, beam);
    expect(brain.state).toBe("recoil");
    expect(brainSpeed(brain.state, 0)).toBeGreaterThan(brainSpeed("hunt", 4));
    brain = stepBrain(brain, RECOIL_SECONDS + 0.1, beam);
    expect(brain.state).toBe("wander");
  });

  it("does not flee from a beam that is too far away", () => {
    let brain = awake("hunt");
    for (let i = 0; i < 10; i++) brain = stepBrain(brain, 0.5, perception({ beamOnCreature: true, playerLightOn: true, distance: 20 }));
    expect(brain.state).toBe("hunt");
  });

  it("gets faster with every tape the player takes", () => {
    expect(brainSpeed("hunt", 4)).toBeGreaterThan(brainSpeed("hunt", 0));
    expect(brainSpeed("dormant", 4)).toBe(0);
  });
});
