#!/usr/bin/env node
/**
 * Aperçu du personnage importé, posé et rendu.
 *
 *   node scripts/preview-avatar.mjs --out preview/avatar-walk.png --motion walk --phase 1.1
 *   node scripts/preview-avatar.mjs --motion idle --aim 1 --weapon m16
 *
 * Il n'y a pas de WebGL dans cet environnement : ni `WebGLRenderer`, ni
 * `GLTFLoader`. Mais la pose, elle, n'a pas besoin de WebGL — seulement de
 * three.js. Ce script reconstruit donc le squelette du fichier glTF en
 * `Object3D`, appelle **le même** `applyAvatarPose` que le jeu, puis fait la
 * peau et la rasterisation à la main.
 *
 * Conséquence importante : ce que montre cette image n'est pas une maquette,
 * c'est la pose que le navigateur calculera. Ce qui reste invérifiable ici,
 * c'est uniquement l'éclairage et les textures (il faudrait un GPU).
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const OUT = getArg("out", "preview/avatar.png");
const MODEL = getArg("model", "public/models/explorateur.glb");
const MOTION = getArg("motion", "walk");
const PHASE = Number(getArg("phase", "1.1"));
const AIM = Number(getArg("aim", "0"));
const WEAPON = getArg("weapon", "machette");
const TIME = Number(getArg("time", "0.8"));
await mkdir(path.dirname(OUT), { recursive: true });

/* ------------------------------------------------------------------ */
/* Le code du jeu, importé tel quel                                    */
/* ------------------------------------------------------------------ */

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-avatar-"));
const bundle = path.join(dir, "pose.mjs");
await build({
  stdin: {
    contents: `export * from "./src/components/avatarRig.ts";`,
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
const THREE = await import("three");
const rigModule = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
/* Lecture du GLB                                                      */
/* ------------------------------------------------------------------ */

const file = await readFile(MODEL);
let offset = 12;
let json = null;
let bin = null;
while (offset + 8 <= file.length) {
  const length = file.readUInt32LE(offset);
  const type = file.toString("ascii", offset + 4, offset + 8);
  const start = offset + 8;
  if (type === "JSON") json = JSON.parse(file.toString("utf8", start, start + length));
  if (type.startsWith("BIN")) bin = file.subarray(start, start + length);
  offset += 8 + length + ((4 - (length % 4)) % 4);
}

const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const width = WIDTHS[accessor.type];
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const element = accessor.componentType === 5126 || accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
  const stride = view.byteStride ?? width * element;
  const dv = new DataView(bin.buffer, bin.byteOffset + byteOffset);
  const out = new Float64Array(accessor.count * width);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < width; c++) {
      const at = i * stride + c * element;
      if (accessor.componentType === 5126) out[i * width + c] = dv.getFloat32(at, true);
      else if (accessor.componentType === 5125) out[i * width + c] = dv.getUint32(at, true);
      else if (accessor.componentType === 5123) out[i * width + c] = dv.getUint16(at, true);
      else out[i * width + c] = dv.getUint8(at);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reconstruction du graphe three.js                                   */
/* ------------------------------------------------------------------ */

const objects = json.nodes.map((node) => {
  const object = new THREE.Object3D();
  object.name = node.name ?? "";
  if (node.translation) object.position.fromArray(node.translation);
  if (node.rotation) object.quaternion.fromArray(node.rotation);
  if (node.scale) object.scale.fromArray(node.scale);
  return object;
});
json.nodes.forEach((node, index) => {
  for (const child of node.children ?? []) objects[index].add(objects[child]);
});
const roots = json.nodes
  .map((node, index) => (json.nodes.some((other) => (other.children ?? []).includes(index)) ? -1 : index))
  .filter((index) => index >= 0);

const modelRoot = new THREE.Group();
for (const index of roots) modelRoot.add(objects[index]);

const skeleton = rigModule.readSkeleton(modelRoot);
const scene = skeleton.root;
scene.position.set(0, 0, 0);

// Une caisse à la place de l'arme : elle n'a pas besoin d'être jolie, elle doit
// être au bon endroit, dans la bonne main, avec le bon angle.
const mount = new THREE.Object3D();
skeleton.root.add(mount);
const LENGTHS = { pistolet: 0.24, m16: 0.86, couteau: 0.32, machette: 0.58, lance: 2.0 };
const weaponLength = LENGTHS[WEAPON] ?? 0.5;

const state = { clock: 0, gait: PHASE, aim: 0, recoil: 0, recoilVelocity: 0, slash: 0 };
rigModule.applyAvatarPose(
  skeleton,
  state,
  {
    dt: 0,
    motion: MOTION,
    speed: MOTION === "run" ? 4.4 : MOTION === "walk" ? 2.1 : 0,
    aiming: AIM > 0.5,
    aimYaw: 0,
    aimPitch: 0,
  },
  { object: mount, id: WEAPON, side: -1 },
);
// On force la position dans le cycle et le temps, puis on repose une fois :
// `dt = 0` laisse la phase intacte mais n'avance ni l'horloge ni la visée.
state.clock = TIME;
state.aim = AIM;
rigModule.applyAvatarPose(
  skeleton,
  state,
  {
    dt: 0,
    motion: MOTION,
    speed: MOTION === "run" ? 4.4 : MOTION === "walk" ? 2.1 : 0,
    aiming: AIM > 0.5,
    aimYaw: 0,
    aimPitch: 0,
  },
  { object: mount, id: WEAPON, side: -1 },
);
scene.updateMatrixWorld(true);

if (argv.includes("--debug")) {
  for (const role of ["hips", "chest", "leftArm", "leftForeArm", "leftHand", "rightArm", "rightForeArm", "rightHand"]) {
    const joint = skeleton.joints[role];
    if (!joint) {
      console.log(role, "MANQUANT");
      continue;
    }
    const p = joint.getWorldPosition(new THREE.Vector3());
    console.log(role.padEnd(12), p.toArray().map((v) => v.toFixed(3)).join(" "));
  }
  const mp = mount.getWorldPosition(new THREE.Vector3());
  console.log("arme        ", mp.toArray().map((v) => v.toFixed(3)).join(" "));
}

/* ------------------------------------------------------------------ */
/* Peau et triangles (repère monde)                                    */
/* ------------------------------------------------------------------ */

const skin = json.skins?.[0];
const jointIndex = new Map();
skin?.joints.forEach((joint, i) => jointIndex.set(joint, i));

const skinMatrices = skin
  ? skin.joints.map((joint, index) => {
      const inverse = new THREE.Matrix4().fromArray(Array.from(readAccessor(skin.inverseBindMatrices).slice(index * 16, index * 16 + 16)));
      return new THREE.Matrix4().multiplyMatrices(objects[joint].matrixWorld, inverse);
    })
  : [];

const triangles = [];
const pushTriangles = (points, indices) => {
  const order = indices ?? Array.from({ length: points.length }, (_, i) => i);
  for (let i = 0; i + 2 < order.length; i += 3) {
    triangles.push([points[order[i]], points[order[i + 1]], points[order[i + 2]]]);
  }
};

for (const mesh of json.meshes ?? []) {
  for (const primitive of mesh.primitives) {
    if (primitive.mode !== undefined && primitive.mode !== 4) continue;
    const position = readAccessor(primitive.attributes.POSITION);
    const joints = primitive.attributes.JOINTS_0 !== undefined ? readAccessor(primitive.attributes.JOINTS_0) : null;
    const weights = primitive.attributes.WEIGHTS_0 !== undefined ? readAccessor(primitive.attributes.WEIGHTS_0) : null;
    const indices = primitive.indices !== undefined ? readAccessor(primitive.indices) : null;
    const count = position.length / 3;
    const points = [];

    for (let i = 0; i < count; i++) {
      const vertex = new THREE.Vector3(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
      if (!joints || !weights) {
        points.push(vertex.toArray());
        continue;
      }
      const out = new THREE.Vector3();
      for (let k = 0; k < 4; k++) {
        const weight = weights[i * 4 + k];
        if (!weight) continue;
        const matrix = skinMatrices[joints[i * 4 + k]];
        if (!matrix) continue;
        out.addScaledVector(vertex.clone().applyMatrix4(matrix), weight);
      }
      points.push(out.toArray());
    }
    pushTriangles(points, indices);
  }
}

// La caisse de l'arme.
if (WEAPON && WEAPON !== "aucune") {
  const half = weaponLength / 2;
  const box = new THREE.BoxGeometry(0.06, 0.07, weaponLength).toNonIndexed();
  box.translate(0, 0, -half + 0.06);
  box.applyMatrix4(mount.matrixWorld);
  const array = box.attributes.position.array;
  const points = [];
  for (let i = 0; i < array.length; i += 3) points.push([array[i], array[i + 1], array[i + 2]]);
  pushTriangles(points, null);
  box.dispose();
}

/* ------------------------------------------------------------------ */
/* Rendu : face, trois quarts, profil                                  */
/* ------------------------------------------------------------------ */

const PANEL = 420;
const SS = 2;
const PANELS = [{ yaw: 0 }, { yaw: 0.62 }, { yaw: -Math.PI * 0.5 }];
const W = PANEL * PANELS.length * SS;
const H = PANEL * SS;
const buffer = new Float32Array(W * H * 3).fill(0.05);
const depth = new Float32Array(W * H).fill(-Infinity);
const light = [-0.35, 0.55, -0.75];

// Cadre fixe : le sol à y = 0, le haut du cadre à 2,05 m. Un personnage qui
// flotte ou qui traverse le sol se voit immédiatement.
const GROUND = 0;
const TOP = 2.05;
const scale = (PANEL * 0.94 * SS) / (TOP - GROUND);
const groundLine = Math.round(PANEL * SS * 0.5 + ((TOP + GROUND) / 2 - GROUND) * scale);

for (let x = 0; x < W; x++) {
  for (let d = 0; d < 2; d++) {
    const y = groundLine + d;
    if (y < 0 || y >= H) continue;
    const i = y * W + x;
    buffer[i * 3] = 0.2;
    buffer[i * 3 + 1] = 0.24;
    buffer[i * 3 + 2] = 0.19;
  }
}

PANELS.forEach((panel, panelIndex) => {
  const cos = Math.cos(panel.yaw);
  const sin = Math.sin(panel.yaw);
  const offsetX = panelIndex * PANEL * SS;

  for (const [a, b, c] of triangles) {
    const rotate = (p) => [p[0] * cos - p[2] * sin, p[1], p[0] * sin + p[2] * cos];
    const ra = rotate(a), rb = rotate(b), rc = rotate(c);

    const e1 = [rb[0] - ra[0], rb[1] - ra[1], rb[2] - ra[2]];
    const e2 = [rc[0] - ra[0], rc[1] - ra[1], rc[2] - ra[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...n) || 1;
    const shade = 0.16 + 0.74 * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / nl);

    const project = (p) => [offsetX + PANEL * SS * 0.5 + p[0] * scale, PANEL * SS * 0.5 + ((TOP + GROUND) / 2 - p[1]) * scale];
    const ua = project(ra), ub = project(rb), uc = project(rc);
    ua.z = ra[2]; ub.z = rb[2]; uc.z = rc[2];

    const minX = Math.max(0, Math.floor(Math.min(ua[0], ub[0], uc[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(ua[0], ub[0], uc[0])));
    const minY = Math.max(0, Math.floor(Math.min(ua[1], ub[1], uc[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(ua[1], ub[1], uc[1])));
    const area = (ub[0] - ua[0]) * (uc[1] - ua[1]) - (uc[0] - ua[0]) * (ub[1] - ua[1]);
    if (Math.abs(area) < 1e-9) continue;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((ub[0] - px) * (uc[1] - py) - (uc[0] - px) * (ub[1] - py)) / area;
        const w1 = ((uc[0] - px) * (ua[1] - py) - (ua[0] - px) * (uc[1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = ua.z * w0 + ub.z * w1 + uc.z * w2;
        const i = y * W + x;
        if (z < depth[i]) continue;
        depth[i] = z;
        buffer[i * 3] = 0.68 * shade;
        buffer[i * 3 + 1] = 0.58 * shade;
        buffer[i * 3 + 2] = 0.47 * shade;
      }
    }
  }
});

const pixels = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H * 3; i++) {
  pixels[i] = Math.round(Math.min(1, Math.pow(Math.max(0, buffer[i]), 1 / 2.2)) * 255);
}

await sharp(pixels, { raw: { width: W, height: H, channels: 3 } })
  .resize(PANEL * PANELS.length, PANEL, { kernel: "lanczos3" })
  .png()
  .toFile(OUT);

console.log(`${MOTION} phase ${PHASE} visée ${AIM} · ${triangles.length} triangles → ${OUT}`);
