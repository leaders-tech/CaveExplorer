/*
This file draws the game's pixel textures in code: the rock texture and the monster sprite sheet.
There are no image files, so everything here is drawn pixel by pixel on small canvases.
Edit this file to change how the rock or the monster looks. Copy drawCreatureFrame to draw another sprite.
*/

import { createRandom } from "./noise";

export const CREATURE_FRAME_W = 32;
export const CREATURE_FRAME_H = 80;
export const CREATURE_FRAMES = 4;

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available.");
  return [canvas, ctx];
}

// Value noise that repeats every `period` cells, so the texture tiles without seams.
function tileNoise(random: () => number, period: number): (x: number, y: number) => number {
  const values = Array.from({ length: period * period }, () => random());
  const at = (x: number, y: number) => values[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
}

// Red = rock detail, green = wet shine, blue = vein pattern for the flesh walls.
export function drawRockTexture(size = 64): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size, size);
  const random = createRandom(99);
  const n4 = tileNoise(random, 4);
  const n8 = tileNoise(random, 8);
  const n16 = tileNoise(random, 16);
  const wet = tileNoise(random, 6);
  const vein = tileNoise(random, 5);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const detail = n4(u * 4, v * 4) * 0.5 + n8(u * 8, v * 8) * 0.3 + n16(u * 16, v * 16) * 0.2;
      const crack = Math.abs(n8(u * 8 + 3.1, v * 8 + 1.7) - 0.5) < 0.02 ? 0.18 : 0;
      const ridge = 1 - Math.abs(vein(u * 5, v * 5) * 2 - 1);
      const i = (y * size + x) * 4;
      image.data[i] = Math.max(0, Math.min(255, (detail - crack) * 255));
      image.data[i + 1] = Math.max(0, Math.min(255, wet(u * 6, v * 6) ** 2 * 255));
      image.data[i + 2] = Math.max(0, Math.min(255, ridge ** 3 * 255));
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

type Painter = { body: CanvasRenderingContext2D; eyes: CanvasRenderingContext2D; ox: number };

function px(p: Painter, x: number, y: number, color: string): void {
  p.body.fillStyle = color;
  p.body.fillRect(p.ox + Math.round(x), Math.round(y), 1, 1);
}

function limb(p: Painter, x0: number, y0: number, x1: number, y1: number, width: number, color: string, shade: string): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let w = 0; w < width; w++) px(p, x + w - Math.floor(width / 2), y, w === width - 1 ? shade : color);
  }
}

// One frame of the tall pale thing. `phase` swings the arms and legs.
function drawCreatureFrame(p: Painter, frame: number): void {
  const phase = (frame / CREATURE_FRAMES) * Math.PI * 2;
  const s = Math.sin(phase);
  const skin = "#c9c4b8";
  const shade = "#7d776c";
  const dark = "#3b3631";
  const bob = Math.round(Math.abs(s) * 1.5);
  const tilt = Math.round(s * 1.2);
  const cx = 16;

  // Legs: thin and bent backwards.
  limb(p, cx - 2, 44, cx - 4 + s * 3, 60, 2, skin, shade);
  limb(p, cx - 4 + s * 3, 60, cx - 3 + s * 4, 78, 2, skin, shade);
  limb(p, cx + 2, 44, cx + 4 - s * 3, 60, 2, skin, shade);
  limb(p, cx + 4 - s * 3, 60, cx + 3 - s * 4, 78, 2, skin, shade);

  // Torso with ribs.
  for (let y = 19 + bob; y < 46; y++) {
    const half = Math.round(3.5 - (y - 19) * 0.06);
    for (let x = -half; x <= half; x++) px(p, cx + x, y, x === half ? shade : skin);
    if (y > 23 + bob && y < 36 && y % 3 === 0) for (let x = -half + 1; x < half; x++) px(p, cx + x, y, shade);
  }
  // Spine shadow and hollow stomach.
  for (let y = 36; y < 44; y++) px(p, cx, y, dark);

  // Arms: far too long, hanging past the knees.
  limb(p, cx - 4, 21 + bob, cx - 7 - s * 2, 40, 2, skin, shade);
  limb(p, cx - 7 - s * 2, 40, cx - 8 - s * 3, 58, 2, skin, shade);
  limb(p, cx + 4, 21 + bob, cx + 7 + s * 2, 40, 2, skin, shade);
  limb(p, cx + 7 + s * 2, 40, cx + 8 + s * 3, 58, 2, skin, shade);
  for (let f = -1; f <= 1; f++) {
    limb(p, cx - 8 - s * 3, 58, cx - 8 - s * 3 + f * 1.5, 65, 1, shade, shade);
    limb(p, cx + 8 + s * 3, 58, cx + 8 + s * 3 + f * 1.5, 65, 1, shade, shade);
  }

  // Neck and long head, tilted.
  limb(p, cx, 15 + bob, cx + tilt, 20 + bob, 2, skin, shade);
  for (let y = 0; y < 15; y++) {
    const half = Math.round(Math.sin((y / 15) * Math.PI) * 3.4);
    for (let x = -half; x <= half; x++) px(p, cx + tilt + x, 1 + y + bob, x === half ? shade : skin);
  }
  // Mouth: a long dark slit with red inside.
  for (let y = 8; y < 14; y++) {
    px(p, cx + tilt, y + bob, y > 9 && y < 13 ? "#5a0a0a" : dark);
  }
  // Eye sockets (dark) and the glowing eye dots (eye mask).
  for (const ex of [-2, 1]) {
    px(p, cx + tilt + ex, 5 + bob, dark);
    px(p, cx + tilt + ex + 1, 5 + bob, dark);
    p.eyes.fillStyle = "#ffffff";
    p.eyes.fillRect(p.ox + cx + tilt + ex, 5 + bob, 2, 2);
  }
}

export function drawCreatureSheet(): { body: HTMLCanvasElement; eyes: HTMLCanvasElement } {
  const width = CREATURE_FRAME_W * CREATURE_FRAMES;
  const [bodyCanvas, body] = makeCanvas(width, CREATURE_FRAME_H);
  const [eyesCanvas, eyes] = makeCanvas(width, CREATURE_FRAME_H);
  eyes.fillStyle = "#000000";
  eyes.fillRect(0, 0, width, CREATURE_FRAME_H);
  for (let frame = 0; frame < CREATURE_FRAMES; frame++) {
    drawCreatureFrame({ body, eyes, ox: frame * CREATURE_FRAME_W }, frame);
  }
  return { body: bodyCanvas, eyes: eyesCanvas };
}
