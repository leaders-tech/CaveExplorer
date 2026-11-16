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
  EXIT_TRIGGER,
  ITEMS,
  LIGHTS,
  NODES,
  PIT_DEATH_Y,
  PIT_TRENCH,
  PLAYER_START,
  SEED,
  WATER_LEVEL,
  nodeById,
  walkPoint,
  type ItemSpot,
  type Vec3,
} from "./caveLayout";
import { brainSpeed, createBrain, noiseRadius, stepBrain, type Brain } from "./creatureBrain";
import { distance, findPath, nearestNode, pathPoints } from "./nav";
import { createNoise3D } from "./noise";
import {
  BASIC_VERTEX,
  CAVE_FRAGMENT,
  CAVE_VERTEX,
  CREATURE_FRAGMENT,
  DUST_FRAGMENT,
  DUST_VERTEX,
  NUM_LIGHTS,
  POST_FRAGMENT,
  POST_VERTEX,
  PROP_FRAGMENT,
  WATER_FRAGMENT,
} from "./shaders";
import { buildCaveMesh } from "./surfaceNets";
import { CREATURE_FRAMES, drawCreatureSheet, drawRockTexture } from "./textures";

export type GamePhase = "loading" | "ready" | "playing" | "paused" | "dying" | "dead" | "escaped";

