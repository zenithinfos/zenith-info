/**
 * Les Mewas : petits esprits lumineux de la forêt.
 *
 * Dix créatures errent loin du camp. Elles ne s'attrapent pas : on s'approche,
 * elles viennent, on les touche. Chacune offre des Fils de Rêve, la matière des
 * tenues tissées, plus de l'expérience et des points de style.
 *
 * Module pur : ni three, ni DOM. Le rendu lit ces états, et
 * `scripts/check-mewas.mjs` les fait tourner sans navigateur.
 */

export interface MewaState {
  id: number;
  x: number;
  z: number;
  /** Point d'attache : le Mewa y revient quand personne n'est proche. */
  homeX: number;
  homeZ: number;
  collected: boolean;
  /** Décalage d'animation, pour qu'ils ne flottent pas tous en cadence. */
  phase: number;
}

export type MewaRarity = "clair" | "lunaire" | "aube";

export interface MewaReward {
  id: number;
  threads: number;
  xp: number;
  style: number;
  rarity: MewaRarity;
}

export const MEWA_COUNT = 10;
/** Distance à laquelle un Mewa s'intéresse au joueur. */
export const MEWA_APPROACH = 10;
/** Distance de ramassage : au contact, sans touche. */
export const MEWA_CONTACT = 1.15;
/** Aucun Mewa ne naît à moins de 15 m du point de départ. */
export const MEWA_MIN_DISTANCE = 15;
export const MEWA_XP = 40;
export const MEWA_STYLE = 40;

/** Générateur déterministe : la même graine donne toujours la même forêt. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Répartit les Mewas dans la forêt.
 *
 * Ils restent à portée d'exploration — entre 40 et 190 m du camp — mais jamais
 * dans les premiers mètres : les trouver doit demander une marche.
 */
export function spawnMewas(
  seed: number,
  start: [number, number, number],
  count = MEWA_COUNT,
): MewaState[] {
  const random = mulberry32(seed ^ 0x9e3779b9);
  const mewas: MewaState[] = [];
  let guard = 0;
  while (mewas.length < count && guard < 4000) {
    guard += 1;
    const angle = random() * Math.PI * 2;
    const distance = 40 + random() * 150;
    const x = Math.max(-240, Math.min(240, start[0] + Math.cos(angle) * distance));
    const z = Math.max(-240, Math.min(240, start[2] + Math.sin(angle) * distance));
    if (Math.hypot(x - start[0], z - start[2]) < MEWA_MIN_DISTANCE) continue;
    // Deux Mewas ne se marchent pas dessus : 24 m entre eux au moins.
    if (mewas.some((other) => Math.hypot(other.homeX - x, other.homeZ - z) < 24)) continue;
    mewas.push({
      id: mewas.length,
      x,
      z,
      homeX: x,
      homeZ: z,
      collected: false,
      phase: random() * Math.PI * 2,
    });
  }
  return mewas;
}

/** Ce qu'un Mewa laisse dans la main. */
export function mewaReward(id: number): MewaReward {
  // Le nombre de fils est stable pour un Mewa donné : ramasser le même esprit
  // deux fois (après une mort) ne change pas la récompense.
  const hash = Math.abs(Math.sin(id * 127.1 + 11.7) * 43758.5453) % 1;
  const threads = 2 + Math.floor(hash * 3);
  const rarity: MewaRarity = hash > 0.78 ? "aube" : hash > 0.42 ? "lunaire" : "clair";
  return { id, threads, xp: MEWA_XP, style: MEWA_STYLE, rarity };
}

export interface MewaStep {
  mewas: MewaState[];
  collected: MewaReward[];
}

/**
 * Fait vivre les Mewas une image.
 *
 * Comportement : ils flottent autour de leur point d'attache, accélèrent vers
 * le joueur dès qu'il approche à moins de dix mètres, et se laissent ramasser
 * au contact. Une fois ramassé, l'esprit s'éteint — il ne réapparaît pas.
 */
export function stepMewas(
  mewas: MewaState[],
  player: { x: number; z: number },
  dt: number,
  elapsed: number,
): MewaStep {
  const collected: MewaReward[] = [];
  const next = mewas.map((mewa) => {
    if (mewa.collected) return mewa;
    const dx = player.x - mewa.x;
    const dz = player.z - mewa.z;
    const distance = Math.hypot(dx, dz);

    if (distance < MEWA_CONTACT) {
      collected.push(mewaReward(mewa.id));
      return { ...mewa, collected: true, x: player.x, z: player.z };
    }

    if (distance < MEWA_APPROACH) {
      // Il vient, d'autant plus vite qu'on est proche.
      const speed = 1.8 + (1 - distance / MEWA_APPROACH) * 3.4;
      const step = Math.min(distance - MEWA_CONTACT * 0.6, speed * dt);
      return {
        ...mewa,
        x: mewa.x + (dx / (distance || 1)) * step,
        z: mewa.z + (dz / (distance || 1)) * step,
      };
    }

    // Loin de tout : une dérive lente autour du point d'attache.
    const driftX = Math.cos(elapsed * 0.35 + mewa.phase) * 1.6;
    const driftZ = Math.sin(elapsed * 0.27 + mewa.phase * 1.7) * 1.6;
    const targetX = mewa.homeX + driftX;
    const targetZ = mewa.homeZ + driftZ;
    const homeDistance = Math.hypot(targetX - mewa.x, targetZ - mewa.z);
    if (homeDistance < 0.05) return mewa;
    const step = Math.min(homeDistance, 0.9 * dt);
    return {
      ...mewa,
      x: mewa.x + ((targetX - mewa.x) / homeDistance) * step,
      z: mewa.z + ((targetZ - mewa.z) / homeDistance) * step,
    };
  });

  return { mewas: next, collected };
}

/** Combien de Mewas ont été trouvés. */
export function mewasFound(mewas: MewaState[]): number {
  return mewas.filter((mewa) => mewa.collected).length;
}

/** Les Mewas encore visibles, pour la carte et le rendu. */
export function wildMewas(mewas: MewaState[]): MewaState[] {
  return mewas.filter((mewa) => !mewa.collected);
}
