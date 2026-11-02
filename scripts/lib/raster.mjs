/**
 * Générateur de textures par pixels.
 *
 * Les textures SVG dépendent du moteur de rendu (librsvg ignore une partie des
 * filtres) et ne permettent pas de produire une carte de normales cohérente
 * avec l'albédo. Ici, tout est calculé en JavaScript : bruit tuilable, formes
 * peintes, champ de hauteur, puis normales. Le résultat est déterministe et
 * rigoureusement raccordable (seamless).
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Bruit de valeur périodique : la tuile se raccorde exactement. */
function valueNoise(width, height, cellsX, cellsY, seed) {
  const rand = mulberry32(seed);
  const cx = Math.max(2, Math.round(cellsX));
  const cy = Math.max(2, Math.round(cellsY));
  const grid = new Float32Array(cx * cy);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = (y / height) * cy;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const ya = y0 % cy;
    const yb = (y0 + 1) % cy;
    for (let x = 0; x < width; x++) {
      const fx = (x / width) * cx;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const xa = x0 % cx;
      const xb = (x0 + 1) % cx;
      const v00 = grid[ya * cx + xa];
      const v10 = grid[ya * cx + xb];
      const v01 = grid[yb * cx + xa];
      const v11 = grid[yb * cx + xb];
      const top = v00 + (v10 - v00) * tx;
      const bottom = v01 + (v11 - v01) * tx;
      out[y * width + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/** Fractal de bruit de valeur, normalisé dans [0, 1]. */
export function fbm(width, height, { freq = 4, octaves = 4, seed = 1, persistence = 0.5, stretchX = 1, stretchY = 1 } = {}) {
  const out = new Float32Array(width * height);
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = freq * 2 ** o;
    const layer = valueNoise(width, height, f * stretchX, f * stretchY, seed + o * 977);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amplitude;
    total += amplitude;
    amplitude *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Carte couleur : canaux linéaires [0, 1]. */
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height * 3);
    this.height_ = new Float32Array(width * height);
    this.cover = new Float32Array(width * height);
  }

  fill([r, g, b]) {
    for (let i = 0; i < this.width * this.height; i++) {
      this.data[i * 3] = r;
      this.data[i * 3 + 1] = g;
      this.data[i * 3 + 2] = b;
    }
  }

  /** Multiplication douce du pixel (garde les détails déjà peints). */
  multiply(x, y, factor) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] *= factor;
    this.data[i + 1] *= factor;
    this.data[i + 2] *= factor;
  }

  /** Peint un pixel avec transparence, en respectant le raccord. */
  blend(x, y, [r, g, b], alpha) {
    if (alpha <= 0) return;
    const px = ((x % this.width) + this.width) % this.width;
    const py = ((y % this.height) + this.height) % this.height;
    const i = (py * this.width + px) * 3;
    const a = Math.min(1, alpha);
    this.data[i] += (r - this.data[i]) * a;
    this.data[i + 1] += (g - this.data[i + 1]) * a;
    this.data[i + 2] += (b - this.data[i + 2]) * a;
  }

  /** Marque la hauteur (pour la carte de normales) par max, comme une matière posée. */
  raise(x, y, height, alpha = 1) {
    const px = ((x % this.width) + this.width) % this.width;
    const py = ((y % this.height) + this.height) % this.height;
    const i = py * this.width + px;
    this.height_[i] = Math.max(this.height_[i], height * alpha);
    this.cover[i] = Math.min(1, this.cover[i] + alpha);
  }
}

const hslToRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
};

