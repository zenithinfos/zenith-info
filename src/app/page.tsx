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
    "Explorez la forêt de Minkébé, dans la province de l'Ogooué-Ivindo au Gabon : pister 10 espèces, chasser, dépecer, cartographier 8 zones, jouer jusqu'à 8. Jeu 3D dans le navigateur.",
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
