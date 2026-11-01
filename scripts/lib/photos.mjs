/**
 * Photographies sources de la forêt.
 *
 * Autrefois ces textures étaient des SVG dessinés à la main : aplats, pas de
 * matière — le rendu sonnait « dessin animé ». Elles sont maintenant dérivées
 * de photographies (générées puis retravaillées ici), ce qui est la seule
 * façon d'obtenir un rendu photoréaliste.
 *
 * Le fichier source vit dans `assets/raw/`. Le script de finition en tire :
 *   · une carte d'albédo (sRGB, tuilable, sans liseré blanc),
 *   · une carte de normales dérivée du relief photographique,
 *   · une carte d'opacité pour les feuillages (découpe alpha propre).
 *
 * Usage : `npm run assets` — voir scripts/gen-assets.mjs.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Canvas, fbm, normalMap } from "./raster.mjs";

const RAW = path.join(process.cwd(), "assets", "raw");

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

/** Rend une image strictement tuilable en repliant ses bords (fondu croisé). */
async function makeTileable(input, { blend = 0.14 } = {}) {
  const image = sharp(input);
  const { width, height } = await image.metadata();
  const w = width;
  const h = height;
  const m = Math.round(Math.min(w, h) * blend);

  const { data: pixels } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(pixels);

  // Fondu croisé : les m pixels du bord gauche sont mélangés avec ceux du bord
  // droit (et haut/bas). Le raccord devient invisible.
  const at = (x, y, c) => (y * w + x) * 4 + c;
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < m; i++) {
      const t = i / m;
      // horizontale
      for (let c = 0; c < 4; c++) {
        const left = pixels[at(i, y, c)];
        const right = pixels[at(w - m + i, y, c)];
        out[at(i, y, c)] = Math.round(left * (1 - t * 0.5) + right * (t * 0.5));
        out[at(w - m + i, y, c)] = Math.round(right * (1 - (1 - t) * 0.5) + left * ((1 - t) * 0.5));
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let i = 0; i < m; i++) {
      const t = i / m;
      for (let c = 0; c < 4; c++) {
        const top = out[at(x, i, c)];
        const bottom = out[at(x, h - m + i, c)];
        out[at(x, i, c)] = Math.round(top * (1 - t * 0.5) + bottom * (t * 0.5));
        out[at(x, h - m + i, c)] = Math.round(bottom * (1 - (1 - t) * 0.5) + top * ((1 - t) * 0.5));
      }
    }
  }

  // PNG : un buffer brut ne serait pas reconnu par les appels suivants.
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * Carte de normales dérivée de la luminance photographique.
 * On lisse d'abord pour ne pas transformer le grain du capteur en relief.
 */
async function normalFromLuminance(image, { blur = 1.1, strength = 3.2, tile = true } = {}) {
  const { data, info } = await image
    .clone()
    .greyscale()
    .blur(blur)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const canvas = new Canvas(width, height);
  for (let i = 0; i < width * height; i++) {
    canvas.height_[i] = data[i * channels] / 255;
  }
  const normals = normalMap(canvas, strength);
  // La normales doit rester tuilable si la couleur l'est : normalMap boucle
  // déjà sur les bords, rien de plus à faire.
  void tile;
  return normals;
}

/** Écrit albédo + normale dans public/textures, en JPEG optimisé. */
async function writeMaps(dir, name, albedo, normals, { quality = 84, normalQuality = 72, log } = {}) {
  const { width, height } = await albedo.metadata();
  const albedoOut = await albedo.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
  // Normales à mi-résolution : le relief d'une photo de sol ou d'écorce est
  // basse fréquence, une carte pleine résolution ne pèse que du bruit.
  const normalOut = await sharp(Buffer.from(normals), {
    raw: { width, height, channels: 3 },
  })
    .resize(Math.round(width / 2), Math.round(height / 2), { fit: "fill" })
    .jpeg({ quality: normalQuality, mozjpeg: true })
    .toBuffer();
  await writeFile(path.join(dir, `${name}.jpg`), albedoOut);
  await writeFile(path.join(dir, `${name}_normal.jpg`), normalOut);
  log(
    `✓ textures/${name}.jpg + ${name}_normal.jpg — album ${Math.round(albedoOut.length / 1024)} Ko, normale ${Math.round(normalOut.length / 1024)} Ko`,
  );
}

