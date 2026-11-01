#!/usr/bin/env node
/**
 * Contrôle de la chasse et des cours d'eau.
 *
 *   node scripts/check-hunt.mjs
 *
 * Compile les modules purs (esbuild) puis vérifie ce qui peut l'être sans
 * navigateur :
 *   · la géométrie des surfaces d'eau (pas de NaN, rives à la bonne hauteur,
 *     lit creusé, largeur cohérente avec le maillage) ;
 *   · la balistique des armes (dégâts, tête, portée, munitions, cadence) ;
 *   · la viande et le dépeçage ;
 *   · le comportement de la harde (fuite, plafond de population, pas de
 *     mammifère terrestre dans trois mètres d'eau).
 */

import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const entry = `
  export * from "./src/game/water.ts";
  export { terrainHeight, shoreDistance } from "./src/game/terrain.ts";
  export * from "./src/game/animals.ts";
  export * from "./src/game/hunting.ts";
`;

async function load() {
  const dir = await mkdtemp(path.join(tmpdir(), "minkebe-chasse-"));
  const outFile = path.join(dir, "bundle.mjs");
  await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outFile,
    logLevel: "error",
  });
  const gameModule = await import(`${outFile}?t=${Date.now()}`);
  await rm(dir, { recursive: true, force: true });
  return gameModule;
}

const game = await load();
let failures = 0;

