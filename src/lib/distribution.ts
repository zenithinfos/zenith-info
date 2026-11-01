import { APP_VERSION, GAME_URL, GAME_VERSION, SUPPORT_EMAIL } from "./version";

export type PackageId = "windows" | "macos" | "android" | "source";

export interface GamePackage {
  id: PackageId;
  label: string;
  icon: string;
  description: string;
  format: string;
  requirements: string;
  /** "client" = jeu prêt à jouer ; "server" = code source à héberger. */
  kind: "client" | "server";
  platform: string;
  filename: string;
  version: string;
  /** Taille et empreinte connues une fois le paquet généré (npm run package). */
  sizeBytes: number | null;
  sha256: string | null;
  downloadPath: string;
  instructions: string[];
}

export const PACKAGES: GamePackage[] = [
  {
    id: "windows",
    label: "Windows 10/11",
    icon: "🪟",
    description:
      "Client complet avec la forêt de Minkébé, le mode expédition et le multijoueur local.",
    format: "ZIP",
    requirements: "Windows 10/11 64 bits · 4 Go RAM · GPU DirectX 11",
    kind: "client",
    platform: "windows",
    filename: `minkebe-${GAME_VERSION}-windows.zip`,
    version: GAME_VERSION,
    sizeBytes: null,
    sha256: null,
    downloadPath: "/downloads/windows",
    instructions: [
      "Décompressez l'archive dans un dossier dédié.",
      "Lancez Minkebe.exe (Windows peut afficher un avertissement SmartScreen).",
      "Choisissez « Expédition » pour le solo ou « Multijoueur » pour rejoindre un serveur.",
    ],
  },
  {
    id: "macos",
    label: "macOS 13+",
    icon: "🍎",
    description:
      "Version Apple Silicon et Intel, rendu Metal, manette et trackpad pris en charge.",
    format: "DMG",
    requirements: "macOS 13 Ventura · Apple Silicon ou Intel · 4 Go RAM",
    kind: "client",
    platform: "macos",
    filename: `minkebe-${GAME_VERSION}-macos.dmg`,
    version: GAME_VERSION,
    sizeBytes: null,
    sha256: null,
    downloadPath: "/downloads/macos",
    instructions: [
      "Ouvrez le DMG puis glissez Minkébé dans Applications.",
      "Au premier lancement : clic droit → Ouvrir (signature non notariée).",
      "Le jeu utilise Metal : fermez les applications gourmandes en GPU.",
    ],
  },
  {
    id: "android",
    label: "Android 8+",
    icon: "🤖",
    description:
      "Version mobile avec contrôles tactiles, mode économie de batterie et sauvegarde cloud.",
    format: "APK",
    requirements: "Android 8.0 · 3 Go RAM · OpenGL ES 3.0",
    kind: "client",
    platform: "android",
    filename: `minkebe-${GAME_VERSION}-android.apk`,
    version: GAME_VERSION,
    sizeBytes: null,
    sha256: null,
    downloadPath: "/downloads/android",
    instructions: [
      "Autorisez l'installation depuis cette source dans les réglages Android.",
      "Installez l'APK puis ouvrez Minkébé.",
      "Les contrôles tactiles apparaissent automatiquement sur mobile.",
    ],
  },
  {
    id: "source",
    label: "Serveur (code source)",
    icon: "🗄️",
    description:
      "Code source complet Next.js + PostgreSQL : à héberger pour le multijoueur, les sauvegardes et les paiements",
    format: "ZIP",
    requirements: "Node.js 20 · PostgreSQL 14+",
    kind: "server",
    platform: "source",
    filename: `minkebe-server-${APP_VERSION}.zip`,
    version: APP_VERSION,
    sizeBytes: null,
    sha256: null,
    downloadPath: "/downloads/source",
    instructions: [
      "Décompressez l'archive sur le serveur.",
      "cp .env.example .env puis renseignez DATABASE_URL et ADMIN_TOKEN.",
      "npm ci && npm run db:push && npm run build && npm start.",
      "Placez un reverse-proxy TLS (Caddy, Nginx, Traefik) devant le port 3000.",
    ],
  },
];

export function getPackage(id: string): GamePackage | undefined {
  return PACKAGES.find((p) => p.id === id);
}

export function packageIds(): PackageId[] {
  return PACKAGES.map((p) => p.id);
}

/** Contenu du fichier LISEZ-MOI.txt ajouté à chaque paquet. */
export function readmeFor(pkg: GamePackage): string {
  return [
    `${pkg.label} — Minkébé ${pkg.version}`,
    "=".repeat(60),
    "",
    pkg.description,
    "",
    `Format        : ${pkg.format}`,
    `Configuration : ${pkg.requirements}`,
    `Site du jeu   : ${GAME_URL}`,
    `Support       : ${SUPPORT_EMAIL}`,
    "",
    "Installation",
    "------------",
    ...pkg.instructions.map((line, i) => `${i + 1}. ${line}`),
    "",
    "Licence : voir LICENCE (© Zenith Info).",
  ].join("\n");
}

/**
 * Guide d'installation du paquet « Serveur ». Utilisé par /api/download/source
 * et par la page /admin quand le ZIP n'est pas encore généré.
 */
export function buildServerGuide(gameUrl: string = GAME_URL): string {
  return `=== SERVEUR — Code source complet (Next.js 16 + PostgreSQL) ===

1. Prérequis
   - Node.js 20 LTS ou supérieur
   - PostgreSQL 14 ou supérieur
   - Un domaine et un reverse-proxy TLS (Caddy, Nginx, Traefik)

2. Installation
   unzip minkebe-server-${APP_VERSION}.zip -d minkebe
   cd minkebe
   cp .env.example .env
   npm ci
   npm run db:push        # crée les tables (saves, payments, download_events)
   npm run build
   npm start              # écoute sur 0.0.0.0:3000

3. Variables d'environnement essentielles
   DATABASE_URL=postgres://user:motdepasse@hote:5432/minkebe
   ADMIN_TOKEN=<jeton long et aléatoire>
   PAYMENT_MODE=simulation|live
   NEXT_PUBLIC_GAME_URL=https://votre-domaine.tld

4. Reverse-proxy (exemple Caddy)
   votre-domaine.tld {
     encode gzip
     reverse_proxy 127.0.0.1:3000
   }

5. Vérification
   curl -fsS https://votre-domaine.tld/api/health
   curl -fsS -H "x-admin-token: $ADMIN_TOKEN" https://votre-domaine.tld/api/admin

Serveur de jeu : ${gameUrl}

Le client desktop et mobile lit l'adresse du serveur dans son fichier de
configuration (server.url). Pour pointer vers votre propre serveur (voir le
paquet « Serveur »), modifiez cette valeur.

=== FIN ===
`;
}

export function deviceMatrix(): { label: string; value: string }[] {
  return [
    { label: "Desktop", value: "Windows 10/11 · macOS 13+" },
    { label: "Mobile", value: "Android 8+ (iOS en préparation)" },
    { label: "Navigateur", value: "Chrome / Edge / Firefox / Safari récents" },
    { label: "Serveur", value: "Node.js 20 · PostgreSQL 14+" },
  ];
}
