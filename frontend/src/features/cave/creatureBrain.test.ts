/*
This file tests how the monster decides: seeing, hearing, stalking, hunting, searching, fleeing from the flashlight,
learning to bear the light, and following the noise of a thrown glowstick.
Edit this file when monster rules in creatureBrain.ts change. Copy a test here for another monster rule.
*/

import { describe, expect, it } from "vitest";
import {
  FREEZE_SECONDS,
  HUNT_FORGET_SECONDS,
  RECOIL_EXPOSURE,
  RECOIL_SECONDS,
  SEARCH_SECONDS,
  STALK_SECONDS,
  brainSpeed,
  exposureNeeded,
  predictPlayer,
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

  it("charges a player it sees up close after a short stare, and remembers where it saw them", () => {
    let brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true, distance: 8 }));
    expect(brain.state).toBe("hunt");
    expect(brain.freeze).toBeGreaterThan(0);
    expect(brain.target).toEqual(player);
    brain = stepBrain(brain, FREEZE_SECONDS, perception({ playerLightOn: true, distance: 8 }));
    expect(brain.freeze).toBe(0);
    expect(brain.state).toBe("hunt");
  });

  it("stalks a far away player from the dark before it attacks", () => {
    let brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true, distance: 20 }));
    expect(brain.state).toBe("stalk");
    for (let t = 0; t < STALK_SECONDS - 1; t += 0.5) brain = stepBrain(brain, 0.5, perception({ playerLightOn: true, distance: 20 }));
    expect(brain.state).toBe("stalk");
    brain = stepBrain(brain, 1.5, perception({ playerLightOn: true, distance: 20 }));
    expect(brain.state).toBe("hunt");
  });

  it("strikes from the stalk when the player turns their back", () => {
    let brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true, distance: 13 }));
    expect(brain.state).toBe("stalk");
    brain = stepBrain(brain, 0.1, perception({ playerLightOn: true, distance: 13, playerFacing: -0.8 }));
    expect(brain.state).toBe("hunt");
  });

  it("freezes when the light finds it while stalking, then charges", () => {
    let brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true, distance: 18 }));
    brain = stepBrain(brain, 0.1, perception({ playerLightOn: true, distance: 18, beamOnCreature: true }));
    expect(brain.state).toBe("stalk");
    expect(brain.freeze).toBeGreaterThan(0);
    brain = stepBrain(brain, FREEZE_SECONDS + 0.1, perception({ playerLightOn: true, distance: 18, beamOnCreature: true }));
    expect(brain.state).toBe("hunt");
  });

  it("goes to check a noise", () => {
    const brain = stepBrain(awake(), 0.1, perception({ noiseRadius: 20 }));
    expect(brain.state).toBe("investigate");
    expect(brain.target).toEqual(player);
  });

  it("follows the sound of a thrown glowstick instead of the player", () => {
    const spot = { x: 40, y: 10, z: 40 };
    const brain = stepBrain(awake(), 0.1, perception({ lineOfSight: false, sound: { pos: spot, radius: 24, distance: 10 } }));
    expect(brain.state).toBe("investigate");
    expect(brain.target).toEqual(spot);
    const far = stepBrain(awake(), 0.1, perception({ lineOfSight: false, sound: { pos: spot, radius: 24, distance: 30 } }));
    expect(far.state).toBe("wander");
  });

  it("is lured away by a glowstick after it loses sight of the player", () => {
    let brain: Brain = { ...awake("hunt"), lastSeen: player, target: player };
    const spot = { x: 40, y: 10, z: 40 };
    brain = stepBrain(brain, 0.1, perception({ lineOfSight: false, sound: { pos: spot, radius: 24, distance: 5 } }));
    expect(brain.state).toBe("investigate");
    expect(brain.target).toEqual(spot);
  });

  it("searches around where it lost the player, then gives up and wanders", () => {
    let brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true, distance: 8 }));
    brain = stepBrain(brain, FREEZE_SECONDS, perception({ playerLightOn: true, distance: 8 }));
    const hidden = perception({ lineOfSight: false });
    for (let t = 0; t < HUNT_FORGET_SECONDS - 0.5; t += 0.5) brain = stepBrain(brain, 0.5, hidden);
    expect(brain.state).toBe("hunt");
    brain = stepBrain(brain, 1, hidden);
    expect(brain.state).toBe("search");
    expect(brain.target).not.toBeNull();
    for (let t = 0; t < SEARCH_SECONDS + 1; t += 1) brain = stepBrain(brain, 1, hidden);
    expect(brain.state).toBe("wander");
  });

  it("guesses where a running player went", () => {
    let brain = stepBrain(awake(), 0.1, perception({ playerLightOn: true, distance: 8, playerPos: { x: 0, y: 0, z: 0 } }));
    brain = stepBrain(brain, 0.5, perception({ playerLightOn: true, distance: 8, playerPos: { x: 1, y: 0, z: 0 } }));
    brain = stepBrain(brain, 0.5, perception({ playerLightOn: true, distance: 8, playerPos: { x: 2, y: 0, z: 0 } }));
    const guess = predictPlayer(brain)!;
    expect(guess.x).toBeGreaterThan(2.5);
    expect(Math.abs(guess.z)).toBeLessThan(0.1);
  });

  it("flees after the flashlight shines in its face long enough, then comes back to search", () => {
    let brain = awake("hunt");
    const beam = perception({ beamOnCreature: true, playerLightOn: true, distance: 5 });
    brain = stepBrain(brain, 0.6, beam);
    expect(brain.state).toBe("hunt");
    brain = stepBrain(brain, 0.7, beam);
    expect(brain.state).toBe("recoil");
    expect(brainSpeed(brain.state, 0)).toBeGreaterThan(brainSpeed("hunt", 4));
    brain = stepBrain(brain, RECOIL_SECONDS + 0.1, beam);
    expect(brain.state).toBe("search");
  });

  it("gets used to the light: every escape needs more light the next time", () => {
    let brain = awake("hunt");
    expect(exposureNeeded(brain)).toBe(RECOIL_EXPOSURE);
    const beam = perception({ beamOnCreature: true, playerLightOn: true, distance: 5 });
    brain = stepBrain(brain, RECOIL_EXPOSURE + 0.05, beam);
    expect(brain.state).toBe("recoil");
    expect(brain.recoils).toBe(1);
    brain = { ...brain, state: "hunt", timer: 0 };
    brain = stepBrain(brain, RECOIL_EXPOSURE + 0.05, beam);
    expect(brain.state).toBe("hunt");
    expect(exposureNeeded(brain)).toBeGreaterThan(RECOIL_EXPOSURE);
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
