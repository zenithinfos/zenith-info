/**
 * Dictionnaire du jeu.
 *
 * Une clé = une phrase. Pas d'imbrication : les clés pointées se lisent dans
 * le code (`t("hero.lede")`) et se relisent dans ce fichier, et une clé
 * manquante se voit à la compilation — le dictionnaire anglais est typé sur
 * le français.
 */

import type { Locale } from "./locales";

const fr = {
  "app.name": "MINKÉBÉ",
  "app.tagline": "Le jeu de la forêt gabonaise",
  "app.place": "Forêt de Minkébé · province de l'Ogooué-Ivindo · Gabon",
  "app.byline": "par ONOKO-CRÉATIONS",

  "nav.play": "Jouer",
  "nav.trailer": "Bande-annonce",
  "nav.forest": "La forêt",
  "nav.support": "Soutenir",
  "nav.language": "Langue",
  "nav.label": "Navigation principale",

  "hero.kicker": "Jeu de survie · Gabon · 0° 30′ N",
  "hero.title": "MINKÉBÉ",
  "hero.lede":
    "Une forêt de l'Ogooué-Ivindo, au nord-est du Gabon. Des éléphants de forêt, de la boue jusqu'aux genoux, et aucune route à des jours de marche. Pistez, chassez, dépecez — et rentrez avant la nuit.",
  "hero.place": "Forêt de Minkébé · Ogooué-Ivindo · Gabon",

  "hero.cta": "Jouer maintenant",
  "hero.ctaAlt": "Voir la bande-annonce",

  "figures.zones": "zones à cartographier",
  "figures.species": "espèces modélisées",
  "figures.players": "joueurs par salon",
  "figures.weapons": "armes",

  "trailer.kicker": "Bande-annonce",
  "trailer.title": "Quarante-deux secondes dans la futaie",
  "trailer.note":
    "Images rendues par le moteur du jeu — pas une capture vidéo retouchée.",
  "trailer.play": "Lire la bande-annonce",
  "trailer.pause": "Pause",
  "trailer.replay": "Revoir",
  "trailer.unavailable": "Vidéo indisponible sur ce serveur.",
  "trailer.chapter.forest": "La futaie",
  "trailer.chapter.hunter": "Le pisteur",
  "trailer.chapter.wildlife": "La harde",
  "trailer.chapter.aim": "La chasse",
  "trailer.chapter.night": "La nuit",
  "trailer.chapter.title": "MINKÉBÉ",

  "place.kicker": "Le lieu",
  "place.title": "Une forêt, pas un décor",
  "place.body":
    "Minkébé est une forêt de terre ferme du nord-est du Gabon, dans la province de l'Ogooué-Ivindo, à la frontière du Cameroun et du Congo. Sept mille kilomètres carrés sans route, où les baïs — ces clairières marécageuses riches en sels minéraux — attirent éléphants, bongos et gorilles. La réserve est aussi le cœur du dernier grand bassin d'éléphants de forêt d'Afrique centrale.",
  "place.fact.area": "7 000 km² de forêt de terre ferme",
  "place.fact.province": "Province de l'Ogooué-Ivindo",
  "place.fact.baï": "Les baïs, clairières à sels minéraux",

  "fauna.kicker": "Carnet de terrain",
  "fauna.title": "Ce que vous croiserez",
  "fauna.lede":
    "Dix espèces modélisées en 3D : chacune a ses horaires, son habitat et sa réaction — fuite, curiosité ou charge.",
  "fauna.more": "Voir les dix espèces",

  "game.kicker": "Jouer",
  "game.title": "Entrez dans la forêt",
  "game.start": "Commencer l'expédition",
  "game.resume": "Reprendre",
  "game.look": "Regarder",
  "game.controls": "ZQSD / WASD · Maj courir · Ctrl s'accroupir · V vue · M carte · Échap pause",
  "game.mobile": "Sur mobile, utilisez le joystick.",
  "game.character": "Personnage",
  "game.view": "Vue",
  "game.viewShoulder": "Épaule",
  "game.viewFirst": "Première personne",
  "game.weapons": "Armes",
  "game.reload": "Recharger",
  "game.fire": "Tirer",
  "game.pause": "Pause",
  "game.save": "Sauvegarder",
  "game.map": "Carte",
  "game.voice": "Voix",
  "game.hints.walk": "marcher",
  "game.hints.run": "courir",
  "game.hints.crouch": "s'accroupir",
  "game.hints.aim": "clic droit : épauler",
  "game.hints.fire": "tirer",
  "game.hints.weapons": "armes",
  "game.hints.reload": "recharger",
  "game.hints.view": "vue",
  "game.hints.pause": "pause",
  "game.skin": "Dépecer",
  "game.room": "Salon",
  "game.explorers": "explorateurs",
  "game.soloNote": "Mode solo — créez un salon pour jouer à plusieurs.",

  "support.kicker": "Soutenir",
  "support.title": "Le projet",
  "download.kicker": "Installer",
  "download.title": "Hors du navigateur",
  "download.lede": "Clients Windows, macOS et Android, ou le serveur à héberger.",

  "footer.play": "Jouer",
  "footer.browser": "Dans le navigateur",
  "footer.clients": "Windows · macOS · Android",
  "footer.server": "Héberger un serveur",
  "footer.about": "À propos",
  "footer.health": "État du service",
  "footer.version": "Version",
  "footer.admin": "Administration",
  "footer.legal": "© 2026 Zenith Info · Minkébé · licence propriétaire",
  "footer.contact": "Contact",
  "footer.credit": "Un jeu de survie et d'exploration, inspiré de la réserve de Minkébé.",

  "lang.switch": "Changer de langue",
  // Téléchargements
  "dl.title": "Télécharger Minkébé",
  "dl.version": "Version",
  "dl.updating": "mise à jour…",
  "dl.json": "Métadonnées JSON",
  "dl.hostBadge": "à héberger",
  "dl.hosting": "Hébergement",
  "dl.install": "Installation",
  "dl.download": "⬇ Télécharger",
  "dl.readme": "📄 Lisez-moi",
  "dl.requirements": "Configuration requise",
  "dl.integrity": "Intégrité",
  "dl.notBuilt":
    "Le paquet n'a pas encore été généré sur ce serveur : la route renvoie le mode d'emploi. Lancez npm run package pour produire les archives.",
  "dl.noteServer":
    "Le paquet serveur inclut les API de sauvegarde, de salons multijoueurs et de paiement.",
  "dl.noteClient":
    "Les sauvegardes locales fonctionnent hors ligne ; le mode multijoueur nécessite un serveur.",
  "dl.ios": "📱 iOS en préparation",
  "dl.browsers": "🖥️ Navigateur : Chrome, Edge, Firefox, Safari",
  "dl.about": "À propos du build",

  // Formules
  "pricing.title": "Une forêt qui se joue, une forêt qui se protège.",
  "pricing.lede":
    "10 % des recettes « Mécène » sont reversés à des programmes de surveillance de la réserve. Paiement par carte (PayPal) ou Mobile Money au Gabon.",
  "pricing.recommended": "conseillé",
  "pricing.payment": "Paiement",
  "pricing.provider": "Moyen de paiement",
  "pricing.provider.card": "Carte bancaire international",
  "pricing.email": "E-mail du reçu",
  "pricing.phone": "Numéro Mobile Money",
  "pricing.processing": "Traitement…",
  "pricing.pay": "Payer",
  "pricing.demo":
    "Mode démonstration : aucun débit réel n'est effectué tant que PAYMENT_MODE vaut simulation. Écrivez à support@zenith-info.example pour toute question.",
  "pricing.reference": "Conservez la référence",
  "pricing.simulated": "Paiement simulé confirmé.",
  "pricing.pending": "Paiement en attente :",
  "pricing.operator": "suivez les instructions de votre opérateur.",
  "pricing.unavailable": "Paiement indisponible",
  "pricing.error": "Erreur",

  // Vestiaire
  "dressing.kicker": "Vestiaire",
  "dressing.title": "S'équiper pour la forêt",
  "dressing.level": "Niveau",
  "dressing.effect": "Effet de la tenue",
  "dressing.locked": "Débloquée au niveau",
  "dressing.lockedNote": "tenue(s) encore verrouillée(s) : gagnez des points en observant la faune.",
  "dressing.stealth": "Discrétion",
  "dressing.stamina": "Endurance",
  "dressing.resilience": "Résistance",
  "dressing.speed": "Vitesse",

  // Bande-son
  "music.kicker": "Bande-son",
  "music.title": "Écouter la forêt",
  "music.playing": "en lecture",
  "music.paused": "en pause",
  "music.play": "▶ Écouter",
  "music.pause": "⏸ Pause",
  "music.previous": "Piste précédente",
  "music.next": "Piste suivante",
  "music.volume": "Volume",
  "music.error.missing": "Piste indisponible sur ce serveur.",
  "music.error.blocked": "Lecture bloquée par le navigateur — cliquez à nouveau.",
  "music.error.failed": "Lecture impossible : vérifiez le fichier audio.",

  // Extras et accessibilité
  "extras.summary": "Vestiaire, musique, accessibilité",
  "a11y.kicker": "Accessibilité",
  "a11y.keyboard": "Contrôles clavier, manette et tactile.",
  "a11y.motion": "Mode « mouvement réduit » (moins d'insectes, pas de secousses).",
  "a11y.contrast": "Interface contrastée, navigation clavier complète.",

};

