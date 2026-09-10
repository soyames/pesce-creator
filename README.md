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
  ├── Publications → Firestore → contenus Telegram
  ├── Photos → Firestore → proxy Telegram
  ├── Audios → Firestore → proxy Telegram
  ├── Vidéos → YouTube
  ├── Communauté → Telegram channel
  └── Soutenir → Telegram Stars
```

## Studio créatrice

Le Studio privé est accessible uniquement au compte Telegram configuré dans `PESCE_CREATOR_TELEGRAM_USER_IDS`.

Il permet maintenant de :

- rédiger une publication texte ;
- enregistrer un brouillon ;
- reprendre un brouillon ;
- publier directement sur `@PesceHounyoOfficiel` ;
- ajouter automatiquement le bouton `⭐ Soutenir le travail de Pesce` aux nouvelles publications ;
- ajouter ce bouton aux publications récentes déjà existantes ;
- consulter les statistiques de base, les soutiens Stars et les demandes de support.

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
│       │   ├── content.js
│       │   ├── create-invoice.js
│       │   ├── media.js
│       │   ├── studio.js
│       │   └── telegram-pesce-studio.webhook.js
│       ├── assets/
│       ├── lib/
│       │   └── firestore.js
│       ├── privacy/
│       │   └── index.html
│       ├── app.js
│       ├── index.html
│       ├── studio.js
│       ├── studio.css
│       ├── package.json
│       └── styles.css
├── docs/
├── firestore.rules
├── firestore.indexes.json
├── firebase.json
├── .firebaserc
├── .gitignore
└── README.md
```

## Vercel

Le projet Vercel utilise `app/frontend` comme **Root Directory**.

Les fonctions sont sous `app/frontend/api/`.

URL de production actuelle :

`https://pesce-creator-nine.vercel.app/`

### Variables d’environnement

Configurer dans Vercel :

- `TELEGRAM_PESCE_BOT_TOKEN`
- `TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `PESCE_CREATOR_TELEGRAM_USER_IDS`
- `TELEGRAPH_ACCESS_TOKEN`

`FIREBASE_PRIVATE_KEY` doit conserver les retours à la ligne sous la forme `\\n` lorsqu’elle est saisie comme variable d’environnement.

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

Phase 2 — Mini App Telegram, Stars, webhook, canal éditorial, synchronisation Firestore et premier Studio créatrice en intégration.

### Déjà en place

- Gateway navigateur / Telegram
- Mini App francophone
- connexion YouTube
- canal Telegram officiel
- webhook Telegram avec secret
- réception `channel_post`
- authentification server-side `initData`
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
