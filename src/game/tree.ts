/**
 * Architecture des arbres — module pur, sans dépendance à Three.js.
 *
 * Un arbre n'est pas un mât surmonté d'une boule. C'est ce que donnaient les
 * premiers essais : à l'écran, des lampadaires. Ce module construit une vraie
 * charpente ligneuse :
 *
 *   · un fût qui s'affine et s'incurve légèrement,
 *   · des **contreforts** à la base (le signal le plus fort d'un arbre de
 *     forêt tropicale : aucun fût n'entre dans le sol comme un poteau),
 *   · des **charpentières étagées** dès la moitié basse du fût, qui se
 *     subdivisent,
 *   · des **grappes de feuillage** accrochées aux extrémités, décrites en
 *     volume et non en plans posés.
 *
 * Le jeu et l'outil d'aperçu consomment tous deux ces données.
 */

export type Vec3 = [number, number, number];

export interface Segment {
  /** Extrémité basse, relative à la base du tronc. */
  from: Vec3;
  /** Extrémité haute. */
  to: Vec3;
  /** Rayon à l'extrémité basse. */
  radiusFrom: number;
  /** Rayon à l'extrémité haute. */
  radiusTo: number;
  /** 0 = bois, 1 = racine, 2 = branche, 3 = rameau. */
  kind: 0 | 1 | 2 | 3;
}

export interface Cluster {
  /** Centre de la grappe, relatif à la base du tronc. */
  at: Vec3;
  /** Rayon de la grappe. */
  radius: number;
  /** 0 = cœur du houppier, 1 = bord (feuillage plus clair et plus aéré). */
  edge: 0 | 1;
}

export interface Skeleton {
  segments: Segment[];
  clusters: Cluster[];
  /** Hauteur réelle du houppier (au-dessus du sol), pour les diagnostics. */
  crownBase: number;
}

export type TreeShape = "emergent" | "mid" | "understory" | "sapling";

export interface SkeletonInput {
  shape: TreeShape;
  trunkHeight: number;
  trunkRadius: number;
  crownScale: number;
  rand: () => number;
}

const TAU = Math.PI * 2;

/** Petite courbe continue pour éviter les fûts parfaitement rectilignes. */
function curve(t: number, seed: number): number {
  return Math.sin(t * 2.4 + seed) * 0.6 + Math.sin(t * 5.1 + seed * 1.7) * 0.25;
}

/**
 * Construit la charpente d'un arbre.
 * `segments` sont exprimés dans le repère local (base du tronc à l'origine).
 */
