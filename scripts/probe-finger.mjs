#!/usr/bin/env node
/**
 * Quel axe plie un doigt ?
 *
 * Un squelette importé a ses axes propres ; plutôt que de deviner, on mesure :
 * pour chaque axe de rotation, on calcule la distance entre le bout du doigt et
 * le poignet. Un doigt qui se replie dans la paume raccourcit cette distance.
 */
import { readFile } from "node:fs/promises";

const file = await readFile("public/models/explorateur.glb");
let offset = 12, json = null, bin = null;
while (offset + 8 <= file.length) {
  const length = file.readUInt32LE(offset);
  const type = file.toString("ascii", offset + 4, offset + 8);
  const start = offset + 8;
  if (type === "JSON") json = JSON.parse(file.toString("utf8", start, start + length));
  if (type.startsWith("BIN")) bin = file.subarray(start, start + length);
  offset += 8 + length + ((4 - (length % 4)) % 4);
}
void bin;

const parentOf = new Array(json.nodes.length).fill(-1);
json.nodes.forEach((node, i) => (node.children ?? []).forEach((c) => (parentOf[c] = i)));

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
};

const fromTRS = (t = [0, 0, 0], q = [0, 0, 0, 1]) => {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, t[0], t[1], t[2], 1];
};

const qFromEuler = (x, y, z) => {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
};

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
  a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

function evaluate(index, overrides) {
  const node = json.nodes[index];
  const delta = overrides[node.name];
  const rest = node.rotation ?? [0, 0, 0, 1];
  const rotation = delta ? qMul(rest, qFromEuler(delta[0], delta[1], delta[2])) : rest;
  const local = fromTRS(node.translation, rotation);
  const parent = parentOf[index];
  return parent >= 0 ? mul(evaluate(parent, overrides), local) : local;
}

const indexOf = (name) => json.nodes.findIndex((node) => node.name === name);
const wrist = indexOf("LeftHand");
const fingers = ["LeftHandIndex", "LeftHandMiddle", "LeftHandRing", "LeftHandPinky", "LeftHandThumb"];

console.log("distance bout du doigt → poignet (m) ; plus court = doigt replié\n");
for (const finger of fingers) {
  const segments = [1, 2, 3].map((n) => `${finger}${n}`).filter((name) => indexOf(name) >= 0);
  const tipName = segments[segments.length - 1];
  const tip = indexOf(tipName);
  const report = [];
  for (const axis of ["x", "y", "z"]) {
    for (const sign of [1, -1]) {
      const overrides = {};
      for (const name of segments) {
        overrides[name] = [0, 0, 0];
        overrides[name][{ x: 0, y: 1, z: 2 }[axis]] = 0.9 * sign;
      }
      const w = evaluate(wrist, overrides);
      const t = evaluate(tip, overrides);
      const d = Math.hypot(w[12] - t[12], w[13] - t[13], w[14] - t[14]);
      report.push(`${axis}${sign > 0 ? "+" : "-"}: ${d.toFixed(3)}`);
    }
  }
  const rest = evaluate(tip, {});
  const w0 = evaluate(wrist, {});
  const d0 = Math.hypot(w0[12] - rest[12], w0[13] - rest[13], w0[14] - rest[14]);
  console.log(finger.padEnd(16), "repos", d0.toFixed(3), "·", report.join("  "));
}