export type HudState = {
  phase: GamePhase;
  loadingText: string;
  battery: number;
  stamina: number;
  lightOn: boolean;
  tapes: number;
  totalTapes: number;
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
const GLIMPSE_POINT: Vec3 = { x: 55, y: 20.3, z: 28 };
const LAKE_CENTER = nodeById("lake");

type ItemObject = { spot: ItemSpot; group: THREE.Group; taken: boolean; led?: THREE.Mesh; base: THREE.Vector3 };

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
  private creatureMesh!: THREE.Mesh;
  private creatureMaterial!: THREE.ShaderMaterial;
  private items: ItemObject[] = [];
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
  private cVisible = false;
  private cSquash = 1;
  private cSquashTimer = 0;
  private cStuckTimer = 0;
  private glimpse: "waiting" | "showing" | "done" = "waiting";
  private glimpseTimer = 0;

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

    // Bones scattered in the heart of the cave.
    const bone = this.propMaterial([0.75, 0.72, 0.62]);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4;
      const x = 15 + Math.cos(a) * (2 + (i % 5));
      const z = 46 + Math.sin(a) * (2 + (i % 4));
      const y = this.floorAt(x, 7, z);
      if (y < 3) continue;
      const mesh = this.addProp(new THREE.CylinderGeometry(0.035, 0.03, 0.4 + (i % 3) * 0.2, 4), bone, x, y + 0.04, z, a);
      mesh.rotation.z = Math.PI / 2;
    }

    // A sliver of sky far up the exit crack.
    this.addProp(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.1) }), 3, 28.5, 18.4);
  }

  private buildItems(): void {
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
      } else {
        const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8), this.propMaterial([0.8, 0.62, 0.15], [0.05, 0.035, 0]));
        cell.rotation.z = Math.PI / 2;
        group.add(cell);
      }
      const floor = this.floorAt(spot.x, spot.y, spot.z);
      const base = new THREE.Vector3(spot.x, floor + 0.08, spot.z);
      group.position.copy(base);
      group.rotation.y = spot.x * 1.7;
      this.scene.add(group);
      this.items.push({ spot, group, taken: false, led, base });
    }
  }

  private buildCreature(): void {
    const sheet = drawCreatureSheet();
    const makeTexture = (canvas: HTMLCanvasElement) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      return texture;
    };
    this.creatureMaterial = this.material(CREATURE_FRAGMENT, {
      uTex: { value: makeTexture(sheet.body) },
      uEyes: { value: makeTexture(sheet.eyes) },
      uFrame: { value: 0 },
      uFrames: { value: CREATURE_FRAMES },
      uEyeGlow: { value: 0.9 },
      uBodyVisible: { value: 1 },
    });
    this.creatureMaterial.side = THREE.DoubleSide;
    this.creatureMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 2.6), this.creatureMaterial);
    this.creatureMesh.visible = false;
    this.creatureMesh.frustumCulled = false;
    this.scene.add(this.creatureMesh);
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
    this.cVisible = false;
    this.glimpse = "waiting";
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
    this.updateCreature(dt);
    this.updateStory(dt);
    this.updateItems();
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
      if (dist > 2.5) continue;
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
    this.updateGlimpse(dt);
    if (this.brain.state === "dormant") {
      this.creatureMesh.visible = this.glimpse === "showing";
      this.audio.setCreature(this.cPos, false, false);
      this.fear = THREE.MathUtils.damp(this.fear, this.glimpse === "showing" ? 0.35 : 0, 2, dt);
      this.audio.setFear(this.fear);
      return;
    }

    const dist = this.cPos.distanceTo(eye);
    this.cSeesTimer -= dt;
    if (this.cSeesTimer <= 0) {
      this.cSeesTimer = 0.15;
      this.cLos = dist < 40 && lineOfSight(this.grid, this.cPos, eye);
    }
    const toCreature = this.cPos.clone().sub(this.shared.uLightPos.value).normalize();
    const beamOn = this.beamPower() > 0.3 && this.cLos && toCreature.dot(this.flashDir) > this.shared.uCosOuter.value;
    const before = this.brain.state;
    this.brain = stepBrain(this.brain, dt, {
      distance: dist,
      lineOfSight: this.cLos,
      playerLightOn: this.beamPower() > 0.2,
      beamOnCreature: beamOn,
      noiseRadius: this.noise,
      playerPos: { x: this.pos.x, y: this.pos.y + 1.3, z: this.pos.z },
    });
    if (this.brain.state === "hunt" && before !== "hunt") {
      this.audio.stinger();
      this.flash = 0.25;
      this.cPath = [];
    }
    if (this.brain.state === "recoil" && before !== "recoil") {
      this.audio.scream();
      this.battery = Math.max(0, this.battery - 6);
      this.cPath = [];
    }

    this.moveCreature(dt, eye);

    // Caught.
    if (this.cPos.distanceTo(new THREE.Vector3(this.pos.x, this.pos.y + 1.0, this.pos.z)) < 1.1 && this.brain.state !== "recoil") {
      this.die("creature");
      return;
    }

    const hunting = this.brain.state === "hunt";
    const near = THREE.MathUtils.clamp(1 - dist / 20, 0, 1);
    const targetFear = near * (hunting ? 1 : this.cLos ? 0.6 : 0.3);
    this.fear = THREE.MathUtils.damp(this.fear, targetFear, 3, dt);
    this.flash = Math.max(0, this.flash - dt);
    this.staticAmount = THREE.MathUtils.damp(this.staticAmount, hunting && dist < 6 ? 0.4 : 0, 4, dt);
    this.audio.setFear(this.fear);
    this.audio.setCreature(this.cPos, true, hunting);
    this.updateCreatureSprite(dt, hunting);
  }

  private updateGlimpse(dt: number): void {
    if (this.glimpse === "waiting" && this.brain.state === "dormant") {
      const gallery = nodeById("gallery");
      if (Math.hypot(this.pos.x - gallery.x, this.pos.z - gallery.z) < 16 && this.pos.y < gallery.y + 6) {
        this.glimpse = "showing";
        this.glimpseTimer = 0;
        this.cPos.copy(v3(GLIMPSE_POINT));
        this.creatureMaterial.uniforms.uFrame.value = 0;
      }
    }
    if (this.glimpse === "showing") {
      this.glimpseTimer += dt;
      this.billboard();
      const close = this.cPos.distanceTo(this.eye()) < 11;
      if (close || this.glimpseTimer > 7) {
        this.glimpse = "done";
        this.creatureMesh.visible = false;
        this.audio.stinger(0.3);
        this.cPos.copy(v3(walkPoint(nodeById("nest"))));
      }
    }
  }

  private moveCreature(dt: number, eye: THREE.Vector3): void {
    const speed = brainSpeed(this.brain.state, this.tapes);
    const playerChest = new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z);
    let goal: THREE.Vector3 | null = null;

    if (this.brain.state === "hunt" && this.cLos) {
      goal = playerChest;
      this.cPath = [];
    } else {
      this.cPathTimer -= dt;
      if (this.cPath.length === 0 || this.cPathTimer <= 0) this.planCreaturePath(eye);
      if (this.cPath.length > 0) {
        goal = v3(this.cPath[0]);
        if (goal.distanceTo(this.cPos) < 0.7) {
          this.cPath.shift();
          goal = this.cPath.length > 0 ? v3(this.cPath[0]) : null;
        }
      }
    }
    if (!goal) return;
    const step = goal.clone().sub(this.cPos);
    const len = step.length();
    if (len < 0.01) return;
    const moveBy = Math.min(len, speed * dt);
    const before = this.cPos.clone();
    this.cPos.addScaledVector(step.normalize(), moveBy);
    // Push out of walls (the monster can squeeze through tight spots, but not through rock).
    for (let i = 0; i < 3; i++) {
      const d = density(this.grid, this.cPos.x, this.cPos.y, this.cPos.z) + 0.3;
      if (d <= 0) break;
      const n = surfaceNormal(this.grid, this.cPos.x, this.cPos.y, this.cPos.z);
      this.cPos.addScaledVector(v3(n), d);
    }
    const moved = this.cPos.distanceTo(before);
    this.cWalk += moved;
    if (moveBy > 0.001 && moved < moveBy * 0.3) {
      this.cStuckTimer += dt;
      if (this.cStuckTimer > 0.6) {
        this.cStuckTimer = 0;
        this.cPath = [];
        this.cPathTimer = 0;
        if (this.brain.state === "hunt") this.cLos = false;
      }
    } else this.cStuckTimer = 0;
  }

  private planCreaturePath(eye: THREE.Vector3): void {
    this.cPathTimer = 1.2;
    const canSeeFrom = (from: Vec3) => (node: Vec3) => lineOfSight(this.grid, from, node, 0.6);
    const startId = nearestNode(this.cPos, canSeeFrom(this.cPos));
    let goalId: string;
    let finalPoint: Vec3 | null = null;
    if (this.brain.state === "recoil") {
      // Flee to the node farthest from the player.
      let best = NODES[0];
      for (const node of NODES) if (distance(walkPoint(node), eye) > distance(walkPoint(best), eye)) best = node;
      goalId = best.id;
      this.cPathTimer = 99;
    } else if (this.brain.target) {
      goalId = nearestNode(this.brain.target, canSeeFrom(this.brain.target));
      finalPoint = this.brain.target;
    } else {
      if (this.cPath.length > 0) return;
      goalId = NODES[Math.floor(Math.random() * NODES.length)].id;
      this.cPathTimer = 99;
    }
    const points = pathPoints(findPath(startId, goalId));
    if (points.length > 1 && distance(points[0], this.cPos) < 3) points.shift();
    if (finalPoint) points.push(finalPoint);
    this.cPath = points;
  }

  private billboard(): void {
    this.creatureMesh.position.copy(this.cPos);
    const dx = this.camera.position.x - this.cPos.x;
    const dz = this.camera.position.z - this.cPos.z;
    this.creatureMesh.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  private updateCreatureSprite(dt: number, hunting: boolean): void {
    this.creatureMesh.visible = true;
    // Squash the tall body in low tunnels (it bends and folds itself).
    this.cSquashTimer -= dt;
    if (this.cSquashTimer <= 0) {
      this.cSquashTimer = 0.2;
      const up = raycast(this.grid, this.cPos, { x: 0, y: 1, z: 0 }, 1.4, 0.1) ?? 1.4;
      const down = raycast(this.grid, this.cPos, { x: 0, y: -1, z: 0 }, 1.4, 0.1) ?? 1.4;
      this.cSquash = Math.min(1, (up + down) / 2.6);
    }
    this.billboard();
    this.creatureMesh.scale.set(1 + (1 - this.cSquash) * 0.4, Math.max(0.45, this.cSquash), 1);
    if (hunting) {
      this.creatureMesh.position.x += (Math.random() - 0.5) * 0.06;
      this.creatureMesh.position.y += (Math.random() - 0.5) * 0.04;
    }
    this.creatureMaterial.uniforms.uFrame.value = Math.floor(this.cWalk * 2.2) % CREATURE_FRAMES;
    const glow = this.brain.state === "recoil" ? 0 : hunting ? 1.2 : Math.random() < 0.02 ? 0 : 0.8;
    this.creatureMaterial.uniforms.uEyeGlow.value = glow;
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
      // Put its face right in front of yours.
      this.cPos.copy(this.camera.position).addScaledVector(look, 0.85 - Math.min(0.3, this.phaseTimer * 0.4));
      this.cPos.y = this.camera.position.y - 1.1;
      this.billboard();
      this.creatureMesh.visible = true;
      this.creatureMesh.scale.set(1, 1, 1);
      this.creatureMaterial.uniforms.uEyeGlow.value = 1.6;
      this.creatureMaterial.uniforms.uFrame.value = Math.floor(this.phaseTimer * 12) % CREATURE_FRAMES;
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
      this.creatureMesh.visible = false;
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
      prompt: item ? (item.spot.kind === "recorder" ? "[E] Take the tape recorder" : "[E] Take the batteries") : "",
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
    };
  }
}
