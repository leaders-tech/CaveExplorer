/*
This file builds and animates the monster's 3D body from simple shapes: a thin pale crawler with a ribcage, very long
arms with elbows bent up like a spider, a hanging head with a jaw that opens, and glowing eyes.
Each hand and foot is planted on the real cave floor and steps on its own, so it moves like a living thing.
Edit this file to change how the monster looks or moves. game.ts decides where it goes; this file only draws it.
*/

import * as THREE from "three";
import { needsStep, solveTwoBone, stepArc, strideFor } from "./creatureGait";

export type FloorFn = (x: number, y: number, z: number) => number;

// What game.ts tells the body every frame.
export type CreaturePose = {
  pos: THREE.Vector3; // middle of the body
  vel: THREE.Vector3; // how fast it moves (m/s)
  upright: number; // 0 = crawling on all fours, 1 = standing tall
  look: THREE.Vector3 | null; // a point it stares at (usually your face)
  jaw: number; // 0 = closed, 1 = wide open
  eyeGlow: number; // 0 = eyes dark
  twitch: number; // 0..1, how jerky and broken the movement looks
  lunge: THREE.Vector3 | null; // when set, the head is pushed to this point (the death scare)
};

type Limb = {
  side: number; // -1 left, +1 right
  front: boolean; // arm (front) or leg (back)
  group: number; // diagonal pairs step together
  l1: number;
  l2: number;
  planted: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number; // 0..1 while stepping, -1 when planted
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  joint: THREE.Mesh;
  fingers: THREE.Mesh[];
};

const UP = new THREE.Vector3(0, 1, 0);

// A tapered bone from its base (y = 0) to its tip (y = 1). It is stretched between two points each frame.
function boneGeometry(baseRadius: number, tipRadius: number): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(tipRadius, baseRadius, 1, 6);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

function placeBone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  mesh.position.copy(a);
  if (length > 0.0001) mesh.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / length));
  mesh.scale.set(1, Math.max(0.001, length), 1);
}

