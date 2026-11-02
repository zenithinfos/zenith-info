# MINKÉBÉ

Jeu de survie et d'exploration dans la forêt de Minkébé, **province de
l'Ogooué-Ivindo**, au nord-est du Gabon : on y piste la faune, on chasse, on
dépece — et on revient au camp.

Interface en **français et en anglais** (sélecteur dans l'en-tête, préférence
mémorisée).
Forêt 3D procédurale, faune réactive, carnet de terrain, multijoueur à 8, sauvegardes
PostgreSQL et distribution (clients + paquet serveur).

**Stack** : Next.js 16 · React 19 · Tailwind CSS 4 · Three.js (WebGL 2) · Drizzle ORM / PostgreSQL 14+

---

## Démarrage rapide

```bash
npm install
cp .env.example .env      # facultatif : sans DATABASE_URL, mode mémoire
npm run assets            # génère icônes, textures, modèles GLB et audio
npm run dev               # http://localhost:3000
```

Le jeu est immédiatement jouable dans le navigateur. Sans `DATABASE_URL`, les
sauvegardes, salons et paiements fonctionnent en mémoire (perdus au redémarrage).

### Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement (écoute sur `0.0.0.0`) |
| `npm run build` / `npm start` | Build de production et serveur |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (config Next) |
| `npm run assets` | Régénère `public/` (icônes, visuels, textures, GLB, WAV) |
| `npm run package` | Fabrique `public/downloads/minkebe-server-<version>.zip` |
| `npm run check:forest` | Mesure la densité de la forêt (ciel visible, placement) |
| `npm run check:hunt` | Vérifie les cours d'eau, la balistique et la faune |
| `npm run preview:water` | Rend les cours d'eau hors navigateur (`preview/eau-*.png`) |
| `npm run check:human` | Vérifie le squelette, la prise en main des armes, la marche |
| `npm run preview:faune` | Planche de proportions de la faune (`preview/faune.png`) |
| `npm run preview:perso` | Rendu logiciel du personnage (`preview/personnage.png`) |
| `npm run trailer` | Rend la bande-annonce MP4 (`public/video/minkebe-trailer.mp4`) |
| `npm run trailer:still` | Extrait quatre images du film, pour contrôle |
| `npm run db:push` | Applique le schéma Drizzle à PostgreSQL |

---

