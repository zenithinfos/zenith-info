# Minkébé

Jeu d'exploration et de conservation dans la réserve de Minkébé (nord-est du Gabon).
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
│   ├── page.tsx                 page d'accueil (jeu, faune, zones, téléchargements, tarifs)
│   ├── admin/page.tsx           console d'administration (jeton requis)
│   └── api/
│       ├── health · about       sondes et métadonnées de build
│       ├── expeditions          référentiel de contenu (zones, faune, tenues, gadgets)
│       ├── music                catalogue audio + présence réelle des fichiers
│       ├── download[/platform]  métadonnées et livraison des paquets
│       ├── saves[/id]           sauvegardes (PostgreSQL ou mémoire)
│       ├── rooms[/code]/…       salons multijoueurs (create / join / leave / sync)
│       └── pay/…                checkout, confirm, mobile-money, verify, webhooks
├── components/                  Scene (Three.js), HUD, carte GPS, vestiaire, lecteur, etc.
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

Principes de rendu :

- **Tuilage** : la forêt est découpée en tuiles de 48 unités (`buildTile`). Le jeu
  charge celles qui entourent le joueur (rayon 2 tuiles, soit 96 unités — la
  portée du brouillard) et libère les autres en marchant. Une tuile de plus par
  image : pas de saccade. Tout le monde n'est donc plus généré autour de
  l'origine, ce qui laissait le reste de la carte vide.
- **Quatre strates** : émergents (22–32 m), arbres moyens (11–19 m), jeunes
  arbres (6–12 m) et **arbustes de sous-bois** (2–5 m) qui bouchent la vue à
  hauteur d'homme — sans eux, on voyait le ciel entre les troncs.
- **Houppiers en volume** : cartes de feuillage empilées sur les deux tiers
  supérieurs du fût, plus une carte horizontale en « toit ».
- **Sous-bois** : fougères et balisiers en deux plans croisés, plus un
  **couvre-sol à plat** (dalles de litière de 2–5 m) qui tapisse le sol.
  Les cartes basses sont assombries (occlusion verticale) pour donner la
  profondeur du sous-bois.
- **Feuillages alpha-testés** : silhouettes découpées, et Three projette de
  vraies ombres feuillues (le depth material reprend `alphaTest`).
- **Ciel en dôme** : bleu au zénith, lavé par la brume à l'horizon. Un fond uni
  laissait une bande de ciel claire entre les troncs, à hauteur d'œil.
- **Plafond de canopée** + brouillard : on ne voit jamais le ciel depuis le
  sentier, sauf dans les baïs — vérifié par `npm run check:forest`.
- **Vent** : léger balancement dans le vertex shader, avec une clé de cache de
  programme par matériau.
- Sol assombri sous la canopée dense, rais de lumière additifs, vignettage.

Densités mesurées autour du joueur (`npm run check:forest`) :

| Sonde | Ciel visible |
|---|---|
| Camp de base | 14 % |
| Sentier | 0 % |
| Forêt profonde | 0 % |
| Baï (clairière) | 43 % |
| Colline | 0,4 % |
| Canopée | 0 % |

Le rendu se vérifie aussi à l'œil, hors navigateur : `npm run preview:scene`
écrit quatre PNG (`preview-{spawn,foret,sentier,clairiere}.png`) depuis un
raycaster logiciel qui partage `buildTile` et `plantCards` avec le jeu.

## Assets

Tout `public/` est généré par `scripts/gen-assets.mjs` (+ `scripts/lib/textures.mjs`)
— sharp, SVG et un écrivain GLB/WAV maison : icônes PWA, visuels de menu,
textures de forêt, deux modèles low-poly et trois pistes audio.

Les textures de forêt sont dessinées feuille par feuille (bouquets, fougères,
balisiers, canopée percée de trous de lumière, écorce, litière) puis quantifiées
en palette : **~400 Ko au total** pour onze textures.

Remplacez ces fichiers par vos propres créations **en conservant les noms** :
`public/models/Michelle.glb`, `public/models/Soldier.glb`,
`public/textures/*`, `public/audio/le-mougongo.wav`,
`public/audio/reveil-dans-la-foret.wav`, `public/audio/ambiance-canopee.wav`,
`public/video/forest-trailer.mp4`. Le lecteur vidéo et le lecteur audio gèrent
proprement l'absence d'un fichier (affiche de secours, message explicite).

Régénération complète : `npm run assets -- --force`.

---

## Accessibilité

- Contrôles clavier complets (WASD/ZQSD, flèches, Maj, Ctrl, M, Échap) et tactile.
- `prefers-reduced-motion` réduit la végétation, les insectes et les animations.
- Interface contrastée, libellés ARIA sur la scène, la carte et les curseurs.
- Aucun son obligatoire ; les ambiances s'affichent aussi en texte.

---

## Licence

© 2026 Zenith Info — voir `LICENCE`. Les données écologiques sont pédagogiques et
ne remplacent pas les sources officielles (ANPN, WWF, IRD).
