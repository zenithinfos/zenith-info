#!/usr/bin/env node
/**
 * Portrait du personnage, en gros.
 *
 *   node scripts/preview-head.mjs [--out preview/tete.png]
 *
 * `check-human` juge le corps entier ; à trois mètres, une tête fait quarante
 * pixels et on ne voit rien. Ce script-ci ne rend que la tête, de face, de
 * trois quarts et de profil, à 240 pixels de haut, avec un ombrage lissé.
 * C'est le seul moyen de juger un nez.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const OUT = getArg("out", "preview/tete.png");
await mkdir(path.dirname(OUT), { recursive: true });

async function loadModules() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-tete-"));
  const outFile = path.join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `
        export * from "./src/components/HumanModel.ts";
        export * as THREE from "three";
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    outfile: outFile,
    logLevel: "error",
  });
  const loaded = await import(`${outFile}?t=${Date.now()}`);
  await rm(dir, { recursive: true, force: true });
  return loaded;
}

const human = await loadModules();
const THREE = human.THREE;

const rig = human.createHumanRig();
human.setHumanWeapon(rig, "couteau");
for (let i = 0; i < 10; i++) {
  human.poseHuman(rig, {
    dt: 1 / 60,
    motion: "idle",
    speed: 0,
    aiming: false,
    aimYaw: 0,
    aimPitch: 0,
  });
}
rig.group.updateMatrixWorld(true);

const SIZE = 260;
const SS = 3;
const W = SIZE * 3 * SS;
const H = SIZE * SS;
const buffer = new Float32Array(W * H * 3);
// Tampon de profondeur. Le tri par profondeur moyenne (algorithme du peintre)
// laisse des bandes sur une surface courbe vue de près : les triangles d'un
// même anneau se recouvrent à l'écran et se peignent dans le désordre.
const depth = new Float32Array(W * H).fill(Infinity);

for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    buffer[i] = 0.05 + t * 0.04;
    buffer[i + 1] = 0.08 + t * 0.05;
    buffer[i + 2] = 0.06 + t * 0.03;
  }
}

const camera = new THREE.PerspectiveCamera(26, 1, 0.02, 40);
const light = new THREE.Vector3(0.5, 0.8, -0.6).normalize();
const fill = new THREE.Vector3(-0.7, 0.2, -0.4).normalize();

const headCentre = new THREE.Vector3();
rig.head.getWorldPosition(headCentre);

// Le personnage regarde vers -Z : une caméra de face se place donc du côté
// négatif. Le nez ne se juge pas depuis la nuque.
const shots = [
  { camera: [0, 0.02, -0.62] },
  { camera: [0.44, 0.05, 0.5] },
  { camera: [-0.62, 0.0, 0.06] },
];

shots.forEach((shot, shotIndex) => {
  camera.aspect = 1;
  camera.position.set(
    headCentre.x + shot.camera[0],
    headCentre.y + 0.01 + shot.camera[1],
    headCentre.z + shot.camera[2],
  );
  camera.lookAt(new THREE.Vector3(headCentre.x, headCentre.y + 0.01, headCentre.z));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const triangles = [];
  rig.head.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry;
    const position = geometry.attributes.position;
    const normalsAttr = geometry.attributes.normal;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const colour = (child.material.userData?.swatch ?? child.material.color).clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const n = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const at = index ? index.getX(i + k) : i + k;
        v[k].fromBufferAttribute(position, at).applyMatrix4(child.matrixWorld);
        n[k].fromBufferAttribute(normalsAttr, at).applyMatrix3(normalMatrix).normalize();
      }
      const screen = v.map((p) => p.clone().project(camera));
      if (screen.some((p) => p.z < -1 || p.z > 1)) continue;
      triangles.push({
        points: screen.map((p) => [
          shotIndex * SIZE * SS + (p.x * 0.5 + 0.5) * SIZE * SS,
          (1 - (p.y * 0.5 + 0.5)) * SIZE * SS,
        ]),
        // Coordonnées écran sans perspective pour interpoler la profondeur
        // correctement (division perspective).
        depths: screen.map((p) => p.z),
        colour,
        normals: n.map((value) => value.clone()),
      });
    }
  });

  for (const triangle of triangles) {
    const [[x0, y0], [x1, y1], [x2, y2]] = triangle.points;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // Les profondeurs NDC ne sont pas linéaires en écran : on interpole
        // 1/z (division perspective), sinon la surface se déchire en bandes.
        const iw =
          (w0 / triangle.depths[0] + w1 / triangle.depths[1] + w2 / triangle.depths[2]) || 1;
        const z = 1 / iw;
        if (z >= depth[y * W + x]) continue;
        depth[y * W + x] = z;
        const nx = triangle.normals[0].x * w0 + triangle.normals[1].x * w1 + triangle.normals[2].x * w2;
        const ny = triangle.normals[0].y * w0 + triangle.normals[1].y * w1 + triangle.normals[2].y * w2;
        const nz = triangle.normals[0].z * w0 + triangle.normals[1].z * w1 + triangle.normals[2].z * w2;
        const len = Math.hypot(nx, ny, nz) || 1;
        const key = Math.abs((nx * light.x + ny * light.y + nz * light.z) / len);
        const fillLight = Math.max(0, (nx * fill.x + ny * fill.y + nz * fill.z) / len);
        const s = 0.16 + 0.72 * Math.pow(key, 0.85) + 0.14 * fillLight;
        const i = (y * W + x) * 3;
        buffer[i] = buffer[i] * 0.1 + triangle.colour.r * s * 0.9;
        buffer[i + 1] = buffer[i + 1] * 0.1 + triangle.colour.g * s * 0.9;
        buffer[i + 2] = buffer[i + 2] * 0.1 + triangle.colour.b * s * 0.9;
      }
    }
  }
});

const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H * 3; i++) {
  const value = Math.min(1, Math.max(0, Math.pow(Math.max(0, buffer[i]), 1 / 2.2)));
  pixels[i] = Math.round(value * 255);
}

await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
  .resize(SIZE * 3, SIZE, { kernel: "lanczos3" })
  .png()
  .toFile(OUT);

console.log(`image ${OUT}`);
