#!/usr/bin/env node
/**
 * Les niveaux du jeu, sans navigateur.
 *
 *   node scripts/check-progression.mjs
 *
 * Le module de progression est pur : on peut donc faire jouer un explorateur
 * virtuel — il marche jusqu'au sentier, abat deux hingebe, rapporte la viande,
 * descend au baï — et vérifier que les chapitres s'enchaînent dans l'ordre,
 * qu'aucun objectif ne se valide tout seul et que les zones s'ouvrent au bon
 * moment.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-progress-"));
const bundle = path.join(dir, "progress.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/progression.ts"; export * from "./src/game/engine.ts"; export * from "./src/game/xp.ts";`,
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
const {
  LEVELS,
  advanceProgress,
  levelStatus,
  currentLevel,
  newGame,
  recordKill,
  recordHarvest,
  serialize,
  deserialize,
  MAX_LEVEL,
  SURVIVAL_PRIZE_XP,
  xpForLevel,
  levelForXp,
  levelProgress,
} = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Simule une action du joueur et renvoie l'état + le niveau terminé. */
function play(state, mutate) {
  const next = mutate(state);
  const { state: advanced, completed } = advanceProgress(next);
  return { state: advanced, completed };
}

console.log("\nLa courbe d'expérience");
check("cinquante niveaux", MAX_LEVEL === 50);
check("le Prix de Survie est à 2 500 XP", SURVIVAL_PRIZE_XP === 2500);
check("niveau 1 à 0 XP", xpForLevel(1) === 0);
check("niveau 50 à 2 500 XP", xpForLevel(50) === SURVIVAL_PRIZE_XP);
check(
  "la courbe ne redescend jamais",
  Array.from({ length: 49 }, (_, i) => xpForLevel(i + 2) > xpForLevel(i + 1)).every(Boolean),
);
check("une XP de 0 donne le niveau 1", levelForXp(0) === 1);
check("2 500 XP donnent le niveau 50", levelForXp(2500) === 50);
check("3 000 XP ne dépassent pas 50", levelForXp(3000) === 50);
const progress10 = levelProgress(xpForLevel(10));
check("la barre du niveau 10 est à 0 %", progress10.level === 10 && progress10.into === 0);
check("le niveau 10 donne un objectif suivant", progress10.nextAt > xpForLevel(10));

console.log("\nLes chapitres");
check("cinq chapitres", LEVELS.length === 5);
let state = newGame();
check("l'expédition démarre au chapitre 1", currentLevel(state.progress)?.id === LEVELS[0].id);

// 1. Reconnaissance : rejoindre le sentier + observer deux espèces.
check(
  "rien n'est validé au départ",
  levelStatus(state).objectives.every((entry) => entry.current === 0),
);
state = { ...state, visitedZones: [...state.visitedZones, "sentier"] };
let step1 = advanceProgress(state);
check("rejoindre le sentier ne suffit pas", step1.completed === null);
state = { ...state, observedSpecies: ["calao", "papillon"] };
step1 = play(state, (s) => s);
check("deux espèces observées terminent le chapitre 1", step1.completed?.id === "reconnaissance");
state = step1.state;
check(
  "le chapitre 1 ouvre le sentier",
  state.progress.unlocks.includes("sentier"),
  state.progress.unlocks.join(", ") || "aucune",
);

// 2. Première battue : deux hingebe + 10 kg.
step1 = play(state, (s) => recordKill(s, "hingebe", 20));
check("un hingebe ne suffit pas", step1.completed === null);
state = step1.state;
state = recordKill(state, "hingebe", 20);
let step2 = play(state, (s) => recordHarvest(s, 6));
check("la viande seule ne suffit pas", step2.completed === null);
state = step2.state;
step2 = play(state, (s) => recordHarvest(s, 5));
check("deux hingebe et 11 kg terminent le chapitre 2", step2.completed?.id === "premiere-battue");
state = step2.state;
check("le chapitre 2 ouvre la clairière", state.progress.unlocks.includes("clairiere"));

// 3. Le baï : clairière + sitatunga + 5 espèces.
state = { ...state, visitedZones: [...state.visitedZones, "clairiere"] };
state = recordKill(state, "sitatunga", 70);
state = { ...state, observedSpecies: ["calao", "papillon", "hingebe", "sitatunga", "bongo"] };
const step3 = play(state, (s) => s);
check("le baï termine le chapitre 3", step3.completed?.id === "bai");
state = step3.state;
check("le chapitre 3 ouvre la rivière", state.progress.unlocks.includes("riviere"));

// 4. La rivière : y aller, un crocodile, 45 kg de viande.
state = { ...state, visitedZones: [...state.visitedZones, "riviere"] };
state = recordKill(state, "crocodile", 60);
// 11 kg ont déjà été rapportés au chapitre 2 : l'objectif des 45 kg est
// cumulatif, c'est précisément ce qu'on vérifie ici.
let step4 = play(state, (s) => recordHarvest(s, 20));
check("31 kg en tout ne suffisent pas pour la rivière", step4.completed === null);
state = step4.state;
step4 = play(state, (s) => recordHarvest(s, 15));
check("le crocodile et 46 kg terminent le chapitre 4", step4.completed?.id === "riviere");
state = step4.state;
check("le chapitre 4 ouvre la forêt profonde", state.progress.unlocks.includes("foret-profonde"));

// 5. La grande traque : un bongo, cinq Mewas, un abri.
state = recordKill(state, "bongo", 95);
state = {
  ...state,
  mewas: state.mewas.map((mewa, index) => (index < 5 ? { ...mewa, collected: true } : mewa)),
};
let step5 = play(state, (s) => s);
check("sans abri, le dernier chapitre reste ouvert", step5.completed === null);
state = step5.state;
state = { ...state, shelters: [{ x: 0, z: 0, index: 0, day: 1 }] };
step5 = play(state, (s) => s);
check("bongo + cinq Mewas + abri terminent la campagne", step5.completed?.id === "grande-traque");
state = step5.state;
check("plus de chapitre après la campagne", currentLevel(state.progress) === null);
check("toutes les zones sont ouvertes", state.progress.unlocks.length >= 5, state.progress.unlocks.join(", "));

console.log("\nL'expérience");
check("abattre donne de l'XP", state.xp > 0, `${Math.round(state.xp)} XP`);
check(
  "le niveau suit l'XP",
  state.level === levelForXp(state.xp),
  `niveau ${state.level}`,
);
check(
  "les récompenses de chapitre sont comptées",
  state.xp >= 50 + 120 + 200 + 300 + 500,
  `${Math.round(state.xp)} XP`,
);

console.log("\nLa sauvegarde");
const saved = deserialize(JSON.parse(JSON.stringify(serialize(state))));
check("le chapitre survit", saved.progress.levelIndex === state.progress.levelIndex);
check("les zones ouvertes survivent", saved.progress.unlocks.length === state.progress.unlocks.length);
check("les chapitres terminés survivent", saved.progress.completed.length === state.progress.completed.length);
check("l'XP survit", saved.xp === state.xp);

const fresh = deserialize({ version: 5, player: { position: [0, 0, 6] } });
check("une sauvegarde d'avant les chapitres repart au 1", fresh.progress.levelIndex === 0);

console.log(
  failures === 0
    ? "\nLes cinq chapitres s'enchaînent, l'XP suit.\n"
    : `\n${failures} vérification(s) en échec.\n`,
);
process.exit(failures === 0 ? 0 : 1);
