#!/usr/bin/env node
/**
 * Le personnage fait-il le geste ?
 *
 *   node scripts/check-swing.mjs
 *
 * Il ne le faisait pas. `humanSlash` posait un compteur que seule la rotation
 * du torse lisait : dix degrés pendant un quart de seconde. Mesuré, le poignet
 * parcourait **2,9 cm** — un tressaillement, pas un coup. Le holdeur d'arme,
 * et donc l'arme, et donc le bras (qui suit la poignée par cinématique
 * inverse), ne bougeaient pas du tout.
 *
 * Ce contrôle mesure, sur la géométrie réellement animée :
 *
 *   · l'amplitude du poignet et de la pointe de l'arme — un coup de lame
 *     déplace la pointe de près d'un mètre ;
 *   · la participation du torse et des hanches ;
 *   · le **retour exact** au repos : une animation qui ne revient pas laisse le
 *     personnage figé en garde, ce qui est pire que pas d'animation ;
 *   · la continuité : une vraie courbe divise son pas par deux quand on
 *     double la fréquence d'échantillonnage ; une discontinuité, non. Un seuil
 *     en centimètres absolus se serait trompé dans les deux sens — il
 *     condamne une lame rapide et régulière, et laisse passer un saut court.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as THREE from "three";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-swing-"));
const bundle = path.join(dir, "human.mjs");
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

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const BLADES = ["machette", "couteau", "lance"];
const IDLE = { dt: 1 / 60, motion: "idle", speed: 0, aiming: false, aimYaw: 0, aimPitch: 0 };
/** Fonction d'accession à la pointe, en coordonnées du monde. */
const tipOf = (rig) => (rig.weapon ? rig.weapon.group.localToWorld(new THREE.Vector3(0, 0, -0.42)) : null);

console.log("\nLe geste, arme par arme");
for (const id of BLADES) {
  const rig = human.createHumanRig();
  human.setHumanWeapon(rig, id);
  for (let i = 0; i < 30; i += 1) human.poseHuman(rig, IDLE);
  rig.group.updateMatrixWorld(true);

  const hand = () => rig.wrist.right.getWorldPosition(new THREE.Vector3());
  const restHand = hand().clone();
  const restTip = tipOf(rig)?.clone() ?? null;
  const restChest = rig.chest.rotation.y;

  human.humanSlash(rig);

  let handTravel = 0;
  let tipTravel = 0;
  let torsoTwist = 0;
  let hipTwist = 0;
  for (let frame = 0; frame < 60; frame += 1) {
    human.poseHuman(rig, IDLE);
    rig.group.updateMatrixWorld(true);
    const now = hand();
    handTravel = Math.max(handTravel, now.distanceTo(restHand));
    const tip = tipOf(rig);
    if (tip && restTip) tipTravel = Math.max(tipTravel, tip.distanceTo(restTip));
    torsoTwist = Math.max(torsoTwist, Math.abs(rig.chest.rotation.y - restChest));
    hipTwist = Math.max(hipTwist, Math.abs(rig.hips.rotation.y));
  }

  // Continuité : on rejoue le même coup en pas de temps deux fois plus fin.
  // Le plus grand pas doit à peu près se diviser par deux ; sinon, la main
  // saute d'un point à un autre sans passer par le milieu.
  const peakStep = (substeps) => {
    const probe = human.createHumanRig();
    human.setHumanWeapon(probe, id);
    const fine = { ...IDLE, dt: IDLE.dt / substeps };
    for (let i = 0; i < 30 * substeps; i += 1) human.poseHuman(probe, fine);
    probe.group.updateMatrixWorld(true);
    const at = () => probe.wrist.right.getWorldPosition(new THREE.Vector3());
    let last = at().clone();
    human.humanSlash(probe);
    let peak = 0;
    for (let frame = 0; frame < 60 * substeps; frame += 1) {
      human.poseHuman(probe, fine);
      probe.group.updateMatrixWorld(true);
      const now = at();
      peak = Math.max(peak, now.distanceTo(last));
      last = now.clone();
    }
    human.disposeHumanRig(probe);
    return peak;
  };
  const coarseStep = peakStep(1);
  const fineStep = peakStep(2);
  const ratio = fineStep / Math.max(coarseStep, 1e-6);
  const speed = coarseStep / IDLE.dt;

  // Retour : on laisse l'animation finir, puis on compare au repos d'origine.
  for (let frame = 0; frame < 90; frame += 1) human.poseHuman(rig, IDLE);
  rig.group.updateMatrixWorld(true);
  const back = hand().distanceTo(restHand);

  const name = id.padEnd(9);
  console.log(
    `    ${name} main ${handTravel.toFixed(2)} m · pointe ${tipTravel.toFixed(2)} m · torse ${torsoTwist.toFixed(2)} rad · hanches ${hipTwist.toFixed(2)} rad`,
  );
  check(`${id} : la main parcourt au moins 25 cm`, handTravel > 0.25, `${handTravel.toFixed(2)} m`);
  check(`${id} : l'arme balaie au moins 50 cm`, tipTravel > 0.5, `${tipTravel.toFixed(2)} m`);
  check(`${id} : le corps accompagne le coup`, torsoTwist > (id === "lance" ? 0.12 : 0.4), `${torsoTwist.toFixed(2)} rad`);
  check(`${id} : le personnage revient au repos`, back < 0.01, `${(back * 100).toFixed(1)} cm`);
  check(
    `${id} : mouvement continu`,
    ratio < 0.72,
    `pas de ${(coarseStep * 100).toFixed(1)} cm à 60 Hz, ${(fineStep * 100).toFixed(1)} cm à 120 Hz (×${ratio.toFixed(2)})`,
  );
  // Ordre de grandeur : un poing de boxeur part à 8–12 m/s, un poignet qui
  // manie une machette monte plus haut. Mesuré ici : 4 à 10 m/s. Le plafond
  // n'est là que pour attraper une animation emballée, pas pour imposer une
  // allure.
  check(`${id} : vitesse de poignet plausible`, speed < 14, `${speed.toFixed(1)} m/s au plus vite`);

  human.disposeHumanRig(rig);
}

