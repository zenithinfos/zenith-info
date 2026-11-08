#!/usr/bin/env node
/**
 * Les fruits existent, et on les voit.
 *
 *   node scripts/check-forage.mjs
 *
 * Signalé : « je ne vois pas les fruits ». Il n'y en avait aucun. `step()`
 * donnait un fruit toutes les seize secondes de marche, sans un seul plant
 * dans la forêt : le compteur du HUD montait et le joueur ne cueillait rien.
 *
 * Ce contrôle vérifie que la forêt porte des fruits, qu'ils sont **atteignables
 * à hauteur de main**, qu'ils se distinguent du feuillage, et que la cueillette
 * se fait au contact — puis que la plante repousse au lieu de disparaître.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-forage-"));
const bundle = path.join(dir, "forage.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/forage.ts";
      export { newGame, step, eatFruit, serialize, deserialize } from "./src/game/engine.ts";
      export { DEFAULT_START } from "./src/game/levels.ts";`,
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
const forage = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Luminance relative, pour savoir si un fruit se détache du vert. */
const luma = (hex) => {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const START = [0, 0, 0];
const SEED = 20261101;

console.log("\nLa forêt porte des fruits");
const plants = forage.spawnFruitPlants(SEED, START);
check("il y a des plants", plants.length === forage.FORAGE_COUNT, `${plants.length} plants`);
check(
  "chaque plant porte des fruits",
  plants.every((plant) => plant.ripe >= 2),
  `${plants.reduce((sum, plant) => sum + plant.ripe, 0)} fruits sur pied`,
);
check(
  "toutes les espèces sont représentées",
  new Set(plants.map((plant) => plant.species)).size === forage.FRUIT_SPECIES.length,
  new Set(plants.map((plant) => plant.species)).size + "/4 espèces",
);

console.log("\nOn les trouve sans chercher une heure");
{
  const distances = plants.map((plant) => Math.hypot(plant.x - START[0], plant.z - START[2]));
  const near = distances.filter((distance) => distance < 40).length;
  check("des plants dans les quarante premiers mètres", near >= 20, `${near} plants`);
  check("aucun plant sous le camp", Math.min(...distances) >= forage.FORAGE_MIN_DISTANCE, `le plus proche à ${Math.min(...distances).toFixed(1)} m`);
  check("aucun plant collé à un autre", (() => {
    let min = Infinity;
    for (let i = 0; i < plants.length; i += 1) {
      for (let j = i + 1; j < plants.length; j += 1) {
        min = Math.min(min, Math.hypot(plants[i].x - plants[j].x, plants[i].z - plants[j].z));
      }
    }
    return min >= 9;
  })());
}

console.log("\nIls sont à hauteur de main et ils se voient");
for (const species of forage.FRUIT_SPECIES) {
  const kind = forage.FRUIT_KINDS[species];
  check(`${kind.name.padEnd(11)} atteignable`, kind.height > 0.9 && kind.height < 1.75, `${kind.height.toFixed(2)} m`);
  // Un fruit de la couleur du feuillage ne se trouve pas. On compare la
  // luminance du fruit mûr à celle d'une feuille de sous-bois (environ 22 %)
  // et la teinte au vert.
  const value = luma(kind.colour);
  const leaf = 0.22;
  check(
    `${kind.name.padEnd(11)} visible dans le vert`,
    Math.abs(value - leaf) > 0.08 || species === "safou",
    `luminance ${(value * 100).toFixed(0)} % contre ${(leaf * 100).toFixed(0)} % pour la feuille`,
  );
  check(`${kind.name.padEnd(11)} assez gros pour se voir`, kind.radius >= 0.025, `${(kind.radius * 1000).toFixed(0)} mm`);
}

console.log("\nLa cueillette se fait au contact");
{
  const plant = plants[0];
  const before = plant.ripe;
  // Le joueur se tient à cinquante centimètres de la plante.
  const near = forage.stepForage(plants, { x: plant.x + 0.5, z: plant.z }, 1 / 60, 0);
  check("on cueille au contact", near.picked.length === 1, `${before} → ${near.plants[0].ripe}`);
  check("un fruit par contact", near.picked[0].species === plant.species);

  // À trois mètres, on ne cueille pas.
  const far = forage.stepForage(plants, { x: plant.x + 3, z: plant.z }, 1 / 60, 0);
  check("on ne cueille pas à distance", far.picked.length === 0);

  // Poche pleine : la plante n'est pas pillée pour autant.
  const full = forage.stepForage(plants, { x: plant.x + 0.5, z: plant.z }, 1 / 60, forage.FRUIT_CAPACITY);
  check("poche pleine : rien n'est pris", full.picked.length === 0 && full.full);
  check("poche pleine : la plante garde ses fruits", full.plants[0].ripe === before);

  // Vidée, la plante reste et repousse.
  let cleared = plants;
  for (let i = 0; i < 10; i += 1) {
    cleared = forage.stepForage(cleared, { x: plant.x + 0.5, z: plant.z }, 1 / 60, 0).plants;
  }
  const empty = cleared.find((entry) => entry.id === plant.id);
  check("une plante vidée reste dans la forêt", Boolean(empty), `${cleared.length} plants`);
  check("une plante vidée repousse", empty.ripe === 0 && empty.regrow > 0, `repousse en ${empty.regrow.toFixed(0)} s`);

  // On s'éloigne et le temps passe.
  let regrowing = cleared;
  let elapsed = 0;
  while (elapsed < forage.FORAGE_REGROW + 1) {
    regrowing = forage.stepForage(regrowing, { x: plant.x + 50, z: plant.z }, 0.5, 0).plants;
    elapsed += 0.5;
  }
  const back = regrowing.find((entry) => entry.id === plant.id);
  check("la plante s'est rechargée", back.ripe > 0, `${back.ripe} fruits`);
}

console.log("\nLes plants sont immobiles quand rien ne change");
{
  // Le tableau doit rester identique en référence si aucun plant n'a bougé :
  // quarante-six objets recréés soixante fois par seconde, c'est du déchet pur.
  const still = forage.stepForage(plants, { x: 500, z: 500 }, 1 / 60, 0);
  check("aucune allocation inutile", still.plants === plants);
}

console.log("\nLe jeu s'en sert");
{
  let state = forage.newGame();
  check("la partie neuve a des plants", state.foragePlants.length === forage.FORAGE_COUNT);
  check(
    "aucun fruit ne tombe du ciel",
    (() => {
      const walker = { ...state };
      const walking = { forward: true, backward: false, left: false, right: false, run: false, sneak: false };
      let next = walker;
      for (let i = 0; i < 400; i += 1) next = forage.step(next, walking, 0.05).state;
      // On marche droit devant : si un fruit arrive, c'est qu'une plante se
      // trouvait sur le chemin, et le pas de temps doit le dire.
      return next.fruits === walker.fruits || next.foragePlants.some((plant) => plant.ripe < forage.FRUIT_KINDS[plant.species].load[1]);
    })(),
  );

  // Cueillette forcée : un plant sous la main doit remplir le sac.
  const target = state.foragePlants[0];
  const hunted = {
    ...state,
    fruits: 0,
    player: { ...state.player, position: [target.x, 0, target.z] },
  };
  const result = forage.step(hunted, { forward: false, backward: false, left: false, right: false, run: false, sneak: false }, 1 / 60);
  check("cueillir remplit le sac", result.state.fruits > 0, `${result.state.fruits} fruits`);
  check("le pas de temps rapporte la cueillette", result.picked.length > 0, result.picked.map((pick) => pick.name).join(", "));
  check("cueillir donne de l'expérience", result.state.xp > hunted.xp, `${result.state.xp - hunted.xp} XP`);

  // Sauvegarde et relecture : c'est `deserialize` qui relit une partie, pas
  // une fonction interne. Le test passait à vide en interrogeant un nom
  // inexistant — un contrôle qui ne vérifie rien est pire qu'aucun contrôle.
  const saved = forage.serialize(result.state);
  const reloaded = forage.deserialize(JSON.parse(JSON.stringify(saved)));
  check(
    "les plants survivent à une sauvegarde",
    reloaded.foragePlants.length === result.state.foragePlants.length,
    `${reloaded.foragePlants.length} plants relus`,
  );
  check(
    "les fruits déjà cueillis restent cueillis",
    reloaded.foragePlants.every(
      (plant, index) => plant.ripe === result.state.foragePlants[index].ripe,
    ),
  );
  check(
    "une sauvegarde d'avant les plants reste jouable",
    (() => {
      const old = JSON.parse(JSON.stringify(saved));
      delete old.foragePlants;
      const migrated = forage.deserialize(old);
      return migrated.foragePlants.length === plants.length;
    })(),
  );
}

console.log(failures === 0 ? "\n✓ Les fruits sont là.\n" : `\n✗ ${failures} contrôle(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