## Configuration (`.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `DATABASE_URL` | vide | PostgreSQL ; vide ⇒ mode mémoire |
| `ADMIN_TOKEN` | `change-me` | Jeton de `/api/admin` et `/admin` |
| `PAYMENT_MODE` | `simulation` | `live` active les vrais appels prestataires |
| `NEXT_PUBLIC_GAME_URL` | `http://localhost:3000` | URL publique (guides, retours de paiement) |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_ENV` | — | PayPal Orders v2 |
| `MOBILE_MONEY_API_URL` / `MOBILE_MONEY_API_KEY` / `MOBILE_MONEY_MERCHANT_ID` | — | Passerelle Airtel / Moov |
| `MOBILE_MONEY_WEBHOOK_TOKEN` | — | Jeton partagé du webhook Mobile Money |

> En `PAYMENT_MODE=simulation`, **aucun débit réel** n'est effectué : le parcours
> complet est rejoué localement pour permettre les démonstrations.

---

## Arborescence

```
src/
├── app/
│   ├── page.tsx                 accueil : métadonnées + <LandingPage />
│   ├── admin/page.tsx           console d'administration (jeton requis)
│   └── api/
│       ├── health · about       sondes et métadonnées de build
│       ├── expeditions          référentiel de contenu (zones, faune, tenues, gadgets)
│       ├── music                catalogue audio + présence réelle des fichiers
│       ├── download[/platform]  métadonnées et livraison des paquets
│       ├── saves[/id]           sauvegardes (PostgreSQL ou mémoire)
│       ├── rooms[/code]/…       salons multijoueurs (create / join / leave / sync)
│       └── pay/…                checkout, confirm, mobile-money, verify, webhooks
├── components/
│   ├── Scene.tsx                rendu Three.js (forêt, eau, ciel, faune, armes)
│   ├── LandingPage.tsx          la page d'accueil : six sections, la bande-annonce
│   └── …                        HUD, carte GPS, vestiaire, lecteur audio
├── i18n/                        fr + en : dictionnaire, détection, <html lang>
├── game/                        moteur pur (sans three) : engine, faune, zones, météo, eau…
├── db/                          schéma Drizzle, connexion, repli mémoire
└── lib/                         distribution, paiements, PayPal, salons, sauvegardes
```

Le module `src/game/engine.ts` ne dépend pas de Three.js : il tourne côté serveur,
dans les tests ou un Web Worker, et c'est lui qui est sérialisé dans les sauvegardes.
`src/components/Scene.tsx` ne fait que le rendu.

---

## API

| Route | Méthode | Description |
|---|---|---|
| `/api/health` | GET | État, version, base, salons — 503 si dégradé |
| `/api/about` | GET | Version, stack, contenu, paquets, formules |
| `/api/expeditions` | GET / POST | Référentiel filtrable / création d'expédition |
| `/api/music` | GET | Pistes et disponibilité des fichiers |
| `/api/download` | GET | Métadonnées des 4 paquets (taille, sha256, dispo) |
| `/api/download/{id}` | GET | Archive si générée, sinon mode d'emploi (`?format=txt`) |
| `/api/saves` | GET / POST | Liste (`?deviceId=`) / création-mise à jour |
| `/api/saves/{id}` | GET / DELETE | Lecture / suppression |
| `/api/rooms` | GET / POST | Salons ouverts / création (hôte inscrit) |
| `/api/rooms/{code}/join` | POST | Rejoindre (409 si complet, 404 si inconnu) |
| `/api/rooms/{code}/leave` | POST | Quitter |
| `/api/rooms/{code}/sync` | POST | Envoi de position + récupération des joueurs |
| `/api/pay/checkout` | POST | Crée un paiement (PayPal, Mobile Money ou simulation) |
| `/api/pay/confirm` | POST | Confirme / capture (simulation, PayPal) |
| `/api/pay/mobile-money` | GET / POST | Collecte Mobile Money et statut |
| `/api/pay/verify` | GET | Statut d'une référence (redirige en HTML) |
| `/api/pay/webhook` | POST | Notification opérateur (Mobile Money) |
| `/api/pay/paypal-webhook` | POST | Événements PayPal |
| `/api/admin` | GET | Statistiques (en-tête `x-admin-token`) |

Sauvegardes limitées à 256 Ko et 3 emplacements par appareil. Les positions des
salons expirent après 45 s d'inactivité ; un salon vide est fermé après 1 min.

---

## Multijoueur

Le client (`src/game/net.ts`) utilise du **polling adaptatif** (120 ms, suspendu
quand l'onglet est caché) plutôt que des WebSockets : c'est compatible avec un
déploiement Next.js classique derrière un reverse-proxy, sans serveur additionnel.

Les salons vivent en mémoire du processus (`src/lib/rooms.ts`). Pour un
déploiement multi-instances, branchez Redis ou une table PostgreSQL sur la même
interface (`createRoom`, `joinRoom`, `syncRoom`, `leaveRoom`, `listRooms`).

---

## Distribution

`npm run package` produit le paquet **Serveur** (code source complet, sans
`node_modules` ni `.next`) dans `public/downloads/`. Les tailles et empreintes
SHA-256 sont calculées à la demande par `/api/download`.

Les clients Windows / macOS / Android nécessitent Electron et le SDK Android :
déposez les archives au même endroit (`minkebe-1.4.0-windows.zip`, etc.) et
`/api/download` les exposera automatiquement. Tant qu'elles sont absentes, la
route renvoie le mode d'emploi en texte brut plutôt qu'une erreur.

### Héberger un serveur

```bash
unzip minkebe-server-0.1.0.zip -d minkebe && cd minkebe
cp .env.example .env        # DATABASE_URL + ADMIN_TOKEN
npm ci && npm run db:push && npm run build && npm start
```

Placez un reverse-proxy TLS devant le port 3000 (Caddy, Nginx, Traefik), puis
vérifiez `GET /api/health`.

---

## Rendu de la forêt

La forêt est générée par des modules purs, testables sans navigateur :

| Module | Rôle |
|---|---|
| `src/game/terrain.ts` | Relief, cuvettes des plans d'eau, pentes, distance aux rives |
| `src/game/forest.ts` | Placement des trois strates (canopée, sous-bois, sol) et forme des houppiers |
| `src/game/water.ts` | Ligne d'eau (polyligne), lit, rives, nage, maillage des surfaces |
| `src/game/animals.ts` | Morphologie, déplacement, fuite, dégâts, dépeçage |
| `src/game/hunting.ts` | Armes, balistique, munitions, viande |

Le personnage et les armes ont leurs propres modules de rendu :

| Module | Rôle |
|---|---|
| `src/components/HumanModel.ts` | Squelette articulé, animation, IK des bras |
| `src/components/WeaponModels.ts` | Les six armes, détachées de toute main |
| `src/components/WeaponView.ts` | Vue subjective : avant-bras et arme devant la caméra |

Principes de rendu :

- **Aucune matière n'est dessinée par du code.** Le sol (litière, racines,
  cailloux, mousse), l'écorce (fibres, crevasses, lichens) et tous les
  feuillages (houppier, sous-bois, fougère, grandes feuilles, herbe, canopée)
  sont des **photographies** retravaillées par `scripts/lib/photos.mjs` :
  mise en tuile sans couture, détourage alpha progressif sans liseré blanc,
  carte de normales dérivée du relief photographique. C'est la seule façon
  d'obtenir du photoréalisme — un feuillage dessiné restera toujours un
  dessin. Les photographies sources vivent dans `assets/raw/`.
- **Tuilage** : la forêt est découpée en tuiles de 48 unités (`buildTile`). Le
  jeu charge celles qui entourent le joueur (rayon 2 tuiles) et libère les
  autres.
- **Quatre strates** : émergents (22–32 m), arbres moyens (11–19 m), jeunes
  arbres (6–12 m) et arbustes de sous-bois (2–5 m) qui bouchent l'horizon.
- **Houppiers en nuage** : neuf à onze bouquets répartis dans un ellipsoïde,
  plus une carte éparse pour laisser passer le ciel. Chaque arbre de canopée
  porte trois ou quatre **charpentières** réelles.
- **Chablis** : `gapAt()` ouvre des trouées dans la futaie — le rythme de la
  forêt tropicale, et la seule façon de voir un rayon traverser.
- **Lumière physique** : environnement préfiltré (PMREM) pour la lumière
  d'ambiance, **transluminescence** dans le shader de feuillage (le soleil
  traverse les feuilles et prend leur couleur), soleil bas et rasant,
  **brouillard exponentiel**, ombres de contact au pied des troncs.
- **Post-traitement** (bureau) : bloom sur les trouées de lumière, puis
  étalonnage — désaturation, réchauffement des lumières, vignettage, grain.
- **Ciel en dôme** et brume de sous-bois : jamais de bande de ciel nue.

Densités mesurées autour du joueur (`npm run check:forest`) :

| Sonde | Ciel visible |
|---|---|
| Camp de base | 14 % |
| Sentier | 1 % |
| Forêt profonde | 0 % |
| Baï (clairière) | 44 % |
| Colline | 1 % |
| Canopée | 1 % |

Le rendu se vérifie aussi hors navigateur : `npm run preview:scene` écrit
quatre PNG depuis un raycaster logiciel qui partage `buildTile`, `plantCards`
et `crownCards` avec le jeu. Il ne remplace pas le rendu WebGL (pas de PBR,
ni d'ombres portées, ni de bloom) : il sert à contrôler la structure et la
densité, pas la lumière.

## Cours d'eau

Les plans d'eau ne sont plus des rectangles posés sur le relief. Chacun est
décrit par sa **ligne d'eau** — une polyligne pour la rivière et le ruisseau,
un point pour le baï et le marais — et une seule fonction de distance signée
(`waterField`) sert partout :

- le relief creuse le lit et remonte la berge sur six mètres (`terrain.ts`) ;
- la végétation s'arrête au bord, et une **roselière** pousse dans les
  quatre derniers mètres (`forest.ts`) ;
- la surface est extrudée le long de la même ligne : les berges du maillage
  sont exactement les berges du terrain ;
- la nage, les crocodiles et la carte GPS lisent la même fonction.

Le shading est un shader dédié (`components/WaterSurface.ts`) :

- trois couches de rides qui dérivent **le long du courant** (la direction est
  portée par le maillage, donc les rides suivent les boucles de la rivière) ;
- absorption de Beer-Lambert : vase au bord, tanin presque noir au fond ;
- Fresnel et reflet de l'environnement **modulé par le feuillage** — l'eau
  reflète le couvert, pas un ciel vide ;
- **houle analytique** : trois trains de vagues orientés par le courant, dont
  on connaît la pente exacte, regroupés en plaques par des rafales de vent ;
- pétillement solaire bruité (deux lobes, sans quoi un seul donne une tache
  lisse), écume de berge cassée en plaques, brouillard exponentiel.

Deux corrections de fond, trouvées en comparant le rendu logiciel au shader :

- les rides étaient échantillonnées en mélangeant des coordonnées UV (le long
  du ruban) et la direction du courant (x/z du monde). Les vaguelettes
  n'étaient donc orientées correctement que par hasard, selon la forme du
  maillage. Elles sont maintenant exprimées en **mètres le long et en travers
  du courant**, puis reconverties vers le monde ;
- la carte de normales n'est pas centrée sur 128 : sa moyenne vaut (0,67 ;
  0,78), soit une pente de 18° en travers et 29° dans l'axe. La rivière était
  donc un miroir incliné, et les rides — qui ne font que ±0,25 — disparaissaient
  dessous. Le biais est mesuré au chargement et retranché dans le shader.

Le maillage a aussi été resserré (0,8 m le long, 28 colonnes en travers,
12 anneaux pour les mares) : à 1,6 m la ligne d'eau faisait des zigzags.

Contrôle hors navigateur : `npm run preview:water` rejoue la même formule en
JavaScript sur le même champ de distance. Ce n'est pas une capture du jeu —
pas de reflets d'arbres réels, pas de bloom — c'est un contrôle de forme et de
couleur.

## Faune et chasse

Dix espèces sont modélisées : éléphant de forêt, gorille, chimpanzé, panthère,
bongo, sitatunga, céphalophe bleu, crocodile nain, calao et perroquet jaco.
Chaque espèce porte sa morphologie dans `game/animals.ts` (garrot, longueur,
cornes, robe) ; le modèle 3D et la boîte de collision lisent **les mêmes
nombres**, donc on ne touche jamais un animal qu'on ne voit pas.

Comportement : la harde apparaît entre 24 et 46 unités (derrière la brume),
paît, erre, fuit quand le joueur fait du bruit, charge pour les espèces
agressives, et disparaît au-delà de 90 unités.

Six armes, tenues en main avec deux avant-bras :

| Arme | Dégâts | Portée | Particularité |
|---|---|---|---|
| Couteau de camp | 55 | 1,9 | Silencieux, il faut arriver au contact |
| Machette | 80 | 2,2 | Lourde, lente |
| Lance de chasse | 70 | 3,1 | Plus longue, plus lente |
| Pistolet 9 mm | 58 | 55 | 12 coups, rechargement rapide |
| Carabine M16 | 96 | 150 | Rafale, 30 coups, bruit énorme |
| Fusil à pompe cal. 12 | 165 | 38 | Six chevrotines, arrêt net à courte portée |

Un tir à la tête multiplie les dégâts par 1,6 à 2,4 selon l'arme ; la distance
réduit les dégâts de 30 % au maximum. Une bête abattue laisse une carcasse :
approchez-vous et dépecez-la (`E`) pour rapporter la viande — 13 kg pour un
céphalophe, 420 kg pour un éléphant. L'arsenal, les munitions, la viande et le
tableau de chasse sont sauvegardés avec l'expédition.

Contrôle : `npm run check:hunt` (balistique, munitions, dépeçage, géométrie
des rives, comportement de la harde).

## Survivre

La survie n'est pas un mode à part : c'est la partie. Quatre jauges restent à
l'écran — santé, faim, soif, endurance.

- **Eau** (`E` près de la berge) : +32 de soif. La soif baisse d'environ
  0,06 par seconde ; sous 15, la santé fond.
- **Fruits** (`F`) : +22 de faim, ramassés en marchant (huit au sac).
- **Viande grillée** (`G`, au feu du camp) : +46 de faim et +8 de santé.
- **Endurance** : la course, le saut (`Espace`, 7 points) et la parade la
  vident ; marcher la recharge.
- **Santé à zéro** : l'expédition se termine. La cause (soif, faim, blessure)
  décide du texte de fin, le score part au classement.

**L'abri** (`B`) coûte cinq fagots de bois mort, ramassés en marchant. Il faut
un terrain à peu près plat et douze mètres entre deux abris. Sous l'abri, `N`
dort deux heures : +38 de santé, endurance pleine — au prix de la soif et de la
faim, qui continuent de descendre.

**Les dangers** : le potamochère et le buffle de forêt chargent sans sommation.
La garde (clic droit ou `Ctrl`) transforme le choc en perte d'endurance ; un
saut par-dessus la charge (`Espace`) l'annule complètement. La nuit tombe
vraiment : les lunettes infrarouges (`I`) amplifient la lumière et teintent
l'image en vert.

**Les niveaux** : cinquante paliers, 2 500 XP pour le Prix de Survie. L'XP vient
des bêtes abattues, de la viande dépecée, des espèces observées, des zones
découvertes, des Mewas (+40), des abris (+60) et des nuits passées à l'abri.
L'expérience et les tenues survivent à la mort ; la carte, le tableau de chasse
et les abris, non.

**Les Mewas** : dix créatures blanches aux oreilles bleues, disséminées entre 40
et 190 mètres du camp. Elles flottent, errent, et s'approchent par curiosité.
Au contact, elles laissent deux à quatre Fils de Rêve, qui se tissent en quatre
tenues nommées — *Fée des étoiles* (planer), *Nénuphar* (marcher sur l'eau),
*Murmure des bêtes* (apprivoiser), *Purificatrice* (calmer les prédateurs).

## Bande-annonce

La vidéo est un vrai MP4, rendu par `scripts/game-trailer.mjs` : quarante-deux
secondes, six plans, encodées par ffmpeg depuis des images calculées en flux
(brut sur l'entrée standard, rien d'écrit entre la scène et le film).

Il n'y a pas de navigateur dans l'environnement de développement : impossible
de filmer le jeu en WebGL. Le script construit donc **le monde du jeu avec ses
propres modules** — `forest.ts` pour les tuiles, `terrain.ts` pour le relief,
`AnimalModel.ts` pour la faune, `HumanModel.ts` pour le personnage et son
arme — et le filme avec un rasteriseur logiciel (tampon de profondeur,
perspective correcte, lumière lambert). Ce n'est pas le rendu WebGL : pas de
PBR, pas d'ombres portées, pas de bloom. Mais ce sont de vraies caméras, de
vrais animaux qui marchent, une vraie arme qui recule. Une image fixe retouchée
n'aurait rien montré de tout ça.

Le montage :

| Temps | Plan |
|---|---|
| 0-9 s | la futaie, caméra à hauteur d'œil qui avance |
| 9-16 s | le pisteur de dos, fusil en main |
| 16-24 s | la harde dans une trouée (bongos, gorille, éléphant) |
| 24-29 s | vue subjective, arme en joue, éclair de bouche |
| 29-37 s | la nuit, lucioles, halos de lampe |
| 37-42 s | carton de fin |

Côté page, `components/GameTrailer.tsx` ne télécharge la vidéo qu'au premier
clic et affiche ses **six chapitres** comme sommaire : la barre de progression
est aussi un menu, et le chapitre en cours s'allume.

Trois détails qui ont demandé du travail, et qui se voient :

- au-delà de la quarantaine de mètres où s'arrête le décor détaillé, on sème
  des fûts en silhouette (`drawFarForest`) peints directement dans la couleur
  de la brume, du plus sombre au plus clair selon la distance. Sans eux,
  l'horizon est un mur vert parfaitement plat ;
- le fond entre les fûts est une brume *éclairée* et non un aplat sombre : les
  feuilles s'y découpent en silhouette, comme dans une forêt humide ;
- un vrai objectif ne fait pas la mise au point à trente centimètres : les
  cartes de feuillage trop proches et trop grandes sont écartées, sinon elles
  couvrent l'image comme un drap ;
- la nuit passe par une exposition globale (`EXPOSURE`) et pas seulement par un
  soleil plus faible : la courbe ACES relève tellement les basses lumières
  qu'une scène de nuit réglée à la baisse ressortait gris-vert ;
- le carton de fin est composé en SVG (sharp) puis posé en fondu sur les
  dernières secondes. Le rasteriseur ne connaît pas les glyphes ; une vidéo
  sans mot-symbole final n'est pas une bande-annonce.

Un détail qui a coûté cher : `frameBuffer` est un `Buffer` Node, pas un
`Uint8ClampedArray`. Une valeur négative issue du grade y était écrite *modulo
256* — un pixel sombre à -0,009 devenait 254, soit un point rouge vif. Toute la
« moucheture rouge » du premier plan venait de là, pas des textures. Les octets
sont désormais bornés explicitement.

## Langues

Français et anglais. Le dictionnaire est dans `src/i18n/dictionary.ts` : une
clé, une phrase, et le dictionnaire anglais est typé sur le français — une clé
manquante ne compile pas. `src/i18n/LocaleProvider.tsx` lit la préférence
(`localStorage`, avec `useSyncExternalStore` pour éviter les rendus en cascade),
détecte la langue du navigateur à défaut, et met à jour `<html lang>`.

Couvert : la page d'accueil entière — héros, lieu, bande-annonce, faune,
téléchargements, formules, vestiaire, bande-son, accessibilité —, l'écran de
départ, les commandes, le HUD et les messages de chasse. Les fiches qui ne sont
pas des phrases d'interface (paquets, formules, tenues, personnages, pistes)
sont traduites par surcouche dans `src/i18n/catalogue.ts` : le français reste
la source, l'anglais s'ajoute au rendu, et les tables sont typées par
identifiant — un paquet sans traduction s'affiche en français plutôt que vide.

Ce qui reste hors périmètre : les descriptions d'espèces du carnet de terrain,
qui viennent de `src/game/fauna.ts`. Elles s'ajouteront là où elles sont.

## Personnages

La vue subjective ne montrait que deux avant-bras : impossible de dire qui
tenait le fusil. Le personnage existe désormais en entier — et se voit, puisque
la caméra se place **à l'épaule** par défaut (touche `V` pour repasser en vue
subjective).

`components/HumanModel.ts` construit un squelette hiérarchique : hanches →
colonne → poitrine → épaules, cou, tête ; cuisses → genoux → chevilles. Rien
n'est pré-animé : la marche, la course, l'accroupi et la respiration sont
calculés image par image.

- **Les jambes** oscillent à la cadence de la vitesse réelle, genoux fléchis au
  retour, pieds remis à plat, bassin qui plonge à chaque appui.
- **Les bras** passent par une résolution à deux os (IK analytique) : on donne
  la position de la main, le solveur place l'épaule et le coude. C'est ce qui
  fait que la main droite tombe sur la poignée et la gauche sur le garde-main
  de chaque arme, au lieu de flotter à côté.
- **La tête** suit le regard avec un retard sur le buste, et le buste se
  décale de trente degrés en position de tir : personne ne vise face à l'axe
  de ses épaules.
- **L'arme** vit dans l'espace du corps, pas dans la main : elle porte la
  direction de visée, les mains viennent la chercher. Une arme collée à la main
  ne peut pas viser juste.

Les six armes de `WeaponModels.ts` sont les mêmes objets dans les deux vues :
seule la mise en scène change (bras devant la caméra, ou squelette entier).

`npm run check:human` mesure ce qui doit être vrai — taille, pieds au sol,
mains sur les prises, canon devant, pas de matrice NaN — puis rend le
personnage au rasteriseur logiciel (`preview/personnage.png`) pour juger la
silhouette. 33 contrôles.

## Assets

Tout `public/` est généré par `scripts/gen-assets.mjs` (+ `scripts/lib/textures.mjs`)
— sharp, SVG et un écrivain GLB/WAV maison : icônes PWA, visuels de menu,
textures de forêt, deux modèles low-poly et trois pistes audio.

Les matières de forêt viennent de photographies (`assets/raw/`) finies par
`scripts/lib/photos.mjs` : tuilage sans couture, détourage, normales.
`scripts/lib/textures.mjs` ne produit plus que les effets qui ne sont pas des
matières : brume, roche, normales d'eau. **~2,6 Mo** de textures publiées.

Remplacez ces fichiers par vos propres créations **en conservant les noms** :
`public/models/Michelle.glb`, `public/models/Soldier.glb`,
`public/textures/*`, `public/audio/le-mougongo.wav`,
`public/audio/reveil-dans-la-foret.wav`, `public/audio/ambiance-canopee.wav`,
`public/video/forest-trailer.mp4`. Le lecteur vidéo et le lecteur audio gèrent
proprement l'absence d'un fichier (affiche de secours, message explicite).

Régénération complète : `npm run assets -- --force`.

---

## Accessibilité

- Contrôles clavier complets : WASD/ZQSD, flèches, Maj (courir), C (s'accroupir),
  **Espace (sauter)**, **Ctrl ou clic droit (parade)**, clic (tirer), 1-6 (armes),
  R (recharger), E (boire / dépecer), F (manger), G (griller), **B (bâtir un abri)**,
  **N (dormir sous l'abri)**, **I (lunettes infrarouges)**, ⇧O (vestiaire),
  V (vue), M (carte), Échap (pause). Tactile : joystick, saut, parade, tir.
- `prefers-reduced-motion` réduit la végétation, les insectes et les animations.
- Interface contrastée, libellés ARIA sur la scène, la carte et les curseurs.
- Aucun son obligatoire ; les ambiances s'affichent aussi en texte.

---

## Licence

© 2026 Zenith Info — voir `LICENCE`. Les données écologiques sont pédagogiques et
ne remplacent pas les sources officielles (ANPN, WWF, IRD).
