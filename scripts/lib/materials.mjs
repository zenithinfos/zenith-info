/**
 * Matières de la forêt : sol et écorce, peints au pixel.
 *
 * Chaque matière produit un albédo et une carte de normales issues du même
 * champ de hauteur, ce qui évite l'aspect « texture collée » : les reliefs de
 * la normales correspondent exactement aux feuilles, cailloux et crevasses de
 * l'albédo.
 */

import {
  Canvas,
  fbm,
  hslToRgb,
  mulberry32,
  normalMap,
  paintLeaf,
  paintMoss,
  paintStone,
  paintTwig,
  toPixels,
} from "./raster.mjs";

/* ------------------------------------------------------------------ */
/* Sol : litière de feuilles, racines, cailloux, mousse                 */
/* ------------------------------------------------------------------ */

export function groundMaps({ size = 1024, seed = 9 } = {}) {
  const rand = mulberry32(seed);
  const canvas = new Canvas(size, size);

  // --- terre de fond : deux sols, l'humus noir des cuvettes et la terre
  // brun-roux des pentes. Sur un sol de forêt, tout est sombre : c'est le
  // contraste avec les feuilles mortes clairsemées qui fait la matière.
  const damp = fbm(size, size, { freq: 3, octaves: 5, seed, persistence: 0.55 });
  const humus = fbm(size, size, { freq: 11, octaves: 4, seed: seed + 41 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = Math.min(1, Math.max(0, (damp[i] - 0.28) * 1.7));
      const r = 0.105 + t * 0.115 + humus[i] * 0.035;
      const g = 0.082 + t * 0.082 + humus[i] * 0.028;
      const b = 0.056 + t * 0.05 + humus[i] * 0.021;
      canvas.data[i * 3] = r;
      canvas.data[i * 3 + 1] = g;
      canvas.data[i * 3 + 2] = b;
      canvas.height_[i] = humus[i] * 0.14;
    }
  }

  // --- litière : des milliers de feuilles, mais serrées et peu contrastées.
  // Le but n'est pas de les distinguer une à une, c'est de former un tapis.
  const palette = [
    [0.2, 0.14, 0.075],
    [0.26, 0.185, 0.1],
    [0.17, 0.13, 0.08],
    [0.3, 0.215, 0.11],
    [0.22, 0.19, 0.1],
    [0.14, 0.115, 0.075],
    [0.34, 0.25, 0.12],
  ];
  for (let i = 0; i < 2600; i++) {
    // Une feuille sur douze seulement est claire : ce sont celles qui
    // accrochent la lumière et donnent la lecture du tapis.
    const pale = rand() < 0.085;
    const base = pale ? palette[6] : palette[Math.floor(rand() * 6)];
    const colour = base.map((c) => c * (0.82 + rand() * 0.36));
    paintLeaf(canvas, {
      x: Math.floor(rand() * size),
      y: Math.floor(rand() * size),
      length: size * (0.01 + Math.pow(rand(), 1.6) * 0.042),
      width: size * (0.004 + rand() * 0.014),
      angle: rand() * Math.PI * 2,
      colour,
      alpha: 0.55 + rand() * 0.45,
      height: 0.2 + rand() * 0.18,
      rib: 0.8,
    });
  }

  // --- brindilles et petites racines
  for (let i = 0; i < 190; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const angle = rand() * Math.PI * 2;
    const len = size * (0.02 + Math.pow(rand(), 1.6) * 0.11);
    paintTwig(canvas, {
      x,
      y,
      x2: x + Math.cos(angle) * len,
      y2: y + Math.sin(angle) * len,
      thickness: size * (0.002 + rand() * 0.0045),
      colour: [0.115 + rand() * 0.06, 0.082 + rand() * 0.04, 0.048 + rand() * 0.025],
      alpha: 0.85,
      height: 0.36 + rand() * 0.18,
    });
  }

  // --- cailloux : rares, sombres, posés dans la terre
  for (let i = 0; i < 34; i++) {
    paintStone(canvas, {
      x: rand() * size,
      y: rand() * size,
      radius: size * (0.005 + Math.pow(rand(), 2) * 0.014),
      colour: [0.17 + rand() * 0.08, 0.16 + rand() * 0.07, 0.135 + rand() * 0.06],
      alpha: 0.9,
    });
  }

  // --- mousse : discrète, surtout dans les creux
  const mossMask = fbm(size, size, { freq: 5, octaves: 4, seed: seed + 17, stretchX: 1.7 });
  for (let i = 0; i < mossMask.length; i++) {
    mossMask[i] = Math.max(0, mossMask[i] - 0.54) * 2.2;
  }
  paintMoss(canvas, mossMask, { hue: 96, sat: 0.34, light: 0.1, amount: 0.55 });

  // --- grain fin : sable, brindilles écrasées
  const grain = fbm(size, size, { freq: 64, octaves: 3, seed: seed + 71 });
  for (let i = 0; i < size * size; i++) {
    const g = 0.9 + grain[i] * 0.2;
    canvas.data[i * 3] *= g;
    canvas.data[i * 3 + 1] *= g;
    canvas.data[i * 3 + 2] *= g;
    canvas.height_[i] += grain[i] * 0.05;
  }

  // --- ombres larges : le tapis n'est jamais uniformément éclairé
  const shade = fbm(size, size, { freq: 2, octaves: 4, seed: seed + 101 });
  for (let i = 0; i < size * size; i++) {
    const s = 0.72 + shade[i] * 0.5;
    canvas.data[i * 3] *= s;
    canvas.data[i * 3 + 1] *= s;
    canvas.data[i * 3 + 2] *= s;
  }

  return {
    width: size,
    height: size,
    albedo: toPixels(canvas, { gamma: 0.95 }),
    normal: normalMap(canvas, size * 0.05),
  };
}

