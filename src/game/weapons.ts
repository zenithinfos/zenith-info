/**
 * Outils d'intervention.
 *
 * Minkébé est un jeu de conservation : aucun outil n'est létal. « Armes » ici
 * désigne le matériel de capture et de défense utilisé par les écogardes.
 */

export type ToolId =
  | "sarbacane"
  | "filet"
  | "baton"
  | "fumigene"
  | "fusee-eclairante"
  | "camera-piege";

export interface Tool {
  id: ToolId;
  name: string;
  emoji: string;
  /** Dégâts = points d'endormissement (jamais de blessure). */
  power: number;
  /** Munitions par recharge. */
  ammo: number;
  cooldown: number;
  range: number;
  effect: "endormir" | "immobiliser" | "repousser" | "eclairer" | "observer";
  description: string;
  /** Effet secondaire indésirable : bruit, stress animal... */
  drawback: string;
}

export const TOOLS: Tool[] = [
  {
    id: "sarbacane",
    name: "Sarbacane anesthésiante",
    emoji: "🎯",
    power: 40,
    ammo: 4,
    cooldown: 2.4,
    range: 18,
    effect: "endormir",
    description:
      "Dard hypodermique à dose vétérinaire. Endort un animal blessé pour le soigner et le relâcher.",
    drawback: "Précision faible à distance ; le stress de l'animal réduit ses chances de survie.",
  },
  {
    id: "filet",
    name: "Filet de capture",
    emoji: "🕸️",
    power: 25,
    ammo: 2,
    cooldown: 4,
    range: 6,
    effect: "immobiliser",
    description: "Immobilise un petit mammifère le temps de poser un collier GPS.",
    drawback: "Inutile sur les grands animaux ; encombrant.",
  },
  {
    id: "baton",
    name: "Bâton de marche",
    emoji: "🦯",
    power: 12,
    ammo: 999,
    cooldown: 0.8,
    range: 2,
    effect: "repousser",
    description: "Sert surtout à sonder le sol des marais et à écarter les lianes.",
    drawback: "Peut effrayer la faune proche (bruit).",
  },
  {
    id: "fumigene",
    name: "Fumigène répulsif",
    emoji: "💨",
    power: 60,
    ammo: 1,
    cooldown: 12,
    range: 8,
    effect: "repousser",
    description: "Crée un écran de fumée qui décourage une charge sans blesser l'animal.",
    drawback: "Usage unique ; réduit la visibilité dans les deux sens.",
  },
  {
    id: "fusee-eclairante",
    name: "Fusée éclairante",
    emoji: "🚨",
    power: 0,
    ammo: 2,
    cooldown: 6,
    range: 40,
    effect: "eclairer",
    description: "Éclaire une zone pendant la nuit et signale votre position à l'équipe.",
    drawback: "Aucun dégât, mais révèle votre position.",
  },
  {
    id: "camera-piege",
    name: "Piège photographique",
    emoji: "📸",
    power: 0,
    ammo: 3,
    cooldown: 1.5,
    range: 25,
    effect: "observer",
    description: "Documente la faune sans la déranger ; c'est l'outil le plus productif du jeu.",
    drawback: "Ne protège pas : fuyez si un animal charge.",
  },
];

export function getTool(id: ToolId): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export interface ToolState {
  id: ToolId;
  ammo: number;
  lastUsedAt: number;
}

export function initialArsenal(level: number): ToolState[] {
  return TOOLS.filter((_, index) => index <= Math.min(TOOLS.length - 1, 1 + level))
    .map((tool) => ({ id: tool.id, ammo: tool.ammo, lastUsedAt: 0 }));
}

export interface ShotResult {
  ok: boolean;
  reason?: "munitions" | "recharge" | "portee" | "inconnu";
  tool: Tool;
  ammoLeft: number;
  /** Points d'endormissement infligés (0 pour un outil non létal sans effet). */
  sedation: number;
}

/** Tire avec un outil : vérifie munitions, cooldown et portée. */
export function fire(
  state: ToolState,
  target: { distance: number },
  now: number,
  accuracy = 0.8,
): ShotResult {
  const tool = getTool(state.id);
  if (!tool) {
    return { ok: false, reason: "inconnu", tool: TOOLS[0], ammoLeft: state.ammo, sedation: 0 };
  }
  if (state.ammo <= 0) {
    return { ok: false, reason: "munitions", tool, ammoLeft: 0, sedation: 0 };
  }
  if (now - state.lastUsedAt < tool.cooldown * 1000) {
    return { ok: false, reason: "recharge", tool, ammoLeft: state.ammo, sedation: 0 };
  }
  if (target.distance > tool.range) {
    return { ok: false, reason: "portee", tool, ammoLeft: state.ammo, sedation: 0 };
  }

  const falloff = 1 - target.distance / (tool.range + 1);
  const sedation = Math.round(tool.power * falloff * accuracy);
  return { ok: true, tool, ammoLeft: state.ammo - 1, sedation };
}

/** Effet de l'outil sur un animal de résistance donnée. */
export function applyTool(
  tool: Tool,
  resistance: number,
  sedation: number,
): "endormi" | "ralenti" | "repoussé" | "aucun effet" {
  switch (tool.effect) {
    case "endormir":
      return sedation >= resistance ? "endormi" : "ralenti";
    case "immobiliser":
      return sedation * 2 >= resistance ? "endormi" : "ralenti";
    case "repousser":
      return "repoussé";
    default:
      return "aucun effet";
  }
}
