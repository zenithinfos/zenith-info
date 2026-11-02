/**
 * Petits détails qui donnent vie à la forêt : lucioles, pluie de feuilles,
 * chants d'oiseaux, sons d'eau, messages d'ambiance.
 * Ces éléments sont volontairement légers et désactivables (réduction des
 * animations).
 */

export type WhimsyKind = "luciole" | "feuille" | "papillon" | "goutte" | "pollen" | "brume";

export interface WhimsyLayer {
  kind: WhimsyKind;
  /** Nombre d'instances. */
  count: number;
  color: number;
  size: number;
  /** Vitesse de dérive (unités/s). */
  speed: number;
  /** Plage horaire d'apparition (heures du monde). */
  hours: [number, number];
  /** Météo propice. */
  weather: ("sec" | "pluie" | "orage" | "brume")[];
}

export const WHIMSY_LAYERS: WhimsyLayer[] = [
  {
    kind: "luciole",
    count: 400,
    color: 0xd8ff8a,
    size: 0.06,
    speed: 0.12,
    hours: [19, 5],
    weather: ["sec", "brume"],
  },
  {
    kind: "feuille",
    count: 220,
    color: 0x6b8f3a,
    size: 0.09,
    speed: 0.4,
    hours: [6, 19],
    weather: ["sec", "orage", "pluie"],
  },
  {
    kind: "papillon",
    count: 90,
    color: 0xf0b23c,
    size: 0.05,
    speed: 0.7,
    hours: [8, 17],
    weather: ["sec"],
  },
  {
    kind: "goutte",
    count: 3000,
    color: 0xb8d6e0,
    size: 0.02,
    speed: 22,
    hours: [0, 24],
    weather: ["pluie", "orage"],
  },
  {
    kind: "pollen",
    count: 700,
    color: 0xfff3cc,
    size: 0.015,
    speed: 0.08,
    hours: [6, 18],
    weather: ["sec", "brume"],
  },
  {
    kind: "brume",
    count: 18,
    color: 0xc9d8cc,
    size: 6,
    speed: 0.25,
    hours: [4, 9],
    weather: ["brume", "pluie", "sec"],
  },
];

export function activeLayers(
  hour: number,
  weather: "sec" | "pluie" | "orage" | "brume",
  reducedMotion = false,
): WhimsyLayer[] {
  if (reducedMotion) {
    return WHIMSY_LAYERS.filter((l) => l.kind === "brume").map((l) => ({
      ...l,
      count: Math.round(l.count / 2),
    }));
  }
  return WHIMSY_LAYERS.filter((layer) => {
    const [from, to] = layer.hours;
    const inHours =
      from <= to ? hour >= from && hour < to : hour >= from || hour < to;
    return inHours && layer.weather.includes(weather);
  });
}

/** Messages d'ambiance affichés discrètement en bas de l'écran. */
export const AMBIENT_LINES = [
  "Un calao à casque noir lance son appel, puis se tait.",
  "Quelque part à l'ouest, un arbre tombe. La forêt encaisse.",
  "Des odeurs de terre humide montent du sous-bois.",
  "Au loin, des cris de chimpanzés roulent sous la canopée.",
  "Une colonne de fourmis coupe-piste traverse le sentier.",
  "Le sol résonne : quelque chose de lourd marche à cinquante pas.",
  "La pluie frappe les feuillages comme des applaudissements lents.",
  "Ici, le silence n'est jamais vraiment le silence.",
  "Les lucioles dessinent des courbes au ras du sol.",
  "Un papillon bleu se pose sur votre manche, puis repart.",
  "On dit que les bais attirent les éléphants depuis des siècles.",
  "Une trace fraîche : trois doigts, une plante de pied. Bongo ?",
  "Le Ivindo charrie des feuilles et des secrets.",
  "Vous reconnaissez l'odeur du camp avant de le voir.",
  "Le GPS perd le signal. La boussole, jamais.",
];

export function ambientLine(seed: number): string {
  const index = Math.abs(Math.floor(seed)) % AMBIENT_LINES.length;
  return AMBIENT_LINES[index];
}

/** Petits succès (déclenchés par des actions anodines). */
export const WHIMSY_ACHIEVEMENTS = [
  { id: "premiers-pas", label: "Premiers pas", hint: "Quitter le camp à pied." },
  { id: "bain-de-foret", label: "Bain de forêt", hint: "Rester immobile 60 secondes." },
  { id: "oreille-absolue", label: "Oreille absolue", hint: "Identifier un oiseau au chant." },
  { id: "photographe", label: "Photographe", hint: "10 espèces dans le carnet." },
  { id: "marcheur-de-pluie", label: "Marcheur de pluie", hint: "Marcher 2 km sous l'orage." },
  { id: "ami-des-gardiens", label: "Ami des gardiens", hint: "Aider un écogarde bloqué." },
] as const;

export function fireflyPhase(time: number, seed: number): number {
  // Scintillement doux et irrégulier.
  const a = Math.sin(time * 1.7 + seed * 3.1);
  const b = Math.sin(time * 4.3 + seed * 1.7);
  return Math.max(0, (a + b) * 0.35 + 0.35);
}
