#!/usr/bin/env node
/**
 * Le corps et la tenue sont deux choses distinctes.
 *
 *   node scripts/check-outfits.mjs
 *
 * Signalé : « faire la différence entre le corps avec la tenue ». Le
 * personnage étant entièrement vêtu, la peau ne se voyait qu'au visage et aux
 * mains — et les deux étaient de la même valeur que la toile. Sur la planche,
 * on distinguait à peine où finissait le bras et où commençait la manche.
 *
 * Ce contrôle mesure, matière par matière :
 *
 *   · que chaque tenue change réellement les couleurs du vêtement ;
 *   · que la **peau ne change pas** — une tenue habille, elle ne teint pas ;
 *   · que chaque pièce de tissu se sépare de la peau, en valeur (luminance)
 *     ou en teinte. Un pantalon de la couleur exacte du bras redevient un bras.
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-outfits-"));
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
const outfits = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Luminance relative : c'est elle qui décide si l'œil sépare deux surfaces. */
const luma = (colour) => 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
const rgb = (colour) => [colour.r, colour.g, colour.b];

/** Différence de teinte, en degrés. */
function hueGap(a, b) {
  const ha = Math.atan2(Math.sqrt(3) * (a.g - a.b), 2 * a.r - a.g - a.b);
  const hb = Math.atan2(Math.sqrt(3) * (b.g - b.b), 2 * b.r - b.g - b.b);
  const diff = Math.abs(ha - hb) * (180 / Math.PI);
  return Math.min(diff, 360 - diff);
}

const CLOTH = ["chemise", "pantalon", "bottes", "sangle"];
const SKIN = ["peau", "peau-creux"];

/** Palette d'une tenue appliquée à un corps neuf. */
function paletteFor(id) {
  const rig = human.createHumanRig();
  human.applyHumanOutfit(rig, id);
  const found = {};
  for (const material of rig.materials) found[material.name] = material.color.clone();
  human.disposeHumanRig(rig);
  return found;
}

console.log("\nChaque tenue change le vêtement");
// Référence : le corps **avant** toute tenue. Comparer les tenues entre elles
// ferait passer la tenue de base pour un échec — elle est identique à
// elle-même, ce qui ne dit rien du vêtement d'origine.
const bare = (() => {
  const rig = human.createHumanRig();
  const found = {};
  for (const material of rig.materials) found[material.name] = material.color.clone();
  human.disposeHumanRig(rig);
  return found;
})();
const base = bare;
for (const outfit of outfits.OUTFITS) {
  const palette = paletteFor(outfit.id);
  const changed = CLOTH.filter((name) => palette[name] && !palette[name].equals(base[name])).length;
  const skinUntouched = SKIN.every((name) => palette[name].equals(base[name]));
  check(`${outfit.id.padEnd(14)} habille le corps`, changed >= 3, `${changed}/4 pièces distinctes de la tenue de base`);
  check(`${outfit.id.padEnd(14)} ne teint pas la peau`, skinUntouched);
}

console.log("\nLa peau se sépare de l'étoffe");
for (const outfit of outfits.OUTFITS) {
  const palette = paletteFor(outfit.id);
  const skin = rgb(palette.peau);
  const skinLuma = luma(skin);
  for (const name of ["chemise", "pantalon"]) {
    const cloth = palette[name];
    const gap = Math.abs(luma(rgb(cloth)) - skinLuma);
    const hue = hueGap(cloth, palette.peau);
    // Deux surfaces se distinguent par la valeur (le contraste qui tient même
    // en vision de nuit) **ou** par la teinte. L'un des deux suffit ; aucun
    // des deux, et le vêtement se confond avec le corps.
    const readable = gap > 0.06 || hue > 40;
    check(
      `${outfit.id.padEnd(14)} ${name} distinct de la peau`,
      readable,
      `Δvaleur ${(gap * 100).toFixed(0)} % · Δteinte ${hue.toFixed(0)}°`,
    );
  }
}

console.log("\nChaque tenue a une intention");
for (const outfit of outfits.OUTFITS) {
  const palette = outfit.palette;
  check(
    `${outfit.id.padEnd(14)} palette complète`,
    Boolean(palette?.top && palette?.bottom && palette?.boot && palette?.gear),
  );
}
{
  // Deux tenues ne doivent pas avoir la même palette : le vestiaire deviendrait
  // un choix sans conséquence visible.
  const seen = new Map();
  for (const outfit of outfits.OUTFITS) seen.set(outfit.palette.top + outfit.palette.bottom, outfit.id);
  check("les dix tenues sont distinctes", seen.size === outfits.OUTFITS.length, `${seen.size} palettes uniques`);
}

console.log(
  failures === 0 ? "\n✓ Le corps et la tenue se distinguent.\n" : `\n✗ ${failures} contrôle(s) en échec.\n`,
);
process.exit(failures === 0 ? 0 : 1);
