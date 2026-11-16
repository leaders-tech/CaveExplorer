/*
This file describes the hand-made cave map: rooms (chambers), tunnels between them, extra rock shapes,
item spots, and glowing lights. The cave mesh, the monster paths, and the item positions all come from here.
Edit this file to move rooms, add tunnels, change items, or add lights. Copy a node/edge line to grow the cave.
*/

export type Vec3 = { x: number; y: number; z: number };

export type Chamber = { rx: number; h: number; rz: number };

// x/z = position on the map, y = floor height. All sizes are in meters.
export type CaveNode = { id: string; x: number; y: number; z: number; chamber?: Chamber; flesh?: number; name?: string };

// r = tunnel half width, ry = tunnel half height, rough = how bumpy the walls are (1 = normal).
export type CaveEdge = { a: string; b: string; r: number; ry: number; rough?: number; flesh?: number };

export type ItemKind = "recorder" | "battery";
export type ItemSpot = { id: string; kind: ItemKind; x: number; y: number; z: number; text?: string };

export type CaveLight = { x: number; y: number; z: number; color: [number, number, number]; pulse?: number; fungi?: number };

export const WORLD = { sizeX: 90, sizeY: 46.5, sizeZ: 90, cell: 0.75 };
export const WATER_LEVEL = 10.7;
export const PIT_DEATH_Y = 9; // only inside the pit trench
export const SEED = 1337;

export const NODES: CaveNode[] = [
  { id: "start", x: 14, y: 34, z: 14, chamber: { rx: 7, h: 7, rz: 7 }, name: "The Fall" },
  { id: "t1", x: 22, y: 31, z: 17 },
  { id: "t2", x: 30, y: 27, z: 21 },
  { id: "t3", x: 36, y: 23, z: 23 },
  { id: "gallery", x: 46, y: 19, z: 27, chamber: { rx: 13, h: 12, rz: 11 }, name: "The Cathedral" },
  { id: "t4", x: 58, y: 17, z: 31 },
  { id: "c1", x: 62, y: 15, z: 38 },
  { id: "c2", x: 66, y: 13, z: 45 },
  { id: "lake", x: 70, y: 10, z: 57, chamber: { rx: 11, h: 7, rz: 10 }, name: "Black Water" },
  { id: "t5", x: 60, y: 12, z: 67 },
  { id: "t6", x: 50, y: 14, z: 70 },
  { id: "s1", x: 40, y: 17, z: 42 },
  { id: "s2", x: 46, y: 16, z: 58 },
  { id: "pit", x: 37, y: 15, z: 70, chamber: { rx: 11, h: 10, rz: 9 }, name: "The Throat" },
  { id: "t7", x: 24, y: 15, z: 69 },
  { id: "t8", x: 20, y: 11, z: 58, flesh: 0.5 },
  { id: "nest", x: 15, y: 6, z: 46, chamber: { rx: 9, h: 8, rz: 9 }, flesh: 1, name: "The Hollow Heart" },
  { id: "e1", x: 6, y: 9, z: 36, flesh: 0.4 },
  { id: "e2", x: 4, y: 15, z: 29 },
  { id: "exit", x: 5, y: 19, z: 22, chamber: { rx: 3.2, h: 4, rz: 3.2 }, name: "The Crack" },
];

export const EDGES: CaveEdge[] = [
  { a: "start", b: "t1", r: 1.8, ry: 1.6 },
  { a: "t1", b: "t2", r: 1.6, ry: 1.5 },
  { a: "t2", b: "t3", r: 1.5, ry: 1.3 },
  { a: "t3", b: "gallery", r: 1.6, ry: 1.6 },
  { a: "gallery", b: "t4", r: 1.7, ry: 1.8 },
  { a: "t4", b: "c1", r: 1.4, ry: 1.2 },
  { a: "c1", b: "c2", r: 1.4, ry: 0.75, rough: 0.2 },
  { a: "c2", b: "lake", r: 1.5, ry: 1.3 },
  { a: "lake", b: "t5", r: 2.0, ry: 1.6 },
  { a: "t5", b: "t6", r: 1.8, ry: 1.6 },
  { a: "t6", b: "pit", r: 1.6, ry: 1.7 },
  { a: "gallery", b: "s1", r: 1.5, ry: 1.6 },
  { a: "s1", b: "s2", r: 1.3, ry: 1.4 },
  { a: "s2", b: "pit", r: 1.5, ry: 1.6 },
  { a: "pit", b: "t7", r: 1.5, ry: 1.6 },
  { a: "t7", b: "t8", r: 1.4, ry: 1.4, flesh: 0.3 },
  { a: "t8", b: "nest", r: 1.6, ry: 1.6, flesh: 0.7 },
  { a: "nest", b: "e1", r: 1.3, ry: 1.4, flesh: 0.6 },
  { a: "e1", b: "e2", r: 1.0, ry: 1.2, rough: 0.4 },
  { a: "e2", b: "exit", r: 1.2, ry: 1.4 },
];

