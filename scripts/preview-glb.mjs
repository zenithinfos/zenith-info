#!/usr/bin/env node
/**
 * Aperçu hors navigateur d'un modèle glTF.
 *
 *   node scripts/preview-glb.mjs public/models/Michelle.glb --out preview/modele.png
 *
 * Il n'y a pas de WebGL ici, donc pas de `GLTFLoader` : on lit directement le
 * conteneur glTF (JSON + tampon binaire), on applique les matrices de peau aux
 * sommets, et on rasterise le résultat en logiciel. C'est une pose de repos —
 * pas d'animation — mais c'est la vraie géométrie du fichier : de quoi vérifier
 * qu'un personnage a des mains, un visage et des proportions, au lieu de le
 * supposer.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const input = argv.find((value) => !value.startsWith("--")) ?? "public/models/Michelle.glb";
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const OUT = getArg("out", "preview/modele.png");
const SIZE = Number(getArg("size", "900"));

/* ------------------------------------------------------------------ */
/* Lecture du conteneur                                                */
/* ------------------------------------------------------------------ */

const file = await readFile(input);
if (file.toString("ascii", 0, 4) !== "glTF") throw new Error("ce n'est pas un GLB");

let offset = 12;
let json = null;
let bin = null;
while (offset + 8 <= file.length) {
  // Chaque bloc : longueur (4 octets), type (4 octets), puis les données.
  const length = file.readUInt32LE(offset);
  const type = file.toString("ascii", offset + 4, offset + 8);
  const start = offset + 8;
  if (type === "JSON") json = JSON.parse(file.toString("utf8", start, start + length));
  if (type.startsWith("BIN")) bin = file.subarray(start, start + length);
  offset += 8 + length + ((4 - (length % 4)) % 4);
}
if (!json || !bin) throw new Error("GLB incomplet");

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const ArrayType = COMPONENT[accessor.componentType];
  const width = WIDTH[accessor.type];
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? width * ArrayType.BYTES_PER_ELEMENT;
  const out = new Float64Array(accessor.count * width);
  const view8 = new DataView(bin.buffer, bin.byteOffset + byteOffset, accessor.count * stride);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < width; c++) {
      const at = i * stride + c * ArrayType.BYTES_PER_ELEMENT;
      switch (accessor.componentType) {
        case 5126: out[i * width + c] = view8.getFloat32(at, true); break;
        case 5125: out[i * width + c] = view8.getUint32(at, true); break;
        case 5123: out[i * width + c] = view8.getUint16(at, true); break;
        case 5121: out[i * width + c] = view8.getUint8(at); break;
        default: out[i * width + c] = 0;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Matrices                                                            */
/* ------------------------------------------------------------------ */

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function fromTRS(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

// Matrices monde de tous les nœuds.
const world = new Array(json.nodes.length);
const parentOf = new Array(json.nodes.length).fill(-1);
json.nodes.forEach((node, index) => {
  for (const child of node.children ?? []) parentOf[child] = index;
});
const resolve = (index) => {
  if (world[index]) return world[index];
  const local = fromTRS(json.nodes[index]);
  const parent = parentOf[index];
  world[index] = parent >= 0 ? multiply(resolve(parent), local) : local;
  return world[index];
};
json.nodes.forEach((_, index) => resolve(index));

/* ------------------------------------------------------------------ */
/* Peau : matrices de peau posées, pas d'animation                     */
/* ------------------------------------------------------------------ */

const skin = json.skins?.[0];
const skinMatrices = [];
if (skin) {
  const inverseBind = readAccessor(skin.inverseBindMatrices);
  skin.joints.forEach((joint, index) => {
    const inverse = Array.from(inverseBind.slice(index * 16, index * 16 + 16));
    skinMatrices.push(multiply(resolve(joint), inverse));
  });
}

/** Applique les matrices de peau à un sommet. */
function skinPoint(position, joints, weights, offset) {
  const out = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const weight = weights[offset + k];
    if (!weight) continue;
    const matrix = skinMatrices[joints[offset + k]] ?? identity();
    out[0] += weight * (matrix[0] * position[0] + matrix[4] * position[1] + matrix[8] * position[2] + matrix[12]);
    out[1] += weight * (matrix[1] * position[0] + matrix[5] * position[1] + matrix[9] * position[2] + matrix[13]);
    out[2] += weight * (matrix[2] * position[0] + matrix[6] * position[1] + matrix[10] * position[2] + matrix[14]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Collecte des triangles                                              */
/* ------------------------------------------------------------------ */

const triangles = [];
let vertexCount = 0;

for (const mesh of json.meshes ?? []) {
  for (const primitive of mesh.primitives) {
    if (primitive.mode !== undefined && primitive.mode !== 4) continue;
    const position = readAccessor(primitive.attributes.POSITION);
    const joints = primitive.attributes.JOINTS_0 !== undefined ? readAccessor(primitive.attributes.JOINTS_0) : null;
    const weights = primitive.attributes.WEIGHTS_0 !== undefined ? readAccessor(primitive.attributes.WEIGHTS_0) : null;
    const indices = primitive.indices !== undefined ? readAccessor(primitive.indices) : null;
    const count = position.length / 3;
    vertexCount += count;

    const points = [];
    for (let i = 0; i < count; i++) {
      const p = [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]];
      points.push(joints && weights ? skinPoint(p, joints, weights, i * 4) : p);
    }

    const order = indices ?? Array.from({ length: count }, (_, i) => i);
    for (let i = 0; i + 2 < order.length; i += 3) {
      const a = order[i], b = order[i + 1], c = order[i + 2];
      triangles.push([points[a], points[b], points[c]]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Projection orthographique de face, ombrage lissé                    */
/* ------------------------------------------------------------------ */

let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
for (const triangle of triangles) {
  for (const [x, y] of triangle) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
}
const height = maxY - minY || 1;
const scale = (SIZE * 0.92) / height;
const centreX = (minX + maxX) / 2;
const W = SIZE;
const H = SIZE;
const buffer = new Float32Array(W * H * 3).fill(0.06);
const depth = new Float32Array(W * H).fill(-Infinity);
const light = [0.45, 0.62, 0.65];

for (const [a, b, c] of triangles) {
  const ua = [(a[0] - centreX) * scale + W / 2, H / 2 - (a[1] - (minY + maxY) / 2) * scale, a[2]];
  const ub = [(b[0] - centreX) * scale + W / 2, H / 2 - (b[1] - (minY + maxY) / 2) * scale, b[2]];
  const uc = [(c[0] - centreX) * scale + W / 2, H / 2 - (c[1] - (minY + maxY) / 2) * scale, c[2]];

  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const nlen = Math.hypot(...n) || 1;
  const shade = 0.2 + 0.8 * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nlen);

  const minXi = Math.max(0, Math.floor(Math.min(ua[0], ub[0], uc[0])));
  const maxXi = Math.min(W - 1, Math.ceil(Math.max(ua[0], ub[0], uc[0])));
  const minYi = Math.max(0, Math.floor(Math.min(ua[1], ub[1], uc[1])));
  const maxYi = Math.min(H - 1, Math.ceil(Math.max(ua[1], ub[1], uc[1])));
  const area = (ub[0] - ua[0]) * (uc[1] - ua[1]) - (uc[0] - ua[0]) * (ub[1] - ua[1]);
  if (Math.abs(area) < 1e-9) continue;

  for (let y = minYi; y <= maxYi; y++) {
    for (let x = minXi; x <= maxXi; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((ub[0] - px) * (uc[1] - py) - (uc[0] - px) * (ub[1] - py)) / area;
      const w1 = ((uc[0] - px) * (ua[1] - py) - (ua[0] - px) * (uc[1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = ua[2] * w0 + ub[2] * w1 + uc[2] * w2;
      const i = y * W + x;
      if (z < depth[i]) continue;
      depth[i] = z;
      buffer[i * 3] = 0.62 * shade;
      buffer[i * 3 + 1] = 0.6 * shade;
      buffer[i * 3 + 2] = 0.5 * shade;
    }
  }
}

const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H * 3; i++) {
  pixels[i] = Math.round(Math.min(1, Math.pow(Math.max(0, buffer[i]), 1 / 2.2)) * 255);
}

await sharp(pixels, { raw: { width: W, height: H, channels: 3 } }).png().toFile(OUT);
console.log(
  `${path.basename(input)} : ${triangles.length} triangles, ${vertexCount} sommets, ` +
    `${json.skins?.length ?? 0} peau(x), ${json.animations?.length ?? 0} animation(s) → ${OUT}`,
);