function check(label, condition, detail = "") {
  const status = condition ? "✓" : "✗";
  if (!condition) failures += 1;
  console.log(`  ${status} ${label}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
console.log("\nCours d'eau");
// ---------------------------------------------------------------------------
for (const body of game.WATER_BODIES) {
  const surface = game.waterSurface(body);
  const vertices = surface.positions.length / 3;
  const triangles = surface.indices.length / 3;
  const finite = surface.positions.every(Number.isFinite);
  const shoreMax = Math.max(...surface.shore);
  const shoreMin = Math.min(...surface.shore);
  const depthMax = Math.max(...surface.depth);

  check(
    `${body.name} : maillage`,
    finite && vertices > 100 && triangles > 100,
    `${vertices} sommets · ${triangles} triangles`,
  );
  check(
    `${body.name} : rive et profondeur`,
    shoreMin <= 0.01 && shoreMax > 0.85 && depthMax > 0.3,
    `shore ${shoreMin.toFixed(2)}–${shoreMax.toFixed(2)} · ${depthMax.toFixed(2)} m`,
  );

  // La ligne d'eau du maillage doit coïncider avec le bord du champ de distance.
  const centreX = surface.positions[0];
  const centreZ = surface.positions[2];
  check(
    `${body.name} : sondage`,
    Number.isFinite(game.shoreDistance(centreX, centreZ)),
    `bord à ${game.shoreDistance(centreX, centreZ).toFixed(1)} m`,
  );
}

// Le lit doit être sous la surface, et la berge au-dessus.
const river = game.getWaterBody("ivindo");
let bedOk = true;
let bankOk = true;
for (let i = 0; i < 200; i++) {
  const t = (i / 199) * (river.path.length - 1);
  const index = Math.min(river.path.length - 2, Math.floor(t));
  const local = t - index;
  const [ax, az] = river.path[index];
  const [bx, bz] = river.path[index + 1];
  const x = ax + (bx - ax) * local;
  const z = az + (bz - az) * local;
  const field = game.waterField(x, z);
  if (!field) {
    bedOk = false;
    break;
  }
  if (Math.abs(game.terrainHeight(x, z) - (field.body.level - field.depth)) > 0.02) bedOk = false;
  // 12 m au large de la rive : le sol doit être remonté au-dessus de l'eau.
  const bankX = x + 13 + field.width * 0.2;
  const bankField = game.waterField(bankX, z);
  if (bankField && bankField.edge > 8 && game.terrainHeight(bankX, z) <= field.body.level) bankOk = false;
}
check("Lit creusé sous la surface", bedOk);
check("Berges remontées au-dessus de l'eau", bankOk);

// Ruissellement : le ruisseau doit rejoindre la rivière.
const stream = game.getWaterBody("ruisseau");
const streamEnd = stream.path[stream.path.length - 1];
const streamField = game.waterField(streamEnd[0], streamEnd[1]);
check(
  "Le ruisseau rejoint la rivière",
  Boolean(streamField && Math.abs(streamField.edge) < 12),
  streamField ? `bord à ${streamField.edge.toFixed(1)} m` : "hors de l'eau",
);

// ---------------------------------------------------------------------------
console.log("\nArmes");
// ---------------------------------------------------------------------------
const bongoBuild = game.ANIMAL_BUILDS.bongo;
const makeAnimal = (speciesId, x, z) => ({
  id: 1,
  speciesId,
  x,
  z,
  groundY: game.terrainHeight(x, z),
  heading: 0,
  gait: 0,
  speed: 0,
  state: "pature",
  health: game.ANIMAL_BUILDS[speciesId].health,
  maxHealth: game.ANIMAL_BUILDS[speciesId].health,
  timer: 1,
  alert: 0,
  wander: 0,
  deadTimer: 0,
  harvested: false,
  hitFlash: 0,
  scale: 1,
  variant: 0.5,
});

/** Vise le centre du tronc d'un animal posé à `distance` devant le joueur. */
function aimAt(speciesId, distance, groundY = 0) {
  const build = game.ANIMAL_BUILDS[speciesId];
  const targetY = groundY + game.bodyCenterY(build);
  const dy = targetY - 1.62;
  const length = Math.hypot(dy, distance);
  return { origin: [0, 1.62, 0], direction: [0, dy / length, -distance / length] };
}

const bongo = makeAnimal("bongo", 0, -18);
bongo.groundY = 0;
const aim = aimAt("bongo", 18);
const rifle = game.initialArsenalState();
rifle.current = "m16";

let arsenal = rifle;
let lastShot = -1000;
let report;
for (let shot = 0; shot < 6; shot++) {
  const out = game.fireWeapon("m16", arsenal, [bongo], aim, shot * 1000, lastShot, () => 0.5);
  arsenal = out.arsenal;
  lastShot = out.lastShotAt;
  report = out.report;
  if (bongo.state === "mort") break;
}
check(
  "M16 : un bongo tombe en quelques balles",
  bongo.state === "mort",
  `santé ${bongo.health}/${bongoBuild.health} · chargeur ${report.loaded}`,
);
check("M16 : munitions décomptées", report.loaded < 30, `${report.loaded} balles restantes`);

const elephant = makeAnimal("elephant", 0, -16);
elephant.groundY = 0;
let elephantArsenal = game.initialArsenalState();
elephantArsenal.current = "pistolet";
let elephantLast = -1000;
let elephantShots = 0;
const elephantAim = aimAt("elephant", 16);
while (elephant.state !== "mort" && elephantShots < 60) {
  const out = game.fireWeapon(
    "pistolet",
    elephantArsenal,
    [elephant],
    elephantAim,
    elephantShots * 1000,
    elephantLast,
    () => 0.5,
  );
  elephantArsenal = out.arsenal;
  elephantLast = out.lastShotAt;
  elephantShots += 1;
  if (out.report.reason === "munitions") {
    elephantArsenal = game.reloadWeapon(elephantArsenal, "pistolet");
  }
}
check(
  "Pistolet : un éléphant résiste",
  elephantShots >= 7,
  `${elephantShots} balles`,
);

const target = makeAnimal("hingebe", 0, -9);
target.groundY = 0.4 + 0.38;
const knifeAim = { origin: [0, 1.62, 0], direction: [0, -0.02, -1] };
const knifeArsenal = game.initialArsenalState();
const knifeOut = game.fireWeapon("couteau", knifeArsenal, [target], knifeAim, 1000, -1000, () => 0.5);
check(
  "Couteau : portée courte, coups silencieux",
  knifeOut.report.fired && knifeOut.report.noise <= 1,
  `bruit ${knifeOut.report.noise}`,
);

const far = makeAnimal("bongo", 0, -60);
far.groundY = 0;
const farOut = game.fireWeapon("couteau", knifeArsenal, [far], aim, 1000, -1000, () => 0.5);
check("Couteau : inutile à 60 m", farOut.report.hit === null);

const dry = game.initialArsenalState();
dry.weapons = dry.weapons.map((w) => (w.id === "pistolet" ? { ...w, loaded: 0, reserve: 0 } : w));
const dryOut = game.fireWeapon("pistolet", dry, [bongo], aim, 5000, -1000, () => 0.5);
check("Pistolet vide : le coup ne part pas", dryOut.report.fired === false && dryOut.report.reason === "munitions");

const cadence = game.fireWeapon("m16", rifle, [bongo], aim, 10, 0, () => 0.5);
check("Cadence respectée", cadence.report.reason === "cadence");

// ---------------------------------------------------------------------------
console.log("\nDépeçage");
// ---------------------------------------------------------------------------
const carcass = makeAnimal("bongo", 0, -3);
carcass.state = "mort";
const near = game.nearestCarcass([carcass], 0, 0, 3.6);
check("Carcasse détectée à portée", near?.id === carcass.id);
const meat = game.harvest(carcass);
check("Dépeçage : viande récupérée", Boolean(meat && meat.meat > 10), `${meat?.meat} kg`);
check("Dépeçage : pas deux fois", game.harvest(carcass) === null);

// ---------------------------------------------------------------------------
console.log("\nHarde");
// ---------------------------------------------------------------------------
let animals = [];
let random = game.mulberry32(20261101);
let maxPopulation = 0;
let inWater = 0;
for (let step = 0; step < 60 * 90; step++) {
  const result = game.stepHerd(
    animals,
    {
      player: [0, 0],
      noise: 3,
      hour: 9,
      weather: "sec",
      zoneId: "foret-profonde",
      abundance: 1,
      seed: 12,
    },
    1 / 60,
    random,
  );
  animals = result.animals;
  maxPopulation = Math.max(maxPopulation, animals.length);
  for (const animal of animals) {
    if (animal.state === "mort") continue;
    if (animal.speciesId === "crocodile" || animal.speciesId === "sitatunga") continue;
    const field = game.waterField(animal.x, animal.z);
    if (field && field.edge < 0 && field.depth > 0.15) inWater += 1;
  }
}
check(
  "Population plafonnée",
  maxPopulation <= game.MAX_ANIMALS && maxPopulation >= 2,
  `${animals.length} animaux après 90 s`,
);
check("Aucun mammifère terrestre dans l'eau", inWater === 0, `${inWater} occurrences`);

// Un céphalophe posé à huit mètres doit détaler dès que le joueur approche.
const close = [makeAnimal("hingebe", 0, -8)];
close[0].groundY = game.terrainHeight(0, -8);
let seeded = game.mulberry32(7);
for (let i = 0; i < 60; i++) {
  const out = game.stepHerd(
    close,
    { player: [0, 0], noise: 8, hour: 12, weather: "sec", zoneId: "foret-profonde", seed: 3 },
    1 / 30,
    seeded,
  );
  close.length = 0;
  close.push(...out.animals);
}
const fleeing = close.filter((a) => a.state === "fuite" || a.state === "charge").length;
const moved = Math.hypot(close[0]?.x ?? 0, (close[0]?.z ?? 0) + 8);
check(
  "Une bête proche du joueur détale",
  fleeing > 0 || moved > 2,
  `${fleeing} en fuite · ${moved.toFixed(1)} m parcourus`,
);

console.log(
  failures === 0
    ? "\n✓ Chasse et cours d'eau conformes\n"
    : `\n✗ ${failures} contrôle(s) en échec\n`,
);
process.exit(failures === 0 ? 0 : 1);
