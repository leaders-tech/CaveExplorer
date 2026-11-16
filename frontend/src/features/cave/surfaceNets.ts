/*
This file turns the rock/air grid into a triangle mesh ("surface nets" method) that the GPU can draw.
Edit this file only if the cave mesh needs a different shape or more data per vertex.
Do not copy this file; call buildCaveMesh with a CaveGrid.
*/

import { density, sampleField, surfaceNormal, type CaveGrid } from "./caveGrid";

export type CaveMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  flesh: Float32Array;
  indices: Uint32Array;
};

// The 12 edges of a cube, as pairs of corner numbers. Corner bits: 1 = +x, 2 = +y, 4 = +z.
const CUBE_EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];

export function buildCaveMesh(grid: CaveGrid): CaveMeshData {
  const { nx, ny, nz, cell, d } = grid;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions: number[] = [];
  const corner = new Float32Array(8);
  const sy = nx;
  const sz = nx * ny;
  const offsets = [0, 1, sy, sy + 1, sz, sz + 1, sz + sy, sz + sy + 1];

  // 1. One vertex inside every cell that has both rock and air corners.
  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx; x++) {
        const base = x + sy * y + sz * z;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          corner[c] = d[base + offsets[c]];
          if (corner[c] > 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let count = 0;
        for (let e = 0; e < 24; e += 2) {
          const a = CUBE_EDGES[e];
          const b = CUBE_EDGES[e + 1];
          const va = corner[a];
          const vb = corner[b];
          if (va > 0 === vb > 0) continue;
          const t = va / (va - vb);
          sumX += (a & 1) + ((b & 1) - (a & 1)) * t;
          sumY += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sumZ += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          count++;
        }
        cellVertex[x + cx * (y + cy * z)] = positions.length / 3;
        positions.push((x + sumX / count) * cell, (y + sumY / count) * cell, (z + sumZ / count) * cell);
      }
    }
  }

  // 2. Normals and flesh amount for every vertex.
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  const flesh = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    const n = surfaceNormal(grid, px, py, pz);
    normals[v * 3] = n.x;
    normals[v * 3 + 1] = n.y;
    normals[v * 3 + 2] = n.z;
    flesh[v] = Math.min(1, sampleField(grid, grid.flesh, px, py, pz));
  }

  // 3. A quad (two triangles) for every grid edge that crosses the wall.
  const indices: number[] = [];
  const cellAt = (x: number, y: number, z: number) => cellVertex[x + cx * (y + cy * z)];
  const addTriangle = (a: number, b: number, c: number) => {
    // Make the triangle face the air side by comparing with the field normal.
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax;
    const uy = positions[b * 3 + 1] - ay;
    const uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax;
    const vy = positions[c * 3 + 1] - ay;
    const vz = positions[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const dot = fx * (normals[a * 3] + normals[b * 3] + normals[c * 3]) + fy * (normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1]) + fz * (normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2]);
    if (dot >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  const addQuad = (a: number, b: number, c: number, e: number) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    addTriangle(a, b, c);
    addTriangle(a, c, e);
  };
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const here = d[x + sy * y + sz * z] > 0;
        if (x < cx && y > 0 && z > 0 && y < cy && z < cz && here !== d[x + 1 + sy * y + sz * z] > 0) {
          addQuad(cellAt(x, y - 1, z - 1), cellAt(x, y, z - 1), cellAt(x, y, z), cellAt(x, y - 1, z));
        }
        if (y < cy && x > 0 && z > 0 && x < cx && z < cz && here !== d[x + sy * (y + 1) + sz * z] > 0) {
          addQuad(cellAt(x - 1, y, z - 1), cellAt(x, y, z - 1), cellAt(x, y, z), cellAt(x - 1, y, z));
        }
        if (z < cz && x > 0 && y > 0 && x < cx && y < cy && here !== d[x + sy * y + sz * (z + 1)] > 0) {
          addQuad(cellAt(x - 1, y - 1, z), cellAt(x, y - 1, z), cellAt(x, y, z), cellAt(x - 1, y, z));
        }
      }
    }
  }

  return { positions: new Float32Array(positions), normals, flesh, indices: new Uint32Array(indices) };
}

// Used by tests: true if a mesh vertex sits close to the wall surface.
export function vertexOnSurface(grid: CaveGrid, x: number, y: number, z: number): boolean {
  return Math.abs(density(grid, x, y, z)) < grid.cell;
}
