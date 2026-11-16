/*
This file runs the whole game: builds the 3D cave, moves the player, runs the monster, handles items,
and draws every frame through the low-resolution pixel filter. The React page only shows menus and the HUD.
Edit this file to change controls, player speed, flashlight, story events, or how the monster moves.
Do not copy this file; split a big new system (for example a new enemy) into its own file next to it.
*/

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CaveAudio } from "./audio";
import { buildCaveGrid, density, findFloor, lineOfSight, raycast, surfaceNormal, type CaveGrid } from "./caveGrid";
import {
  AREA_THOUGHTS,
  COCOONS,
  CREATURE_BODY_HEIGHT,
  EDGES,
  EXIT_TRIGGER,
  GIANT_SKELETON,
  GLOW_LIGHT_SLOTS,
  ITEMS,
  LIGHTS,
  NODES,
  PIT_DEATH_Y,
  PIT_TRENCH,
  PLAYER_START,
  SEED,
  WALL_WRITINGS,
  WATER_LEVEL,
  nodeById,
  walkPoint,
  type ItemSpot,
  type Vec3,
} from "./caveLayout";
import { STALK_SECONDS, brainSpeed, createBrain, noiseRadius, stepBrain, type Brain, type BrainState } from "./creatureBrain";
import { CreatureModel } from "./creatureModel";
import { giantSkeleton, pushOutOfBones, skeletonBounds, type Skeleton } from "./giantSkeleton";
import { distance, findPath, nearestNode, nodesWithin, pathPoints } from "./nav";
import { createRandom } from "./noise";
import { createNoise3D } from "./noise";
import { FIRST_GHOST_SECONDS, GHOST_EVERY_SECONDS, appearDelay, pickAppearSpot } from "./scareDirector";
import { tunnelWalk } from "./tunnels";
import {
  BASIC_VERTEX,
  CAVE_FRAGMENT,
  CAVE_VERTEX,
  DECAL_FRAGMENT,
  DUST_FRAGMENT,
  DUST_VERTEX,
  NUM_LIGHTS,
  POST_FRAGMENT,
  POST_VERTEX,
  PROP_FRAGMENT,
  WATER_FRAGMENT,
} from "./shaders";
import { buildCaveMesh } from "./surfaceNets";
import { drawRockTexture, drawWritingTexture } from "./textures";

export type GamePhase = "loading" | "ready" | "playing" | "paused" | "dying" | "dead" | "escaped";

export type HudState = {
  phase: GamePhase;
  loadingText: string;
  battery: number;
  stamina: number;
  lightOn: boolean;
  tapes: number;
  totalTapes: number;
  glowsticks: number;
  prompt: string;
  subtitle: string;
  areaTitle: string;
  seconds: number;
  deathReason: "creature" | "fall" | "";
};

export type RunResult = { outcome: "died" | "escaped"; recorders: number; seconds: number };

export type GameOptions = {
  canvas: HTMLCanvasElement;
  onHud: (hud: HudState) => void;
  onFinish: (result: RunResult) => void;
  sensitivity?: number; // 0.2 (slow) to 3 (fast); 1 is normal
};

const RENDER_HEIGHT = 216;
const PLAYER_RADIUS = 0.3;
const STAND_HEIGHT = 1.7;
const CROUCH_HEIGHT = 0.95;
const GRAVITY = 20;
const BATTERY_DRAIN = 0.38; // percent per second
const TOTAL_TAPES = ITEMS.filter((item) => item.kind === "recorder").length;
const GLIMPSE_POINT: Vec3 = { x: 55, y: 19.95, z: 28 };
const LAKE_CENTER = nodeById("lake");
const START_GLOWSTICKS = 1;
const GLOWSTICK_SECONDS = 45;
const GLOWSTICK_NOISE = 24; // meters the landing sound carries

const ITEM_PROMPTS: Record<ItemSpot["kind"], string> = {
  recorder: "[E] Take the tape recorder",
  battery: "[E] Take the batteries",
  glowstick: "[E] Take the glowsticks",
};

type ItemObject = { spot: ItemSpot; group: THREE.Group; taken: boolean; led?: THREE.Mesh; base: THREE.Vector3 };
type Glowstick = { pos: THREE.Vector3; vel: THREE.Vector3; resting: boolean; life: number; mesh: THREE.Mesh; slot: number; landed: boolean };
type Cocoon = { mesh: THREE.Group; phase: number; jerk: number };

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

function v3(p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.y, p.z);
}

