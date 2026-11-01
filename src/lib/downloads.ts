import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { db, hasDatabase } from "@/db";
import { downloadEvents } from "@/db/schema";
import type { GamePackage } from "./distribution";

/**
 * Fichiers de distribution : lecture des archives produites par
 * `npm run package` dans public/downloads/, empreintes sha256 et journal des
 * téléchargements.
 */

export const DOWNLOAD_DIR = path.join(process.cwd(), "public", "downloads");

export interface ArtifactInfo {
  id: string;
  filename: string;
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  sha256: string | null;
}

const hashCache = new Map<string, { size: number; sha256: string }>();

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function inspectArtifact(pkg: GamePackage): Promise<ArtifactInfo> {
  const filePath = path.join(DOWNLOAD_DIR, pkg.filename);
  try {
    const info = await stat(filePath);
    const cached = hashCache.get(filePath);
    let sha256: string;
    if (cached && cached.size === info.size) {
      sha256 = cached.sha256;
    } else {
      sha256 = await sha256File(filePath);
      hashCache.set(filePath, { size: info.size, sha256 });
    }
    return {
      id: pkg.id,
      filename: pkg.filename,
      path: filePath,
      exists: true,
      sizeBytes: info.size,
      sha256,
    };
  } catch {
    return {
      id: pkg.id,
      filename: pkg.filename,
      path: filePath,
      exists: false,
      sizeBytes: null,
      sha256: null,
    };
  }
}

export async function inspectAll(packages: GamePackage[]): Promise<ArtifactInfo[]> {
  return Promise.all(packages.map(inspectArtifact));
}

const memoryLog: { packageId: string; version: string; at: Date; served: boolean }[] = [];

export async function logDownload(input: {
  packageId: string;
  platform?: string | null;
  version: string;
  userAgent?: string | null;
  ip?: string | null;
  served: boolean;
}): Promise<void> {
  const ipHash = input.ip
    ? createHash("sha256").update(input.ip).digest("hex").slice(0, 16)
    : null;

  if (!db || !hasDatabase()) {
    memoryLog.push({
      packageId: input.packageId,
      version: input.version,
      at: new Date(),
      served: input.served,
    });
    if (memoryLog.length > 500) memoryLog.shift();
    return;
  }

  try {
    await db.insert(downloadEvents).values({
      packageId: input.packageId,
      platform: input.platform ?? null,
      version: input.version,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      ipHash,
      served: input.served,
    });
  } catch (error) {
    console.error("[downloads] journalisation impossible :", error);
  }
}

export function recentDownloads(limit = 20) {
  return memoryLog.slice(-limit).reverse();
}

/** Empreinte lisible : `sha256:abcd…` sur 16 caractères. */
export function shortHash(sha256: string | null): string {
  return sha256 ? `sha256:${sha256.slice(0, 16)}…` : "non généré";
}

export function suggestedFilename(pkg: GamePackage): string {
  return pkg.filename;
}
