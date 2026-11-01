#!/usr/bin/env node
/**
 * Fabrication des archives de distribution.
 *
 *   node scripts/package-downloads.mjs
 *
 * Produit public/downloads/minkebe-server-<version>.zip : l'archive « Serveur »
 * réellement distribuable (code source complet, sans node_modules ni .next).
 *
 * Les clients Windows / macOS / Android ne peuvent pas être compilés ici : ils
 * demandent Electron, Xcode et le SDK Android. Le script vérifie leur présence
 * dans public/downloads/ et rappelle la commande de production.
 *
 * Écriture ZIP en pur Node (deflate via zlib) : aucune dépendance externe.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "downloads");

const INCLUDE = [
  "src",
  "public",
  "scripts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "drizzle.config.json",
  "README.md",
  "LICENCE",
  ".env.example",
];

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  "downloads",
  "coverage",
  "drizzle/meta",
]);

/* ------------------------------------------------------------------ */
/* Écriture ZIP                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipBuffer(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

/* ------------------------------------------------------------------ */
/* Collecte des fichiers                                               */
/* ------------------------------------------------------------------ */

async function collect(relative, base = ROOT) {
  const absolute = path.join(base, relative);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return [];
  }
  if (info.isFile()) return [{ relative, absolute }];
  if (!info.isDirectory()) return [];

  const subEntries = await readdir(absolute, { withFileTypes: true });
  const results = [];
  for (const entry of subEntries) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      if (childRelative.replace(/\\/g, "/").endsWith("public/downloads")) continue;
      results.push(...(await collect(childRelative, base)));
    } else if (entry.isFile()) {
      if (entry.name === ".DS_Store") continue;
      if (childRelative.replace(/\\/g, "/").endsWith("public/downloads/.gitkeep")) continue;
      results.push({ relative: childRelative, absolute: path.join(base, childRelative) });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Programme principal                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const version = pkg.version ?? "0.0.0";
  const archiveName = `minkebe-server-${version}.zip`;

  const files = [];
  for (const entry of INCLUDE) {
    files.push(...(await collect(entry)));
  }

  if (files.length === 0) {
    console.error("Aucun fichier à archiver.");
    process.exit(1);
  }

  // Un fichier d'installation à la racine de l'archive.
  const guide = Buffer.from(
    [
      "Minkébé — paquet Serveur",
      "========================",
      "",
      `Version ${version}`,
      "",
      "1. npm ci",
      "2. cp .env.example .env   (renseignez DATABASE_URL et ADMIN_TOKEN)",
      "3. npm run db:push",
      "4. npm run build && npm start",
      "",
      "Détails : README.md (section « Héberger un serveur »).",
      "",
    ].join("\n"),
    "utf8",
  );

  const entries = [
    { name: "INSTALLATION.txt", data: guide },
    ...(
      await Promise.all(
        files.map(async (file) => ({
          name: file.relative.replace(/\\/g, "/"),
          data: await readFile(file.absolute),
        })),
      )
    ).sort((a, b) => a.name.localeCompare(b.name)),
  ];

  const archive = zipBuffer(entries);
  const target = path.join(OUT_DIR, archiveName);
  await writeFile(target, archive);

  const sha256 = createHash("sha256").update(archive).digest("hex");
  const sizeMb = (archive.length / 1024 / 1024).toFixed(2);

  console.log(`✓ ${archiveName} — ${entries.length} fichiers, ${sizeMb} Mo`);
  console.log(`  sha256: ${sha256}`);

  // Vérification des clients natifs.
  const clients = [
    ["minkebe-1.4.0-windows.zip", "Electron : npx electron-builder --win"],
    ["minkebe-1.4.0-macos.dmg", "Electron : npx electron-builder --mac"],
    ["minkebe-1.4.0-android.apk", "Capacitor : npx cap build android"],
  ];

  console.log("\nClients natifs :");
  for (const [file, command] of clients) {
    if (existsSync(path.join(OUT_DIR, file))) {
      console.log(`  ✓ ${file}`);
    } else {
      console.log(`  · ${file} absent — à produire avec : ${command}`);
    }
  }

  console.log(
    "\nLes tailles et empreintes sont exposées automatiquement par /api/download.",
  );
}

main().catch((error) => {
  console.error("Échec du packaging :", error);
  process.exit(1);
});
