/**
 * Le plafond de canopée : les nappes de feuillage suspendues au-dessus du
 * joueur.
 *
 * Elles existent pour une raison simple : sans elles, on voit le ciel partout
 * entre les fûts et la forêt ressemble à un parc. Mais un plafond **plein** est
 * pire que pas de plafond du tout : la première version posait cinquante-six
 * nappes de quarante à quatre-vingts mètres sur une texture **opaque**, ce qui
 * fermait le ciel au-dessus de vingt degrés. Le joueur ne voyait plus que la
 * bande la plus pâle du dégradé, celle de l'horizon — d'où le « le ciel n'est
 * pas bleu ».
 *
 * Deux corrections, et elles sont dans les données :
 *
 *   1. la texture de canopée employée ici est celle du **feuillage**, trouée à
 *      55 % : entre les feuilles, on voit le ciel ;
 *   2. les nappes sont posées sur une grille irrégulière avec des **vides** —
 *      les trouées d'une forêt réelle, celles que laisse la chute d'un arbre.
 *      Au zénith, un tiers du ciel reste ouvert.
 *
 * Le placement est ici et non dans `Scene.tsx` pour que `scripts/check-canopy.mjs`
 * mesure exactement le plafond que le jeu dessine.
 */

import { mulberry32 } from "./forest";

export interface CanopySheet {
  /** Position dans le repère du plafond, centré sur le joueur. */
  x: number;
  y: number;
  z: number;
  /** Rotation autour de la verticale, en radians. */
  yaw: number;
  /** Inclinaison autour de X, faible : une nappe n'est jamais un plan parfait. */
  tilt: number;
  /** Côté de la nappe, en mètres. */
  size: number;
}

export const CANOPY = {
  seed: 20261101,
  /** Rayon du plafond autour du joueur. */
  radius: 108,
  /** Pas de la grille de pose : c'est lui qui règle la taille des vides. */
  step: 20,
  /** Proportion de cases laissées vides — les trouées. */
  skip: 0.38,
  /** Altitude des nappes, en mètres. */
  height: [27, 41] as const,
  /** Côté des nappes, en mètres. */
  size: [24, 40] as const,
  /** Le mobile en pose moins : même couverture angulaire, moins d'objets. */
  mobile: { radius: 82, step: 24, skip: 0.44 } as const,
} as const;

/**
 * Les nappes du plafond, dans un ordre déterministe.
 *
 * Déterministe compte : le contrôle doit pouvoir rejouer la même pose pour
 * mesurer le ciel visible. Une seule source d'aléatoire, `mulberry32`, et un
 * ordre de tirages fixe.
 */
export function canopySheets(options: { mobile?: boolean } = {}): CanopySheet[] {
  const random = mulberry32(CANOPY.seed);
  const radius = options.mobile ? CANOPY.mobile.radius : CANOPY.radius;
  const step = options.mobile ? CANOPY.mobile.step : CANOPY.step;
  const skip = options.mobile ? CANOPY.mobile.skip : CANOPY.skip;
  const [minY, maxY] = CANOPY.height;
  const [minSize, maxSize] = CANOPY.size;

  const sheets: CanopySheet[] = [];
  for (let gridX = -radius; gridX <= radius; gridX += step) {
    for (let gridZ = -radius; gridZ <= radius; gridZ += step) {
      // Les tirages ont lieu **avant** les rejets : sinon, selon l'ordre des
      // `continue`, la même graine ne produirait plus la même forêt.
      const jitterX = (random() - 0.5) * step * 0.8;
      const jitterZ = (random() - 0.5) * step * 0.8;
      const roll = random();
      const sizeRoll = random();
      const yawRoll = random();
      const tiltRoll = random();
      const heightRoll = random();

      const x = gridX + jitterX;
      const z = gridZ + jitterZ;
      if (Math.hypot(x, z) > radius) continue;
      if (roll < skip) continue;

      sheets.push({
        x,
        y: minY + heightRoll * (maxY - minY),
        z,
        yaw: yawRoll * Math.PI,
        tilt: (tiltRoll - 0.5) * 0.14,
        size: minSize + sizeRoll * (maxSize - minSize),
      });
    }
  }
  return sheets;
}