/** Feuille morte : losange pointu, nervure plus sombre, léger galbe. */
export function paintLeaf(canvas, { x, y, length, width, angle, colour, alpha = 0.9, height = 0.35, rib = 0.55 }) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfL = length / 2;
  const halfW = width / 2;
  const reach = Math.ceil(halfL + 2);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      // Repère de la feuille.
      const u = (dx * cos + dy * sin) / halfL;
      const v = (-dx * sin + dy * cos) / halfW;
      if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
      // Profil : large au tiers, pointu aux deux bouts.
      const profile = Math.pow(Math.max(0, 1 - u * u), 0.62) * (0.82 + 0.18 * Math.sin(u * Math.PI));
      if (Math.abs(v) > profile) continue;
      const edge = Math.min(1, (profile - Math.abs(v)) / 0.28);
      // Nervure centrale sombre, bords très légèrement plus clairs.
      const isRib = Math.abs(v) < 0.13 && u < 0.75;
      const shade = isRib ? rib : 0.92 + 0.16 * Math.abs(v);
      const px = x + dx;
      const py = y + dy;
      canvas.blend(
        px,
        py,
        [colour[0] * shade, colour[1] * shade, colour[2] * shade],
        alpha * Math.min(1, edge + 0.35),
      );
      canvas.raise(px, py, height * (0.6 + 0.4 * (1 - Math.abs(v))));
    }
  }
}

/** Brindille ou racine : segment effilé. */
export function paintTwig(canvas, { x, y, x2, y2, thickness, colour, alpha = 0.9, height = 0.5 }) {
  const steps = Math.ceil(Math.hypot(x2 - x, y2 - y));
  for (let s = 0; s <= steps; s++) {
    const t = s / Math.max(1, steps);
    const cx = x + (x2 - x) * t;
    const cy = y + (y2 - y) * t;
    const r = (thickness / 2) * (1 - t * 0.45);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r + 0.5) continue;
        const shade = 0.85 + 0.3 * (1 - d / Math.max(0.6, r));
        canvas.blend(
          Math.round(cx + dx),
          Math.round(cy + dy),
          [colour[0] * shade, colour[1] * shade, colour[2] * shade],
          alpha,
        );
        canvas.raise(Math.round(cx + dx), Math.round(cy + dy), height);
      }
    }
  }
}

/** Caillou : disque bombé, éclat en haut à gauche. */
export function paintStone(canvas, { x, y, radius, colour, alpha = 1 }) {
  const r = Math.ceil(radius) + 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy) / radius;
      if (d > 1) continue;
      // Éclairage venant du haut-gauche, comme le soleil de la scène.
      const nx = dx / radius;
      const ny = dy / radius;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lambert = 0.55 + 0.55 * Math.max(0, -nx * 0.5 - ny * 0.5 + nz * 0.7);
      canvas.blend(
        Math.round(x + dx),
        Math.round(y + dy),
        [colour[0] * lambert, colour[1] * lambert, colour[2] * lambert],
        alpha,
      );
      canvas.raise(Math.round(x + dx), Math.round(y + dy), 0.55 + 0.45 * nz);
    }
  }
}

/** Mousse : taches douces teintées vert. */
export function paintMoss(canvas, mask, { hue = 96, sat = 0.34, light = 0.16, amount = 0.55 }) {
  const [r, g, b] = hslToRgb(hue, sat, light);
  for (let i = 0; i < canvas.width * canvas.height; i++) {
    const m = mask[i];
    if (m <= 0.05) continue;
    const a = Math.min(1, (m - 0.05) * amount * 2.2);
    const x = i % canvas.width;
    const y = (i - x) / canvas.width;
    canvas.blend(x, y, [r, g, b], a);
  }
}

/** Carte de normales tangente à partir du champ de hauteur. */
export function normalMap(canvas, strength = 2.2) {
  const { width, height, height_ } = canvas;
  const data = Buffer.alloc(width * height * 3);
  const at = (x, y) => height_[(((y % height) + height) % height) * width + (((x % width) + width) % width)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Normale (-dx, -dy, 1) normalisée, encodée en 0..255.
      const len = Math.hypot(dx, dy, 1);
      const i = (y * width + x) * 3;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
    }
  }
  return data;
}

/** Sortie RGB 8 bits, avec correction gamma optionnelle. */
export function toPixels(canvas, { gamma = 1 } = {}) {
  const { width, height, data } = canvas;
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.max(0, Math.min(1, data[i * 3 + c]));
      out[i * 3 + c] = Math.round((gamma === 1 ? v : v ** gamma) * 255);
    }
  }
  return out;
}

export { hslToRgb };
