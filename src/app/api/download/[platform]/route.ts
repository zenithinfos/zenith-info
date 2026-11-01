import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { buildServerGuide, getPackage, packageIds, readmeFor } from "@/lib/distribution";
import { inspectArtifact, logDownload } from "@/lib/downloads";
import { GAME_URL } from "@/lib/version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Téléchargement d'un paquet.
 *
 * Si l'archive a été produite (npm run package), elle est servie en pièce
 * jointe avec son empreinte. Sinon — cas d'un serveur de démonstration — la
 * route renvoie le mode d'emploi en texte brut (ou le guide d'hébergement pour
 * le paquet « Serveur »), avec un code 200 explicite.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  const pkg = getPackage(platform);

  if (!pkg) {
    return NextResponse.json(
      {
        error: "Paquet inconnu",
        available: packageIds(),
      },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const wantsText = url.searchParams.get("format") === "txt";
  const artifact = await inspectArtifact(pkg);

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip");

  if (!wantsText && artifact.exists) {
    await logDownload({
      packageId: pkg.id,
      platform: pkg.platform,
      version: pkg.version,
      userAgent: request.headers.get("user-agent"),
      ip,
      served: true,
    });

    const nodeStream = createReadStream(artifact.path);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(artifact.sizeBytes ?? 0),
        "Content-Disposition": `attachment; filename="${pkg.filename}"`,
        "X-Checksum-Sha256": artifact.sha256 ?? "",
        "Cache-Control": "no-store",
      },
    });
  }

  await logDownload({
    packageId: pkg.id,
    platform: pkg.platform,
    version: pkg.version,
    userAgent: request.headers.get("user-agent"),
    ip,
    served: false,
  });

  const body =
    pkg.kind === "server" ? buildServerGuide(GAME_URL) : readmeFor(pkg);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="${pkg.id === "source" ? "INSTALLATION.txt" : `${pkg.id}.txt`}"`,
      "Cache-Control": "no-store",
      "X-Package-Available": String(artifact.exists),
    },
  });
}
