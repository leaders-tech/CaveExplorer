/*
This file draws the game's pixel textures in code: the rock texture and the words scratched on the walls.
There are no image files, so everything here is drawn pixel by pixel on small canvases.
Edit this file to change how the rock or the wall writing looks. Copy drawWritingTexture to draw another texture.
*/

import { createRandom } from "./noise";

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

// Words scratched into the rock and smeared with something dark. White = paint, black = clear.
export function drawWritingTexture(text: string): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(256, 64);
  const random = createRandom(text.length * 31 + text.charCodeAt(0));
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = "bold 40px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  // Write each letter a few times with a shaky hand.
  for (let pass = 0; pass < 3; pass++) {
    let x = 128 - (text.length * 22) / 2 + 11;
    for (const letter of text) {
      ctx.save();
      ctx.translate(x + (random() - 0.5) * 3, 32 + (random() - 0.5) * 5);
      ctx.rotate((random() - 0.5) * 0.25);
      ctx.strokeText(letter, 0, 0);
      ctx.restore();
      x += 22;
    }
  }
  // Drips running down from the letters.
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 14; i++) {
    const x = 20 + random() * 216;
    ctx.fillRect(Math.round(x), 40, 2, 6 + random() * 18);
  }
  return canvas;
}