/* ------------------------------------------------------------------ */
/* Découpe d'une planche de feuillage                                  */
/* ------------------------------------------------------------------ */

/**
 * Découpe une photo de feuillage sur fond clair en carte alpha-testée.
 *
 * Un simple seuil laisserait un liseré blanc (le fond se mélange aux feuilles
 * sur les bords). On détoure donc progressivement : les pixels clairs
 * deviennent transparents, et les pixels de bord prennent la couleur de la
 * feuille voisine pour éviter le halo.
 */
async function cutout(image, { threshold = 232, feather = 26 } = {}) {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.from(data);

  // Distance au fond clair : min(r,g,b) suffit, un fond studio est neutre.
  const alphaAt = (i) => {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const value = Math.min(r, g, b) * 0.55 + ((r + g + b) / 3) * 0.45;
    if (value >= threshold) return 0;
    if (value <= threshold - feather) return 255;
    const t = (threshold - value) / feather;
    return Math.round(t * 255);
  };

  const alphas = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) alphas[i] = alphaAt(i);

  // Congélation de la couleur : les pixels semi-transparents prennent la
  // teinte d'un pixel opaque voisin. C'est ce qui supprime le liseré blanc.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = alphas[i];
      out[i * 4 + 3] = a;
      if (a === 255) continue;
      if (a === 0) {
        out[i * 4] = 0;
        out[i * 4 + 1] = 0;
        out[i * 4 + 2] = 0;
        continue;
      }
      // Voisin opaque le plus proche dans un rayon de 3 px.
      let found = false;
      for (let radius = 1; radius <= 3 && !found; radius++) {
        for (let dy = -radius; dy <= radius && !found; dy++) {
          for (let dx = -radius; dx <= radius && !found; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (alphas[ni] < 250) continue;
            out[i * 4] = data[ni * 4];
            out[i * 4 + 1] = data[ni * 4 + 1];
            out[i * 4 + 2] = data[ni * 4 + 2];
            found = true;
          }
        }
      }
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).trim({ threshold: 1 });
}

/**
 * Adoucit une carte de feuillage : fondu radial vers les bords et morsure de
 * bruit sur le contour.
 *
 * Une planche photographique remplit tout le cadre : collée telle quelle sur
 * un plan, elle donne un rectangle vert aux bords nets, ce qui trahit
 * immédiatement le décor. Une vraie carte de feuillage est dense au centre et
 * s'effiloche vers les bords.
 */
async function softenEdges(input, { edge = 0.52, bite = 0.34, seed = 77 } = {}) {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const noise = fbm(width, height, { freq: 7, octaves: 4, seed });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (data[i * 4 + 3] === 0) continue;
      // Distance normalisée au centre, en tenant compte du format.
      const nx = (x / width - 0.5) * 2;
      const ny = (y / height - 0.5) * 2;
      const d = Math.min(1, Math.sqrt(nx * nx * 0.85 + ny * ny * 0.85));
      // Décroissance douce : opaque jusqu'à 60 % du rayon, puis effiloché.
      const falloff = 1 - Math.max(0, (d - (1 - edge)) / edge) ** 1.6;
      // Morsure de bruit forte en bordure : la silhouette devient dentelée,
      // comme des feuilles qui dépassent d'une masse.
      const biteAt = noise[i] * bite;
      const keep = falloff - biteAt * Math.pow(d, 1.5) * 2.4;
      if (keep < 0.5) data[i * 4 + 3] = 0;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } });
}

/** Empaquette une carte découpée en PNG palette (4× plus léger qu'un RGBA). */
async function packCutout(input, file) {
  // Le PNG palette perd l'alpha progressif : on garde un alpha binaire net,
  // ce qui est de toute façon le fonctionnement d'alphaTest.
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i++) {
    data[i * 4 + 3] = data[i * 4 + 3] > 128 ? 255 : 0;
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: true, colors: 200, effort: 9 })
    .toBuffer();
  await writeFile(path.join(process.cwd(), "public", "textures", file), png);
  return png.length;
}

