# Pesce Studio

**L’espace Telegram de Pesce Hounyo**

Pesce Studio est une expérience Telegram native destinée à permettre à Pesce Hounyo de publier, échanger avec son audience et recevoir directement son soutien via les Étoiles Telegram.

## Vision

Construire un espace simple, francophone et centré sur Pesce, sans créer une plateforme média indépendante inutilement complexe.

Telegram fournit l’infrastructure de conversation, de distribution et de monétisation. YouTube reste l’hébergeur des vidéos. Vercel héberge le Mini App et ses fonctions serverless. Firestore conserve uniquement les métadonnées nécessaires au flux de contenu et aux paiements.

## Canaux officiels

- Telegram : `@PesceHounyoOfficiel` — https://t.me/PesceHounyoOfficiel
- Bot : `@PesceStudioBot`
- YouTube : `@gnonnouxopescehounyo2576` — https://www.youtube.com/@gnonnouxopescehounyo2576

Le canal Telegram est le flux éditorial utilisé par Pesce Studio. Les canaux WhatsApp existants restent des canaux de distribution indépendants.

## Principes

- 🇫🇷 Toute l’expérience utilisateur est en français.
- 📱 Telegram est le point d’entrée principal.
- ⭐ Les Étoiles Telegram sont le mécanisme de soutien prioritaire.
- 🎥 Les vidéos restent hébergées sur YouTube.
- 📝 Le contenu Telegram reste publié et géré dans Telegram.
- 🗄️ Firestore ne conserve que les métadonnées nécessaires ; les médias ne sont pas copiés dans une nouvelle bibliothèque.
- 🤖 L’IA assiste Pesce mais ne remplace jamais son jugement journalistique.
- 🔐 Les secrets Telegram et Firebase ne sont jamais commités dans Git.

## Architecture actuelle

```text
Pesce
  │
  ├── Telegram channel @PesceHounyoOfficiel
  │       │ channel_post
  │       ▼
  │   Vercel webhook
  │       │
  │       ├── Firestore: pesce_posts
  │       └── Telegram media file_id
  │
  ├── YouTube @gnonnouxopescehounyo2576
  │
  └── WhatsApp channels existants

Pesce Studio Mini App
  ├── Publications → Firestore → Telegram
  ├── Photos → Firestore → proxy Telegram
  ├── Audios → Firestore → proxy Telegram
  ├── Vidéos → YouTube
  ├── Communauté → Telegram channel
  └── Soutenir → Telegram Stars
```

## Structure

```text
pesce-creator/
├── app/
│   └── frontend/
│       ├── api/
│       │   ├── content.js
│       │   ├── create-invoice.js
│       │   ├── media.js
│       │   └── telegram-pesce-studio.webhook.js
│       ├── assets/
│       ├── lib/
│       │   └── firestore.js
│       ├── app.js
│       ├── index.html
│       ├── package.json
│       └── styles.css
├── docs/
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

`FIREBASE_PRIVATE_KEY` doit conserver les retours à la ligne sous la forme `\\n` lorsqu’elle est saisie comme variable d’environnement.

## Webhook Telegram

Endpoint :

`https://pesce-creator.vercel.app/api/telegram-pesce-studio.webhook`

Updates actuellement nécessaires :

- `message`
- `channel_post`
- `pre_checkout_query`

Le bot doit rester administrateur du canal `@PesceHounyoOfficiel` afin que les publications du canal puissent alimenter le flux Pesce Studio.

## Firestore

Collections utilisées :

- `pesce_posts` — publications Telegram synchronisées
- `pesce_payments` — paiements Stars confirmés

Les documents `pesce_posts` contiennent notamment le type de contenu, le texte/caption, l’identifiant du message Telegram, l’URL publique du post et le `file_id` Telegram lorsqu’un média est présent.

Les médias ne sont pas copiés dans Firestore. Le Mini App les récupère via `api/media`, qui utilise le bot pour accéder au fichier Telegram.

## Paiements Stars

Le soutien utilise `XTR` et les niveaux :

- 50 ⭐ — Petit soutien
- 100 ⭐ — Soutien
- 250 ⭐ — Grand soutien
- 500 ⭐ — Soutien majeur
- 1 000 ⭐ — Soutien exceptionnel

La création de facture vérifie côté serveur l’`initData` Telegram avant de demander une facture à l’API Bot.

## État du projet

Phase 2 — Mini App Telegram, Stars, webhook, canal éditorial et flux de contenu en cours d’intégration.

### Déjà en place

- Gateway navigateur / Telegram
- Mini App francophone
- connexion YouTube
- canal Telegram officiel
- webhook Telegram avec secret
- réception `channel_post`
- authentification server-side `initData` pour les factures
- soutien Telegram Stars
- `/start`
- `/paysupport`
- persistance prévue des publications et paiements via Firestore
- feeds Publications / Photos / Audios dans le Mini App

### Prochaines étapes

1. Configurer Firestore et les variables Firebase dans Vercel.
2. Publier un nouveau post de test dans `@PesceHounyoOfficiel`.
3. Vérifier son apparition dans Publications / Photos / Audios.
4. Configurer le Main Mini App et le Menu Button dans BotFather.
5. Construire le studio privé de Pesce : brouillons, publication, audience, Stars et statistiques.
6. Ajouter la synchronisation des modifications/suppressions de posts et les statistiques éditoriales.
