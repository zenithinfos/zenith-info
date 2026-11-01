"use client";

import { useRef, useState } from "react";

/**
 * Bande-annonce. La vidéo n'est chargée qu'au clic (preload="none") pour ne
 * pas gaspiller la bande passante ; si le fichier est absent, l'affiche reste
 * visible avec un message explicite.
 */

export default function GameTrailer({
  poster = "/images/menu-forest.jpg",
  src = "/video/forest-trailer.mp4",
  title = "Bande-annonce",
  subtitle = "Deux minutes dans la canopée de Minkébé",
  className = "",
}: {
  poster?: string;
  src?: string;
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  const play = () => {
    setStarted(true);
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => setFailed(true));
  };

  return (
    <figure className={`panel relative overflow-hidden ${className}`}>
      <div className="relative aspect-video w-full bg-canopy-950">
        {!failed ? (
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            poster={poster}
            preload="none"
            playsInline
            controls={started}
            onError={() => setFailed(true)}
            aria-label={title}
          >
            <source src={src} type="video/mp4" />
            Votre navigateur ne prend pas en charge la lecture vidéo.
          </video>
        ) : (
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${poster})` }}
            role="img"
            aria-label="Affiche de la bande-annonce"
          />
        )}

        {!started && !failed && (
          <button
            type="button"
            onClick={play}
            className="group absolute inset-0 grid place-items-center bg-canopy-950/35 transition hover:bg-canopy-950/20"
            aria-label={`Lire : ${title}`}
          >
            <span className="grid h-16 w-16 place-items-center rounded-full border border-parchment/40 bg-canopy-950/60 text-2xl text-parchment backdrop-blur transition group-hover:scale-105 group-hover:border-amber-glow group-hover:text-amber-glow animate-pulse-ring">
              ▶
            </span>
          </button>
        )}

        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-canopy-950 via-canopy-950/70 to-transparent p-4">
          <p className="eyebrow">{title}</p>
          <p className="display text-lg text-parchment">{subtitle}</p>
          {failed && (
            <p className="mt-1 text-[0.65rem] text-laterite-400">
              Vidéo non disponible sur ce serveur — déposez le fichier dans public/video/.
            </p>
          )}
        </figcaption>
      </div>
    </figure>
  );
}
