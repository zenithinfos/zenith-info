#!/usr/bin/env node
/**
 * De quelle couleur est la peau du personnage ?
 *
 *   node scripts/check-appearance.mjs
 *
 * Ce n'est pas une question de goût : le personnage est un écogarde de
 * Makokou, dans l'Ogooué-Ivindo. Une carnation claire ne serait pas une
 * variante, ce serait un autre homme.
 *
 * Le contrôle vérifie trois choses mesurables :
 *
 *   1. la luminance de la peau tombe dans la bande des carnations d'Afrique
 *      centrale (sombre, jamais claire) ;
 *   2. la teinte reste **chaude** (rouge > vert > bleu) — une peau obtenue en
 *      désaturant vire au gris, c'est le piège du « je baisse la luminosité » ;
 *   3. la texture du glTF, une fois multipliée par la teinte du jeu, donne
 *      bien cette carnation à l'écran — pas seulement dans une constante.
 */

import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const dir = await mkdtemp(path.join(tmpdir(), "minkebe-skin-"));
const bundle = path.join(dir, "appearance.mjs");
await build({
  stdin: {
    contents: `export * from "./src/game/appearance.ts";`,
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
  SKIN_BASE,
  SKIN_SHADE,
  SKIN_GLB_TINT,
  SKIN_MAP_TINT,
  SKIN_REFERENCE,
  SKIN_TARGET,
  srgbOf,
  linearOf,
  toSrgb,
} = await import(`${bundle}?t=${Date.now()}`);
await rm(dir, { recursive: true, force: true });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const rgb = (hex) => srgbOf(hex).map((v) => Math.round(v * 255));
/** Luminance relative (WCAG) : la mesure qui correspond à ce qu'on perçoit. */
const luminance = (hex) => {
  const [r, g, b] = srgbOf(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hex = (t) => `#${t.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

console.log("\nLa carnation du corps procédural");
{
  const [r, g, b] = rgb(SKIN_BASE);
  check("peau sombre", luminance(SKIN_BASE) < 0.09, `luminance ${luminance(SKIN_BASE).toFixed(3)} · ${hex(rgb(SKIN_BASE))}`);
  check("teinte chaude", r > g && g > b, `${r} > ${g} > ${b}`);
  check("pas grise", (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b) > 0.5);
  const [sr, sg, sb] = rgb(SKIN_SHADE);
  check("les creux restent bruns, pas noirs", sr + sg + sb > 90, hex([sr, sg, sb]));
}

console.log("\nLa texture importée");
{
  const [mr, mg, mb] = rgb(SKIN_MAP_TINT);
  // Moyenne mesurée de `/textures/avatar/skin.jpg`.
  const map = [119, 74, 53];
  const shown = map.map((v, i) => Math.round((v * [mr, mg, mb][i]) / 255));
  check("le glTF n'est pas repeint à l'aplat", mr !== 255 || mg !== 255, hex([mr, mg, mb]));
  check(
    "peau du glTF : sombre",
    shown[0] < 100,
    `${hex(shown)} · avant ${hex(map)}`,
  );
  check("peau du glTF : chaude", shown[0] > shown[1] && shown[1] > shown[2], shown.join(" > "));
}

console.log("\nLa teinte multiplicatrice du glTF");
{
  // Le calcul doit retomber sur la carnation visée : c'est la seule preuve que
  // la texture importée ne sortira pas noire de suie ni beige.
  const reference = linearOf(SKIN_REFERENCE);
  const tint = linearOf(SKIN_GLB_TINT);
  const shown = [0, 1, 2].map((i) => Math.round(Math.min(1, toSrgb(Math.min(1, reference[i] * tint[i]))) * 255));
  const target = SKIN_TARGET;
  const err = Math.max(
    Math.abs(shown[0] - ((target >> 16) & 255)),
    Math.abs(shown[1] - ((target >> 8) & 255)),
    Math.abs(shown[2] - (target & 255)),
  );
  check("la teinte retombe sur la carnation visée", err <= 3, `${hex(shown)} pour cible ${hex(rgb(target))}`);
  const [r, g, b] = rgb(SKIN_GLB_TINT);
  check("la teinte est chaude", r > g && g > b, `${r} > ${g} > ${b}`);
  check("elle assombrit sans écraser", r > 40 && r < 200, `${r}`);
}

// Une dernière chose, qui n'est pas de la couleur : le corps doit être celui
// d'un homme, et il doit être nommé. C'est le genre de détail qui disparaît
// au premier refactor.
const characters = await readFile(path.join(process.cwd(), "src/game/characters.ts"), "utf8");
check("le personnage par défaut est nommé", characters.includes('name: "Aubin Mbadinga"'));
check("son rôle est écogarde", characters.includes('role: "Écogarde"'));
check("Makokou est cité", characters.includes("Makokou"));
check("Minkébé et l'Ogooué-Ivindo sont cités", characters.includes("Ogooué-Ivindo"));
check("l'ancien identifiant reste lisible", characters.includes("michelle: \"mbadinga\""));

// L'image de peau du disque, si elle est là, pour que la mesure porte sur le
// fichier réel et pas sur une constante recopiée.
try {
  const stats = await sharp(path.join(process.cwd(), "public/textures/avatar/skin.jpg")).resize(1, 1).raw().toBuffer();
  check("skin.jpg est bien dans les bruns", stats[0] > stats[1] && stats[1] > stats[2], [...stats].slice(0, 3).join(", "));
} catch {
  console.log("  · skin.jpg absent — mesure de la texture ignorée");
}

console.log(
  failures === 0
    ? "\nLa peau est celle d'un homme du bassin du Congo, et chaude.\n"
    : `\n${failures} vérification(s) en échec.\n`,
);
process.exit(failures === 0 ? 0 : 1);