export class CaveGame {
  private opts: GameOptions;
  private renderer!: THREE.WebGLRenderer;
  private sceneTarget!: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 90);
  private postScene = new THREE.Scene();
  private postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMaterial!: THREE.ShaderMaterial;
  private grid!: CaveGrid;
  private audio = new CaveAudio();
  private shared = {
    uCamPos: { value: new THREE.Vector3() },
    uLightPos: { value: new THREE.Vector3() },
    uLightDir: { value: new THREE.Vector3(0, 0, -1) },
    uLightPower: { value: 1 },
    uCosOuter: { value: Math.cos(THREE.MathUtils.degToRad(24)) },
    uCosInner: { value: Math.cos(THREE.MathUtils.degToRad(11)) },
    uPLPos: { value: Array.from({ length: NUM_LIGHTS }, () => new THREE.Vector3()) },
    uPLColor: { value: Array.from({ length: NUM_LIGHTS }, () => new THREE.Vector3()) },
    uFogDensity: { value: 0.05 },
    uTime: { value: 0 },
  };
  private creature!: CreatureModel;
  private skeleton!: Skeleton;
  private skeletonBox!: { min: Vec3; max: Vec3 };
  private batteryMaterial!: THREE.ShaderMaterial;
  private cocoons: Cocoon[] = [];
  private items: ItemObject[] = [];
  private glowsticks: Glowstick[] = [];
  private glowCount = START_GLOWSTICKS;
  private glowSlot = 0;
  private soundEvent: { pos: THREE.Vector3; radius: number; time: number } | null = null;
  private frameId = 0;
  private lastTime = 0;
  private disposed = false;
  private keys = new Set<string>();
  private hudTimer = 0;
  private sensitivity = 1;
  private dragging = false;

  // Player state
  private phase: GamePhase = "loading";
  private loadingText = "Waking up...";
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private yaw = PLAYER_START.yaw;
  private pitch = 0;
  private crouch = 0;
  private grounded = false;
  private stamina = 100;
  private exhausted = false;
  private battery = 100;
  private lightOn = true;
  private flashDir = new THREE.Vector3(0, 0, -1);
  private tapes = 0;
  private seconds = 0;
  private stepDistance = 0;
  private bobPhase = 0;
  private noise = 0;
  private fallStartY = 0;
  private subtitle = "";
  private subtitleTimer = 0;
  private subtitleQueue: { text: string; time: number }[] = [];
  private areaTitle = "";
  private areaTimer = 0;
  private visitedAreas = new Set<string>();
  private deathReason: HudState["deathReason"] = "";
  private phaseTimer = 0;
  private fear = 0;
  private flicker = 1;
  private flash = 0;
  private staticAmount = 0;
  private fade = 0;

  // Monster state
  private brain: Brain = createBrain();
  private cPos = new THREE.Vector3();
  private cPath: Vec3[] = [];
  private cPathTimer = 0;
  private cSeesTimer = 0;
  private cLos = false;
  private cWalk = 0;
  private cVel = new THREE.Vector3();
  private cUpright = 0;
  private cIdle = 0; // seconds left standing still (sniffing, listening)
  private cSniff = false; // stands up tall while idle
  private cBurst = 0;
  private cStuckTimer = 0;
  private cSinceContact = 0; // seconds since it last saw you
  private cSearchStarted = false;
  private appearSpots: Vec3[] = []; // places the monster can pop up (rooms and tunnel points)
  private cUnseen = 0; // seconds since the player last had the monster in view
  private ghostTimer = FIRST_GHOST_SECONDS; // before it wakes: seconds until the next far-away glimpse
  private glimpse: "waiting" | "showing" | "fleeing" | "done" = "waiting";
  private glimpseTimer = 0;
  private glimpseUpright = 1; // stands tall only where the roof is high enough

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.setSensitivity(opts.sensitivity ?? 1);
  }

  // ---------- Setup ----------

  async load(): Promise<void> {
    this.setLoading("Carving the tunnels...");
    await nextFrame();
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.opts.canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    const canFloat = this.renderer.extensions.has("EXT_color_buffer_float") || this.renderer.extensions.has("EXT_color_buffer_half_float");
    this.sceneTarget = new THREE.WebGLRenderTarget(320, 180, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
    });

    this.grid = buildCaveGrid(SEED);
    if (this.disposed) return;
    this.setLoading("Growing the walls...");
    await nextFrame();
    const meshData = buildCaveMesh(this.grid);
    if (this.disposed) return;
    this.setLoading("Hiding something in the dark...");
    await nextFrame();
    this.buildCave(meshData);
    this.buildWater();
    this.buildLightsAndFungi();
    this.buildProps();
    this.buildItems();
    this.buildCreature();
    this.buildDust();
    this.buildPost();
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.opts.canvas.addEventListener("click", this.onCanvasClick);
    this.opts.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    this.reset();
    this.phase = "ready";
    this.emitHud();
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.loop);
    (window as unknown as { __cave?: object }).__cave = {
      state: () => this.debugState(),
      look: (yaw: number, pitch: number) => {
        this.yaw = yaw;
        this.pitch = pitch;
      },
      teleport: (x: number, y: number, z: number) => {
        this.pos.set(x, findFloor(this.grid, x, y + 1.5, z) + 0.01, z);
        this.vel.set(0, 0, 0);
      },
      // Puts the monster a few meters in front of you (for checking how it looks and moves).
      summon: (meters = 7, state: BrainState = "wander") => {
        const look = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const p = this.pos.clone().addScaledVector(look, meters);
        this.cPos.set(p.x, findFloor(this.grid, p.x, this.pos.y + 1.5, p.z) + CREATURE_BODY_HEIGHT, p.z);
        this.brain = { ...createBrain(), state, timer: 30 };
        this.cPath = [];
        this.cIdle = 0;
        this.glimpse = "done";
        this.creature.resetFeet();
      },
    };
  }

  private setLoading(text: string): void {
    this.loadingText = text;
    this.emitHud();
  }

  private material(fragment: string, extra: Record<string, THREE.IUniform>, vertex = BASIC_VERTEX): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { ...this.shared, ...extra } });
  }

  private propMaterial(color: [number, number, number], emissive: [number, number, number] = [0, 0, 0]): THREE.ShaderMaterial {
    return this.material(PROP_FRAGMENT, { uColor: { value: new THREE.Vector3(...color) }, uEmissive: { value: new THREE.Vector3(...emissive) } });
  }

  private buildCave(data: ReturnType<typeof buildCaveMesh>): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute("aFlesh", new THREE.BufferAttribute(data.flesh, 1));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    // Colour every vertex: pale limestone high up, dark wet rock deep down, red flesh near the heart.
    const n = createNoise3D(SEED + 7);
    const count = data.positions.length / 3;
    const colors = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      const x = data.positions[v * 3];
      const y = data.positions[v * 3 + 1];
      const z = data.positions[v * 3 + 2];
      const ny = data.normals[v * 3 + 1];
      const big = n(x * 0.12, y * 0.12, z * 0.12);
      const t = THREE.MathUtils.clamp((y - 6) / 28, 0, 1);
      let r = 0.2 + 0.34 * t;
      let g = 0.19 + 0.32 * t;
      let b = 0.19 + 0.27 * t;
      const shade = 0.82 + 0.3 * big + 0.07 * Math.sin(y * 2.6 + big * 2.5);
      r *= shade;
      g *= shade;
      b *= shade;
      if (n(x * 0.3 + 40, y * 0.3, z * 0.3) > 0.45) {
        r *= 1.25;
        g *= 0.92;
        b *= 0.75;
      }
      if (ny > 0.6) {
        r *= 0.85;
        g *= 0.8;
        b *= 0.72;
      }
      if (ny < -0.5) {
        r *= 0.8;
        g *= 0.8;
        b *= 0.85;
      }
      const lakeDist = Math.hypot(x - LAKE_CENTER.x, z - LAKE_CENTER.z);
      if (lakeDist < 14 && y < WATER_LEVEL + 1.5) {
        r *= 0.65;
        g *= 0.85;
        b *= 0.75;
      }
      const f = data.flesh[v];
      colors[v * 3] = THREE.MathUtils.lerp(r, 0.45 + 0.1 * big, f);
      colors[v * 3 + 1] = THREE.MathUtils.lerp(g, 0.09, f);
      colors[v * 3 + 2] = THREE.MathUtils.lerp(b, 0.1, f);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const texture = new THREE.CanvasTexture(drawRockTexture());
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    const material = this.material(CAVE_FRAGMENT, { uTex: { value: texture } }, CAVE_VERTEX);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  private buildWater(): void {
    const geometry = new THREE.PlaneGeometry(26, 24);
    geometry.rotateX(-Math.PI / 2);
    const material = this.material(WATER_FRAGMENT, {});
    material.transparent = true;
    material.depthWrite = false;
    const water = new THREE.Mesh(geometry, material);
    water.position.set(LAKE_CENTER.x, WATER_LEVEL, LAKE_CENTER.z);
    this.scene.add(water);
  }

  private buildLightsAndFungi(): void {
    const pieces: THREE.BufferGeometry[] = [];
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    LIGHTS.forEach((light, index) => {
      this.shared.uPLPos.value[index].set(light.x, light.y, light.z);
      for (let i = 0; i < (light.fungi ?? 0); i++) {
        const dir = new THREE.Vector3(random() - 0.5, random() - 0.8, random() - 0.5).normalize();
        const hit = raycast(this.grid, light, dir, 7, 0.1);
        if (hit === null) continue;
        const p = v3(light).addScaledVector(dir, hit - 0.05);
        for (let k = 0; k < 4; k++) {
          const size = 0.05 + random() * 0.09;
          const piece = new THREE.IcosahedronGeometry(size, 0);
          piece.translate(p.x + (random() - 0.5) * 0.5, p.y + (random() - 0.5) * 0.3, p.z + (random() - 0.5) * 0.5);
          const colors = new Float32Array(piece.attributes.position.count * 3);
          const boost = 2.2 / Math.max(...light.color);
          for (let c = 0; c < colors.length; c += 3) {
            colors[c] = light.color[0] * boost * 0.5;
            colors[c + 1] = light.color[1] * boost * 0.5;
            colors[c + 2] = light.color[2] * boost * 0.5;
          }
          piece.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          pieces.push(piece);
        }
      }
    });
    if (pieces.length > 0) {
      const merged = mergeGeometries(pieces);
      if (merged) this.scene.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true })));
    }
  }

  private floorAt(x: number, y: number, z: number): number {
    return findFloor(this.grid, x, y + 1.5, z);
  }

  private addProp(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rotY = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.scene.add(mesh);
    return mesh;
  }

  private buildProps(): void {
    // The snapped rope hanging from the hole you fell through.
    const rope = this.propMaterial([0.45, 0.36, 0.22]);
    this.addProp(new THREE.CylinderGeometry(0.03, 0.03, 5, 4), rope, 14.4, 41.6, 13.6);
    this.addProp(new THREE.CylinderGeometry(0.02, 0.05, 0.4, 4), rope, 14.4, 39, 13.6, 0.4);
    const ropeEnd = this.floorAt(15.2, 34.5, 13.4);
    this.addProp(new THREE.TorusGeometry(0.35, 0.04, 4, 10), rope, 15.2, ropeEnd + 0.04, 13.4).rotation.x = Math.PI / 2;

    // The lost team's camp in the big hall.
    const crate = this.propMaterial([0.38, 0.3, 0.2]);
    const tarp = this.propMaterial([0.5, 0.18, 0.08]);
    const metal = this.propMaterial([0.35, 0.36, 0.38]);
    const campY = this.floorAt(51, 19, 35.5);
    this.addProp(new THREE.BoxGeometry(0.7, 0.5, 0.5), crate, 51, campY + 0.25, 35.5, 0.3);
    this.addProp(new THREE.BoxGeometry(0.5, 0.4, 0.5), crate, 51.6, campY + 0.7, 35.3, 0.9);
    this.addProp(new THREE.BoxGeometry(1.9, 0.12, 0.8), tarp, 48.4, this.floorAt(48.4, 19, 35.6) + 0.06, 35.6, -0.4);
    this.addProp(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 6), metal, 50.2, this.floorAt(50.2, 19, 34.8) + 0.15, 34.8);

    // Jonas's lamp, still glowing at the bottom of the pit.
    const lampY = this.floorAt(37, 4, 71);
    this.addProp(new THREE.BoxGeometry(0.25, 0.3, 0.25), this.propMaterial([0.2, 0.2, 0.2], [1, 0.8, 0.4]), 37, lampY + 0.15, 71);
    this.shared.uPLPos.value[5].set(37, lampY + 1.2, 71);

    // Bones of people and animals: in the heart, the larder, by the pit, among the giant bones.
    const bone = this.propMaterial([0.75, 0.72, 0.62]);
    const dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.scatterBones(15, 6, 46, 6.5, 30, 11, bone, dark);
    this.scatterBones(9, 13, 90, 4, 18, 12, bone, dark);
    this.scatterBones(27, 15, 72, 2, 6, 13, bone, dark);
    this.scatterBones(72, 14, 16, 5, 10, 14, bone, dark);
    this.scatterBones(20, 11, 60, 1.5, 5, 15, bone, dark);
    this.buildGiantSkeleton(bone, dark);
    this.buildCocoons();
    this.buildWallWritings();

    // A sliver of sky far up the exit crack.
    this.addProp(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.1) }), 3, 28.5, 18.4);
  }

  // A few human-sized bones lying around (cx, cz) in a circle: skulls, long bones, ribs.
  private scatterBones(cx: number, cy: number, cz: number, radius: number, count: number, seed: number, bone: THREE.Material, dark: THREE.Material): void {
    const random = createRandom(seed);
    const pieces: THREE.BufferGeometry[] = [];
    const holes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * radius;
      const x = cx + Math.cos(angle) * dist;
      const z = cz + Math.sin(angle) * dist;
      const y = this.floorAt(x, cy + 1, z);
      if (Math.abs(y - cy) > 2.5) continue;
      const kind = random();
      const turn = random() * Math.PI * 2;
      if (kind < 0.25) {
        // A skull with dark eye holes.
        const skull = new THREE.SphereGeometry(0.11, 6, 5);
        skull.scale(1, 0.9, 1.15);
        const jaw = new THREE.BoxGeometry(0.12, 0.04, 0.1);
        jaw.translate(0, -0.08, 0.06);
        for (const g of [skull, jaw]) {
          g.rotateY(turn);
          g.rotateZ((random() - 0.5) * 0.8);
          g.translate(x, y + 0.08, z);
          pieces.push(g);
        }
        for (const side of [-1, 1]) {
          const hole = new THREE.SphereGeometry(0.032, 4, 3);
          hole.translate(side * 0.042, 0.015, 0.11);
          hole.rotateY(turn);
          hole.translate(x, y + 0.08, z);
          holes.push(hole);
        }
      } else if (kind < 0.7) {
        // A long bone with knobby ends.
        const length = 0.3 + random() * 0.25;
        const shaft = new THREE.CylinderGeometry(0.022, 0.026, length, 5);
        shaft.rotateZ(Math.PI / 2);
        const ends = [-1, 1].map((e) => {
          const knob = new THREE.SphereGeometry(0.04, 5, 4);
          knob.translate((e * length) / 2, 0, 0);
          return knob;
        });
        for (const g of [shaft, ...ends]) {
          g.rotateY(turn);
          g.translate(x, y + 0.03, z);
          pieces.push(g);
        }
      } else {
        // A curved rib.
        const rib = new THREE.TorusGeometry(0.16, 0.012, 3, 8, Math.PI * 0.8);
        rib.rotateX(Math.PI / 2 + (random() - 0.5) * 0.6);
        rib.rotateY(turn);
        rib.translate(x, y + 0.02, z);
        pieces.push(rib);
      }
    }
    const merge = (list: THREE.BufferGeometry[], material: THREE.Material) => {
      if (list.length === 0) return;
      const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
        g.deleteAttribute("uv");
        return g;
      }));
      if (merged) this.scene.add(new THREE.Mesh(merged, material));
    };
    merge(pieces, bone);
    merge(holes, dark);
  }

  // The huge skeleton in the Ossuary: tubes and blobs from giantSkeleton.ts turned into one mesh.
  private buildGiantSkeleton(bone: THREE.Material, dark: THREE.Material): void {
    const floorY = this.floorAt(GIANT_SKELETON.x, 15, GIANT_SKELETON.z);
    this.skeleton = giantSkeleton(GIANT_SKELETON.x, floorY, GIANT_SKELETON.z, GIANT_SKELETON.size);
    this.skeletonBox = skeletonBounds(this.skeleton);
    const pieces: THREE.BufferGeometry[] = [];
    const holes: THREE.BufferGeometry[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const tube of this.skeleton.tubes) {
      const a = v3(tube.a);
      const b = v3(tube.b);
      const length = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(tube.r1, tube.r0, length, 6);
      g.translate(0, length / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
      g.translate(a.x, a.y, a.z);
      pieces.push(g);
      const joint = new THREE.SphereGeometry(tube.r1 * 1.15, 5, 4);
      joint.translate(b.x, b.y, b.z);
      pieces.push(joint);
    }
    for (const blob of this.skeleton.blobs) {
      const g = new THREE.SphereGeometry(1, 9, 6);
      g.scale(blob.s.x, blob.s.y, blob.s.z);
      g.translate(blob.c.x, blob.c.y, blob.c.z);
      (blob.dark ? holes : pieces).push(g);
    }
    const clean = (list: THREE.BufferGeometry[]) =>
      list.map((g) => {
        const flat = g.index ? g.toNonIndexed() : g;
        flat.deleteAttribute("uv");
        return flat;
      });
    const bones = mergeGeometries(clean(pieces));
    if (bones) this.scene.add(new THREE.Mesh(bones, bone));
    const sockets = mergeGeometries(clean(holes));
    if (sockets) this.scene.add(new THREE.Mesh(sockets, dark));
  }

  // People wrapped in red flesh, hanging from the Larder roof on thin strands. Some of them still move.
  private buildCocoons(): void {
    const flesh = this.propMaterial([0.42, 0.12, 0.1], [0.025, 0, 0]);
    const strand = this.propMaterial([0.5, 0.25, 0.2]);
    COCOONS.forEach((spot, i) => {
      const floor = this.floorAt(spot.x, 14, spot.z);
      const ceilingHit = raycast(this.grid, { x: spot.x, y: floor + 1, z: spot.z }, { x: 0, y: 1, z: 0 }, 9, 0.1);
      const ceiling = floor + 1 + (ceilingHit ?? 4);
      const center = Math.min(ceiling - 1.1, floor + 1.8 + (i % 3) * 0.3);
      const group = new THREE.Group();
      group.position.set(spot.x, ceiling, spot.z);
      const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), flesh);
      bodyMesh.scale.set(0.3, 0.85, 0.27);
      bodyMesh.position.y = center - ceiling;
      group.add(bodyMesh);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), flesh);
      head.position.y = center - ceiling + 0.78;
      group.add(head);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, ceiling - center - 0.8, 4), strand);
      rope.position.y = (center - ceiling + 0.8) / 2;
      group.add(rope);
      this.scene.add(group);
      this.cocoons.push({ mesh: group, phase: i * 1.9, jerk: 0 });
    });
  }

  // Words on the walls: find the rock in the given direction and paint a picture of the text on it.
  private buildWallWritings(): void {
    for (const writing of WALL_WRITINGS) {
      const dir = v3(writing.dir).normalize();
      const hit = raycast(this.grid, writing.from, dir, 8, 0.05);
      if (hit === null) continue;
      const p = v3(writing.from).addScaledVector(dir, hit);
      const n = v3(surfaceNormal(this.grid, p.x, p.y, p.z));
      const texture = new THREE.CanvasTexture(drawWritingTexture(writing.text));
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      const material = this.material(DECAL_FRAGMENT, { uTex: { value: texture }, uColor: { value: new THREE.Vector3(0.38, 0.05, 0.04) } });
      material.side = THREE.DoubleSide;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -4;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), material);
      mesh.position.copy(p).addScaledVector(n, 0.12);
      mesh.lookAt(p.clone().addScaledVector(n, 2));
      this.scene.add(mesh);
    }
  }

  private buildItems(): void {
    this.batteryMaterial = this.propMaterial([0.85, 0.6, 0.1], [0.08, 0.05, 0]);
    for (const spot of ITEMS) {
      const group = new THREE.Group();
      let led: THREE.Mesh | undefined;
      if (spot.kind === "recorder") {
        group.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), this.propMaterial([0.16, 0.16, 0.17])));
        const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 8), this.propMaterial([0.5, 0.5, 0.5]));
        reel.position.set(-0.06, 0.07, 0);
        group.add(reel);
        led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.05) }));
        led.position.set(0.1, 0.07, 0.06);
        group.add(led);
      } else if (spot.kind === "battery") {
        // Two big batteries taped together. They glint now and then so you can spot them in the dark.
        const black = this.propMaterial([0.08, 0.08, 0.08]);
        const cap = this.propMaterial([0.6, 0.6, 0.62]);
        for (const side of [-1, 1]) {
          const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 10), this.batteryMaterial);
          cell.rotation.z = Math.PI / 2;
          cell.position.set(0, 0.075, side * 0.078);
          group.add(cell);
          const end = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.08, 10), black);
          end.rotation.z = Math.PI / 2;
          end.position.set(-0.11, 0.075, side * 0.078);
          group.add(end);
          const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 6), cap);
          tip.rotation.z = Math.PI / 2;
          tip.position.set(0.165, 0.075, side * 0.078);
          group.add(tip);
        }
        const tape = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.32), black);
        tape.position.set(0.02, 0.075, 0);
        group.add(tape);
      } else {
        // A bundle of glowsticks, faintly green even when no light is on them.
        const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.9, 0.3) });
        for (const side of [-1, 0, 1]) {
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 6), glow);
          stick.rotation.z = Math.PI / 2;
          stick.rotation.y = side * 0.25;
          stick.position.set(0, 0.025, side * 0.05);
          group.add(stick);
        }
      }
      const floor = this.floorAt(spot.x, spot.y, spot.z);
      const base = new THREE.Vector3(spot.x, floor + (spot.kind === "recorder" ? 0.08 : 0.01), spot.z);
      group.position.copy(base);
      group.rotation.y = spot.x * 1.7;
      this.scene.add(group);
      this.items.push({ spot, group, taken: false, led, base });
    }
  }

  private buildCreature(): void {
    this.appearSpots = NODES.map(walkPoint);
    EDGES.forEach((edge, index) => this.appearSpots.push(...tunnelWalk(index, edge.a, CREATURE_BODY_HEIGHT)));
    const skin = this.propMaterial([0.62, 0.58, 0.52]);
    const teeth = this.propMaterial([0.8, 0.78, 0.65]);
    this.creature = new CreatureModel(skin, teeth);
    this.creature.visible = false;
    this.creature.onStep = (_pos, hard) => {
      if (this.cPos.distanceTo(this.eye()) < 26) this.audio.creatureStep(hard);
    };
    this.scene.add(this.creature.group);
  }

  private buildDust(): void {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = Math.random() * 14;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: { ...this.shared, uPixelScale: { value: 3 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
  }

  private buildPost(): void {
    this.postMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        uRes: { value: new THREE.Vector2(320, 180) },
        uTime: { value: 0 },
        uFear: { value: 0 },
        uFlash: { value: 0 },
        uFade: { value: 1 },
        uStatic: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  private resize = (): void => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setSize(width, height, true);
    const lowW = Math.round((RENDER_HEIGHT * width) / height);
    this.sceneTarget.setSize(lowW, RENDER_HEIGHT);
    this.postMaterial.uniforms.uRes.value.set(lowW, RENDER_HEIGHT);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  // ---------- Game flow ----------

  reset(): void {
    this.pos.set(PLAYER_START.x, PLAYER_START.y, PLAYER_START.z);
    this.pos.y = findFloor(this.grid, this.pos.x, this.pos.y + 2, this.pos.z) + 0.01;
    this.vel.set(0, 0, 0);
    this.yaw = PLAYER_START.yaw;
    this.pitch = -0.1;
    this.crouch = 0;
    this.stamina = 100;
    this.battery = 100;
    this.lightOn = true;
    this.tapes = 0;
    this.seconds = 0;
    this.noise = 0;
    this.fear = 0;
    this.flash = 0;
    this.staticAmount = 0;
    this.fade = 0;
    this.deathReason = "";
    this.subtitle = "";
    this.subtitleTimer = 0;
    this.subtitleQueue = [];
    this.areaTitle = "";
    this.visitedAreas.clear();
    this.brain = createBrain();
    this.cPos.copy(v3(walkPoint(nodeById("nest"))));
    this.cPath = [];
    this.cIdle = 0;
    this.cUpright = 0;
    this.cSinceContact = 0;
    this.cUnseen = 0;
    this.ghostTimer = FIRST_GHOST_SECONDS;
    this.creature.visible = false;
    this.creature.resetFeet();
    this.glimpse = "waiting";
    this.glowCount = START_GLOWSTICKS;
    for (const stick of this.glowsticks) this.removeGlowstick(stick);
    this.glowsticks = [];
    this.soundEvent = null;
    for (const item of this.items) {
      item.taken = false;
      item.group.visible = true;
    }
    this.flashDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.fallStartY = this.pos.y;
  }

  start(): void {
    this.audio.start();
    this.requestLock();
    if (this.phase === "ready" || this.phase === "dead" || this.phase === "escaped") {
      if (this.phase !== "ready") this.reset();
      this.phase = "playing";
      this.queueSubtitle("The rope snapped. I fell a long way down.", 0.8);
      this.queueSubtitle("The others came down here a week ago. Mara, Jonas... Their tapes must still be here.", 5);
      this.queueSubtitle("Find their tapes. Find another way out.", 11);
    } else if (this.phase === "paused") {
      this.phase = "playing";
    }
    this.emitHud();
  }

  private requestLock(): void {
    try {
      const result = this.opts.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Pointer lock can fail in some browsers. The game still works with the mouse unlocked.
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.opts.canvas.removeEventListener("click", this.onCanvasClick);
    this.opts.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    if (document.pointerLockElement === this.opts.canvas) document.exitPointerLock();
    this.audio.stop();
    this.renderer?.dispose();
  }

  private queueSubtitle(text: string, delay = 0): void {
    this.subtitleQueue.push({ text, time: this.seconds + delay });
  }

  private finish(outcome: RunResult["outcome"]): void {
    this.opts.onFinish({ outcome, recorders: this.tapes, seconds: Math.round(this.seconds) });
    if (document.pointerLockElement === this.opts.canvas) document.exitPointerLock();
  }

  // ---------- Input ----------

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (this.phase !== "playing") return;
    if (event.code === "KeyF") {
      this.lightOn = !this.lightOn;
      this.audio.click();
    }
    if (event.code === "KeyE") this.tryTakeItem();
    if (event.code === "KeyG") this.throwGlowstick();
    if (event.code === "Space") event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  // 1 = normal. Touchpads often feel slow, so players can raise it on the title and pause screens.
  setSensitivity(value: number): void {
    this.sensitivity = THREE.MathUtils.clamp(value, 0.2, 3);
  }

  // Looks around by the given mouse or touchpad movement in pixels.
  private turn(dx: number, dy: number): void {
    const speed = 0.0022 * this.sensitivity;
    this.yaw -= dx * speed;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * speed, -1.45, 1.45);
  }

  // Normal mode: the cursor is locked and every move turns the head (works with a touchpad too).
  // Backup mode: if the browser did not lock the cursor, hold the touchpad button (or press and drag) to look.
  private onMouseMove = (event: MouseEvent): void => {
    if (this.phase !== "playing") return;
    if (document.pointerLockElement === this.opts.canvas) this.turn(event.movementX, event.movementY);
    else if (this.dragging) this.turn(event.movementX, event.movementY);
  };

  private onPointerDown = (): void => {
    this.dragging = true;
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private onPointerLockChange = (): void => {
    if (document.pointerLockElement !== this.opts.canvas && this.phase === "playing") {
      this.phase = "paused";
      this.keys.clear();
      this.emitHud();
    }
  };

  private onCanvasClick = (): void => {
    if (this.phase === "playing" && document.pointerLockElement !== this.opts.canvas) this.requestLock();
  };

  // ---------- Main loop ----------

  private loop = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.shared.uTime.value += dt;
    if (this.phase === "playing") this.updatePlaying(dt);
    else if (this.phase === "dying") this.updateDying(dt);
    else if (this.phase === "escaped") this.fade = Math.max(0, this.fade - dt * 0.4);
    if (this.phase === "ready" || this.phase === "playing" || this.phase === "paused") this.fade = Math.min(1, this.fade + dt * 0.5);
    this.audio.update(this.phase === "playing" ? dt : 0);
    this.updateCamera(dt);
    this.render();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.emitHud();
    }
    this.frameId = requestAnimationFrame(this.loop);
  };

  private updatePlaying(dt: number): void {
    this.seconds += dt;
    this.updatePlayer(dt);
    if (this.phase !== "playing") return;
    this.updateFlashlight(dt);
    this.updateGlowsticks(dt);
    this.updateCreature(dt);
    this.updateStory(dt);
    this.updateItems();
    this.updateCocoons(dt);
  }

  private height(): number {
    return THREE.MathUtils.lerp(STAND_HEIGHT, CROUCH_HEIGHT, this.crouch);
  }

  private eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height() - 0.12, this.pos.z);
  }

  private inWater(): boolean {
    return this.pos.y < WATER_LEVEL - 0.05 && Math.hypot(this.pos.x - LAKE_CENTER.x, this.pos.z - LAKE_CENTER.z) < 13;
  }

  private updatePlayer(dt: number): void {
    const forwardInput = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const sideInput = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const wantsCrouch = this.keys.has("KeyC") || this.keys.has("ControlLeft");
    const moving = forwardInput !== 0 || sideInput !== 0;

    // Crouch, but only stand up if there is room above the head.
    let crouchTarget = wantsCrouch ? 1 : 0;
    if (!wantsCrouch && this.crouch > 0.01) {
      const headY = this.pos.y + STAND_HEIGHT - PLAYER_RADIUS;
      if (density(this.grid, this.pos.x, headY, this.pos.z) + PLAYER_RADIUS > 0) crouchTarget = 1;
    }
    this.crouch = THREE.MathUtils.damp(this.crouch, crouchTarget, 10, dt);
    const crouching = this.crouch > 0.5;

    const sprinting = this.keys.has("ShiftLeft") && moving && !crouching && !this.exhausted && forwardInput > 0;
    if (sprinting) this.stamina = Math.max(0, this.stamina - 24 * dt);
    else this.stamina = Math.min(100, this.stamina + 13 * dt);
    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina > 30) this.exhausted = false;

    const water = this.inWater();
    let speed = crouching ? 1.35 : sprinting ? 5.0 : 2.7;
    if (water) speed *= 0.6;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = forward.multiplyScalar(forwardInput).addScaledVector(right, sideInput);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const accel = this.grounded ? 12 : 2;
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wish.x, accel, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, wish.z, accel, dt);
    this.vel.y -= GRAVITY * dt;
    if (this.grounded && this.keys.has("Space") && !crouching) {
      this.vel.y = 5;
      this.grounded = false;
    }

    // Move in small steps so we never tunnel through thin rock.
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    const travel = this.vel.clone().multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(travel.length() / 0.15));
    this.grounded = false;
    for (let s = 0; s < steps; s++) {
      this.pos.addScaledVector(travel, 1 / steps);
      this.collide();
    }
    // Stick to the floor when walking down a slope instead of bouncing off it.
    if (!this.grounded && wasGrounded && this.vel.y <= 0) {
      for (let drop = 0.05; drop <= 0.45; drop += 0.05) {
        if (density(this.grid, this.pos.x, this.pos.y - drop, this.pos.z) > 0) {
          this.pos.y -= drop - 0.03;
          this.collide();
          this.grounded = true;
          break;
        }
      }
    }
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;

    if (!wasGrounded && this.grounded) {
      const drop = this.fallStartY - this.pos.y;
      if (drop > 1.2 || fallSpeed > 7) {
        this.audio.footstep(water, 1.6);
        this.noise = Math.max(this.noise, 12);
      }
    }
    if (this.grounded || wasGrounded) this.fallStartY = this.pos.y;

    // Footsteps make noise the monster can hear.
    const horizontal = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && horizontal > 0.3) {
      this.stepDistance += horizontal * dt;
      this.bobPhase += horizontal * dt * 2.2;
      const stride = crouching ? 0.9 : sprinting ? 1.6 : 1.2;
      if (this.stepDistance > stride) {
        this.stepDistance = 0;
        this.audio.footstep(water, crouching ? 0.25 : sprinting ? 1.1 : 0.6);
      }
    }
    const radius = noiseRadius(moving && horizontal > 0.3, sprinting, crouching, water);
    this.noise = Math.max(radius, this.noise - dt * 10);

    const overPit = this.pos.x > PIT_TRENCH.minX - 1 && this.pos.x < PIT_TRENCH.maxX + 1 && this.pos.z > PIT_TRENCH.minZ && this.pos.z < PIT_TRENCH.maxZ;
    if (overPit && this.pos.y < PIT_DEATH_Y) this.die("fall");
  }

  // Push the three body balls (feet, middle, head) out of the rock.
  private collide(): void {
    const r = PLAYER_RADIUS;
    const h = this.height();
    for (let iteration = 0; iteration < 3; iteration++) {
      // Feet: standing on a floor lifts straight up, so we do not slide down slopes.
      const fy = this.pos.y + r;
      const df = density(this.grid, this.pos.x, fy, this.pos.z) + r;
      if (df > 0) {
        const n = surfaceNormal(this.grid, this.pos.x, fy, this.pos.z);
        if (n.y > 0.55) {
          this.pos.y += df / n.y;
          this.grounded = true;
        } else {
          this.pos.x += n.x * df;
          this.pos.y += n.y * df;
          this.pos.z += n.z * df;
        }
      }
      for (const offset of [h * 0.5, h - r]) {
        const cy = this.pos.y + offset;
        const d = density(this.grid, this.pos.x, cy, this.pos.z) + r;
        if (d <= 0) continue;
        const n = surfaceNormal(this.grid, this.pos.x, cy, this.pos.z);
        this.pos.x += n.x * d;
        this.pos.z += n.z * d;
        if (n.y < -0.4) {
          this.pos.y += n.y * d;
          if (this.vel.y > 0) this.vel.y = 0;
        }
      }
    }
    // The big bones in the Ossuary are solid too.
    const box = this.skeletonBox;
    if (this.pos.x > box.min.x - 1 && this.pos.x < box.max.x + 1 && this.pos.z > box.min.z - 1 && this.pos.z < box.max.z + 1) {
      const pushed = pushOutOfBones(this.pos.x, this.pos.z, this.pos.y, h, r, this.skeleton);
      this.pos.x = pushed.x;
      this.pos.z = pushed.z;
    }
    // Ground check slightly below the feet.
    if (!this.grounded && this.vel.y <= 0 && density(this.grid, this.pos.x, this.pos.y - 0.05, this.pos.z) > -0.02) this.grounded = true;
  }

  private updateFlashlight(dt: number): void {
    if (this.lightOn && this.battery > 0) this.battery = Math.max(0, this.battery - BATTERY_DRAIN * dt);
    const creatureClose = this.brain.state !== "dormant" && this.cPos.distanceTo(this.eye()) < 12;
    const weak = this.battery < 15;
    if ((creatureClose || weak) && Math.random() < (creatureClose ? 0.12 : 0.05)) this.flicker = Math.random() * 0.6;
    this.flicker = THREE.MathUtils.damp(this.flicker, 1, 8, dt);
    const batteryFactor = this.battery > 0 ? Math.min(1, 0.45 + this.battery / 40) : 0;
    this.shared.uLightPower.value = this.lightOn ? batteryFactor * this.flicker : 0;
  }

  private beamPower(): number {
    return this.shared.uLightPower.value;
  }

  private updateCamera(dt: number): void {
    const eye = this.eye();
    const horizontal = Math.hypot(this.vel.x, this.vel.z);
    const bob = this.phase === "playing" && this.grounded ? Math.sin(this.bobPhase * Math.PI) * Math.min(1, horizontal / 3) * 0.045 : 0;
    this.camera.position.set(eye.x, eye.y + bob, eye.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = Math.sin(this.bobPhase * Math.PI * 0.5) * 0.006 * Math.min(1, horizontal / 3);
    if (this.phase === "dying") {
      this.camera.rotation.z += (Math.random() - 0.5) * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * 0.04;
    }
    this.camera.updateMatrixWorld();

    // The flashlight lags slightly behind where you look, like a real hand-held torch.
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.flashDir.lerp(look, 1 - Math.exp(-14 * dt)).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.shared.uCamPos.value.copy(this.camera.position);
    this.shared.uLightPos.value.copy(this.camera.position).addScaledVector(right, 0.22).y -= 0.18;
    this.shared.uLightDir.value.copy(this.flashDir);
    this.audio.setListener(this.camera.position, look);
  }

  // ---------- Items and story ----------

  private nearestItem(): ItemObject | null {
    const eye = this.eye();
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best: ItemObject | null = null;
    let bestScore = 0.7;
    for (const item of this.items) {
      if (item.taken) continue;
      const toItem = item.group.position.clone().sub(eye);
      const dist = toItem.length();
      if (dist > 3) continue;
      const score = toItem.normalize().dot(look) + (dist < 1 ? 0.3 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  private tryTakeItem(): void {
    const item = this.nearestItem();
    if (!item) return;
    item.taken = true;
    item.group.visible = false;
    if (item.spot.kind === "battery") {
      this.battery = Math.min(100, this.battery + 45);
      this.audio.batteryPickup();
      this.queueSubtitle("Fresh batteries.");
      return;
    }
    if (item.spot.kind === "glowstick") {
      this.glowCount += 2;
      this.audio.batteryPickup();
      this.queueSubtitle("Glowsticks. If I throw one [G], the noise might pull it away from me.");
      return;
    }
    this.tapes += 1;
    this.audio.tapeStatic(7);
    this.subtitleQueue = [];
    this.queueSubtitle(item.spot.text ?? "");
    if (this.tapes === 1) {
      this.brain = { ...createBrain(), state: "wander" };
      this.cPos.copy(v3(walkPoint(nodeById("nest"))));
      this.cPath = [];
      this.glimpse = "done";
      this.queueSubtitle("Something deep below just woke up.", 9);
      setTimeout(() => this.audio.stinger(0.35), 9000);
    }
    if (this.tapes === TOTAL_TAPES) {
      this.brain = { ...this.brain, state: "investigate", target: { x: this.pos.x, y: this.pos.y + 1.3, z: this.pos.z }, timer: 20 };
      this.cPath = [];
      this.queueSubtitle("Run.", 9);
    }
  }

  private updateItems(): void {
    const t = this.shared.uTime.value;
    for (const item of this.items) {
      if (item.taken) continue;
      if (item.led) item.led.visible = Math.floor(t * 1.5) % 2 === 0;
    }
    // Batteries catch the light: a short glint every two seconds.
    const glint = Math.max(0, Math.sin(t * 3.1)) ** 12;
    this.batteryMaterial.uniforms.uEmissive.value.set(0.08 + glint * 0.5, 0.05 + glint * 0.38, glint * 0.05);
  }

  // The hanging cocoons sway. Sometimes one jerks, as if something inside is still alive.
  private updateCocoons(dt: number): void {
    const t = this.shared.uTime.value;
    for (const cocoon of this.cocoons) {
      if (cocoon.jerk <= 0 && Math.random() < dt * 0.04 && cocoon.mesh.position.distanceTo(this.pos) < 12) {
        cocoon.jerk = 0.6;
        this.audio.creatureStep(false);
      }
      cocoon.jerk = Math.max(0, cocoon.jerk - dt);
      const kick = cocoon.jerk > 0 ? Math.sin(cocoon.jerk * 40) * 0.12 * cocoon.jerk : 0;
      cocoon.mesh.rotation.z = Math.sin(t * 0.6 + cocoon.phase) * 0.05 + kick;
      cocoon.mesh.rotation.x = Math.cos(t * 0.45 + cocoon.phase) * 0.04;
      cocoon.mesh.rotation.y += dt * 0.05;
    }
  }

  // ---------- Glowsticks ----------

  private throwGlowstick(): void {
    if (this.glowCount <= 0) {
      this.queueSubtitle("No glowsticks left.");
      return;
    }
    this.glowCount -= 1;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const slot = this.glowSlot;
    this.glowSlot = (this.glowSlot + 1) % GLOW_LIGHT_SLOTS;
    const old = this.glowsticks.find((stick) => stick.slot === slot);
    if (old) this.removeGlowstick(old);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 0.5) }));
    this.scene.add(mesh);
    const pos = this.eye().addScaledVector(look, 0.4);
    const vel = look.clone().multiplyScalar(10).add(new THREE.Vector3(0, 2.5, 0));
    this.glowsticks.push({ pos, vel, resting: false, life: GLOWSTICK_SECONDS, mesh, slot, landed: false });
    this.audio.glowCrack();
  }

  private removeGlowstick(stick: Glowstick): void {
    this.scene.remove(stick.mesh);
    stick.mesh.geometry.dispose();
    this.shared.uPLColor.value[LIGHTS.length + stick.slot].set(0, 0, 0);
    this.glowsticks = this.glowsticks.filter((other) => other !== stick);
  }

  private updateGlowsticks(dt: number): void {
    for (const stick of [...this.glowsticks]) {
      stick.life -= dt;
      if (stick.life <= 0) {
        this.removeGlowstick(stick);
        continue;
      }
      if (!stick.resting) {
        stick.vel.y -= GRAVITY * dt;
        const steps = Math.max(1, Math.ceil((stick.vel.length() * dt) / 0.1));
        for (let s = 0; s < steps; s++) {
          stick.pos.addScaledVector(stick.vel, dt / steps);
          const d = density(this.grid, stick.pos.x, stick.pos.y, stick.pos.z);
          if (d > -0.04) {
            // Bounce off the rock and lose most of the speed.
            const n = v3(surfaceNormal(this.grid, stick.pos.x, stick.pos.y, stick.pos.z));
            stick.pos.addScaledVector(n, d + 0.05);
            stick.vel.addScaledVector(n, -1.6 * stick.vel.dot(n)).multiplyScalar(0.35);
            if (!stick.landed) {
              stick.landed = true;
              this.soundEvent = { pos: stick.pos.clone(), radius: GLOWSTICK_NOISE, time: this.seconds };
              this.audio.thud(stick.pos);
            }
            if (stick.vel.length() < 0.8 && n.y > 0.4) {
              stick.resting = true;
              stick.vel.set(0, 0, 0);
            }
          }
        }
        stick.mesh.rotation.x += dt * 9;
        stick.mesh.rotation.z += dt * 6;
      }
      stick.mesh.position.copy(stick.pos);
      const fade = Math.min(1, stick.life / 6);
      const flick = 0.9 + 0.1 * Math.sin(this.shared.uTime.value * 9 + stick.slot);
      const index = LIGHTS.length + stick.slot;
      this.shared.uPLPos.value[index].copy(stick.pos).y += 0.15;
      this.shared.uPLColor.value[index].set(0.05 * fade * flick, 0.55 * fade * flick, 0.16 * fade * flick);
    }
  }

  private updateStory(dt: number): void {
    if (this.subtitleQueue.length > 0 && this.subtitleQueue[0].time <= this.seconds) {
      const next = this.subtitleQueue.shift()!;
      this.subtitle = next.text;
      this.subtitleTimer = 4 + next.text.length * 0.055;
    }
    this.subtitleTimer -= dt;
    if (this.subtitleTimer <= 0) this.subtitle = "";
    this.areaTimer -= dt;
    if (this.areaTimer <= 0) this.areaTitle = "";

    for (const node of NODES) {
      if (!node.chamber || !node.name || this.visitedAreas.has(node.id)) continue;
      if (Math.hypot(this.pos.x - node.x, this.pos.z - node.z) < Math.min(node.chamber.rx, node.chamber.rz) * 0.8 && Math.abs(this.pos.y - node.y) < 5) {
        this.visitedAreas.add(node.id);
        if (node.id !== "start") {
          this.areaTitle = node.name;
          this.areaTimer = 3.5;
        }
        const thought = AREA_THOUGHTS[node.id];
        if (thought) this.queueSubtitle(thought, 1.5);
      }
    }

    const exitDist = Math.hypot(this.pos.x - EXIT_TRIGGER.x, this.pos.y - EXIT_TRIGGER.y, this.pos.z - EXIT_TRIGGER.z);
    if (exitDist < EXIT_TRIGGER.radius) {
      this.phase = "escaped";
      this.fade = 1;
      this.audio.setCreature(this.cPos, false, false);
      this.finish("escaped");
    }

    // Light pulse for the flesh lights; the fungi breathe slowly.
    const t = this.shared.uTime.value;
    LIGHTS.forEach((light, index) => {
      const pulse = light.pulse ? 0.55 + 0.45 * Math.sin(t * 2.4 + index) : 0.85 + 0.15 * Math.sin(t * 0.7 + index * 1.7);
      this.shared.uPLColor.value[index].set(light.color[0] * pulse, light.color[1] * pulse, light.color[2] * pulse);
    });
  }

  // ---------- The monster ----------

  private updateCreature(dt: number): void {
    const eye = this.eye();
    if (this.brain.state === "dormant") {
      this.updateGlimpse(dt, eye);
      this.audio.setCreature(this.cPos, false, false);
      this.fear = THREE.MathUtils.damp(this.fear, this.glimpse === "showing" ? 0.35 : 0, 2, dt);
      this.audio.setFear(this.fear);
      return;
    }

    const head = this.cPos.clone();
    head.y += 0.35;
    const dist = head.distanceTo(eye);
    this.cSeesTimer -= dt;
    if (this.cSeesTimer <= 0) {
      this.cSeesTimer = 0.15;
      this.cLos = dist < 40 && lineOfSight(this.grid, head, eye);
    }
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const toCreature = head.clone().sub(this.shared.uLightPos.value).normalize();
    const beamOn = this.beamPower() > 0.3 && this.cLos && toCreature.dot(this.flashDir) > this.shared.uCosOuter.value;
    const facing = head.clone().sub(eye).normalize().dot(look);
    const recentSound = this.soundEvent && this.seconds - this.soundEvent.time < 0.6 ? this.soundEvent : null;
    const before = this.brain.state;
    const freezeBefore = this.brain.freeze;
    this.brain = stepBrain(this.brain, dt, {
      distance: dist,
      lineOfSight: this.cLos,
      playerLightOn: this.beamPower() > 0.2,
      beamOnCreature: beamOn,
      noiseRadius: this.noise,
      playerPos: { x: this.pos.x, y: this.pos.y + CREATURE_BODY_HEIGHT, z: this.pos.z },
      playerFacing: facing,
      sound: recentSound ? { pos: recentSound.pos, radius: recentSound.radius, distance: this.cPos.distanceTo(recentSound.pos) } : null,
    });
    const state = this.brain.state;
    if (state !== before) {
      this.cPath = [];
      this.cIdle = 0;
      this.cSearchStarted = false;
    }
    if (state === "hunt" && before !== "hunt") {
      this.audio.stinger();
      this.flash = 0.25;
    }
    if (this.brain.freeze > 0 && freezeBefore === 0) this.audio.rattle();
    if (state === "recoil" && before !== "recoil") {
      this.audio.scream();
      this.battery = Math.max(0, this.battery - 6);
      if (this.brain.recoils === 2) this.queueSubtitle("It does not run as fast from the light any more. It is getting used to it.", 2);
    }
    if (state === "hunt" || state === "stalk") this.cSinceContact = 0;
    else this.cSinceContact += dt;
    this.showYourself(dt, eye, look, dist, facing);

    this.moveCreature(dt, eye, dist);

    // Caught.
    if (this.cPos.distanceTo(new THREE.Vector3(this.pos.x, this.pos.y + 0.9, this.pos.z)) < 1.15 && state !== "recoil") {
      this.die("creature");
      return;
    }

    const hunting = state === "hunt";
    const near = THREE.MathUtils.clamp(1 - dist / 20, 0, 1);
    const targetFear = near * (hunting ? 1 : state === "stalk" ? 0.75 : this.cLos ? 0.6 : 0.3);
    this.fear = THREE.MathUtils.damp(this.fear, targetFear, 3, dt);
    this.flash = Math.max(0, this.flash - dt);
    this.staticAmount = THREE.MathUtils.damp(this.staticAmount, hunting && dist < 6 ? 0.4 : 0, 4, dt);
    this.audio.setFear(this.fear);
    // While it stalks, it holds its breath: you hear it less.
    this.audio.setCreature(this.cPos, state !== "stalk" || dist < 7, hunting);
    this.poseCreature(dt, eye, dist);
  }

  // If you have not seen it for a while, it shows up in front of you, out of reach, and stalks you from there.
  private showYourself(dt: number, eye: THREE.Vector3, look: THREE.Vector3, dist: number, facing: number): void {
    const inView = this.cLos && dist < 26 && facing > 0.55;
    if (inView) {
      this.cUnseen = 0;
      return;
    }
    this.cUnseen += dt;
    const state = this.brain.state;
    if (this.cUnseen < appearDelay(this.tapes) || dist < 14 || (state !== "wander" && state !== "search" && state !== "investigate")) return;
    const spot = pickAppearSpot(this.appearSpots, eye, look, 9, 17, (p) => lineOfSight(this.grid, { x: p.x, y: p.y + 0.4, z: p.z }, eye));
    if (!spot) {
      this.cUnseen -= 2; // nowhere good right now; try again in a moment
      return;
    }
    const player = { x: this.pos.x, y: this.pos.y + CREATURE_BODY_HEIGHT, z: this.pos.z };
    this.cPos.copy(v3(spot));
    this.brain = { ...this.brain, state: "stalk", timer: STALK_SECONDS, target: player, lastSeen: player, lostTimer: 0, freeze: 0 };
    this.cPath = [];
    this.cIdle = 0;
    this.creature.resetFeet();
    this.audio.rattle();
    this.cUnseen = 0;
  }

  // Before it wakes up you only catch glimpses: a tall shape far away that stares, then drops and runs.
  // The first one waits for you in the big hall, later ones appear every so often wherever you are.
  private updateGlimpse(dt: number, eye: THREE.Vector3): void {
    if (this.glimpse === "waiting" || this.glimpse === "done") {
      const gallery = nodeById("gallery");
      let spot: Vec3 | null = null;
      if (this.glimpse === "waiting" && Math.hypot(this.pos.x - gallery.x, this.pos.z - gallery.z) < 16 && this.pos.y < gallery.y + 6) {
        spot = GLIMPSE_POINT;
      } else {
        this.ghostTimer -= dt;
        if (this.ghostTimer <= 0) {
          const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
          spot = pickAppearSpot(this.appearSpots, eye, look, 12, 22, (p) => lineOfSight(this.grid, { x: p.x, y: p.y + 0.8, z: p.z }, eye));
          this.ghostTimer = spot ? GHOST_EVERY_SECONDS + Math.random() * 20 : 3;
        }
      }
      if (spot) {
        this.glimpse = "showing";
        this.glimpseTimer = 0;
        this.cPos.copy(v3(spot));
        this.cVel.set(0, 0, 0);
        this.creature.resetFeet();
        const roof = raycast(this.grid, this.cPos, { x: 0, y: 1, z: 0 }, 2, 0.1) ?? 2;
        this.glimpseUpright = roof > 1.6 ? 1 : 0.25;
      }
    }
    if (this.glimpse === "showing") {
      this.glimpseTimer += dt;
      this.creature.visible = true;
      this.creature.update(dt, { pos: this.cPos, vel: this.cVel, upright: this.glimpseUpright, look: eye, jaw: 0.1, eyeGlow: 0.9, twitch: 0.2, lunge: null }, this.floorFn);
      const lit = this.beamPower() > 0.3 && this.cPos.clone().sub(this.shared.uLightPos.value).normalize().dot(this.flashDir) > this.shared.uCosOuter.value;
      if (this.cPos.distanceTo(eye) < 11 || this.glimpseTimer > 8 || (lit && this.glimpseTimer > 1.5)) {
        this.glimpse = "fleeing";
        this.glimpseTimer = 0;
        this.audio.stinger(0.3);
        this.audio.rattle();
      }
    } else if (this.glimpse === "fleeing") {
      // Drops to all fours and scuttles away from you, fast.
      this.glimpseTimer += dt;
      const away = this.cPos.clone().sub(eye).setY(0).normalize();
      const before = this.cPos.clone();
      this.cPos.addScaledVector(away, 6.5 * dt);
      this.pushCreatureOutOfRock();
      this.followGround(dt);
      this.cVel.copy(this.cPos).sub(before).divideScalar(Math.max(dt, 0.001));
      this.cUpright = THREE.MathUtils.damp(this.cUpright, 0, 6, dt);
      this.creature.update(dt, { pos: this.cPos, vel: this.cVel, upright: this.cUpright, look: null, jaw: 0.3, eyeGlow: 0.9, twitch: 0.9, lunge: null }, this.floorFn);
      if (this.glimpseTimer > 1.6) {
        this.glimpse = "done";
        this.creature.visible = false;
        this.cPos.copy(v3(walkPoint(nodeById("nest"))));
        this.creature.resetFeet();
      }
    } else {
      this.creature.visible = false;
    }
  }

  private floorFn = (x: number, y: number, z: number): number => findFloor(this.grid, x, y, z);

  private pushCreatureOutOfRock(): void {
    // The monster can squeeze through tight spots, but not through rock.
    for (let i = 0; i < 3; i++) {
      const d = density(this.grid, this.cPos.x, this.cPos.y, this.cPos.z) + 0.28;
      if (d <= 0) break;
      const n = surfaceNormal(this.grid, this.cPos.x, this.cPos.y, this.cPos.z);
      this.cPos.addScaledVector(v3(n), d);
    }
  }

  // Keep the body just above the floor, lower under a low roof. Over a deep drop it clings where it is.
  private followGround(dt: number): void {
    const floorY = findFloor(this.grid, this.cPos.x, this.cPos.y + 0.5, this.cPos.z);
    if (this.cPos.y - floorY > 2.6) return;
    const roof = raycast(this.grid, { x: this.cPos.x, y: floorY + 0.1, z: this.cPos.z }, { x: 0, y: 1, z: 0 }, 2.4, 0.1) ?? 2.4;
    const height = Math.min(CREATURE_BODY_HEIGHT + this.cUpright * 0.3, Math.max(0.4, roof * 0.55));
    this.cPos.y = THREE.MathUtils.damp(this.cPos.y, floorY + height, 12, dt);
  }

  private moveCreature(dt: number, eye: THREE.Vector3, dist: number): void {
    const state = this.brain.state;
    let speed = brainSpeed(state, this.tapes);
    if (this.brain.freeze > 0) speed = 0;
    if (state === "hunt") {
      // It moves in bursts: a fast scramble, a short jerky pause, another scramble.
      this.cBurst += dt;
      speed *= this.cBurst % 1.7 < 1.25 ? 1.22 : 0.45;
    }
    // Stalking: it keeps its distance in the dark and watches you.
    if (state === "stalk" && this.cLos && dist < 9.5) speed = 0;

    const playerBody = new THREE.Vector3(this.pos.x, this.pos.y + CREATURE_BODY_HEIGHT, this.pos.z);
    let goal: THREE.Vector3 | null = null;
    if ((state === "hunt" || state === "stalk") && this.cLos) {
      goal = playerBody;
      this.cPath = [];
    } else if (this.cIdle > 0) {
      this.cIdle -= dt;
    } else {
      this.cPathTimer -= dt;
      if (this.cPath.length === 0 || this.cPathTimer <= 0) this.planCreaturePath(eye);
      if (this.cPath.length > 0) {
        goal = v3(this.cPath[0]);
        if (goal.distanceTo(this.cPos) < 0.8) {
          this.cPath.shift();
          goal = this.cPath.length > 0 ? v3(this.cPath[0]) : null;
          if (!goal) this.arrived();
        }
      }
    }

    const before = this.cPos.clone();
    if (goal && speed > 0) {
      const step = goal.clone().sub(this.cPos);
      const len = step.length();
      if (len > 0.01) this.cPos.addScaledVector(step.normalize(), Math.min(len, speed * dt));
    }
    this.pushCreatureOutOfRock();
    this.followGround(dt);
    const moved = this.cPos.distanceTo(before);
    this.cVel.copy(this.cPos).sub(before).divideScalar(Math.max(dt, 0.001));
    if (goal && speed > 0.5 && moved < speed * dt * 0.25) {
      this.cStuckTimer += dt;
      if (this.cStuckTimer > 0.6) {
        this.cStuckTimer = 0;
        this.cPath = [];
        this.cPathTimer = 0;
        if (state === "hunt" || state === "stalk") this.cLos = false;
      }
    } else this.cStuckTimer = 0;
  }

  // Reached the end of a path: stop for a moment to listen and sniff, sometimes standing up tall.
  private arrived(): void {
    const state = this.brain.state;
    if (state === "wander" || state === "search" || state === "investigate") {
      this.cIdle = state === "wander" ? 2 + Math.random() * 5 : 1 + Math.random() * 2;
      this.cSniff = Math.random() < 0.55;
    }
  }

  private planCreaturePath(eye: THREE.Vector3): void {
    this.cPathTimer = 1.2;
    const canSeeFrom = (from: Vec3) => (node: Vec3) => lineOfSight(this.grid, from, node, 0.6);
    const startId = nearestNode(this.cPos, canSeeFrom(this.cPos));
    const state = this.brain.state;
    let goalId: string;
    let finalPoint: Vec3 | null = null;
    if (state === "recoil") {
      // Flee to the place farthest from the player.
      let best = NODES[0];
      for (const node of NODES) if (distance(walkPoint(node), eye) > distance(walkPoint(best), eye)) best = node;
      goalId = best.id;
      this.cPathTimer = 99;
    } else if (state === "search" && this.brain.target) {
      // First go to where it thinks you went, then check the rooms and tunnels around it, one by one.
      const around = nearestNode(this.brain.target, canSeeFrom(this.brain.target));
      if (!this.cSearchStarted) {
        this.cSearchStarted = true;
        goalId = around;
        finalPoint = this.brain.target;
      } else {
        if (this.cPath.length > 0) return;
        const choices = nodesWithin(around, 2).filter((id) => id !== startId);
        goalId = choices[Math.floor(Math.random() * choices.length)] ?? around;
      }
      this.cPathTimer = 99;
    } else if (this.brain.target && state !== "wander") {
      goalId = nearestNode(this.brain.target, canSeeFrom(this.brain.target));
      finalPoint = this.brain.target;
    } else {
      if (this.cPath.length > 0) return;
      // It can smell you. The longer it has not seen you (and the more tapes you carry), the closer it wanders.
      const smell = Math.min(0.9, 0.4 + this.cSinceContact / 60 + this.tapes * 0.1);
      if (Math.random() < smell) {
        const near = nodesWithin(nearestNode(this.pos), 2);
        goalId = near[Math.floor(Math.random() * near.length)];
      } else {
        goalId = NODES[Math.floor(Math.random() * NODES.length)].id;
      }
      this.cPathTimer = 99;
    }
    const points = pathPoints(findPath(startId, goalId));
    while (points.length > 1 && distance(points[0], this.cPos) < 3) points.shift();
    if (finalPoint) points.push(finalPoint);
    this.cPath = points;
  }

  // Tells the 3D body how to stand, where to look, how wide to open its mouth.
  private poseCreature(dt: number, eye: THREE.Vector3, dist: number): void {
    const state = this.brain.state;
    const hunting = state === "hunt";
    const frozen = this.brain.freeze > 0;
    const watching = state === "stalk" && this.cLos && dist < 10;
    const standing = (this.cIdle > 0 && this.cSniff) || frozen ? 1 : watching ? 0.35 : 0;
    this.cUpright = THREE.MathUtils.damp(this.cUpright, standing, 4, dt);
    let glow = 0.8;
    if (state === "recoil") glow = 0;
    else if (hunting || frozen) glow = 1.3;
    else if (state === "stalk") glow = 0.9; // two pale eyes watching you from the dark
    else if (Math.random() < 0.02) glow = 0; // a blink
    this.creature.visible = true;
    this.creature.update(
      dt,
      {
        pos: this.cPos,
        vel: this.cVel,
        upright: this.cUpright,
        look: hunting || frozen || state === "stalk" || (this.cLos && dist < 14) ? eye : null,
        jaw: frozen ? 0.8 : hunting ? (dist < 6 ? 1 : 0.45) : state === "recoil" ? 0.9 : 0.05,
        eyeGlow: glow,
        twitch: frozen ? 1 : hunting ? 0.85 : state === "recoil" ? 0.9 : state === "stalk" ? 0.35 : 0.15,
        lunge: null,
      },
      this.floorFn,
    );
  }

  private die(reason: "creature" | "fall"): void {
    this.deathReason = reason;
    this.phase = "dying";
    this.phaseTimer = 0;
    this.keys.clear();
    if (reason === "creature") {
      this.audio.scream();
      this.flash = 0.6;
    } else {
      this.audio.stinger(0.6);
    }
    this.finish("died");
  }

  private updateDying(dt: number): void {
    this.phaseTimer += dt;
    if (this.deathReason === "creature") {
      const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      // Its face rushes right up to yours, jaw wide open.
      const reach = 1.15 - Math.min(0.3, this.phaseTimer * 0.5);
      const lunge = this.camera.position.clone().addScaledVector(look, reach);
      this.cPos.copy(this.camera.position).addScaledVector(look, reach + 1.2);
      this.cPos.y = this.camera.position.y - 0.9;
      this.creature.visible = true;
      this.creature.update(
        dt,
        { pos: this.cPos, vel: new THREE.Vector3(), upright: 0.7, look: this.camera.position, jaw: 1, eyeGlow: 1.6, twitch: 1, lunge },
        this.floorFn,
      );
      this.flash = 0.25 + Math.random() * 0.35;
      this.staticAmount = 1;
      this.shared.uLightPower.value = Math.random() < 0.5 ? 1 : 0.2;
    } else {
      this.vel.y -= GRAVITY * dt;
      this.pos.y = Math.max(3, this.pos.y + this.vel.y * dt);
      this.pitch = THREE.MathUtils.damp(this.pitch, 1.2, 3, dt);
    }
    this.fade = Math.max(0, 1 - this.phaseTimer / 1.8);
    if (this.phaseTimer > 1.8) {
      this.phase = "dead";
      this.creature.visible = false;
      this.staticAmount = 0;
      this.flash = 0;
      this.fear = 0;
      this.audio.setFear(0);
      this.audio.setCreature(this.cPos, false, false);
      this.emitHud();
    }
  }

  // ---------- Drawing ----------

  private render(): void {
    const post = this.postMaterial.uniforms;
    post.uTime.value = this.shared.uTime.value;
    post.uFear.value = this.fear;
    post.uFlash.value = this.flash;
    post.uStatic.value = this.staticAmount;
    post.uFade.value = this.fade;
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  private emitHud(): void {
    const item = this.phase === "playing" ? this.nearestItemSafe() : null;
    this.opts.onHud({
      phase: this.phase,
      loadingText: this.loadingText,
      battery: Math.round(this.battery),
      stamina: Math.round(this.stamina),
      lightOn: this.lightOn,
      tapes: this.tapes,
      totalTapes: TOTAL_TAPES,
      glowsticks: this.glowCount,
      prompt: item ? ITEM_PROMPTS[item.spot.kind] : "",
      subtitle: this.subtitle,
      areaTitle: this.areaTitle,
      seconds: Math.round(this.seconds),
      deathReason: this.deathReason,
    });
  }

  private nearestItemSafe(): ItemObject | null {
    return this.items.length > 0 ? this.nearestItem() : null;
  }

  // Used by browser tests and for debugging in the console: window.__cave.state()
  debugState(): object {
    return {
      phase: this.phase,
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      tapes: this.tapes,
      battery: this.battery,
      creature: this.brain.state,
      grounded: this.grounded,
      glowsticks: this.glowCount,
      creatureX: this.cPos.x,
      creatureY: this.cPos.y,
      creatureZ: this.cPos.z,
    };
  }
}
