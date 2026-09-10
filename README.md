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

Le canal Telegram est le flux éditorial principal utilisé par Pesce Studio. Les canaux WhatsApp existants restent des canaux de distribution indépendants tant qu’un connecteur WhatsApp dédié n’est pas configuré.

## Principes

- 🇫🇷 Toute l’expérience utilisateur est en français.
- 📱 Telegram est le point d’entrée principal.
- ⭐ Les Étoiles Telegram sont le mécanisme de soutien prioritaire.
- 🎥 Les vidéos restent hébergées sur YouTube.
- 📝 Telegram reste la source de vérité éditoriale pour les contenus publiés.
- 🗄️ Firestore conserve les métadonnées nécessaires ; les médias ne sont pas copiés dans une nouvelle bibliothèque.
- 🤖 L’IA assiste Pesce mais ne remplace jamais son jugement journalistique.
- 🔐 Les secrets Telegram et Firebase ne sont jamais commités dans Git.

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

## WhatsApp

Le projet ne prétend pas actuellement publier automatiquement dans le canal WhatsApp. Le canal WhatsApp existant reste indépendant. Une future intégration pourra être ajoutée derrière un adaptateur dédié, sans faire de WhatsApp une dépendance du flux Telegram.

Nous ne devons pas baser la production sur une passerelle WhatsApp non officielle sans décision explicite sur les risques, la confidentialité et la maintenance.

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

### Variables d’environnement

Configurer dans Vercel :

- `TELEGRAM_PESCE_BOT_TOKEN`
- `TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `PESCE_CREATOR_TELEGRAM_USER_IDS`

`FIREBASE_PRIVATE_KEY` doit conserver les retours à la ligne sous la forme `\\n` lorsqu’elle est saisie comme variable d’environnement.

## Webhook Telegram

Endpoint :

`https://pesce-creator.vercel.app/api/telegram-pesce-studio.webhook`

Updates actuellement nécessaires :

- `message`
- `channel_post`
- `pre_checkout_query`

Le bot doit rester administrateur du canal `@PesceHounyoOfficiel` afin que les publications du canal puissent alimenter le flux Pesce Studio et que le bot puisse ajouter le bouton de soutien aux publications.

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

### Prochaines étapes

1. Tester le premier post après activation de Firestore.
2. Ouvrir le Studio depuis le compte créateur et tester brouillon → publication.
3. Vérifier le bouton `⭐ Soutenir le travail de Pesce` sur le canal.
4. Ajouter la création/import média depuis le Studio si nécessaire.
5. Ajouter une intégration WhatsApp choisie et validée séparément.
6. Ajouter la synchronisation des modifications/suppressions et les statistiques éditoriales avancées.
