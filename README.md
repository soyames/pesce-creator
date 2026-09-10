# Pesce Studio

**L’espace Telegram de Pesce Hounyo**

Pesce Studio est une expérience Telegram native destinée à permettre à Pesce Hounyo de publier, échanger avec son audience et recevoir directement son soutien via les Étoiles Telegram.

## Vision

Construire un espace simple, francophone et centré sur Pesce, sans créer une plateforme média indépendante inutilement complexe.

Telegram fournit l’infrastructure de conversation, de distribution et de monétisation. YouTube reste l’hébergeur des vidéos. Vercel héberge le Mini App et ses fonctions serverless. Firestore conserve uniquement les métadonnées nécessaires au flux de contenu, aux paiements, aux supports et aux brouillons.

## Canaux officiels

- Telegram : `@PesceHounyoOfficiel` — https://t.me/PesceHounyoOfficiel
- Bot : `@PesceStudioBot`
- YouTube : `@gnonnouxopescehounyo2576` — https://www.youtube.com/@gnonnouxopescehounyo2576
- Mini App : https://pesce-creator-nine.vercel.app/
- Politique de confidentialité : https://pesce-creator-nine.vercel.app/privacy

Le canal Telegram est le flux éditorial principal utilisé par Pesce Studio. Les canaux WhatsApp existants restent des canaux de distribution indépendants tant qu’un connecteur WhatsApp dédié n’est pas configuré.

## Principes

- 🇫🇷 Toute l’expérience utilisateur est en français.
- 📱 Telegram est le point d’entrée principal.
- ⭐ Les Étoiles Telegram sont le mécanisme de soutien prioritaire.
- 🎥 Les vidéos restent hébergées sur YouTube.
- 📝 Telegram reste la source de vérité éditoriale pour les contenus publiés.
- 🗄️ Firestore conserve les métadonnées nécessaires ; les médias ne sont pas copiés dans une nouvelle bibliothèque.
- 🤖 L’IA assiste Pesce mais ne remplace jamais son jugement journalistique.
- 🔐 Les secrets Telegram, Firebase et Telegraph ne sont jamais commités dans Git.

## Architecture actuelle

```text
Pesce / Studio privé
  │
  ├── texte + brouillons
  │       │
  │       ▼
  │   Vercel Studio API
  │       │
  │       └── Telegram sendMessage
  │                    │
  │                    ▼
  │             @PesceHounyoOfficiel
  │                    │ channel_post
  │                    ▼
  │             Vercel webhook
  │                    │
  │                    └── Firestore: pesce_posts
  │
  ├── Photos / audios / vidéos publiés depuis Telegram
  │                    │ channel_post
  │                    ▼
  │             Firestore + file_id Telegram
  │
  ├── YouTube
  │
  └── WhatsApp existant — distribution indépendante pour l’instant

Pesce Studio Mini App public
  ├── Accueil → identité Pesce + rails (articles, vidéos, audios)
  ├── Publications / Photos / Audios → Firestore → proxy Telegram signé
  ├── Vidéos → vidéos du canal + chaîne YouTube
  ├── Communauté → Telegram channel
  ├── Aide → formulaire Mini App + bot @PesceStudioBot
  └── Soutenir → Telegram Stars

Studio créatrice — masqué (rôle via /api/me, autorité /api/studio)
  ├── publication texte / article Telegraph → canal avec bouton ⭐
  ├── brouillons, indicateurs, tickets (répondre/résoudre), paiements
  └── backfill du bouton de soutien
```

## Deux expériences

Pesce Studio est **un seul Mini App** qui porte deux expériences :

1. **L’espace public** (par défaut) : l’identité de Pesce, ses derniers articles, vidéos et audios, ses publications, la communauté, l’assistance et un soutien clair en Étoiles ⭐. Il s’ouvre toujours normalement — y compris pour Pesce elle-même — **même sans identifiant créatrice configuré**.
2. **Le studio créatrice** (masqué) : aucune affordance visible pour le public ; `studio.js` et `studio.css` ne sont même pas chargés pour un visiteur. Le rôle est résolu via `GET /api/me` (`{ isCreator, creatorConfigured }`) ; le bouton Studio n’apparaît que pour la créatrice, qui peut aussi ouvrir son espace via le lien profond `?startapp=studio` ou la commande privée `/studio` du bot. Sans `PESCE_CREATOR_TELEGRAM_USER_IDS` configuré, personne n’est créatrice et le studio reste masqué (fail-closed) — l’autorisation réelle reste côté serveur (`/api/studio` renvoie 403).

## Studio créatrice

Accessible uniquement au compte Telegram configuré dans `PESCE_CREATOR_TELEGRAM_USER_IDS`. Il permet de :

- rédiger une publication texte ;
- **publier un article Telegraph** (titre + texte → page telegra.ph lue en Instant View, postée avec le bouton ⭐ Soutenir) ;
- enregistrer un brouillon et le reprendre ;
- publier directement sur `@PesceHounyoOfficiel` ;
- ajouter automatiquement le bouton `⭐ Soutenir le travail de Pesce` aux nouvelles publications, ou le réappliquer aux publications récentes ;
- répondre et résoudre les demandes de support ;
- consulter les indicateurs (contenus, vidéos, photos, audios, Étoiles), les soutiens et les demandes.

