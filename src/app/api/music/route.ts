import { stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Catalogue audio. Le champ `available` reflète la présence réelle du fichier
 * dans public/audio, ce qui évite au lecteur de tenter une source manquante.
 */

const TRACKS = [
  {
    id: "mougongo",
    title: "Le Mougongo",
    artist: "Ensemble de Minkébé",
    file: "le-mougongo.wav",
    mood: "Chant de rivière",
    seconds: 192,
  },
  {
    id: "reveil",
    title: "Réveil dans la forêt",
    artist: "Ambiance de l'aube",
    file: "reveil-dans-la-foret.wav",
    mood: "Aube · calaos",
    seconds: 60,
  },
  {
    id: "canopee",
    title: "Sous la canopée",
    artist: "Ambiance de jour",
    file: "ambiance-canopee.wav",
    mood: "Jour · insectes",
    seconds: 60,
  },
];

export async function GET() {
  const tracks = await Promise.all(
    TRACKS.map(async (track) => {
      const filePath = path.join(process.cwd(), "public", "audio", track.file);
      let available = false;
      let sizeBytes: number | null = null;
      try {
        const info = await stat(filePath);
        available = info.isFile() && info.size > 0;
        sizeBytes = info.size;
      } catch {
        available = false;
      }
      return {
        id: track.id,
        title: track.title,
        artist: track.artist,
        mood: track.mood,
        seconds: track.seconds,
        src: `/audio/${track.file}`,
        available,
        sizeBytes,
      };
    }),
  );

  return NextResponse.json(
    { tracks, format: "wav", licence: "© Zenith Info — usage interne" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