/* ------------------------------------------------------------------ */
/* Écorce : fibres, crevasses, lenticelles, lichens                     */
/* ------------------------------------------------------------------ */

export function barkMaps({ width = 512, height = 1024, seed = 3 } = {}) {
  const rand = mulberry32(seed);
  const canvas = new Canvas(width, height);

  // --- fibres verticales : bruit fortement étiré le long du fût
  const fibres = fbm(width, height, {
    freq: 7,
    octaves: 6,
    seed,
    persistence: 0.58,
    stretchX: 4,
    stretchY: 0.22,
  });
  const blotch = fbm(width, height, { freq: 2, octaves: 4, seed: seed + 13 });
  // Plaques : grosses écailles qui cassent la régularité des fibres.
  const plates = fbm(width, height, { freq: 9, octaves: 3, seed: seed + 97, stretchX: 1.6, stretchY: 0.9 });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // Écorce grise-brune : les troncs de terre ferme ne sont pas noirs.
      const f = fibres[i];
      // Écorce gris-brun sombre : le tronc doit lire comme une silhouette,
      // ce sont les liserés clairs des crevasses qui donnent le volume.
      const base = 0.075 + f * 0.15 + blotch[i] * 0.06 + plates[i] * 0.035;
      const hue = 24 + f * 12;
      const [r, g, b] = hslToRgb(hue, 0.18 + f * 0.14, Math.min(0.42, base));
      canvas.data[i * 3] = r;
      canvas.data[i * 3 + 1] = g;
      canvas.data[i * 3 + 2] = b;
      canvas.height_[i] = f * 0.45 + plates[i] * 0.25;
    }
  }

  // --- crevasses : lignes verticales sinueuses, avec un liseré éclairé
  for (let i = 0; i < 46; i++) {
    const x = rand() * width;
    const w = width * (0.004 + rand() * 0.012);
    const dark = rand() < 0.62;
    const wobble = width * (0.005 + rand() * 0.02);
    const phase = rand() * 6.28;
    for (let y = 0; y < height; y++) {
      const t = y / height;
      // Deux sinusoïdes de périodes entières : la ligne se raccorde en haut/bas.
      const cx = x + Math.sin(t * Math.PI * 2 + phase) * wobble + Math.sin(t * Math.PI * 6) * wobble * 0.4;
      for (let d = -w; d <= w; d++) {
        const edge = Math.abs(d) / w;
        if (edge > 1) continue;
        const px = Math.round(cx + d);
        const i2 = (((y % height) + height) % height) * width + (((px % width) + width) % width);
        const soft = 1 - edge * edge;
        if (dark) {
          const k = 1 - soft * 0.55;
          canvas.data[i2 * 3] *= k;
          canvas.data[i2 * 3 + 1] *= k;
          canvas.data[i2 * 3 + 2] *= k;
          canvas.height_[i2] = Math.max(0, canvas.height_[i2] - soft * 0.35);
        } else {
          // Liseré clair côté lumière.
          const k = 1 + soft * 0.55;
          canvas.data[i2 * 3] = Math.min(1, canvas.data[i2 * 3] * k);
          canvas.data[i2 * 3 + 1] = Math.min(1, canvas.data[i2 * 3 + 1] * k);
          canvas.data[i2 * 3 + 2] = Math.min(1, canvas.data[i2 * 3 + 2] * k);
        }
      }
    }
  }

  // --- lenticelles : petits traits horizontaux caractéristiques
  for (let i = 0; i < 260; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const len = width * (0.004 + rand() * 0.014);
    const thickness = Math.max(1, width * 0.003 * (0.6 + rand()));
    const light = rand() < 0.5;
    for (let d = -len / 2; d <= len / 2; d++) {
      for (let t = -thickness; t <= thickness; t++) {
        const px = Math.round(x + d);
        const py = Math.round(y + t);
        const i2 = (((py % height) + height) % height) * width + (((px % width) + width) % width);
        const k = light ? 1.18 : 0.82;
        canvas.data[i2 * 3] = Math.min(1, canvas.data[i2 * 3] * k);
        canvas.data[i2 * 3 + 1] = Math.min(1, canvas.data[i2 * 3 + 1] * k);
        canvas.data[i2 * 3 + 2] = Math.min(1, canvas.data[i2 * 3 + 2] * k);
      }
    }
  }

  // --- lichens : plaques pâles, vert-de-gris, irrégulières
  const lichenMask = fbm(width, height, { freq: 7, octaves: 4, seed: seed + 29, stretchX: 1.4, stretchY: 0.7 });
  const lichenTint = [0.52, 0.56, 0.44];
  for (let i = 0; i < width * height; i++) {
    const m = Math.max(0, lichenMask[i] - 0.6) * 2.4;
    if (m <= 0.02) continue;
    const a = Math.min(0.72, m);
    canvas.data[i * 3] += (lichenTint[0] - canvas.data[i * 3]) * a;
    canvas.data[i * 3 + 1] += (lichenTint[1] - canvas.data[i * 3 + 1]) * a;
    canvas.data[i * 3 + 2] += (lichenTint[2] - canvas.data[i * 3 + 2]) * a;
    canvas.height_[i] += a * 0.12;
  }

  // --- mousse : surtout vers le bas du fût (l'humidité remonte)
  const mossMask = fbm(width, height, { freq: 5, octaves: 4, seed: seed + 53, stretchX: 1.2, stretchY: 0.9 });
  const mossTint = [0.24, 0.33, 0.16];
  for (let y = 0; y < height; y++) {
    const damp = Math.pow(1 - y / height, 2.2);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const m = Math.max(0, mossMask[i] - 0.52) * 2 * damp;
      if (m <= 0.02) continue;
      const a = Math.min(0.8, m);
      canvas.data[i * 3] += (mossTint[0] - canvas.data[i * 3]) * a;
      canvas.data[i * 3 + 1] += (mossTint[1] - canvas.data[i * 3 + 1]) * a;
      canvas.data[i * 3 + 2] += (mossTint[2] - canvas.data[i * 3 + 2]) * a;
    }
  }

  return {
    width,
    height,
    albedo: toPixels(canvas, { gamma: 0.92 }),
    normal: normalMap(canvas, width * 0.09),
  };
}
