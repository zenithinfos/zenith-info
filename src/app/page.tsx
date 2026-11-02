import LandingPage from "@/components/LandingPage";
import { APP_NAME, GAME_VERSION } from "@/lib/version";

/**
 * Page d'accueil. Le corps est un composant client (il change de langue et
 * affiche le jeu) ; cette page ne garde que les métadonnées, qui doivent être
 * rendues par le serveur.
 */

export const metadata = {
  title: { absolute: `${APP_NAME} — le jeu de la forêt de l'Ogooué-Ivindo` },
  description:
    "Survivez dans la forêt de Minkébé, province de l'Ogooué-Ivindo au Gabon : soif, faim, abris de cinq bois, charges de potamochères et de buffles, dix Mewas à trouver, cinquante niveaux. Jeu 3D dans le navigateur.",
  alternates: {
    canonical: "/",
    languages: {
      "fr-FR": "/",
      "en-GB": "/",
    },
  },
  other: { "game-version": GAME_VERSION },
};

export default function HomePage() {
  return <LandingPage />;
}
