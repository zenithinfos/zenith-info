#!/usr/bin/env node
/**
 * Le coup de lame, image par image.
 *
 *   node scripts/preview-slash.mjs [--out preview/coup.png]
 *
 * Sans WebGL, on rend la séquence par rasterisation logicielle — mêmes
 * géométries, mêmes matrices que le jeu, avec un test de profondeur et un
 * éclairage Lambert sur les normales interpolées. Ce n'est pas la lumière du
 * jeu ; c'est de quoi juger si le corps **fait le geste** : l'épaule monte,
 * le torse tourne, la lame balaie.
 *
 * Une ligne par arme, une colonne par instant du coup.
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
const OUT = getArg("out", "preview/coup.png");

const dir = await mkdtemp(path.join(tmpdir(), "slash-"));
const bundle = path.join(dir, "h.mjs");
await build({
  stdin: {
    contents: `export * from "./src/components/HumanModel.ts";`,
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

const WEAPONS = [
  { id: "machette", label: "Machette — taille en diagonale" },
  { id: "couteau", label: "Couteau — taille courte" },
  { id: "lance", label: "Lance — estoc à deux mains" },
];
/** Instants du coup, en fraction du geste. */
const FRAMES = [0, 0.14, 0.28, 0.42, 0.56, 0.72, 0.9];

const PANEL = 250;
const SS = 2;
const W = PANEL * (FRAMES.length + 1) * SS;
const H = PANEL * WEAPONS.length * SS;
const buffer = new Float32Array(W * H * 3);
const zbuffer = new Float32Array(W * H).fill(-Infinity);
const light = new THREE.Vector3(0.45, 0.8, -0.5).normalize();
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 60);

// fond de sous-bois
for (let y = 0; y < H; y += 1) {
  const t = y / (H - 1);
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3;
    buffer[i] = 0.035 + t * 0.02;
    buffer[i + 1] = 0.06 + t * 0.035;
    buffer[i + 2] = 0.045 + t * 0.02;
  }
}

function render(rig, offsetX, offsetY, position, target) {
  rig.group.updateMatrixWorld(true);
  camera.position.set(...position);
  camera.lookAt(new THREE.Vector3(...target));
  camera.updateMatrixWorld(true);
  camera.aspect = 1;
  camera.updateProjectionMatrix();

  const panelX1 = offsetX + PANEL * SS - 1;
  const panelY1 = offsetY + PANEL * SS - 1;
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
    const colour = (child.material.userData?.swatch ?? child.material.color ?? new THREE.Color(0.6, 0.6, 0.6)).clone();
    const tints = geometry.attributes.color;
    const normalsAttr = geometry.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const screen = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const normals = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        const at = index ? index.getX(i + k) : i + k;
        v[k].fromBufferAttribute(positionAttr, at).applyMatrix4(child.matrixWorld);
        screen[k].copy(v[k]).project(camera);
        if (normalsAttr) normals[k].fromBufferAttribute(normalsAttr, at).applyMatrix3(normalMatrix).normalize();
      }
      if (screen.some((p) => p.z < -1 || p.z > 1)) continue;
      triangles.push({
        points: screen.map((p) => [
          offsetX + (p.x * 0.5 + 0.5) * PANEL * SS,
          offsetY + (1 - (p.y * 0.5 + 0.5)) * PANEL * SS,
        ]),
        near: screen.map((point) => 1 - point.z),
        colour,
        tints: tints
          ? [0, 1, 2].map((k) => {
              const at = index ? index.getX(i + k) : i + k;
              return [tints.getX(at), tints.getY(at), tints.getZ(at)];
            })
          : null,
        normals: normals.map((n) => n.clone()),
      });
    }
  });

  for (const triangle of triangles) {
    const [[x0, y0], [x1, y1], [x2, y2]] = triangle.points;
    const span = Math.max(Math.abs(x0 - x1), Math.abs(x1 - x2), Math.abs(y0 - y1), Math.abs(y1 - y2));
    if (span > PANEL * SS * 3) continue;
    const minX = Math.max(offsetX, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(panelX1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(offsetY, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(panelY1, Math.ceil(Math.max(y0, y1, y2)));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = triangle.near[0] * w0 + triangle.near[1] * w1 + triangle.near[2] * w2;
        const pixel = y * W + x;
        if (depth <= zbuffer[pixel] + 1e-6) continue;
        zbuffer[pixel] = depth;
        const i = pixel * 3;
        const nx = triangle.normals[0].x * w0 + triangle.normals[1].x * w1 + triangle.normals[2].x * w2;
        const ny = triangle.normals[0].y * w0 + triangle.normals[1].y * w1 + triangle.normals[2].y * w2;
        const nz = triangle.normals[0].z * w0 + triangle.normals[1].z * w1 + triangle.normals[2].z * w2;
        const len = Math.hypot(nx, ny, nz) || 1;
        const lambert = Math.abs((nx * light.x + ny * light.y + nz * light.z) / len);
        const shade = 0.18 + 0.82 * Math.pow(lambert, 0.9);
        const tintR = triangle.tints ? triangle.tints[0][0] * w0 + triangle.tints[1][0] * w1 + triangle.tints[2][0] * w2 : 1;
        const tintG = triangle.tints ? triangle.tints[0][1] * w0 + triangle.tints[1][1] * w1 + triangle.tints[2][1] * w2 : 1;
        const tintB = triangle.tints ? triangle.tints[0][2] * w0 + triangle.tints[1][2] * w1 + triangle.tints[2][2] * w2 : 1;
        buffer[i] = Math.min(1, triangle.colour.r * tintR * shade);
        buffer[i + 1] = Math.min(1, triangle.colour.g * tintG * shade);
        buffer[i + 2] = Math.min(1, triangle.colour.b * tintB * shade);
      }
    }
  }
}