export type DictionaryKey = keyof typeof fr;
export type Dictionary = Record<DictionaryKey, string>;

const en: Dictionary = {
  "app.name": "MINKÉBÉ",
  "app.tagline": "The game of the Gabonese rainforest",
  "app.place": "Minkébé Forest · Ogooué-Ivindo Province · Gabon",
  "app.byline": "by ONOKO-CRÉATIONS",

  "nav.play": "Play",
  "nav.trailer": "Trailer",
  "nav.forest": "The forest",
  "nav.support": "Support",
  "nav.language": "Language",
  "nav.label": "Main navigation",

  "hero.kicker": "Survival game · Gabon · 0° 30′ N",
  "hero.title": "MINKÉBÉ",
  "hero.lede":
    "A forest in Ogooué-Ivindo, north-east Gabon. Forest elephants, mud to the knee, and not a road for days on foot. Track, hunt, butcher — and be back before dark.",
  "hero.place": "Minkébé Forest · Ogooué-Ivindo · Gabon",

  "hero.cta": "Play now",
  "hero.ctaAlt": "Watch the trailer",

  "figures.zones": "zones to map",
  "figures.species": "species modelled",
  "figures.players": "players per room",
  "figures.weapons": "weapons",

  "trailer.kicker": "Trailer",
  "trailer.title": "Forty-two seconds under the canopy",
  "trailer.note": "Rendered by the game's own engine — not a retouched capture.",
  "trailer.play": "Play the trailer",
  "trailer.pause": "Pause",
  "trailer.replay": "Watch again",
  "trailer.unavailable": "Video unavailable on this server.",
  "trailer.chapter.forest": "The forest",
  "trailer.chapter.hunter": "The tracker",
  "trailer.chapter.wildlife": "The herd",
  "trailer.chapter.aim": "The hunt",
  "trailer.chapter.night": "The night",
  "trailer.chapter.title": "MINKÉBÉ",

  "place.kicker": "The place",
  "place.title": "A forest, not a set",
  "place.body":
    "Minkébé is a terra firma forest in north-east Gabon, in Ogooué-Ivindo Province, on the border with Cameroon and the Congo. Seven thousand square kilometres without a road, where the baïs — marshy clearings rich in mineral salts — draw elephants, bongos and gorillas. The reserve also holds the heart of central Africa's last great forest-elephant population.",
  "place.fact.area": "7,000 km² of terra firma forest",
  "place.fact.province": "Ogooué-Ivindo Province",
  "place.fact.baï": "The baïs, salt-rich clearings",

  "fauna.kicker": "Field notes",
  "fauna.title": "What you will meet",
  "fauna.lede":
    "Ten species modelled in 3D, each with its own hours, habitat and reaction — flight, curiosity or charge.",
  "fauna.more": "See all ten species",

  "game.kicker": "Play",
  "game.title": "Step into the forest",
  "game.start": "Start the expedition",
  "game.resume": "Resume",
  "game.look": "Look around",
  "game.controls": "WASD · Shift to run · Ctrl to crouch · V to switch view · M map · Esc pause",
  "game.mobile": "On mobile, use the joystick.",
  "game.character": "Character",
  "game.view": "View",
  "game.viewShoulder": "Shoulder",
  "game.viewFirst": "First person",
  "game.weapons": "Weapons",
  "game.reload": "Reload",
  "game.fire": "Fire",
  "game.pause": "Pause",
  "game.save": "Save",
  "game.map": "Map",
  "game.voice": "Voice",
  "game.hints.walk": "walk",
  "game.hints.run": "run",
  "game.hints.crouch": "crouch",
  "game.hints.aim": "right click: aim",
  "game.hints.fire": "fire",
  "game.hints.weapons": "weapons",
  "game.hints.reload": "reload",
  "game.hints.view": "view",
  "game.hints.pause": "pause",
  "game.skin": "Butcher",
  "game.room": "Room",
  "game.explorers": "explorers",
  "game.soloNote": "Solo mode — create a room to play with others.",

  "support.kicker": "Support",
  "support.title": "The project",
  "download.kicker": "Install",
  "download.title": "Off the browser",
  "download.lede": "Windows, macOS and Android clients, or the server to host yourself.",

  "footer.play": "Play",
  "footer.browser": "In the browser",
  "footer.clients": "Windows · macOS · Android",
  "footer.server": "Host a server",
  "footer.about": "About",
  "footer.health": "Service status",
  "footer.version": "Version",
  "footer.admin": "Administration",
  "footer.legal": "© 2026 Zenith Info · Minkébé · proprietary licence",
  "footer.contact": "Contact",
  "footer.credit": "A survival and exploration game, inspired by the Minkébé reserve.",

  "lang.switch": "Change language",
  // Downloads
  "dl.title": "Download Minkébé",
  "dl.version": "Version",
  "dl.updating": "updating…",
  "dl.json": "JSON metadata",
  "dl.hostBadge": "self-host",
  "dl.hosting": "Hosting",
  "dl.install": "Install",
  "dl.download": "⬇ Download",
  "dl.readme": "📄 Readme",
  "dl.requirements": "System requirements",
  "dl.integrity": "Integrity",
  "dl.notBuilt":
    "This server has not generated the package yet: the route returns the instructions instead. Run npm run package to build the archives.",
  "dl.noteServer":
    "The server package ships the save, multiplayer-room and payment APIs.",
  "dl.noteClient":
    "Local saves work offline; multiplayer needs a server.",
  "dl.ios": "📱 iOS in the works",
  "dl.browsers": "🖥️ Browser: Chrome, Edge, Firefox, Safari",
  "dl.about": "About the build",

  // Plans
  "pricing.title": "A forest you play, a forest you protect.",
  "pricing.lede":
    '10% of "Patron" proceeds go to reserve monitoring programmes. Pay by card (PayPal) or Mobile Money in Gabon.',
  "pricing.recommended": "recommended",
  "pricing.payment": "Payment",
  "pricing.provider": "Payment method",
  "pricing.provider.card": "International bank card",
  "pricing.email": "Receipt e-mail",
  "pricing.phone": "Mobile Money number",
  "pricing.processing": "Processing…",
  "pricing.pay": "Pay",
  "pricing.demo":
    "Demo mode: no real charge is made while PAYMENT_MODE is set to simulation. Write to support@zenith-info.example with any question.",
  "pricing.reference": "Keep the reference",
  "pricing.simulated": "Simulated payment confirmed.",
  "pricing.pending": "Payment pending:",
  "pricing.operator": "follow your operator's instructions.",
  "pricing.unavailable": "Payment unavailable",
  "pricing.error": "Error",

  // Wardrobe
  "dressing.kicker": "Wardrobe",
  "dressing.title": "Geared for the forest",
  "dressing.level": "Level",
  "dressing.effect": "Outfit effect",
  "dressing.locked": "Unlocks at level",
  "dressing.lockedNote": "outfit(s) still locked: earn points by observing wildlife.",
  "dressing.stealth": "Stealth",
  "dressing.stamina": "Stamina",
  "dressing.resilience": "Resilience",
  "dressing.speed": "Speed",

  // Soundtrack
  "music.kicker": "Soundtrack",
  "music.title": "Listen to the forest",
  "music.playing": "playing",
  "music.paused": "paused",
  "music.play": "▶ Listen",
  "music.pause": "⏸ Pause",
  "music.previous": "Previous track",
  "music.next": "Next track",
  "music.volume": "Volume",
  "music.error.missing": "Track not available on this server.",
  "music.error.blocked": "Playback blocked by the browser — click again.",
  "music.error.failed": "Playback failed: check the audio file.",

  // Extras and accessibility
  "extras.summary": "Wardrobe, music, accessibility",
  "a11y.kicker": "Accessibility",
  "a11y.keyboard": "Keyboard, gamepad and touch controls.",
  "a11y.motion": "“Reduced motion” mode (fewer insects, no camera shake).",
  "a11y.contrast": "Contrasted interface, full keyboard navigation.",

};

export const dictionaries: Record<Locale, Dictionary> = { fr, en };

/** Traduction d'une clé, avec repli sur la clé elle-même : jamais de vide. */
export function translate(locale: Locale, key: DictionaryKey): string {
  return dictionaries[locale]?.[key] ?? dictionaries.fr[key] ?? key;
}