Pour les photos, audios et vidéos, la publication directe depuis Telegram reste le chemin privilégié en V1 : le webhook synchronise ensuite le contenu dans Firestore sans dupliquer le média.

## Articles Telegraph

Le Studio peut aussi publier un article long-form via Telegraph lorsque `TELEGRAPH_ACCESS_TOKEN` est configuré. Le Studio crée alors la page Telegraph puis publie dans le canal Telegram un message contenant le titre, le lien de lecture et le bouton `⭐ Soutenir le travail de Pesce`.

Configurer dans Vercel :

- `TELEGRAPH_ACCESS_TOKEN` — jeton privé du compte Telegraph utilisé par Pesce Studio.

Le jeton ne doit jamais être commit dans Git ou exposé au navigateur.

## WhatsApp

Le projet ne prétend pas actuellement publier automatiquement dans le canal WhatsApp. Le canal WhatsApp existant reste indépendant. Une future intégration pourra être ajoutée derrière un adaptateur dédié, sans faire de WhatsApp une dépendance du flux Telegram.

Nous ne devons pas baser la production sur une passerelle WhatsApp non officielle sans décision explicite sur les risques, la confidentialité et la maintenance.

## Confidentialité

Pesce Studio fournit une politique de confidentialité publique à :

`https://pesce-creator-nine.vercel.app/privacy`

Elle décrit les données pouvant être reçues via Telegram, les données de support et de paiement Stars, les services techniques utilisés et les finalités du traitement.

## Structure

```text
pesce-creator/
├── app/
│   └── frontend/
│       ├── api/
│       │   ├── content.js                  # flux public (posts signés pour les médias)
│       │   ├── create-invoice.js           # facture Stars
│       │   ├── media.js                    # proxy média Telegram (jeton HMAC)
│       │   ├── me.js                       # rôle de l'utilisateur (sans Firestore)
│       │   ├── studio.js                   # studio créatrice (privé)
│       │   ├── support.js                  # tickets depuis le Mini App
│       │   └── telegram-pesce-studio.webhook.js
│       ├── assets/
│       ├── lib/
<<<<<<< HEAD
│       │   ├── config.js                   # vue ESM des constantes partagées
│       │   ├── firestore.js
│       │   ├── media-token.js              # signature HMAC des URLs média
│       │   ├── telegram-auth.js            # initData + identifiants créatrice
│       │   ├── telegraph.js                # articles telegra.ph
│       │   └── tickets.js                  # générateurs d'identifiants
│       ├── tests/                          # node:test (npm test)
│       ├── constants.js                    # identité et URLs (source unique)
│       ├── app.js                          # coquille publique + rôle + loader studio
=======
│       │   └── firestore.js
│       ├── privacy/
│       │   └── index.html
│       ├── app.js
>>>>>>> eafce9355aaca001f20adefb6e191bcc0d17f5f6
│       ├── index.html
│       ├── studio.js                       # module studio (chargé à la demande)
│       ├── studio.css
│       ├── package.json
│       └── styles.css
├── docs/
├── firestore.rules
├── firestore.indexes.json
├── firebase.json
├── .firebaserc
├── .env.example
├── .gitignore
└── README.md
```

## Vercel

Le projet Vercel utilise `app/frontend` comme **Root Directory**.

Les fonctions sont sous `app/frontend/api/`.

URL de production actuelle :

`https://pesce-creator-nine.vercel.app/`

### Variables d’environnement

Configurer dans Vercel (voir aussi `.env.example`) :

- `TELEGRAM_PESCE_BOT_TOKEN`
- `TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET` — recommandé ; sans lui le webhook fonctionne mais accepte tout POST (avertissement dans les logs)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
<<<<<<< HEAD
- `PESCE_CREATOR_TELEGRAM_USER_IDS` — liste d’identifiants Telegram ; **non configuré ⇒ studio masqué pour tout le monde** (l’app publique fonctionne normalement)
- `PESCE_CREATOR_TELEGRAM_USER_ID` — ancien nom singulier, conservé en repli (à déprécier)
- `TELEGRAPH_ACCESS_TOKEN` — optionnel, pour les articles Telegraph (à obtenir via « Configurer Telegraph » dans le studio)
- `PESCE_MEDIA_SIGNING_SECRET` — optionnel, secret des URLs média signées (repli sur le token du bot)
=======
- `PESCE_CREATOR_TELEGRAM_USER_IDS`
- `TELEGRAPH_ACCESS_TOKEN`
>>>>>>> eafce9355aaca001f20adefb6e191bcc0d17f5f6

`FIREBASE_PRIVATE_KEY` doit conserver les retours à la ligne sous la forme `\\n` lorsqu’elle est saisie comme variable d’environnement.

Toute modification d’environnement exige un redéploiement pour prendre effet.

### Tests

```bash
cd app/frontend
npm test
```