const labels = [];
WEAPONS.forEach((weapon, row) => {
  const rig = human.createHumanRig();
  human.setHumanWeapon(rig, weapon.id);
  const pose = { dt: 1 / 60, motion: "idle", speed: 0, aiming: false, aimYaw: 0, aimPitch: 0 };
  for (let i = 0; i < 30; i += 1) human.poseHuman(rig, pose);

  const duration = { machette: 0.5, couteau: 0.38, lance: 0.55 }[weapon.id] ?? 0.4;
  const steps = 60;
  const dt = duration / steps;

  // Colonne 0 : repos. Les suivantes : instants du coup.
  render(rig, 0, row * PANEL * SS, [2.1, 1.5, -2.5], [0, 1.15, -0.1]);
  labels.push(`<text x="12" y="${row * PANEL + 24}" class="name">${weapon.label}</text>`);
  labels.push(`<text x="12" y="${row * PANEL + 42}" class="sub">repos</text>`);

  human.humanSlash(rig);
  let frameIndex = 0;
  const wanted = new Set(FRAMES.slice(1).map((f) => Math.round(f * steps)));
  for (let step = 1; step <= steps && frameIndex < FRAMES.length - 1; step += 1) {
    human.poseHuman(rig, { ...pose, dt });
    if (!wanted.has(step)) continue;
    frameIndex += 1;
    const col = FRAMES.slice(1).indexOf(FRAMES[frameIndex]);
    render(rig, (col + 1) * PANEL * SS, row * PANEL * SS, [2.1, 1.5, -2.5], [0, 1.15, -0.1]);
    labels.push(
      `<text x="${(col + 1) * PANEL + 12}" y="${row * PANEL + 24}" class="sub">${Math.round(FRAMES[frameIndex] * 100)} %</text>`,
    );
  }
  human.disposeHumanRig(rig);
});

const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i += 1) {
  for (let c = 0; c < 3; c += 1) {
    pixels[i * 3 + c] = Math.round(Math.pow(Math.min(1, Math.max(0, buffer[i * 3 + c])), 1 / 2.2) * 255);
  }
}

const overlay = `
  <svg width="${PANEL * (FRAMES.length + 1)}" height="${PANEL * WEAPONS.length}" xmlns="http://www.w3.org/2000/svg">
    <style>
      text { font-family: ui-monospace, monospace; fill: #f3ead7; }
      .name { font-size: 13px; }
      .sub { font-size: 11px; fill: #b9c8bb; }
      .rule { stroke: #ffffff; stroke-opacity: 0.1; }
    </style>
    ${WEAPONS.map((_, i) => `<line x1="0" y1="${(i + 1) * PANEL}" x2="${PANEL * (FRAMES.length + 1)}" y2="${(i + 1) * PANEL}" class="rule" />`).join("")}
    ${FRAMES.map((_, i) => `<line x1="${(i + 1) * PANEL}" y1="0" x2="${(i + 1) * PANEL}" y2="${PANEL * WEAPONS.length}" class="rule" />`).join("")}
    ${labels.join("")}
  </svg>`;

await mkdir(path.dirname(OUT), { recursive: true });
await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
  .resize(PANEL * (FRAMES.length + 1), PANEL * WEAPONS.length, { kernel: "lanczos3" })
  .composite([{ input: Buffer.from(overlay) }])
  .png()
  .toFile(OUT);
console.log(OUT);
