/**
 * Gadgets de terrain : ce que le joueur peut sortir de son sac.
 * Chaque gadget a une autonomie, un coût d'endurance et un effet de jeu.
 */

export type GadgetId =
  | "carte"
  | "gps"
  | "boussole"
  | "jumelles"
  | "lampe"
  | "camera"
  | "piege-photo"
  | "machette"
  | "filtre-eau"
  | "kit-soin"
  | "sarbacane";

export interface Gadget {
  id: GadgetId;
  name: string;
  emoji: string;
  description: string;
  /** Raccourci clavier (touche physique). */
  key: string;
  /** Autonomie en secondes ; null = illimité. */
  battery: number | null;
  staminaCost: number;
  /** Portée d'action en unités. */
  range: number;
  unlockZone: string | null;
  consumable: boolean;
}

export const GADGETS: Gadget[] = [
  {
    id: "carte",
    name: "Carte topographique",
    emoji: "🗺️",
    description: "Les 8 zones de la réserve, annotées à la main par les pisteurs.",
    key: "M",
    battery: null,
    staminaCost: 0,
    range: 0,
    unlockZone: null,
    consumable: false,
  },
  {
    id: "gps",
    name: "GPS de terrain",
    emoji: "📍",
    description: "Position, cap et waypoints. Perd le signal sous la canopée dense.",
    key: "G",
    battery: 900,
    staminaCost: 0,
    range: 0,
    unlockZone: null,
    consumable: false,
  },
  {
    id: "boussole",
    name: "Boussole",
    emoji: "🧭",
    description: "Fonctionne toujours, même quand le GPS abandonne.",
    key: "B",
    battery: null,
    staminaCost: 0,
    range: 0,
    unlockZone: null,
    consumable: false,
  },
  {
    id: "jumelles",
    name: "Jumelles 10×42",
    emoji: "🔭",
    description: "Identifier la faune à distance sans la déranger.",
    key: "J",
    battery: null,
    staminaCost: 0,
    range: 120,
    unlockZone: "sentier",
    consumable: false,
  },
  {
    id: "lampe",
    name: "Lampe frontale",
    emoji: "🔦",
    description: "Indispensable la nuit ; attire aussi certains insectes et révèle les yeux dans le noir.",
    key: "L",
    battery: 1800,
    staminaCost: 0,
    range: 35,
    unlockZone: null,
    consumable: false,
  },
  {
    id: "camera",
    name: "Appareil photo",
    emoji: "📷",
    description: "Chaque espèce photographiée alimente le carnet de terrain.",
    key: "P",
    battery: 600,
    staminaCost: 1,
    range: 60,
    unlockZone: "sentier",
    consumable: false,
  },
  {
    id: "piege-photo",
    name: "Piège photographique",
    emoji: "📸",
    description: "Posé sur un arbre, il capture la faune nocturne pendant votre absence.",
    key: "T",
    battery: 7200,
    staminaCost: 3,
    range: 25,
    unlockZone: "foret-profonde",
    consumable: true,
  },
  {
    id: "machette",
    name: "Machette",
    emoji: "🔪",
    description: "Ouvre un passage dans les lianes. À utiliser avec parcimonie.",
    key: "F",
    battery: null,
    staminaCost: 4,
    range: 2.5,
    unlockZone: null,
    consumable: false,
  },
  {
    id: "filtre-eau",
    name: "Filtre à eau",
    emoji: "💧",
    description: "Purifie l'eau de rivière : évite la déshydratation et les maladies.",
    key: "E",
    battery: 3200,
    staminaCost: 2,
    range: 3,
    unlockZone: "riviere",
    consumable: false,
  },
  {
    id: "kit-soin",
    name: "Kit de premiers soins",
    emoji: "🩹",
    description: "Soigne morsures, coupures et épuisement. Usage unique.",
    key: "H",
    battery: null,
    staminaCost: 0,
    range: 0,
    unlockZone: null,
    consumable: true,
  },
  {
    id: "sarbacane",
    name: "Sarbacane anesthésiante",
    emoji: "🎯",
    description:
      "Outil vétérinaire de l'ANPN : endort un animal blessé le temps de le soigner. Jamais létal.",
    key: "X",
    battery: null,
    staminaCost: 8,
    range: 18,
    unlockZone: "colline",
    consumable: true,
  },
];

export function getGadget(id: GadgetId): Gadget | undefined {
  return GADGETS.find((g) => g.id === id);
}

export interface GadgetState {
  id: GadgetId;
  charge: number;
  quantity: number;
}

export function initialGadgets(progress: string[]): GadgetState[] {
  return GADGETS.filter(
    (g) => g.unlockZone === null || progress.includes(g.unlockZone),
  ).map((g) => ({
    id: g.id,
    charge: g.battery ?? Infinity,
    quantity: g.consumable ? 1 : Infinity,
  }));
}

/**
 * Consomme un gadget et renvoie l'état mis à jour, ou null si indisponible.
 *
 * Nommée `consumeGadget` et non `useGadget` : le préfixe `use` ferait passer
 * cette fonction pure pour un hook React (règle react-hooks/rules-of-hooks).
 */
export function consumeGadget(
  state: GadgetState,
  seconds: number,
): GadgetState | null {
  const gadget = getGadget(state.id);
  if (!gadget) return null;
  if (gadget.consumable && state.quantity <= 0) return null;
  if (gadget.battery !== null && state.charge <= 0) return null;

  const charge =
    gadget.battery === null ? state.charge : Math.max(0, state.charge - seconds);

  return {
    ...state,
    charge,
    quantity: gadget.consumable ? state.quantity - 1 : state.quantity,
  };
}

export function recharge(state: GadgetState): GadgetState {
  const gadget = getGadget(state.id);
  if (!gadget) return state;
  return {
    ...state,
    charge: gadget.battery ?? Infinity,
    quantity: gadget.consumable ? Math.max(state.quantity, 1) : Infinity,
  };
}

/** Autonomie restante en pourcentage, pour l'interface. */
export function chargePercent(state: GadgetState): number {
  const gadget = getGadget(state.id);
  if (!gadget || gadget.battery === null) return 100;
  return Math.round((state.charge / gadget.battery) * 100);
}
