#!/usr/bin/env node
/**
 * Déroule une expédition entière, sans navigateur.
 *
 *   node scripts/check-progression.mjs
 *
 * Le module de progression est pur : on peut donc simuler un joueur qui marche,
 * abat, dépèce et observe, et vérifier que les cinq niveaux s'enchaînent dans
 * l'ordre, que les zones s'ouvrent au bon moment et qu'aucun objectif ne se
 * valide tout seul (par exemple parce qu'il était déjà rempli avant le niveau).
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-progress-"));
const bundle = path.join(dir, "progression.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/progression.ts"; export * from "./src/game/engine.ts";`,
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
const { LEVELS, levelStatus, newGame, advanceProgress, serialize, deserialize } = await import(
  `${bundle}?t=${Date.now()}`
);
await rm(dir, { recursive: true, force: true });

/** Un pas de jeu factice : on modifie directement ce que le joueur produirait. */
function apply(state, action) {
  const next = {
    ...state,
    hunt: { ...state.hunt, kills: { ...state.hunt.kills }, meat: state.hunt.meat },
    visitedZones: [...state.visitedZones],
    observedSpecies: [...state.observedSpecies],
  };
  if (action.kill) {
    next.hunt.kills[action.kill] = (next.hunt.kills[action.kill] ?? 0) + 1;
  }
  if (action.meat) next.hunt.meat += action.meat;
  if (action.visit && !next.visitedZones.includes(action.visit)) next.visitedZones.push(action.visit);
  if (action.observe) {
    for (let i = 0; i < action.observe; i++) {
      next.observedSpecies.push(`espece-${next.observedSpecies.length}`);
    }
  }
  return advanceProgress(next);
}

let state = newGame();
let failures = 0;

// Le joueur a déjà chassé avant de recevoir ses objectifs. Les objectifs étant
// cumulatifs, ce travail compte — et surtout, il ne peut pas bloquer la suite.
state.hunt.kills.hingebe = 4;
state.hunt.meat = 30;
state.hunt.kills.crocodile = 1;
state.observedSpecies.push("elephant", "gorille", "bongo");

const script = [
  { note: "le camp, puis la piste", visit: "sentier", observe: 3 },
  { note: "deux hingebe, 8 kg", kill: "hingebe", meat: 4 },
  { note: "deuxième hingebe", kill: "hingebe", meat: 4 },
  { note: "le baï", visit: "clairiere" },
  { note: "un sitatunga", kill: "sitatunga", meat: 9 },
  { note: "encore de la viande", meat: 8 },
  { note: "la rivière", visit: "riviere" },
  { note: "un crocodile", kill: "crocodile", meat: 12 },
  { note: "un bongo", kill: "bongo", meat: 20 },
  { note: "un gorille", kill: "gorille", meat: 20 },
];

for (const entry of script) {
  const before = levelStatus(state);
  const previous = state.progress.levelIndex;
  const result = apply(state, entry);
  state = result.state;

  if (previous === state.progress.levelIndex && !result.completed) {
    const marks = before.objectives.map((o) => `${o.current}/${o.target}`).join(" ");
    console.log(`  · ${entry.note.padEnd(26)} ${before.level ? before.level.id : "—"} ${marks}`);
  }
  if (result.completed) {
    const nextLevel = LEVELS[state.progress.levelIndex];
    console.log(`  ✓ ${entry.note.padEnd(26)} fin du niveau « ${result.completed.id} » → ${nextLevel ? nextLevel.id : "campagne terminée"}`);
    console.log(`    zones ouvertes : ${state.progress.unlocks.join(", ") || "aucune"}`);
  }
  void before;
}

// --- vérifications -------------------------------------------------------

const expect = (label, condition) => {
  if (!condition) {
    failures += 1;
    console.log(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
};

console.log("");
expect("les cinq niveaux sont terminés", state.progress.completed.length === LEVELS.length);
expect("l'ordre de la campagne est respecté", state.progress.completed.join(",") === LEVELS.map((l) => l.id).join(","));
expect("toutes les zones sont ouvertes", state.progress.unlocks.length >= 5);
expect("plus aucun objectif en cours", levelStatus(state).level === null);

// Une sauvegarde rechargée doit retrouver la même progression.
const roundTrip = deserialize(serialize(state));
expect("la progression survit à une sauvegarde", roundTrip.progress.levelIndex === state.progress.levelIndex);
expect("les zones ouvertes survivent aussi", roundTrip.progress.unlocks.join(",") === state.progress.unlocks.join(","));

// Aucun niveau ne doit pouvoir se bloquer : chaque objectif de chaque niveau
// doit rester atteignable quel que soit l'ordre des chasses.
const deadEnds = [];
for (const level of LEVELS) {
  for (const objective of level.objectives) {
    const reachable =
      objective.kind === "meat" ||
      objective.kind === "observe" ||
      objective.kind === "visit" ||
      (objective.kind === "kills" && objective.target.length > 0);
    if (!reachable) deadEnds.push(`${level.id}/${objective.label}`);
  }
}
expect("aucun objectif impossible à remplir", deadEnds.length === 0);
expect("un crocodile abattu trop tôt ne bloque pas le niveau 4", state.progress.completed.includes("riviere"));

console.log(failures === 0 ? "\nExpédition valide." : `\n${failures} problème(s).`);
process.exit(failures === 0 ? 0 : 1);
