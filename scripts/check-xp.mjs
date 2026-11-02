#!/usr/bin/env node
/**
 * La courbe d'expérience, sans navigateur.
 *
 *   node scripts/check-xp.mjs
 *
 * Le niveau se déduit de l'XP : il n'est jamais stocké. C'est ce qui permet de
 * retoucher la courbe sans casser les sauvegardes — et ce qui rend ces
 * vérifications utiles : si la courbe se croise, le niveau recule.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-xp-"));
const bundle = path.join(dir, "xp.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/xp.ts";`,
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
const { MAX_LEVEL, SURVIVAL_PRIZE_XP, XP_REWARDS, levelForXp, levelProgress, xpForLevel } =
  await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

console.log("\nLes paliers");
check("cinquante niveaux", MAX_LEVEL === 50, `${MAX_LEVEL}`);
check("le Prix de Survie est à 2 500 XP", SURVIVAL_PRIZE_XP === 2500);
check("le niveau 1 est à 0 XP", xpForLevel(1) === 0);
check("le niveau 50 vaut le Prix de Survie", xpForLevel(50) === SURVIVAL_PRIZE_XP, `${xpForLevel(50)}`);
check(
  "la courbe monte strictement",
  Array.from({ length: 49 }, (_, i) => xpForLevel(i + 2) > xpForLevel(i + 1)).every(Boolean),
);

console.log("\nLa réciproque");
let mismatched = 0;
for (let level = 1; level <= MAX_LEVEL; level += 1) {
  if (levelForXp(xpForLevel(level)) !== level) mismatched += 1;
  // Un XP de moins doit laisser au niveau précédent, sauf au niveau 1.
  if (level > 1 && levelForXp(xpForLevel(level) - 1) !== level - 1) mismatched += 1;
}
check("chaque palier tombe juste", mismatched === 0, `${mismatched} écart(s)`);
check("0 XP donne le niveau 1", levelForXp(0) === 1);
check("2 500 XP donnent le niveau 50", levelForXp(2500) === 50);
check("au-delà du Prix, le niveau plafonne", levelForXp(9000) === MAX_LEVEL);

console.log("\nLa barre de progression");
const progress = levelProgress(xpForLevel(10) + 10);
check("niveau 10 + 10 XP", progress.level === 10 && progress.into === 10);
check("la barre reste dans [0, 1]", progress.ratio >= 0 && progress.ratio <= 1);
check("le prochain palier est connu", progress.nextAt > xpForLevel(10));
check("le Prix de Survie se voit", levelProgress(2500).prize === true);
check("le Prix de Survie ne se vole pas", levelProgress(2499).prize === false);

console.log("\nLes récompenses");
check("abattre un babouin rapporte au moins 5 XP", XP_REWARDS.kill(28) >= 5, `${XP_REWARDS.kill(28)}`);
check("un éléphant ne donne pas 500 XP", XP_REWARDS.kill(400) <= 200, `${XP_REWARDS.kill(400)}`);
check("dépecer 1 kg ne donne pas une XP par kilo", XP_REWARDS.harvest(1) === 2);
check("dépecer un éléphant est plafonné", XP_REWARDS.harvest(400) === 60);
check("une observation vaut moins qu'un Mewa", XP_REWARDS.observe < XP_REWARDS.mewa);
check("un abri vaut plus qu'un Mewa", XP_REWARDS.shelter > XP_REWARDS.mewa);

// Combien de Mewas faut-il pour le niveau 50 ? C'est la question de dosage :
// si la réponse est « une seule expédition de dix Mewas », la campagne est
// trop courte.
const mewasForPrize = Math.ceil(SURVIVAL_PRIZE_XP / XP_REWARDS.mewa);
check("le Prix de Survie demande du jeu", mewasForPrize > 10, `${mewasForPrize} Mewas`);
check(
  "un Mewa vaut 40 XP",
  XP_REWARDS.mewa === 40,
);
check(
  "les cinq chapitres rapportent 1 170 XP",
  [50, 120, 200, 300, 500].reduce((sum, value) => sum + value, 0) === 1170,
);

console.log(
  failures === 0 ? "\nLa courbe tient debout : 50 niveaux, 2 500 XP.\n" : `\n${failures} vérification(s) en échec.\n`,
);
process.exit(failures === 0 ? 0 : 1);