// The pit trench in "The Throat" and the thin bridge over it.
export const PIT_TRENCH = { minX: 33, maxX: 41, minY: 2, maxY: 16, minZ: 58, maxZ: 82 };
export const BRIDGE = { minX: 30.5, maxX: 43.5, minY: 13.6, maxY: 15, minZ: 69.3, maxZ: 70.7 };
export const LAKE_ISLAND = { x: 73, y: 9.6, z: 59, rx: 2.6, ry: 1.8, rz: 2.2 };
export const START_SHAFT = { x: 14, y0: 38, y1: 47, r: 2.2 };
export const EXIT_CRACK = { from: { x: 5, y: 21.5, z: 21 }, to: { x: 3, y: 28, z: 18.5 }, r: 0.9 };
export const EXIT_TRIGGER = { x: 4.4, y: 21, z: 20.6, radius: 2.4 };

export const GALLERY_PILLARS: { x: number; z: number; r: number }[] = [
  { x: 41, z: 31, r: 1.1 },
  { x: 51, z: 32, r: 1.4 },
  { x: 53, z: 21, r: 1.0 },
  { x: 44, z: 20, r: 0.8 },
  { x: 49, z: 23.5, r: 0.6 },
];

export const RECORDER_TEXTS = [
  "Tape 1 - Mara: Day three. The big hall goes on forever. The rock here is warm. Rock should not be warm.",
  "Tape 2 - Mara: We heard it in the water. It sees our lamps from far away... but it hates the light in its face. Shine it, then run.",
  "Tape 3 - Mara: Jonas crossed the bridge. He did not come back. Only his lamp, still on, down at the bottom.",
  "Tape 4 - Mara: It does not live in the cave. It IS the cave. There is a crack in the west wall. Daylight. Go. Do not look back.",
];

export const ITEMS: ItemSpot[] = [
  { id: "rec1", kind: "recorder", x: 49.5, y: 19, z: 33.5, text: RECORDER_TEXTS[0] },
  { id: "rec2", kind: "recorder", x: 73, y: 11.4, z: 59, text: RECORDER_TEXTS[1] },
  { id: "rec3", kind: "recorder", x: 29, y: 15, z: 74, text: RECORDER_TEXTS[2] },
  { id: "rec4", kind: "recorder", x: 17, y: 6, z: 49, text: RECORDER_TEXTS[3] },
  { id: "bat1", kind: "battery", x: 32.5, y: 25.3, z: 21.8 },
  { id: "bat2", kind: "battery", x: 63, y: 14.5, z: 40 },
  { id: "bat3", kind: "battery", x: 52, y: 14, z: 69 },
  { id: "bat4", kind: "battery", x: 21, y: 11, z: 57 },
];

export const LIGHTS: CaveLight[] = [
  { x: 14, y: 42, z: 14, color: [0.18, 0.24, 0.42] }, // moonlight from the hole above
  { x: 38, y: 20.5, z: 32, color: [0.05, 0.42, 0.38], fungi: 14 },
  { x: 56, y: 20.5, z: 23, color: [0.05, 0.36, 0.42], fungi: 12 },
  { x: 65, y: 11.5, z: 51, color: [0.12, 0.45, 0.2], fungi: 12 },
  { x: 77, y: 11.5, z: 63, color: [0.1, 0.42, 0.24], fungi: 12 },
  { x: 37, y: 3.5, z: 71, color: [1.1, 0.8, 0.3] }, // Jonas's lamp at the bottom of the pit
  { x: 15, y: 8.5, z: 46, color: [0.55, 0.05, 0.04], pulse: 1 },
  { x: 10, y: 7.5, z: 51, color: [0.4, 0.03, 0.03], pulse: 1 },
  { x: 3, y: 28, z: 18.5, color: [0.9, 0.7, 0.42] }, // daylight at the exit crack
  { x: 25, y: 12.5, z: 62, color: [0.05, 0.3, 0.32], fungi: 8 },
];

export const PLAYER_START = { x: 15.5, y: 34.2, z: 12.5, yaw: -2.1 };

export function nodeById(id: string): CaveNode {
  const node = NODES.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown cave node ${id}`);
  return node;
}

// Where the monster floats when it walks through this node (about head height).
export function walkPoint(node: CaveNode): Vec3 {
  return { x: node.x, y: node.y + 1.3, z: node.z };
}
