/**
 * Traduction des catalogues.
 *
 * Les paquets, les formules et les tenues ne sont pas des phrases d'interface :
 * ce sont des fiches, réparties dans des modules que le serveur lit aussi
 * (`lib/distribution.ts` sert à fabriquer les archives, `game/outfits.ts` à
 * calculer les statistiques). On ne les traduit donc pas sur place mais par
 * surcouche : le français reste la référence, l'anglais s'ajoute au moment du
 * rendu. Un paquet ou une tenue ajoutée sans traduction ne casse rien ; un
 * identifiant mal orthographié, si — les tables sont typées.
 */

import type { Locale } from "./locales";
import type { GamePackage, PackageId } from "@/lib/distribution";
import { PACKAGES } from "@/lib/distribution";
import { OUTFITS, type Outfit } from "@/game/outfits";
import { CHARACTERS, type Character } from "@/game/characters";
import { PLANS, type Plan } from "@/lib/plans";

type PackageCopy = Pick<GamePackage, "label" | "description" | "requirements" | "instructions">;
type OutfitCopy = Pick<Outfit, "name" | "description">;
type CharacterCopy = Pick<Character, "name" | "role">;
type PlanCopy = Pick<Plan, "label" | "tagline" | "perks">;

const PACKAGES_EN: Partial<Record<PackageId, PackageCopy>> = {
  windows: {
    label: "Windows 10/11",
    description:
      "Full client with the Minkébé forest, the expedition mode and local multiplayer.",
    requirements: "Windows 10/11 64-bit · 4 GB RAM · DirectX 11 GPU",
    instructions: [
      "Unzip the archive into a dedicated folder.",
      "Run Minkebe.exe (Windows may show a SmartScreen warning).",
      'Pick "Expedition" for solo or "Multiplayer" to join a server.',
    ],
  },
  macos: {
    label: "macOS 13+",
    description:
      "Apple Silicon and Intel build, Metal renderer, gamepad and trackpad supported.",
    requirements: "macOS 13 Ventura · Apple Silicon or Intel · 4 GB RAM",
    instructions: [
      "Open the DMG and drag Minkébé into Applications.",
      "On first launch: right-click → Open (the build is not notarised).",
      "The game uses Metal: close GPU-hungry apps.",
    ],
  },
  android: {
    label: "Android 8+",
    description:
      "Mobile build with touch controls, a battery-saving mode and cloud saves.",
    requirements: "Android 8.0 · 3 GB RAM · OpenGL ES 3.0",
    instructions: [
      "Allow installs from this source in the Android settings.",
      "Install the APK, then open Minkébé.",
      "Touch controls appear automatically on mobile.",
    ],
  },
  source: {
    label: "Server (source code)",
    description:
      "Complete Next.js + PostgreSQL source: host it for multiplayer, saves and payments.",
    requirements: "Node.js 20 · PostgreSQL 14+",
    instructions: [
      "Unzip the archive on the server.",
      "cp .env.example .env, then fill in DATABASE_URL and ADMIN_TOKEN.",
      "npm ci && npm run db:push && npm run build && npm start.",
      "Put a TLS reverse proxy (Caddy, Nginx, Traefik) in front of port 3000.",
    ],
  },
};

const OUTFITS_EN: Record<string, OutfitCopy> = {
  explorateur: {
    name: "Explorer's outfit",
    description: "Light cotton, pockets everywhere. The default, versatile kit.",
  },
  ecogarde: {
    name: "Ranger uniform",
    description: "Reinforced olive, radio on the shoulder. Surveys protected zones faster.",
  },
  pisteur: {
    name: "Tracker's garb",
    description: "Natural fibres dyed with mud: the best cover in the reserve.",
  },
  pluie: {
    name: "Rain cape",
    description: "Full waterproof shell. Essential through the wet season.",
  },
  canicule: {
    name: "Tropical kit",
    description: "Fast-drying, maximum airflow: built for full sun.",
  },
  nuit: {
    name: "Night suit",
    description: "Matte anti-glare cloth, invisible seams. Watch without being seen.",
  },
  reve: {
    name: "Dream outfit",
    description:
      "Woven from Mewa Dream Threads. The cloth catches the forest's blue light and gives it back a step later.",
  },
  lumiere: {
    name: "Mantle of light",
    description:
      "Enough threads to cover the shoulders. Rain slides off, the night brightens around you.",
  },
  "peau-mewa": {
    name: "Mewa pelt",
    description:
      "Twenty-four threads, the price of a whole pack of spirits. No one hears you coming.",
  },
};

const CHARACTERS_EN: Record<string, CharacterCopy> = {
  mbadinga: { name: "Aubin Mbadinga", role: "Park ranger" },
  soldier: { name: "The Soldier", role: "Scout" },
  guide: { name: "Nkoul", role: "Tracker" },
  chercheuse: { name: "Dr. Owori", role: "Researcher" },
};

const PLANS_EN: Record<string, PlanCopy> = {
  expedition: {
    label: "Expedition",
    tagline: "The full solo campaign, no time limit",
    perks: [
      "The whole Minkébé forest (8 zones)",
      "Every species and gadget unlocked",
      "3 local save slots",
    ],
  },
  sentinelle: {
    label: "Sentinel",
    tagline: "Multiplayer, cloud saves and updates",
    perks: [
      "Everything in “Expedition”",
      "Multiplayer up to 8 players",
      "PostgreSQL cloud saves",
      "Early access to new zones",
    ],
  },
  mecene: {
    label: "Patron",
    tagline: "Back conservation and research",
    perks: [
      "Everything in “Sentinel”",
      "Your name in the credits",
      "10 % shared with ANPN",
      "A monthly field-notes PDF",
    ],
  },
};

/** Formule traduite, prix et identifiant inchangés. */
export function planCopy(plan: Plan, locale: Locale): Plan {
  if (locale === "en") {
    const copy = PLANS_EN[plan.id];
    if (copy) return { ...plan, ...copy };
  }
  return plan;
}

export const plansFor = (locale: Locale): Plan[] => PLANS.map((plan) => planCopy(plan, locale));

/** Fiche d'un paquet dans la langue demandée. */
export function packageCopy(pkg: GamePackage, locale: Locale): GamePackage {
  if (locale === "en") {
    const copy = PACKAGES_EN[pkg.id];
    if (copy) return { ...pkg, ...copy };
  }
  return pkg;
}

/** Toutes les fiches de paquets, dans la langue demandée. */
export function packagesFor(locale: Locale): GamePackage[] {
  return PACKAGES.map((pkg) => packageCopy(pkg, locale));
}

/** Tenue traduite, identifiants et couleurs inchangés. */
export function outfitCopy(outfit: Outfit, locale: Locale): Outfit {
  if (locale === "en") {
    const copy = OUTFITS_EN[outfit.id];
    if (copy) return { ...outfit, ...copy };
  }
  return outfit;
}

/** Personnage traduit : le nom reste, le rôle change. */
export function characterCopy(character: Character, locale: Locale): Character {
  if (locale === "en") {
    const copy = CHARACTERS_EN[character.id];
    if (copy) return { ...character, ...copy };
  }
  return character;
}

/** Listes complètes, déjà traduites. */
export const outfitsFor = (locale: Locale): Outfit[] => OUTFITS.map((o) => outfitCopy(o, locale));
export const charactersFor = (locale: Locale): Character[] =>
  CHARACTERS.map((c) => characterCopy(c, locale));
