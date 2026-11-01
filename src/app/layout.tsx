import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME, APP_VERSION } from "@/lib/version";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — exploration de la forêt gabonaise`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Jeu d'exploration 3D dans la réserve de Minkébé : documentez la faune, cartographiez les bais, jouez en équipe. Next.js · Three.js · PostgreSQL.",
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
      "Un jeu d'exploration et de conservation, en solo ou à huit, dans l'une des forêts les plus intactes du bassin du Congo.",
    type: "website",
    locale: "fr_FR",
    images: [{ url: "/images/menu-forest.jpg", width: 1600, height: 900, alt: "Canopée de Minkébé" }],
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
    <html lang="fr">
      <body className="min-h-dvh antialiased">
        <a
          href="#jeu"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-amber-glow focus:px-4 focus:py-2 focus:text-canopy-950"
        >
          Aller au jeu
        </a>
        {children}
      </body>
    </html>
  );
}
