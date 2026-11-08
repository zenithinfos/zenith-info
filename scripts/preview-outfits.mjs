#!/usr/bin/env node
/**
 * Les tenues sur le corps.
 *
 *   node scripts/preview-outfits.mjs [--out preview/tenues.png]
 *
 * Le vestiaire changeait des statistiques et rien d'autre : on choisissait un
 * uniforme d'écogarde et le personnage repartait dans la même chemise. Cette
 * planche montre ce que le corps porte réellement, tenue par tenue, et sert
 * surtout à une chose : vérifier que **la peau se distingue du tissu**.
 *
 * Rendu logiciel, mêmes géométries et mêmes matrices que le jeu, avec tampon
 * de profondeur. Ce n'est pas la lumière du jeu — c'est de quoi juger des
 * valeurs et des couleurs.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as THREE from "three";
import sharp from "sharp";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const OUT = getArg("out", "preview/tenues.png");

const dir = await mkdtemp(path.join(tmpdir(), "outfits-"));
const bundle = path.join(dir, "human.mjs");
await build({
  stdin: {
    contents: `export * from "./src/components/HumanModel.ts"; export { OUTFITS } from "./src/game/outfits.ts";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  tsconfig: path.join(process.cwd(), "tsconfig.json"),
  outfile: bundle,
  logLevel: "error",
});
const human = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

const COLUMNS = 5;
const SHOWN = [
  "explorateur",
  "ecogarde",
  "pisteur",
  "pluie",
  "canicule",
  "nuit",
  "fee-etoiles",
  "nenuphar",
  "murmure",
  "purificatrice",
];
const ROWS = Math.ceil(SHOWN.length / COLUMNS);

const PANEL = 240;
const SS = 2;
const W = PANEL * Math.min(COLUMNS, SHOWN.length) * SS;
const H = PANEL * ROWS * SS;
const buffer = new Float32Array(W * H * 3);
const zbuffer = new Float32Array(W * H).fill(-Infinity);
const light = new THREE.Vector3(0.42, 0.82, -0.58).normalize();
// Vue de trois quarts : on voit le torse, un bras nu et le visage — ce qu'il
// faut pour comparer une peau et une étoffe.
const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);

for (let y = 0; y < H; y += 1) {
  const t = y / (H - 1);
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3;
    buffer[i] = 0.045 + t * 0.02;
    buffer[i + 1] = 0.07 + t * 0.03;
    buffer[i + 2] = 0.055 + t * 0.02;
  }
}

function render(rig, offsetX, offsetY, position, target) {
  rig.group.updateMatrixWorld(true);
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...target));
  camera.updateMatrixWorld(true);
  camera.aspect = 1;
  camera.updateProjectionMatrix();

  const x1 = offsetX + PANEL * SS - 1;
  const y1 = offsetY + PANEL * SS - 1;
  const triangles = [];

  rig.group.traverse((child) => {
    if (!child.isMesh) return;
    let visible = true;
    let pointer = child;
    while (pointer) {
      if (!pointer.visible) visible = false;
      pointer = pointer.parent;
    }
    if (!visible) return;

    const geometry = child.geometry;
    const positionAttr = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : positionAttr.count;
    const materialColour = child.material.userData?.swatch ?? child.material.color ?? new THREE.Color(0.55, 0.55, 0.55);
    const colour = materialColour.clone();
    const normalsAttr = geometry.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();

    for (let i = 0; i < count; i += 3) {
      const world = [a, b, c];
      const screen = [];
      const normals = [];
      for (let k = 0; k < 3; k += 1) {
        const at = index ? index.getX(i + k) : i + k;
        world[k].fromBufferAttribute(positionAttr, at).applyMatrix4(child.matrixWorld);
        const p = world[k].clone().project(camera);
        screen.push([offsetX + (p.x * 0.5 + 0.5) * PANEL * SS, offsetY + (1 - (p.y * 0.5 + 0.5)) * PANEL * SS]);
        if (p.z < -1 || p.z > 1) { screen.length = 0; break; }
        normals.push(
          normalsAttr
            ? new THREE.Vector3().fromBufferAttribute(normalsAttr, at).applyMatrix3(normalMatrix).normalize()
            : new THREE.Vector3(0, 1, 0),
        );
        screen[screen.length - 1].push(1 - p.z);
      }
      if (screen.length !== 3) continue;
      triangles.push({ screen, normals, colour });
    }
  });

  for (const triangle of triangles) {
    const [[x0, y0], [x1v, y1v], [x2, y2]] = triangle.screen;
    if (Math.max(Math.abs(x0 - x1v), Math.abs(x1v - x2), Math.abs(y0 - y1v), Math.abs(y1v - y2)) > PANEL * SS * 3) continue;
    const minX = Math.max(offsetX, Math.floor(Math.min(x0, x1v, x2)));
    const maxX = Math.min(x1, Math.ceil(Math.max(x0, x1v, x2)));
    const minY = Math.max(offsetY, Math.floor(Math.min(y0, y1v, y2)));
    const maxY = Math.min(y1, Math.ceil(Math.max(y0, y1v, y2)));
    const area = (x1v - x0) * (y2 - y0) - (x2 - x0) * (y1v - y0);
    if (Math.abs(area) < 1e-9) continue;
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        const w0 = ((x1v - cx) * (y2 - cy) - (x2 - cx) * (y1v - cy)) / area;
        const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = triangle.screen[0][2] * w0 + triangle.screen[1][2] * w1 + triangle.screen[2][2] * w2;
        const pixel = py * W + px;
        if (depth <= zbuffer[pixel] + 1e-6) continue;
        zbuffer[pixel] = depth;
        const i = pixel * 3;
        const n = [0, 1, 2].map(
          (k) => triangle.normals[0].getComponent(k) * w0 + triangle.normals[1].getComponent(k) * w1 + triangle.normals[2].getComponent(k) * w2,
        );
        const len = Math.hypot(...n) || 1;
        const lambert = Math.abs((n[0] * light.x + n[1] * light.y + n[2] * light.z) / len);
        const shade = 0.2 + 0.8 * Math.pow(lambert, 0.9);
        buffer[i] = Math.min(1, triangle.colour.r * shade);
        buffer[i + 1] = Math.min(1, triangle.colour.g * shade);
        buffer[i + 2] = Math.min(1, triangle.colour.b * shade);
      }
    }
  }
}

const labels = [];
SHOWN.forEach((id, index) => {
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const rig = human.createHumanRig();
  human.setHumanWeapon(rig, "machette");
  human.applyHumanOutfit(rig, id);
  const pose = { dt: 1 / 60, motion: "idle", speed: 0, aiming: false, aimYaw: 0, aimPitch: 0 };
  for (let f = 0; f < 14; f += 1) human.poseHuman(rig, pose);
  render(rig, col * PANEL * SS, row * PANEL * SS, [1.85, 1.28, -2.55], [0, 0.98, -0.05]);
  // Étiquette en bas : posée en haut, elle se superposait au chapeau et l'on
  // prenait le texte blanc pour une coiffe.
  labels.push(
    `<text x="${col * PANEL + 12}" y="${row * PANEL + PANEL - 12}" class="name">${id}</text>`,
  );
  human.disposeHumanRig(rig);
});

const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H * 3; i += 1) {
  pixels[i] = Math.round(Math.pow(Math.min(1, Math.max(0, buffer[i])), 1 / 2.2) * 255);
}

const columns = Math.min(COLUMNS, SHOWN.length);
const overlay = `
  <svg width="${PANEL * columns}" height="${PANEL * ROWS}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { font-family: ui-monospace, monospace; fill: #f3ead7; }
      .name { font-size: 13px; }
      .rule { stroke: #ffffff; stroke-opacity: 0.1; }
    </style>
    ${Array.from({ length: ROWS + 1 }, (_, i) => `<line x1="0" y1="${i * PANEL}" x2="${PANEL * columns}" y2="${i * PANEL}" class="rule" />`).join("")}
    ${Array.from({ length: columns + 1 }, (_, i) => `<line x1="${i * PANEL}" y1="0" x2="${i * PANEL}" y2="${PANEL * ROWS}" class="rule" />`).join("")}
    ${labels.join("")}
  </svg>`;

await mkdir(path.dirname(OUT), { recursive: true });
await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
  .resize(PANEL * columns, PANEL * ROWS, { kernel: "lanczos3" })
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(OUT);
console.log(OUT);
