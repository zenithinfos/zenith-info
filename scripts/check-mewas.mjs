#!/usr/bin/env node
/**
 * Les Mewas et la survie, sans navigateur.
 *
 *   node scripts/check-mewas.mjs
 *
 * Vérifie ce que le joueur ressent : dix esprits loin du camp, qui viennent
 * quand on approche et se ramassent au contact ; des Fils de Rêve, de l'XP et
 * du style à chaque prise ; quatre jauges qui descendent ; la soif ou la faim
 * qui ronge la santé ; la santé à zéro qui termine l'expédition, avec sa cause
 * et son score ; et une sauvegarde qui garde tout cela.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-mewas-"));
const bundle = path.join(dir, "mewas.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/mewas.ts"; export * from "./src/game/engine.ts"; export * from "./src/game/realism.ts"; export * from "./src/game/outfits.ts";`,
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
  MEWA_COUNT,
  MEWA_CONTACT,
  MEWA_MIN_DISTANCE,
  MEWA_XP,
  MEWA_STYLE,
  spawnMewas,
  stepMewas,
  mewaReward,
  mewasFound,
  newGame,
  step,
  serialize,
  deserialize,
  eatFruit,
  drinkWater,
  grillMeat,
  weaveOutfit,
  restartExpedition,
  getOutfit,
  SAVE_VERSION,
} = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

const start = [0, 0, 0];
const idle = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  run: false,
  sneak: false,
  joystick: { x: 0, y: 0 },
};

// ------------------------------------------------------------------
// 1. Les dix esprits
// ------------------------------------------------------------------
console.log("\nLes Mewas");
const mewas = spawnMewas(12345, start);
check("ils sont exactement dix", mewas.length === MEWA_COUNT, `${mewas.length}`);
const nearest = Math.min(...mewas.map((m) => Math.hypot(m.homeX - start[0], m.homeZ - start[2])));
check(
  `aucun à moins de ${MEWA_MIN_DISTANCE} m du camp`,
  nearest >= MEWA_MIN_DISTANCE,
  `le plus proche à ${nearest.toFixed(1)} m`,
);
const spread = Math.max(...mewas.map((m) => Math.hypot(m.homeX - start[0], m.homeZ - start[2])));
check("ils sont dispersés dans la forêt", spread > 60, `jusqu'à ${spread.toFixed(0)} m`);

const replay = spawnMewas(12345, start);
check(
  "la même graine redonne la même forêt",
  replay.every((m, i) => Math.abs(m.homeX - mewas[i].homeX) < 1e-9),
);

// ------------------------------------------------------------------
// 2. Ils viennent, et on les ramasse au contact
// ------------------------------------------------------------------
const rewards = [];
let population = mewas.map((m) => ({ ...m }));
// Le joueur se place à 8 m du premier esprit, puis attend.
const target = population[0];
const player = { x: target.x + 8, z: target.z };
let approach = Infinity;
for (let frame = 0; frame < 600; frame += 1) {
  const result = stepMewas(population, player, 1 / 60, frame / 60);
  population = result.mewas;
  for (const reward of result.collected) rewards.push(reward);
  const alive = population.find((m) => !m.collected);
  if (alive) approach = Math.min(approach, Math.hypot(alive.x - player.x, alive.z - player.z));
  if (rewards.length) break;
}
check(
  "un Mewa à moins de 10 m vient vers le joueur",
  approach <= MEWA_CONTACT + 0.2,
  `approché à ${approach.toFixed(2)} m`,
);
check("ramassé au contact, sans touche", rewards.length === 1);
check("il ne revient pas après la prise", mewasFound(population) === 1);

const counts = new Set();
for (let id = 0; id < MEWA_COUNT; id += 1) counts.add(mewaReward(id).threads);
check(
  "chaque Mewa donne 2 à 4 Fils de Rêve",
  [...counts].every((n) => n >= 2 && n <= 4),
  `valeurs : ${[...counts].sort().join(", ")}`,
);
check(
  "+40 XP et +40 points de style",
  mewaReward(0).xp === MEWA_XP && mewaReward(0).style === MEWA_STYLE,
);
check(
  "un esprit lointain reste chez lui",
  (() => {
    const far = mewas.map((m) => ({ ...m }));
    const before = { x: far[1].x, z: far[1].z };
    const after = stepMewas(far, { x: start[0], z: start[2] }, 1 / 60, 0).mewas[1];
    return Math.hypot(after.x - before.x, after.z - before.z) < 0.05;
  })(),
);

// ------------------------------------------------------------------
// 3. Le jeu : collecte, jauges, mort
// ------------------------------------------------------------------
console.log("\nLa survie");
let state = newGame();
check(
  "quatre jauges présentes",
  ["health", "hunger", "hydration", "stamina"].every((k) => typeof state.vitals[k] === "number"),
  `santé ${Math.round(state.vitals.health)} · faim ${Math.round(state.vitals.hunger)} · soif ${Math.round(state.vitals.hydration)} · endurance ${Math.round(state.vitals.stamina)}`,
);

// 90 secondes immobile : la soif et la faim baissent.
const thirstBefore = state.vitals.hydration;
const hungerBefore = state.vitals.hunger;
for (let i = 0; i < 90; i += 1) state = step(state, idle, 1).state;
check(
  "la soif descend avec le temps",
  state.vitals.hydration < thirstBefore,
  `${Math.round(thirstBefore)} → ${Math.round(state.vitals.hydration)}`,
);
check(
  "la faim descend aussi",
  state.vitals.hunger < hungerBefore,
  `${Math.round(hungerBefore)} → ${Math.round(state.vitals.hunger)}`,
);

// Un fruit, puis la cueillette en marchant.
const fed = eatFruit(state);
check("manger un fruit remplit la faim", fed.code === "eat.ok");
check("le fruit est consommé", fed.state.fruits === state.fruits - 1);
check(
  "les fruits se ramassent en marchant",
  (() => {
    let walker = { ...state, fruits: 0, forage: 0 };
    const walking = { ...idle, forward: true };
    for (let i = 0; i < 40; i += 1) walker = step(walker, walking, 1).state;
    return walker.fruits >= 1;
  })(),
);

// Le feu du camp.
const campState = { ...state, hunt: { ...state.hunt, meat: 5 } };
check("griller au camp nourrit", grillMeat(campState).code === "grill.ok");
check(
  "griller loin du feu est refusé",
  grillMeat({ ...campState, player: { ...campState.player, position: [120, 0, 120] } }).code === "grill.far",
);

// Soif à zéro : la santé tombe, puis l'expédition se termine.
let dying = {
  ...state,
  vitals: { ...state.vitals, hydration: 4, hunger: 80, health: 6 },
  mewas: mewas.map((m) => ({ ...m })),
};
let death = null;
let frames = 0;
while (!death && frames < 4000) {
  const result = step(dying, idle, 0.05);
  dying = result.state;
  death = result.death;
  frames += 1;
}
check("la santé à zéro termine l'expédition", Boolean(death));
check("la cause est la déshydratation", death?.cause === "soif", death?.cause ?? "—");
check("le score final est figé", typeof death?.score === "number", `${death?.score}`);
check(
  "le monde ne recommence pas à tourner après la mort",
  (() => {
    const again = step(dying, idle, 1);
    return again.state === dying && again.death === null;
  })(),
);

// La faim seule tue aussi.
let starving = {
  ...newGame(),
  player: { ...newGame().player, position: [120, 0, 120] },
  vitals: { health: 6, hydration: 90, hunger: 3, stamina: 90, wetness: 0, temperature: 27 },
};
let starved = null;
for (let i = 0; i < 4000 && !starved; i += 1) {
  const result = step(starving, idle, 0.05);
  starving = result.state;
  starved = result.death;
}
check("la famine tue aussi", starved?.cause === "faim", starved?.cause ?? "—");

// ------------------------------------------------------------------
// 4. Boire : il faut de l'eau
// ------------------------------------------------------------------
check(
  "boire loin de l'eau est refusé",
  drinkWater({ ...state, player: { ...state.player, position: [0, 0, 0] } }).code === "drink.none",
);

// ------------------------------------------------------------------
// 5. Tisser une tenue
// ------------------------------------------------------------------
console.log("\nLes Fils de Rêve");
const poor = { ...state, threads: 1 };
// La première tenue tissée est la Fée des étoiles : huit Fils de Rêve.
check("sans fils, pas de tenue", weaveOutfit(poor, "fee-etoiles").code === "weave.threads");
const rich = { ...state, threads: 30 };
const woven = weaveOutfit(rich, "fee-etoiles");
check("avec assez de fils, la tenue est tissée", woven.code === "weave.ok");
check("les fils sont dépensés", woven.state.threads === 30 - 8, `${woven.state.threads} restants`);
check("la tenue est gardée", woven.state.woven.includes("fee-etoiles"));
check("on ne la tisse pas deux fois", weaveOutfit(woven.state, "fee-etoiles").code === "weave.owned");
// Les quatre tenues nommées existent, avec leurs effets.
for (const [id, cost] of [
  ["fee-etoiles", 8],
  ["nenuphar", 12],
  ["murmure", 16],
  ["purificatrice", 20],
]) {
  const outfit = getOutfit(id);
  check(`la tenue ${id} coûte ${cost} fils`, outfit.threads === cost, `${outfit.threads}`);
}
check("Fée des étoiles fait planer", getOutfit("fee-etoiles").power === "glide");
check("Nénuphar marche sur l'eau", getOutfit("nenuphar").power === "water");
check("Murmure apprivoise", getOutfit("murmure").power === "tame");
check("Purificatrice calme", getOutfit("purificatrice").power === "calm");

const afterDeath = restartExpedition({ ...woven.state, death: { cause: "soif", at: 10, score: 400 } });
check("la nouvelle expédition repart à neuf", afterDeath.death === null && afterDeath.elapsed === 0);
check("les tenues tissées sont conservées", afterDeath.woven.includes("fee-etoiles"));
check(
  "les Mewas sont de nouveau dix",
  mewasFound(afterDeath.mewas) === 0 && afterDeath.mewas.length === MEWA_COUNT,
);

// ------------------------------------------------------------------
// 6. La sauvegarde
// ------------------------------------------------------------------
console.log("\nLa sauvegarde");
const saved = deserialize(JSON.parse(JSON.stringify(serialize(woven.state))));
check("version de sauvegarde à jour", SAVE_VERSION === 6, `v${SAVE_VERSION}`);
check("les fils survivent", saved.threads === woven.state.threads);
check("les tenues survivent", saved.woven.includes("fee-etoiles"));
check(
  "les Mewas ramassés restent ramassés",
  mewasFound(saved.mewas) === mewasFound(woven.state.mewas),
  `${mewasFound(saved.mewas)}/${MEWA_COUNT}`,
);
check("l'XP et le style survivent", saved.xp === woven.state.xp && saved.style === woven.state.style);

const old = { ...JSON.parse(JSON.stringify(serialize(state))), version: 5 };
delete old.mewas;
delete old.threads;
delete old.death;
const migrated = deserialize(old);
check(
  "une sauvegarde d'avant les Mewas se relit sans casser",
  migrated.mewas.length === MEWA_COUNT && migrated.threads === 0 && migrated.death === null,
);

console.log(
  failures === 0
    ? "\nLes Mewas vivent, la survie tient.\n"
    : `\n${failures} vérification(s) en échec.\n`,
);
process.exit(failures === 0 ? 0 : 1);
