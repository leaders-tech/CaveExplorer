/*
This file describes the hand-made cave map: rooms (chambers), tunnels between them, extra rock shapes,
item spots, and glowing lights. The cave mesh, the monster paths, and the item positions all come from here.
Edit this file to move rooms, add tunnels, change items, or add lights. Copy a node/edge line to grow the cave.
*/

export type Vec3 = { x: number; y: number; z: number };

export type Chamber = { rx: number; h: number; rz: number };

// x/z = position on the map, y = floor height. All sizes are in meters.
export type CaveNode = { id: string; x: number; y: number; z: number; chamber?: Chamber; flesh?: number; name?: string };

// r = tunnel half width, ry = tunnel half height, rough = how bumpy the walls are (1 = normal),
// wiggle = how much the tunnel bends left and right (1 = normal, 0 = straight line).
export type CaveEdge = { a: string; b: string; r: number; ry: number; rough?: number; flesh?: number; wiggle?: number };

export type ItemKind = "recorder" | "battery" | "glowstick";
export type ItemSpot = { id: string; kind: ItemKind; x: number; y: number; z: number; text?: string };

export type CaveLight = { x: number; y: number; z: number; color: [number, number, number]; pulse?: number; fungi?: number };

export const WORLD = { sizeX: 104, sizeY: 46.5, sizeZ: 100, cell: 0.75 };
export const WATER_LEVEL = 10.7;
export const PIT_DEATH_Y = 9; // only inside the pit trench
export const SEED = 1337;

export const NODES: CaveNode[] = [
  { id: "start", x: 14, y: 34, z: 14, chamber: { rx: 7, h: 7, rz: 7 }, name: "The Fall" },
  { id: "t1", x: 22, y: 31, z: 17 },
  { id: "t2", x: 29, y: 27.5, z: 21 },
  { id: "t3", x: 30, y: 22, z: 29 },
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
  { id: "e1", x: 6, y: 10, z: 36.5, flesh: 0.4 },
  { id: "e2", x: 4, y: 13.8, z: 29 },
  { id: "exit", x: 5, y: 18, z: 22, chamber: { rx: 3.2, h: 4, rz: 3.2 }, name: "The Crack" },
  // The north passage to the giant bones, and the loop back down to the lake.
  { id: "o1", x: 36, y: 18, z: 9 },
  { id: "o2", x: 52, y: 16, z: 5 },
  { id: "ossuary", x: 76, y: 14, z: 12, chamber: { rx: 13, h: 9, rz: 8 }, name: "The Ossuary" },
  { id: "o3", x: 92, y: 13, z: 25 },
  { id: "o4", x: 90, y: 12, z: 40 },
  { id: "o5", x: 83, y: 11, z: 52 },
  // A dead end full of hanging things, off the path to the heart.
  { id: "l1", x: 16, y: 14, z: 80, flesh: 0.3 },
  { id: "larder", x: 9, y: 13, z: 90, chamber: { rx: 6, h: 6, rz: 5.5 }, flesh: 0.6, name: "The Larder" },
];

export const EDGES: CaveEdge[] = [
  { a: "start", b: "t1", r: 1.8, ry: 1.6 },
  { a: "t1", b: "t2", r: 1.6, ry: 1.5 },
  { a: "t2", b: "t3", r: 1.5, ry: 1.3 },
  { a: "t3", b: "gallery", r: 1.6, ry: 1.6 },
  { a: "gallery", b: "t4", r: 1.7, ry: 1.8 },
  { a: "t4", b: "c1", r: 1.4, ry: 1.2 },
  { a: "c1", b: "c2", r: 1.4, ry: 0.75, rough: 0.2, wiggle: 0.5 },
  { a: "c2", b: "lake", r: 1.5, ry: 1.3 },
  { a: "lake", b: "t5", r: 2.0, ry: 1.6 },
  { a: "t5", b: "t6", r: 1.8, ry: 1.6 },
  { a: "t6", b: "pit", r: 1.6, ry: 1.7 },
  { a: "gallery", b: "s1", r: 1.5, ry: 1.6 },
  { a: "s1", b: "s2", r: 1.3, ry: 1.4 },
  { a: "s2", b: "pit", r: 1.5, ry: 1.6, wiggle: 0.3 },
  { a: "pit", b: "t7", r: 1.5, ry: 1.6 },
  { a: "t7", b: "t8", r: 1.4, ry: 1.4, flesh: 0.3 },
  { a: "t8", b: "nest", r: 1.6, ry: 1.6, flesh: 0.7 },
  { a: "nest", b: "e1", r: 1.3, ry: 1.4, flesh: 0.6 },
  { a: "e1", b: "e2", r: 1.0, ry: 1.2, rough: 0.4, wiggle: 0.6 },
  { a: "e2", b: "exit", r: 1.2, ry: 1.4 },
  { a: "gallery", b: "o1", r: 1.5, ry: 1.5 },
  { a: "o1", b: "o2", r: 1.4, ry: 1.4 },
  { a: "o2", b: "ossuary", r: 1.7, ry: 1.7 },
  { a: "ossuary", b: "o3", r: 1.5, ry: 1.5 },
  { a: "o3", b: "o4", r: 1.5, ry: 0.8, rough: 0.3, wiggle: 0.6 },
  { a: "o4", b: "o5", r: 1.4, ry: 1.4 },
  { a: "o5", b: "lake", r: 1.6, ry: 1.5 },
  { a: "t7", b: "l1", r: 1.3, ry: 1.4, flesh: 0.3 },
  { a: "l1", b: "larder", r: 1.3, ry: 1.5, flesh: 0.5 },
];