console.log("\nLes armes à feu ne font pas de coup de lame");
for (const id of ["pistolet", "m16", "fusil"]) {
  const rig = human.createHumanRig();
  human.setHumanWeapon(rig, id);
  for (let i = 0; i < 20; i += 1) human.poseHuman(rig, IDLE);
  rig.group.updateMatrixWorld(true);
  const rest = rig.wrist.right.getWorldPosition(new THREE.Vector3());
  human.humanSlash(rig);
  let travel = 0;
  for (let frame = 0; frame < 40; frame += 1) {
    human.poseHuman(rig, IDLE);
    rig.group.updateMatrixWorld(true);
    travel = Math.max(travel, rig.wrist.right.getWorldPosition(new THREE.Vector3()).distanceTo(rest));
  }
  check(`${id} : pas de geste de lame`, travel < 0.2, `${(travel * 100).toFixed(0)} cm`);
  human.disposeHumanRig(rig);
}

console.log("\nLa vue subjective fait le même geste");
{
  // Ce module ne peut pas s'instancier sans DOM (l'éclair est dessiné sur un
  // canvas), mais sa courbe est pure : on la teste seule, sans caméra.
  const viewDir = await mkdtemp(path.join(tmpdir(), "minkebe-view-"));
  const viewBundle = path.join(viewDir, "view.mjs");
  await build({
    stdin: {
      contents: `export { VIEW_STRIKES, strikeWeight, strikeEase } from "./src/components/WeaponView.ts";`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    outfile: viewBundle,
    logLevel: "error",
  });
  const view = await import(`${viewBundle}?t=${Date.now()}`);
  await rm(viewDir, { recursive: true, force: true });

  for (const id of BLADES) {
    const strike = view.VIEW_STRIKES[id];
    check(`${id} : la vue subjective a un coup`, Boolean(strike));
    if (!strike) continue;

    // Trajet de la garde, échantillonné finement, du repos au retour au repos.
    let peak = 0;
    let last = null;
    let jolt = 0;
    const steps = 240;
    for (let i = 0; i <= steps; i += 1) {
      const progress = i / steps;
      const weight = view.strikeWeight(progress);
      const eased = view.strikeEase(progress);
      const at = [0, 1, 2].map((k) => (strike.wind.p[k] + (strike.cut.p[k] - strike.wind.p[k]) * eased) * weight);
      const distance = Math.hypot(...at);
      peak = Math.max(peak, distance);
      if (last) jolt = Math.max(jolt, Math.hypot(...at.map((v, k) => v - last[k])));
      last = at;
    }
    // Fin du geste : la garde doit être revenue exactement à zéro.
    const settled = [0, 1, 2].map((k) => (strike.wind.p[k] + (strike.cut.p[k] - strike.wind.p[k]) * view.strikeEase(1)) * view.strikeWeight(1));
    check(`${id} : la garde balaie au moins 15 cm`, peak > 0.15, `${(peak * 100).toFixed(0)} cm`);
    check(`${id} : la garde revient au repos`, Math.hypot(...settled) < 1e-6, "exact");
    check(`${id} : pas de saut dans la courbe`, jolt < peak * 0.12, `${(jolt * 100).toFixed(1)} cm par pas de 1/240`);
    check(
      `${id} : temps du coup accordé au corps`,
      strike.duration > 0.4,
      `${strike.duration.toFixed(2)} s`,
    );
  }
}

console.log("\nLa lance se porte horizontalement");
{
  const rig = human.createHumanRig();
  human.setHumanWeapon(rig, "lance");
  for (let i = 0; i < 20; i += 1) human.poseHuman(rig, IDLE);
  rig.group.updateMatrixWorld(true);
  const tip = rig.weapon.group.localToWorld(new THREE.Vector3(0, 0, -1.5));
  const butt = rig.weapon.group.localToWorld(new THREE.Vector3(0, 0, 0.3));
  const axis = tip.clone().sub(butt).normalize();
  // Pointe devant : la composante vers −Z doit dominer la composante verticale.
  check(
    "hampe couchée, pointe devant",
    Math.abs(axis.z) > 0.8 && Math.abs(axis.y) < 0.5,
    `axe (${axis.toArray().map((v) => v.toFixed(2)).join(", ")})`,
  );
  human.disposeHumanRig(rig);
}

console.log(failures === 0 ? "\n✓ Le personnage fait le geste.\n" : `\n✗ ${failures} contrôle(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