Suite `node:test` (aucune dépendance) : validation des initData Telegram, liste des identifiants créatrice, constantes partagées (avec garde anti-duplication), jetons média, générateurs d’identifiants, nœuds Telegraph. Les scénarios manuels (public, créatrice, posts du canal, liens profonds, Étoiles) sont détaillés dans [docs/TESTING.md](docs/TESTING.md).

## Webhook Telegram

Endpoint :

`https://pesce-creator-nine.vercel.app/api/telegram-pesce-studio.webhook`

Updates actuellement nécessaires :

- `message`
- `channel_post`
- `pre_checkout_query`

Le bot doit rester administrateur du canal `@PesceHounyoOfficiel` afin que les publications du canal puissent alimenter le flux Pesce Studio et que le bot puisse ajouter le bouton de soutien aux publications.

Après un changement de projet Vercel, le webhook Telegram doit être reconfiguré vers cette nouvelle URL de production.

## Firestore

Collections utilisées :

- `pesce_posts` — publications Telegram synchronisées
- `pesce_payments` — paiements Stars confirmés
- `pesce_support_sessions` — état temporaire d’une conversation de support
- `pesce_support_tickets` — demandes de support
- `pesce_drafts` — brouillons créés dans le Studio

Les documents `pesce_posts` contiennent notamment le type de contenu, le texte/caption, l’identifiant du message Telegram, l’URL publique du post et le `file_id` Telegram lorsqu’un média est présent.

Les médias ne sont pas copiés dans Firestore. Le Mini App les récupère via `api/media`, qui utilise le bot pour accéder au fichier Telegram.

Les règles Firestore bloquent les accès directs du client ; les fonctions Vercel utilisent Firebase Admin SDK côté serveur.

## Paiements Stars

Le soutien utilise `XTR` et les niveaux :

- 50 ⭐ — Petit soutien
- 100 ⭐ — Soutien
- 250 ⭐ — Grand soutien
- 500 ⭐ — Soutien majeur
- 1 000 ⭐ — Soutien exceptionnel

La création de facture vérifie côté serveur l’`initData` Telegram avant de demander une facture à l’API Bot.

## État du projet

Phase 3 — espace public recentré sur l’identité de Pesce, studio masqué derrière la frontière créatrice, articles Telegraph, tests automatisés.

### Déjà en place

- Gateway navigateur / Telegram
- Mini App francophone : accueil identité + rails (articles, vidéos, audios), Publications, Vidéos (canal + YouTube), Audios, Photos, Communauté, Soutenir ⭐, Aide (formulaire + bot), À propos
- studio créatrice **masqué** (bouton réservé à la créatrice, `?startapp=studio`, `/studio`, aucun chargement du code studio pour le public)
- `GET /api/me` (rôle, sans Firestore) ; application fonctionnelle sans identifiant créatrice configuré
- webhook Telegram (`message`, `channel_post`, `pre_checkout_query`) avec secret
- authentification server-side `initData`
<<<<<<< HEAD
- soutien Telegram Stars (montants validés)
- support par le Mini App **et** par le bot (`/support`, `/paysupport`)
- publication texte et **articles Telegraph** depuis le Studio
- bouton de soutien automatique + backfill
- brouillons, indicateurs, réponses/résolutions de tickets, paiements
- médias servis via URLs signées (HMAC, 12 h)
- tests automatisés `node:test` + scénarios manuels ([docs/TESTING.md](docs/TESTING.md))

### Prochaines étapes

1. Dérouler [docs/TESTING.md](docs/TESTING.md) sur le déploiement (public, créatrice avant/après configuration, posts du canal, liens profonds, Étoiles).
2. Configurer le webhook avec `secret_token` et rendre le secret obligatoire.
3. Ajouter la création/import média depuis le Studio si nécessaire.
4. Ajouter une intégration WhatsApp choisie et validée séparément.
5. Ajouter la synchronisation des modifications/suppressions et les statistiques éditoriales avancées.
=======
- soutien Telegram Stars
- `/start`
- `/paysupport`
- persistance des publications, paiements, supports et brouillons via Firestore
- feeds Publications / Photos / Audios dans le Mini App
- publication texte depuis le Studio
- bouton de soutien automatique sur les publications
- publication d’articles Telegraph depuis le Studio lorsque le token est configuré
- politique de confidentialité publique

### Prochaines étapes

1. Vérifier le nouveau domaine Vercel dans Telegram / BotFather.
2. Reconfigurer et vérifier le webhook Telegram sur le nouveau domaine.
3. Ouvrir le Studio depuis le compte créateur et tester brouillon → publication.
4. Vérifier le bouton `⭐ Soutenir le travail de Pesce` sur le canal.
5. Tester la création d’un article Telegraph.
6. Ajouter la création/import média depuis le Studio si nécessaire.
7. Ajouter une intégration WhatsApp choisie et validée séparément.
8. Ajouter la synchronisation des modifications/suppressions et les statistiques éditoriales avancées.
>>>>>>> eafce9355aaca001f20adefb6e191bcc0d17f5f6
