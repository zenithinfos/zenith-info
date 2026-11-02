import { NextResponse } from "next/server";
import { PACKAGES } from "@/lib/distribution";
import { inspectAll } from "@/lib/downloads";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

/** Liste des paquets avec taille et empreinte réelles quand elles existent. */
export async function GET() {
  const artifacts = await inspectAll(PACKAGES);
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  return NextResponse.json(
    {
      appVersion: APP_VERSION,
      packages: PACKAGES.map((pkg) => {
        const artifact = byId.get(pkg.id);
        return {
          id: pkg.id,
          label: pkg.label,
          version: pkg.version,
          format: pkg.format,
          kind: pkg.kind,
          filename: pkg.filename,
          requirements: pkg.requirements,
          description: pkg.description,
          sizeBytes: artifact?.sizeBytes ?? null,
          sha256: artifact?.sha256 ?? null,
          available: artifact?.exists ?? false,
          url: `/api/download/${pkg.id}`,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