/* ------------------------------------------------------------------ */
/* Plan de production                                                  */
/* ------------------------------------------------------------------ */

/**
 * Génère toutes les textures photographiques.
 * Chaque entrée dit d'où vient la photo et ce qu'on en fait.
 */
export async function generatePhotoTextures({ publicDir, force = false, log = console.log } = {}) {
  const dir = path.join(publicDir, "textures");
  await mkdir(dir, { recursive: true });

  const missing = (name) => force || !existsSync(path.join(dir, name));
  const raw = (file) => path.join(RAW, file);

  /* --- sol : litière de feuilles mortes --------------------------- */
  if (missing("ground.jpg")) {
    const tiled = await makeTileable(raw("ground.jpg"), { blend: 0.16 });
    const albedo = sharp(await sharp(tiled).resize(1024, 1024, { fit: "fill" }).png().toBuffer());
    const normals = await normalFromLuminance(albedo, { strength: 3.4, blur: 1.0 });
    await writeMaps(dir, "ground", albedo, normals, { quality: 82, log });
  } else {
    log("· textures/ground.jpg existe déjà");
  }

  /* --- écorce ------------------------------------------------------ */
  if (missing("bark.jpg")) {
    const tiled = await makeTileable(raw("bark.jpg"), { blend: 0.16 });
    const albedo = sharp(await sharp(tiled).resize(512, 1024, { fit: "fill" }).png().toBuffer());
    const normals = await normalFromLuminance(albedo, { strength: 4.2, blur: 0.9 });
    await writeMaps(dir, "bark", albedo, normals, { quality: 82, log });
  } else {
    log("· textures/bark.jpg existe déjà");
  }

  /* --- feuillage : carte de houppier vue du dessous --------------- */
  // Elle sert deux fois : sur les cartes de houppier, et comme plafond de
  // canopée (avec les trous de lumière que la photo contient déjà).
  if (missing("canopy.png")) {
    const tiled = await makeTileable(raw("canopy.jpg"), { blend: 0.12 });
    const albedo = await sharp(tiled).resize(768, 768, { fit: "fill" }).png().toBuffer();
    const png = await sharp(albedo)
      .png({ compressionLevel: 9, palette: true, colors: 192, effort: 9 })
      .toBuffer();
    await writeFile(path.join(dir, "canopy.png"), png);
    log(`✓ textures/canopy.png — canopée photographique (${Math.round(png.length / 1024)} Ko)`);

    const normals = await normalFromLuminance(sharp(albedo), { strength: 2.6, blur: 1.2 });
    const normalOut = await sharp(Buffer.from(normals), {
      raw: { width: 768, height: 768, channels: 3 },
    })
      .resize(384, 384, { fit: "fill" })
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();
    await writeFile(path.join(dir, "canopy_normal.jpg"), normalOut);
    log(`✓ textures/canopy_normal.jpg — normales de canopée (${Math.round(normalOut.length / 1024)} Ko)`);
  } else {
    log("· textures/canopy.png existe déjà");
  }

  /* --- feuillage : cartes découpées ------------------------------- */
  const CUTOUTS = [
    { raw: "leaves.jpg", file: "foliage.png", size: 768, threshold: 238, feather: 30 },
    { raw: "leaves-dark.jpg", file: "foliage-deep.png", size: 768, threshold: 238, feather: 30 },
    { raw: "fern.jpg", file: "fern.png", size: 768, threshold: 242, feather: 24, soft: false },
    { raw: "bigleaf.jpg", file: "bigleaf.png", size: 768, threshold: 240, feather: 28 },
    { raw: "grass.jpg", file: "grass.png", size: 640, threshold: 240, feather: 26, soft: false },
  ];

  /* --- variantes dérivées des photos (jamais du vectoriel) ---------- */
  // Feuillage de lumière : mêmes feuilles, éclaircies et réchauffées comme
  // celles qui touchent une trouée. Copie retouchée de la photo, pas un dessin.
  if (existsSync(path.join(dir, "foliage.png")) && missing("foliage-pale.png")) {
    const source = sharp(path.join(dir, "foliage.png"));
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * 4 + 3] === 0) continue;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      // Éclaircissement + virage vers le jaune-vert des feuilles au soleil.
      data[i * 4] = Math.min(255, luma * 1.32 + 18);
      data[i * 4 + 1] = Math.min(255, luma * 1.46 + 26);
      data[i * 4 + 2] = Math.min(255, luma * 1.02 + 6);
    }
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9, palette: true, colors: 200, effort: 9 })
      .toBuffer();
    await writeFile(path.join(dir, "foliage-pale.png"), png);
    log(`✓ textures/foliage-pale.png — dérivé photo (${Math.round(png.length / 1024)} Ko)`);

    const canvas = new Canvas(info.width, info.height);
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * 4 + 3] < 40) continue;
      canvas.height_[i] =
        (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    }
    const nrm = await sharp(Buffer.from(normalMap(canvas, 3.0)), {
      raw: { width: info.width, height: info.height, channels: 3 },
    })
      .resize(Math.round(info.width / 2), Math.round(info.height / 2), { fit: "fill" })
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();
    await writeFile(path.join(dir, "foliage-pale_normal.jpg"), nrm);
    log(`✓ textures/foliage-pale_normal.jpg — normales (${Math.round(nrm.length / 1024)} Ko)`);
  }

  // Feuilles éparses : la même photo, évidée par un bruit fractal. Le ciel
  // passe entre les feuilles, ce qu'une masse pleine ne permet pas.
  if (existsSync(path.join(dir, "foliage.png")) && missing("spray.png")) {
    const source = sharp(path.join(dir, "foliage.png"));
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const holes = fbm(info.width, info.height, { freq: 5, octaves: 4, seed: 4242 });
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * 4 + 3] === 0) continue;
      // Les zones où le bruit est fort sont évidées : 38 % de la carte environ.
      if (holes[i] > 0.545) data[i * 4 + 3] = 0;
      else data[i * 4 + 3] = data[i * 4 + 3] > 128 ? 255 : 0;
    }
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9, palette: true, colors: 200, effort: 9 })
      .toBuffer();
    await writeFile(path.join(dir, "spray.png"), png);
    log(`✓ textures/spray.png — feuilles éparses dérivées photo (${Math.round(png.length / 1024)} Ko)`);
  }

  for (const spec of CUTOUTS) {
    const source = raw(spec.raw);
    if (!existsSync(source)) {
      log(`· assets/raw/${spec.raw} absent — ${spec.file} inchangé`);
      continue;
    }
    if (!missing(spec.file)) {
      log(`· textures/${spec.file} existe déjà`);
      continue;
    }
    const prepared = sharp(source).resize(spec.size, spec.size, { fit: "cover" });
    const cut = await cutout(prepared, { threshold: spec.threshold, feather: spec.feather });
    // Les fougères et l'herbe ont une silhouette naturelle détachée : pas
    // besoin de les effilocher. Les cartes de houppier, si.
    const softened = spec.soft === false ? cut : await softenEdges(cut, { seed: spec.size });
    const bytes = await packCutout(softened, spec.file);
    log(`✓ textures/${spec.file} — découpe photographique (${Math.round(bytes / 1024)} Ko)`);

    // Normale de la feuille, déduite de sa luminance.
    const { data: lum, info } = await sharp(path.join(dir, spec.file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const canvas = new Canvas(info.width, info.height);
    for (let i = 0; i < info.width * info.height; i++) {
      if (lum[i * 4 + 3] < 40) continue;
      canvas.height_[i] =
        (0.299 * lum[i * 4] + 0.587 * lum[i * 4 + 1] + 0.114 * lum[i * 4 + 2]) / 255;
    }
    const normals = normalMap(canvas, 3.0);
    const normalFile = spec.file.replace(/\.png$/, "_normal.jpg");
    const out = await sharp(Buffer.from(normals), {
      raw: { width: info.width, height: info.height, channels: 3 },
    })
      .resize(Math.round(info.width / 2), Math.round(info.height / 2), { fit: "fill" })
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();
    await writeFile(path.join(dir, normalFile), out);
    log(`✓ textures/${normalFile} — normales (${Math.round(out.length / 1024)} Ko)`);
  }
}
