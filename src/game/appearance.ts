/**
 * Le visage du personnage.
 *
 * Une seule question posée à ce fichier : de quelle couleur est la peau de
 * l'homme qu'on incarne ? Il est écogarde à Makokou, au bord de l'Ivindo, dans
 * l'Ogooué-Ivindo. Ce n'est pas une préférence graphique, c'est le personnage.
 *
 * Deux rendus lisent ces valeurs :
 *
 *  - `HumanModel` construit un corps procédural dont la peau est une matière
 *    unie : il prend `SKIN_BASE` ;
 *  - `AvatarModel` importe `explorateur.glb`, dont la peau est une **texture**
 *    claire. On ne fabrique pas une texture de peau : on la multiplie par une
 *    teinte calculée pour que le résultat tombe sur `SKIN_TARGET`. Les pores,
 *    les taches et les plis de la carte d'origine restent — c'est la seule
 *    façon d'obtenir un visage qui ne soit pas un aplat de couleur.
 *
 * Le piège, vérifié par `scripts/check-appearance.mjs` : une carnation obtenue
 * en baissant la luminosité d'une peau claire vire au gris (la teinte se
 * désature en même temps). On multiplie donc **en linéaire**, canal par canal,
 * à partir d'une peau de référence claire — le résultat garde l'écart
 * rouge/vert/bleu d'un brun chaud.
 */

/** Peau du corps procédural sans texture : brun profond, chaud. */
export const SKIN_BASE = 0x5c3521;
/** Creux : narines, orbite, pli des lèvres. Deux tons plus bas, jamais du noir. */
export const SKIN_SHADE = 0x331c11;
/** Reflet doux des peaux foncées — sans lui, un visage devient un masque plat. */
export const SKIN_SHEEN = 0x9a5b36;

/**
 * Carnation visée, telle qu'elle doit apparaître à l'écran.
 *
 * C'est la couleur qui compte. Tout le reste n'est que de l'arithmétique pour
 * l'atteindre à partir d'une texture plus claire.
 */
export const SKIN_TARGET = 0x6b452f;

/**
 * Peau de référence du modèle importé : les cartes `baseColor` des avatars
 * de ce type tournent autour de ce beige clair. Sert de point de départ au
 * calcul de la teinte multiplicatrice.
 */
export const SKIN_REFERENCE = 0xe0ac8a;

/** sRGB 0-1 → linéaire 0-1. */
export function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Linéaire 0-1 → sRGB 0-1. */
export function toSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/** Composantes sRGB 0-1 d'une couleur packée. */
export function srgbOf(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Composantes linéaires 0-1 : ce qu'attend un rendu qui éclaire en linéaire. */
export function linearOf(hex: number): [number, number, number] {
  return srgbOf(hex).map(toLinear) as [number, number, number];
}

/** Couleur packée depuis trois composantes sRGB 0-1. */
export function pack(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  return (r << 16) | (g << 8) | b;
}

/**
 * Teinte à multiplier à la peau du glTF pour obtenir `SKIN_TARGET`.
 *
 * Calculée, pas devinée : `cible / référence`, canal par canal, en linéaire.
 * Une valeur écrite à la main serait fausse dès qu'on change la peau de
 * référence — et personne ne s'en apercevrait avant de voir un visage noir
 * de suie dans le jeu.
 */
export const SKIN_GLB_TINT = (() => {
  const target = linearOf(SKIN_TARGET);
  const reference = linearOf(SKIN_REFERENCE);
  return pack(
    [0, 1, 2].map((i) => toSrgb(target[i] / Math.max(1e-4, reference[i]))) as [number, number, number],
  );
})();

/**
 * Multiplicateur de la carte de peau du corps procédural.
 *
 * `skin.jpg` a une moyenne mesurée de (119, 74, 53) : c'est déjà un brun, et
 * la repeindre à l'aplat donnerait un masque. On la multiplie par un gris
 * chaud très légèrement au-dessous de 1 — la carnation descend d'un ton, les
 * pores et les variations restent.
 */
export const SKIN_MAP_TINT = 0xb5b2ad;