export function buildSkeleton({ shape, trunkHeight, trunkRadius, crownScale, rand }: SkeletonInput): Skeleton {
  const segments: Segment[] = [];
  const clusters: Cluster[] = [];

  /* --- contreforts : le pied de l'arbre s'évase dans la litière ------ */
  // Sans eux, le fût entre dans le sol comme un poteau de lampadaire.
  const rootCount = shape === "emergent" ? 6 : shape === "mid" ? 5 : shape === "understory" ? 4 : 3;
  const rootSpread = trunkRadius * (shape === "emergent" ? 5.5 : 4.2);
  const rootPhase = rand() * TAU;
  for (let i = 0; i < rootCount; i++) {
    const angle = rootPhase + (i / rootCount) * TAU + (rand() - 0.5) * 0.5;
    const reach = rootSpread * (0.7 + rand() * 0.6);
    const height = trunkHeight * (0.12 + rand() * 0.1);
    segments.push({
      // Le contrefort naît un peu au-dessus du sol et plonge vers l'extérieur.
      from: [Math.cos(angle) * trunkRadius * 0.5, height, Math.sin(angle) * trunkRadius * 0.5],
      to: [Math.cos(angle) * reach, -0.35, Math.sin(angle) * reach],
      radiusFrom: trunkRadius * (0.55 + rand() * 0.3),
      radiusTo: trunkRadius * 0.12,
      kind: 1,
    });
  }

  /* --- fût : segments empilés, qui s'affinent et s'incurvent -------- */
  const trunkSegments = shape === "emergent" ? 4 : shape === "mid" ? 3 : 2;
  const leanAngle = rand() * TAU;
  const leanAmount = trunkRadius * (0.6 + rand() * 0.8);
  let previous: Vec3 = [0, 0, 0];
  let previousRadius = trunkRadius;
  for (let i = 0; i < trunkSegments; i++) {
    const t = (i + 1) / trunkSegments;
    const y = trunkHeight * t;
    // Inclinaison douce, plus marquée en haut.
    const bend = leanAmount * t * t;
    const wobble = curve(t, leanAngle) * trunkRadius * 0.35 * t;
    const next: Vec3 = [
      Math.cos(leanAngle) * bend + wobble,
      y,
      Math.sin(leanAngle) * bend - wobble,
    ];
    const radius = trunkRadius * (1 - t * 0.68);
    segments.push({
      from: previous,
      to: next,
      radiusFrom: previousRadius,
      radiusTo: radius,
      kind: 0,
    });
    previous = next;
    previousRadius = radius;
  }
  const trunkTop = previous;

  /* --- couronne : les charpentières démarrent dès la moitié basse ---- */
  // C'est le second marqueur de « lampadaire » : un houppier qui ne commence
  // qu'aux neuf dixièmes du fût. Une vraie couronne occupe la moitié haute.
  const branchStart = shape === "emergent" ? 0.52 : shape === "mid" ? 0.46 : shape === "understory" ? 0.4 : 0.16;
  const branchCount = shape === "emergent" ? 6 : shape === "mid" ? 5 : shape === "understory" ? 4 : 3;
  const crownBase = trunkHeight * branchStart;

  /** Ajoute une branche et ses ramifications, puis les grappes au bout. */
  const addBranch = (
    origin: Vec3,
    angle: number,
    length: number,
    rise: number,
    radius: number,
    depth: number,
    parentRadius: number,
  ) => {
    // Une branche s'arque : deux segments suffisent à donner la courbure,
    // et la pointe retombe légèrement sous son propre poids.
    const midRise = rise * 0.8;
    const mid: Vec3 = [
      origin[0] + Math.cos(angle) * length * 0.55,
      origin[1] + length * midRise,
      origin[2] + Math.sin(angle) * length * 0.55,
    ];
    const tip: Vec3 = [
      origin[0] + Math.cos(angle) * length,
      origin[1] + length * rise * 0.85 - length * 0.08 * (depth > 0 ? 0 : 1),
      origin[2] + Math.sin(angle) * length,
    ];
    segments.push({
      from: origin,
      to: mid,
      radiusFrom: radius,
      radiusTo: radius * 0.62,
      kind: depth > 0 ? 3 : 2,
    });
    segments.push({
      from: mid,
      to: tip,
      radiusFrom: radius * 0.62,
      radiusTo: radius * 0.22,
      kind: depth > 0 ? 3 : 2,
    });

    // Grappes : une à la pointe, plus aérées vers l'extérieur du houppier.
    clusters.push({
      at: tip,
      radius: crownScale * (0.32 + rand() * 0.22),
      edge: 1,
    });

    if (depth < 1) {
      const subCount = 3;
      for (let s = 0; s < subCount; s++) {
        const t = 0.45 + rand() * 0.4;
        const subAngle = angle + (rand() - 0.5) * 1.5;
        const subOrigin: Vec3 = [
          origin[0] + (tip[0] - origin[0]) * t,
          origin[1] + (tip[1] - origin[1]) * t,
          origin[2] + (tip[2] - origin[2]) * t,
        ];
        addBranch(
          subOrigin,
          subAngle,
          length * (0.45 + rand() * 0.25),
          rise * (0.7 + rand() * 0.5),
          radius * 0.42,
          depth + 1,
          parentRadius,
        );
      }
    }
  };

  for (let b = 0; b < branchCount; b++) {
    const t = branchStart + (b / Math.max(1, branchCount - 1)) * (0.92 - branchStart);
    const angle = b * 2.39996 + rand() * 0.9; // angle d'or : pas d'étagement régulier
    // Le point d'insertion suit la courbure du fût.
    const bend = leanAmount * t * t;
    const origin: Vec3 = [
      Math.cos(leanAngle) * bend + curve(t, leanAngle) * trunkRadius * 0.35 * t,
      trunkHeight * t,
      Math.sin(leanAngle) * bend - curve(t, leanAngle) * trunkRadius * 0.35 * t,
    ];
    const outward = 0.6 + ((b / branchCount) * 0.7);
    addBranch(
      origin,
      angle,
      crownScale * outward,
      0.12 + rand() * 0.35,
      trunkRadius * (0.42 + rand() * 0.2) * (1 - t * 0.4),
      0,
      trunkRadius,
    );
  }

  /* --- cœur du houppier : quelques grappes hautes qui bouchent le ciel */
  const coreClusters = shape === "emergent" ? 8 : shape === "mid" ? 6 : 4;
  for (let i = 0; i < coreClusters; i++) {
    const a = rand() * TAU;
    const r = crownScale * 0.42 * Math.sqrt(rand());
    clusters.push({
      at: [
        trunkTop[0] + Math.cos(a) * r,
        trunkHeight * (0.82 + rand() * 0.28),
        trunkTop[2] + Math.sin(a) * r,
      ],
      radius: crownScale * (0.5 + rand() * 0.3),
      edge: 0,
    });
  }

  return { segments, clusters, crownBase };
}
