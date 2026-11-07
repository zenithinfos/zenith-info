import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { APP_NAME, APP_VERSION } from "@/lib/version";
import { LocaleProvider } from "@/i18n/LocaleProvider";

/**
 * La fonte de titrage.
 *
 * Georgia était le serif par défaut du navigateur : correct, sans caractère,
 * et surtout identique à des millions d'autres pages. Fraunces a des empattements
 * taillés et un axe optique qui tient à très grande taille — c'est ce qu'on
 * demande à un logotype de jeu. Elle est **auto-hébergée** : dix-huit
 * kilo-octets dans le dépôt, aucune requête vers un tiers, et rien à charger
 * pour l'utilisateur hors de notre domaine.
 */
const display = localFont({
  src: [{ path: "../../public/fonts/fraunces-600.woff2", weight: "600", style: "normal" }],
  variable: "--font-display-loaded",
  display: "swap",
  fallback: ["Georgia", "Iowan Old Style", "Palatino Linotype", "serif"],
  preload: true,
});

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — le jeu de la forêt de l'Ogooué-Ivindo`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Jeu de survie 3D dans la forêt de Minkébé (province de l'Ogooué-Ivindo, Gabon) : pistez la faune, chassez, dépecez, cartographiez les baïs, jouez en équipe jusqu'à huit. Next.js · Three.js · PostgreSQL.",
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  metadataBase: new URL(process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:3000"),
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180" }],
  },
  openGraph: {
    title: `${APP_NAME} — la forêt de Minkébé`,
    description:
      "Un jeu de survie et d'exploration dans la forêt de Minkébé, province de l'Ogooué-Ivindo au Gabon — en solo ou à huit.",
    type: "website",
    locale: "fr_FR",
    images: [{ url: "/images/trailer-poster.jpg", width: 960, height: 540, alt: "Sous-bois de Minkébé" }],
  },
  other: { "app-version": APP_VERSION },
};

export const viewport: Viewport = {
  themeColor: "#0a1610",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr-FR">
      <body className={`${display.variable} min-h-dvh antialiased`}>
        <LocaleProvider>
          <a
            href="#jeu"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-amber-glow focus:px-4 focus:py-2 focus:text-canopy-950"
          >
            Aller au jeu
          </a>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