// The pit trench in "The Throat" and the thin bridge over it.
export const PIT_TRENCH = { minX: 33, maxX: 41, minY: 2, maxY: 16, minZ: 58, maxZ: 82 };
export const BRIDGE = { minX: 30.5, maxX: 43.5, minY: 13.6, maxY: 15, minZ: 69.3, maxZ: 70.7 };
export const LAKE_ISLAND = { x: 73, y: 9.6, z: 59, rx: 2.6, ry: 1.8, rz: 2.2 };
export const START_SHAFT = { x: 14, y0: 38, y1: 47, r: 2.2 };
export const EXIT_CRACK = { from: { x: 5, y: 20.5, z: 21 }, to: { x: 3, y: 28, z: 18.5 }, r: 0.9 };
export const EXIT_TRIGGER = { x: 4.4, y: 20, z: 20.6, radius: 2.4 };

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
  { id: "bat1", kind: "battery", x: 30.4, y: 22, z: 28.4 },
  { id: "bat2", kind: "battery", x: 62.4, y: 15, z: 38.6 },
  { id: "bat3", kind: "battery", x: 50.5, y: 14, z: 69.6 },
  { id: "bat4", kind: "battery", x: 20.4, y: 11, z: 58.4 },
  { id: "bat5", kind: "battery", x: 84, y: 14, z: 15 },
  { id: "bat6", kind: "battery", x: 7, y: 13, z: 92 },
  { id: "bat7", kind: "battery", x: 90.3, y: 12, z: 40.5 },
  { id: "glow1", kind: "glowstick", x: 50.4, y: 19, z: 35.9 },
  { id: "glow2", kind: "glowstick", x: 70, y: 14, z: 9 },
  { id: "glow3", kind: "glowstick", x: 82.6, y: 11, z: 52.4 },
  { id: "glow4", kind: "glowstick", x: 11, y: 13, z: 88 },
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
  { x: 70, y: 16.5, z: 16, color: [0.06, 0.32, 0.36], fungi: 12 },
  { x: 86, y: 16.5, z: 9, color: [0.08, 0.36, 0.26], fungi: 12 },
  { x: 9, y: 15, z: 90, color: [0.45, 0.06, 0.04], pulse: 1 },
  { x: 90, y: 13.2, z: 33, color: [0.05, 0.3, 0.3], fungi: 8 },
];

// Light slots kept free for thrown glowsticks (they come after LIGHTS in the shader).
export const GLOW_LIGHT_SLOTS = 2;

// The bones of something huge, lying in the Ossuary. Head points at -x (towards the entrance).
export const GIANT_SKELETON = { x: 78.5, z: 13.5, size: 0.8 };

// Bodies wrapped in flesh, hanging from the ceiling of the Larder.
export const COCOONS: { x: number; z: number }[] = [
  { x: 7, z: 88 },
  { x: 10.5, z: 91.5 },
  { x: 12, z: 87.5 },
  { x: 6.5, z: 93 },
  { x: 9.5, z: 85.5 },
];

// Words scratched into the walls by the lost team. from = a point in the air, dir = where the wall is.
export const WALL_WRITINGS: { text: string; from: Vec3; dir: Vec3 }[] = [
  { text: "DONT RUN", from: { x: 58, y: 18.4, z: 31 }, dir: { x: 0, y: 0, z: -1 } },
  { text: "IT HEARS YOU", from: { x: 16, y: 15.4, z: 80 }, dir: { x: -1, y: 0, z: 0.3 } },
  { text: "LIGHT HURTS IT", from: { x: 52, y: 17.4, z: 5 }, dir: { x: 0, y: 0, z: -1 } },
  { text: "NOT ALONE", from: { x: 92, y: 14.4, z: 25 }, dir: { x: 1, y: 0, z: 0 } },
];

// Thoughts the player says the first time they enter a room.
export const AREA_THOUGHTS: Record<string, string> = {
  gallery: "So big... My light does not even reach the roof.",
  ossuary: "What... what was this thing? Nothing alive is that big.",
  larder: "Those are not animal bones. Those shapes... they used to be people.",
  nest: "The walls are breathing. I should not be here.",
};

export const PLAYER_START = { x: 15.5, y: 34.2, z: 12.5, yaw: -2.1 };

export function nodeById(id: string): CaveNode {
  const node = NODES.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown cave node ${id}`);
  return node;
}

// How high the middle of the monster's body is while it crawls.
export const CREATURE_BODY_HEIGHT = 0.95;

// Where the monster's body is when it walks through this node.
export function walkPoint(node: CaveNode): Vec3 {
  return { x: node.x, y: node.y + CREATURE_BODY_HEIGHT, z: node.z };
}
