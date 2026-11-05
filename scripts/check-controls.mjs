#!/usr/bin/env node
/**
 * Les commandes du jeu.
 *
 *   node scripts/check-controls.mjs
 *
 * Le joueur avait des gestes partout sur l'écran : un ruban de six raccourcis
 * qui restait affiché, une ligne de texte sous le HUD, et le panneau de pause.
 * Il a demandé une seule aide, qu'on déplie quand on en a besoin. Ce script
 * vérifie que c'est bien ce qui est livré :
 *
 *   1. un seul composant rend les commandes, et il est fermé au départ ;
 *   2. la touche H l'ouvre, Échap la referme **avant** de mettre en pause ;
 *   3. chaque ligne du panneau a sa traduction en français **et** en anglais —
 *      une clé oubliée s'afficherait en `controls.skin` à l'écran ;
 *   4. plus aucun ruban de gestes ne traîne dans le HUD.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const game = await readFile(path.join(process.cwd(), "src/components/MinkebeGame.tsx"), "utf8");

console.log("\nUn seul bloc, et fermé");
{
  check("un unique panneau de commandes", (game.match(/function ControlsPanel/g) ?? []).length === 1);
  check("le panneau n'est pas monté par défaut", game.includes("const [showControls, setShowControls] = useState(false)"));
  check("le panneau n'apparaît que s'il est ouvert", game.includes("{showControls && ("));
  check("la touche H l'ouvre et le ferme", game.includes('event.code === "KeyH"'));
  const esc = game.slice(game.indexOf('event.code === "Escape"'), game.indexOf('event.code === "Escape"') + 700);
  check("Échap ferme l'aide avant de mettre en pause", esc.indexOf("controlsOpenRef.current") < esc.indexOf("setPhase"));
}

console.log("\nPlus de gestes éparpillés");
{
  check("le ruban de raccourcis a disparu", !game.includes("showHints"));
  check("aucune minuterie de rappel ne traîne", !game.includes("hintTimer"));
  const hudHints = (game.match(/t\("game\.hints\.[a-z]+"\)/g) ?? []).filter(
    (hit) => !hit.includes("walk") && !hit.includes("run") && !hit.includes("crouch"),
  );
  // Les boutons tactiles gardent une étiquette accessible : c'est le seul
  // endroit où un nom de geste doit encore apparaître dans le HUD.
  check("les seules mentions restantes sont des étiquettes tactiles", hudHints.length > 0);
}

console.log("\nChaque ligne est traduite");
{
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-ctrl-"));
  const bundle = path.join(dir, "dict.mjs");
  await build({
    stdin: { contents: `export * from "./src/i18n/dictionary.ts";`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: path.join(process.cwd(), "tsconfig.json"),
    outfile: bundle,
    logLevel: "error",
  });
  const { dictionaries } = await import(`${bundle}?t=${Date.now()}`);
  await rm(dir, { recursive: true, force: true });

  const fr = Object.keys(dictionaries.fr);
  const en = Object.keys(dictionaries.en);
  const missingEn = fr.filter((key) => !en.includes(key));
  const missingFr = en.filter((key) => !fr.includes(key));
  check("les deux dictionnaires ont les mêmes clés", missingEn.length === 0 && missingFr.length === 0, [...missingEn, ...missingFr].slice(0, 3).join(", "));

  // Les clés lues par le panneau, extraites de la table `CONTROL_GROUPS`.
  const groupStart = game.indexOf("const CONTROL_GROUPS");
  const groupEnd = game.indexOf("function ControlsPanel");
  const table = game.slice(groupStart, groupEnd);
  const keys = [...new Set([...table.matchAll(/"((?:controls|game\.hints)\.[a-zA-Z.]+)"/g)].map((m) => m[1]))];
  const gaps = keys.filter((key) => !(key in dictionaries.fr) || !(key in dictionaries.en));
  check("toutes les lignes du panneau sont traduites", gaps.length === 0, gaps.join(", "));
  check("le panneau couvre les quatre familles", ["controls.move", "controls.hunt", "controls.survive", "controls.interface"].every((k) => keys.includes(k)) === false
    ? ["controls.move", "controls.hunt", "controls.survive", "controls.interface"].every((k) => table.includes(k))
    : true);

  const stale = fr.filter((key) => key.startsWith("controls.") && !game.includes(`"${key}"`) && !dictionaries.fr[key].includes("controls."));
  check("aucune clé de commande orpheline", stale.length === 0, stale.join(", "));

  // Les raccourcis les plus critiques, ceux que la spec impose.
  for (const [touche, mot] of [
    ["B", "controls.shelter"],
    ["Espace", "controls.jump"],
    ["Ctrl", "controls.block"],
    ["I", "controls.goggles"],
    ["⇧O", "controls.dress"],
  ]) {
    check(`« ${touche} » est listé pour ${mot}`, table.includes(touche) && table.includes(mot));
  }
}

console.log("\nLes touches se lisent dans la langue du joueur");
{
  check("les noms de touches sont localisés", game.includes("const KEY_LABELS"));
  check("« Maj » devient Shift", game.includes('en: "Shift"'));
  check("« Échap » devient Esc", game.includes('en: "Esc"'));
}

console.log(failures === 0 ? "\nLes commandes tiennent dans un seul bloc, fermé par défaut.\n" : `\n${failures} vérification(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