export class CreatureModel {
  readonly group = new THREE.Group();
  private eyeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85) });
  // Two glowing dots that stay a few pixels big even far away, so you can spot its eyes in the dark.
  private eyeDotMaterial = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: new THREE.Color(1, 0.95, 0.85) });
  private limbs: Limb[] = [];
  private pelvis: THREE.Mesh;
  private ribs: THREE.Mesh;
  private spine: THREE.Mesh[] = [];
  private neck: THREE.Mesh;
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private forward = new THREE.Vector3(1, 0, 0);
  private headQuat = new THREE.Quaternion();
  private twitchOffset = new THREE.Euler();
  private twitchTimer = 0;
  private time = 0;
  private initialized = false;
  onStep: ((pos: THREE.Vector3, hard: boolean) => void) | null = null;

  constructor(skin: THREE.Material, bone: THREE.Material) {
    this.group.frustumCulled = false;
    const add = <T extends THREE.Object3D>(object: T): T => {
      object.frustumCulled = false;
      this.group.add(object);
      return object;
    };

    this.pelvis = add(new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), skin));
    this.ribs = add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), skin));
    // Bumps of the backbone pushing through the skin.
    for (let i = 0; i < 8; i++) this.spine.push(add(new THREE.Mesh(new THREE.SphereGeometry(0.05 - i * 0.002, 5, 4), skin)));
    this.neck = add(new THREE.Mesh(boneGeometry(0.07, 0.05), skin));

    // The head: a long bald skull, a hanging jaw full of thin teeth, four small eyes.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), skin);
    skull.scale.set(0.15, 0.17, 0.26);
    skull.position.set(0, 0.03, 0.12);
    this.head.add(skull);
    const brow = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), skin);
    brow.scale.set(0.16, 0.06, 0.1);
    brow.position.set(0, 0.1, 0.25);
    this.head.add(brow);
    const eyeGeometry = new THREE.SphereGeometry(0.022, 5, 4);
    for (const [x, y, z, s] of [
      [-0.07, 0.06, 0.33, 1],
      [0.07, 0.06, 0.33, 1],
      [-0.1, 0.11, 0.27, 0.6],
      [0.1, 0.11, 0.27, 0.6],
    ]) {
      const eye = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
      eye.position.set(x, y, z);
      eye.scale.setScalar(s);
      this.head.add(eye);
    }
    const dots = new THREE.BufferGeometry();
    dots.setAttribute("position", new THREE.Float32BufferAttribute([-0.07, 0.06, 0.35, 0.07, 0.06, 0.35], 3));
    this.head.add(new THREE.Points(dots, this.eyeDotMaterial));
    this.jaw.position.set(0, -0.06, 0.0);
    const jawBone = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 4), skin);
    jawBone.scale.set(0.12, 0.05, 0.27);
    jawBone.position.set(0, -0.02, 0.2);
    this.jaw.add(jawBone);
    const toothGeometry = new THREE.ConeGeometry(0.012, 0.07, 3);
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const upperTooth = new THREE.Mesh(toothGeometry, bone);
      upperTooth.position.set(side * (0.085 - k * 0.012), -0.07, 0.2 + k * 0.045);
      upperTooth.rotation.x = Math.PI;
      this.head.add(upperTooth);
      const lowerTooth = new THREE.Mesh(toothGeometry, bone);
      lowerTooth.position.set(side * (0.075 - k * 0.011), 0.03, 0.18 + k * 0.045);
      this.jaw.add(lowerTooth);
    }
    this.head.add(this.jaw);
    add(this.head);
    this.head.traverse((child) => (child.frustumCulled = false));

    // Long arms (front) and shorter folded legs (back). Diagonal pairs step together.
    const limbSetup: [number, boolean, number, number, number][] = [
      [-1, true, 0, 0.95, 1.05],
      [1, true, 1, 0.95, 1.05],
      [-1, false, 1, 0.72, 0.82],
      [1, false, 0, 0.72, 0.82],
    ];
    for (const [side, front, group, l1, l2] of limbSetup) {
      const fingers: THREE.Mesh[] = [];
      if (front) for (let f = 0; f < 4; f++) fingers.push(add(new THREE.Mesh(boneGeometry(0.014, 0.004), skin)));
      else for (let f = 0; f < 3; f++) fingers.push(add(new THREE.Mesh(boneGeometry(0.018, 0.006), skin)));
      this.limbs.push({
        side,
        front,
        group,
        l1,
        l2,
        planted: new THREE.Vector3(),
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        t: -1,
        upper: add(new THREE.Mesh(boneGeometry(front ? 0.06 : 0.075, 0.04), skin)),
        lower: add(new THREE.Mesh(boneGeometry(0.042, 0.022), skin)),
        joint: add(new THREE.Mesh(new THREE.SphereGeometry(front ? 0.055 : 0.065, 5, 4), skin)),
        fingers,
      });
    }
  }

  set visible(value: boolean) {
    this.group.visible = value;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  // Forget where the feet were (after a teleport), so they land again under the body.
  resetFeet(): void {
    this.initialized = false;
  }

  headPosition(): THREE.Vector3 {
    return this.head.position.clone();
  }

  update(dt: number, pose: CreaturePose, floor: FloorFn): void {
    this.time += dt;
    this.eyeMaterial.color.setRGB(pose.eyeGlow * 1.1, pose.eyeGlow * 1.0, pose.eyeGlow * 0.88);
    this.eyeDotMaterial.color.setRGB(pose.eyeGlow * 2.4, pose.eyeGlow * 2.1, pose.eyeGlow * 1.7);
    this.eyeDotMaterial.visible = pose.eyeGlow > 0.05;
    const speed = Math.hypot(pose.vel.x, pose.vel.z);

    // Turn the body towards where it walks, or towards what it stares at when standing still.
    const wanted = new THREE.Vector3();
    if (speed > 0.25) wanted.set(pose.vel.x, 0, pose.vel.z);
    else if (pose.look) wanted.set(pose.look.x - pose.pos.x, 0, pose.look.z - pose.pos.z);
    if (wanted.lengthSq() > 0.0001) {
      wanted.normalize();
      this.forward.lerp(wanted, 1 - Math.exp(-(pose.twitch > 0.5 ? 9 : 4.5) * dt)).normalize();
    }
    const f = this.forward.clone();
    const side = new THREE.Vector3().crossVectors(f, UP).normalize(); // points to the monster's right

    // Ground under the body. Over a deep drop it clings at its current height.
    let ground = floor(pose.pos.x, pose.pos.y + 0.3, pose.pos.z);
    if (ground < pose.pos.y - 2.4) ground = pose.pos.y - 0.95;
    const u = pose.upright;
    const crawlHeight = THREE.MathUtils.clamp(pose.pos.y - ground, 0.4, 1.0);
    const breath = Math.sin(this.time * (pose.twitch > 0.5 ? 5 : 2.1));
    const sway = Math.sin(this.time * 7.5) * Math.min(1, speed / 3) * 0.06;

    // Hips and shoulders. Crawling: the back is long and flat; standing: the spine points up.
    const hip = new THREE.Vector3(pose.pos.x, ground + THREE.MathUtils.lerp(crawlHeight * 0.85, 1.05, u), pose.pos.z).addScaledVector(f, -0.5 * (1 - u));
    hip.addScaledVector(side, sway);
    const spineDir = f.clone().multiplyScalar(1 - u).addScaledVector(UP, 0.12 + u).normalize();
    const shoulder = hip.clone().addScaledVector(spineDir, 1.15 + breath * 0.015);
    const back = new THREE.Vector3().crossVectors(side, spineDir).normalize(); // points away from the belly

    // Neck and head. Crawling: the head hangs low in front. Standing: it leans forward from the shoulders.
    const neckDir = f.clone().multiplyScalar(0.85).addScaledVector(UP, THREE.MathUtils.lerp(-0.25, 0.35, u)).normalize();
    let headPos = shoulder.clone().addScaledVector(neckDir, 0.42).addScaledVector(back, 0.05);

    // Sudden jerks of the head: it snaps to a new angle, holds still, snaps again.
    this.twitchTimer -= dt;
    if (this.twitchTimer <= 0) {
      const wild = 0.25 + pose.twitch * 0.9;
      this.twitchOffset.set((Math.random() - 0.5) * wild, (Math.random() - 0.5) * wild * 1.4, (Math.random() - 0.5) * wild * 2.6);
      if (Math.random() < 0.3) this.twitchOffset.z = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.6); // head turned sideways
      this.twitchTimer = pose.twitch > 0.5 ? 0.08 + Math.random() * 0.5 : 0.6 + Math.random() * 2.4;
    }
    const lookPoint = pose.look ?? headPos.clone().addScaledVector(f, 3).addScaledVector(UP, -0.4);
    const lookMatrix = new THREE.Matrix4().lookAt(lookPoint, headPos, UP);
    const target = new THREE.Quaternion().setFromRotationMatrix(lookMatrix).multiply(new THREE.Quaternion().setFromEuler(this.twitchOffset));
    this.headQuat.slerp(target, 1 - Math.exp(-(pose.twitch > 0.3 ? 30 : 10) * dt));

    // The death scare: shove the whole body so the head is right in your face.
    const offset = new THREE.Vector3();
    if (pose.lunge) offset.subVectors(pose.lunge, headPos);
    hip.add(offset);
    shoulder.add(offset);
    headPos = headPos.add(offset);

    // Body shapes.
    const mid = hip.clone().lerp(shoulder, 0.55);
    this.ribs.position.copy(mid);
    this.ribs.quaternion.setFromUnitVectors(UP, spineDir);
    this.ribs.scale.set(0.24 + breath * 0.012, 0.52, 0.2 + breath * 0.01);
    this.pelvis.position.copy(hip);
    this.pelvis.quaternion.copy(this.ribs.quaternion);
    this.pelvis.scale.set(0.2, 0.16, 0.15);
    this.spine.forEach((bump, i) => {
      bump.position.copy(hip).lerp(shoulder, i / (this.spine.length - 1)).addScaledVector(back, 0.17 - Math.abs(i - 4) * 0.012);
    });
    placeBone(this.neck, shoulder, headPos);
    this.head.position.copy(headPos);
    this.head.quaternion.copy(this.headQuat);
    this.jaw.rotation.x = THREE.MathUtils.lerp(0.05, 1.0, pose.jaw) + (pose.jaw > 0.5 ? Math.sin(this.time * 40) * 0.08 : 0);

    // Arms and legs.
    const { stride, duration } = strideFor(speed);
    const lift = 0.16 + Math.min(speed, 5) * 0.05;
    const groupStepping = [false, false];
    for (const limb of this.limbs) if (limb.t >= 0) groupStepping[limb.group] = true;
    for (const limb of this.limbs) {
      const root = (limb.front ? shoulder : hip).clone().addScaledVector(side, limb.side * (limb.front ? 0.24 : 0.17));
      const free = limb.front && u > 0.5; // standing tall: the arms just hang
      let tip: THREE.Vector3;
      if (free) {
        tip = root
          .clone()
          .addScaledVector(UP, -1.75)
          .addScaledVector(f, 0.25 + Math.sin(this.time * 1.3 + limb.side) * 0.08)
          .addScaledVector(side, limb.side * 0.18);
        limb.t = -1;
        limb.planted.copy(tip);
      } else {
        // Where this foot would like to be, a bit ahead when moving.
        const rest = (limb.front ? shoulder : hip)
          .clone()
          .addScaledVector(f, limb.front ? 0.55 * (1 - u) + 0.1 : -0.12)
          .addScaledVector(side, limb.side * (limb.front ? 0.62 : 0.42) * (1 - u * 0.55))
          .addScaledVector(pose.vel, 0.28);
        let restFloor = floor(rest.x, rest.y + 0.6, rest.z);
        if (restFloor < ground - 1.6) restFloor = ground - 0.2;
        rest.y = restFloor;
        if (!this.initialized || limb.planted.distanceTo(rest) > 3) {
          limb.planted.copy(rest);
          limb.t = -1;
        }
        const otherGroup = 1 - limb.group;
        if (limb.t < 0 && !groupStepping[otherGroup] && needsStep(limb.planted, rest, stride)) {
          limb.from.copy(limb.planted);
          limb.to.copy(rest);
          limb.t = 0;
          groupStepping[limb.group] = true;
        }
        if (limb.t >= 0) {
          limb.t += dt / duration;
          if (limb.t >= 1) {
            limb.t = -1;
            limb.planted.copy(limb.to);
            this.onStep?.(limb.planted, speed > 2.5);
          }
        }
        const p = limb.t >= 0 ? stepArc(limb.from, limb.to, limb.t, lift) : limb.planted;
        tip = new THREE.Vector3(p.x, p.y + 0.03, p.z);
      }
      tip.add(offset);
      // Elbows bend up and out like a spider's; knees point forward and out.
      const pole = root
        .clone()
        .addScaledVector(UP, limb.front ? 1.2 : 0.6)
        .addScaledVector(side, limb.side * (limb.front ? 0.9 : 0.5))
        .addScaledVector(f, limb.front ? -0.3 - u * 0.6 : 0.6);
      const solved = solveTwoBone(root, tip, limb.l1, limb.l2, pole);
      const joint = new THREE.Vector3(solved.joint.x, solved.joint.y, solved.joint.z);
      const end = new THREE.Vector3(solved.tip.x, solved.tip.y, solved.tip.z);
      placeBone(limb.upper, root, joint);
      placeBone(limb.lower, joint, end);
      limb.joint.position.copy(joint);
      // Long fingers spread out over the rock (or hang down when standing).
      limb.fingers.forEach((finger, i) => {
        const spread = (i - (limb.fingers.length - 1) / 2) * 0.45;
        const dir = free
          ? UP.clone().multiplyScalar(-1).addScaledVector(f, 0.2).addScaledVector(side, spread * 0.4)
          : f.clone().applyAxisAngle(UP, -spread - limb.side * 0.3).addScaledVector(UP, -0.15);
        const length = limb.front ? 0.26 : 0.14;
        placeBone(finger, end, end.clone().addScaledVector(dir.normalize(), length));
      });
    }
    this.initialized = true;
  }

  dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    this.eyeMaterial.dispose();
    this.eyeDotMaterial.dispose();
  }
}
