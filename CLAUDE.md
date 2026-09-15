# Pesce Studio — règles du projet

## Architecture (ne pas créer de doublons)

- **Vercel** (Root Directory `app/frontend`) héberge le Mini App statique + les fonctions serverless `api/*.js`. Aucun framework, bundler ni build step.
- **Neon PostgreSQL** est la **seule** base de données de l'application (driver `@neondatabase/serverless`, `lib/db.js`, migrations `migrations/*.sql` via `scripts/migrate.mjs`). Firestore/Firebase a été entièrement migré : **ne jamais réintroduire Firebase**.
- **Pesce Studio publie canoniquement dans Neon** (`pesce_posts`, colonne `origin` : `studio` | `telegram`) : le Mini App consomme Neon directement — jamais de dépendance au webhook ni à la réouverture du Studio pour qu'une publication devienne publique. **Telegram est un canal de distribution** : le webhook ingère les publications du canal (`origin='telegram'`, réconciliation possible → inactive) ; une publication créée dans le Studio (`origin='studio'`) **survit à la suppression de sa copie Telegram**. Identité unique : `chat_id`+`message_id` et `article_url` dédupliqués, `publish_key` idempotent. Les médias restent hébergés par Telegram/Telegraph ; Neon ne stocke que des métadonnées/références. **Ne jamais dupliquer les médias dans Neon.**
- **YouTube** héberge les vidéos ; le Mini App ne fait que référencer/ouvrir des liens. Aucun upload YouTube n'existe — ne pas en créer sans demande explicite.
- **Deux expériences dans un seul Mini App** : l'espace public (défaut) et le studio créatrice **masqué** (bouton réservé à la créatrice via `GET /api/me`, deep link `?startapp=studio`, commande `/studio` ; `studio.js`/`studio.css` chargés à la demande). L'autorisation est **toujours** validée côté serveur (`/api/studio` : initData 401 + allowlist créatrice 403) — le masquage client est de l'UX, pas de la sécurité.
- **Le journal public se lit PARTOUT** : dans Telegram (Mini App) comme dans un navigateur ordinaire. Il n'y a plus de porte bloquante hors Telegram — un lien d'article partagé ne doit jamais aboutir à une impasse. Seules les capacités **propres à Telegram** (Étoiles, assistance par le bot, espace créatrice, mesure d'audience) restent conditionnées à `inTelegram` et le disent honnêtement. **Ne jamais reconditionner la lecture publique à Telegram.**
- **Lien canonique d'une publication** : `PESCE.articleLink(id)` → `<MINI_APP_URL>?post=<id>` (partageable partout) ; `PESCE.articleTelegramLink(id)` → `<BOT_URL>?startapp=post_<id>` (ouvre le Mini App sur l'article). Les ancres historiques `#post-…` restent acceptées. Source unique dans `constants.js` — **ne jamais reconstruire ces formes à la main**. Le clavier d'une publication du canal (`postMarkup`) porte « 📖 Lire dans Pesce Studio » **et** « ⭐ Soutenir » ; il est reposé après l'attachement de l'identité Telegram, car l'identifiant canonique peut changer dans la course avec le webhook.
- **Le lecteur n'est jamais une impasse** : l'article expose l'identité Pesce, la navigation publique, « Découvrir plus de Pesce » (autres publications du **même flux** `/api/content`, jamais une source parallèle, jamais l'article courant ni une publication retirée) et l'accès au soutien.
- **Studio créatrice web `/studio`** (portail de bureau, `app/frontend/studio/index.html`) : **deux voies d'authentification, une seule session**. (1) adresse + mot de passe (empreinte **scrypt** dans `PESCE_STUDIO_PASSWORD_HASH`, vérifiée par `lib/password-auth.js` ; limitation des tentatives dans `pesce_login_attempts`) ; (2) Google Sign-In (jeton d'identité vérifié côté serveur — signature JWKS, audience, expiration). Les deux passent par `api/studio-auth.js` et créent la **même** session HttpOnly/Secure/SameSite adossée à Neon (`pesce_web_sessions`, `lib/web-session.js`), avec la même allowlist stricte (`PESCE_WEB_ADMIN_EMAILS`, défaut : l'administrateur du Studio). **Ne jamais créer de second système de session.** `/api/studio` accepte **soit** la session web autorisée, **soit** l'initData Telegram — même base, mêmes actions, aucune couche de synchronisation. Variables requises (noms uniquement) : `GOOGLE_OAUTH_CLIENT_ID` (identifiant OAuth public — aucun secret client nécessaire), `PESCE_WEB_ADMIN_EMAILS`, `PESCE_STUDIO_PASSWORD_HASH`.
- **PWA du bureau privé** : `/studio` est installable (manifeste `studio/manifest.webmanifest`, `start_url`/`scope` = `/studio`, icônes dérivées de `assets/profilePesce.png` par `scripts/generate-pwa-icons.mjs`). Le service worker `studio-sw.js` est servi depuis la racine (portée maximale) mais **enregistré avec la portée `/studio`** : le Mini App public n'est jamais contrôlé. Il ne met en cache qu'une **liste blanche stricte** de ressources statiques de la coquille — **jamais `/api/*`**, jamais une réponse authentifiée, jamais de contenu non publié, et **aucune file d'attente de publication hors ligne**. Installer la PWA n'authentifie personne.
- **Corriger une publication ne la recrée JAMAIS** (action `article_update` de `/api/studio`, bouton « Modifier » dans Écrits → « Mettre à jour la publication ») : même ligne Neon, même `id`, même URL publique (page Telegraph éditée **en place** par son `path`), même `published_at`, même message Telegram, mêmes soutiens et statistiques. Seul `updated_at` avance. La liste blanche `POST_UPDATABLE_COLUMNS` (`lib/db.js`) interdit structurellement de toucher à l'identité. Ordre **canonique d'abord** : Neon, puis Telegraph, puis Telegram — un échec de copie externe n'annule jamais la correction et est rapporté franchement. **Ne jamais implémenter une correction par retrait + republication.** Toute édition d'un message Telegram doit reposer `reply_markup` (sans quoi Telegram efface le bouton ⭐ Soutenir).
- Les directs (`pesce_live_schedules`, `api/live.js`, actions `live_*` du studio) ne stockent que la programmation ; le direct reste sur sa plateforme externe.
- Constantes partagées : `app/frontend/constants.js` (`globalThis.PESCE`) + vue ESM `lib/config.js`. Un test garde-fou interdit de réécrire ces identifiants en dur.

## Sécurité — règle permanente (ne jamais enfreindre)

Authentification : la vérification d'identité est **toujours** serveur. Le Studio web (`/studio`) ne rend **aucune** donnée privée avant l'authentification (l'écran de connexion est la seule surface visible), refuse tout compte hors allowlist (403 Google / 401 générique par mot de passe), et la session (cookie HttpOnly/Secure/SameSite) expire après 7 jours. Aucune vérification par localStorage, paramètre d'URL ou condition JavaScript côté client.

Mots de passe : **jamais** en clair nulle part (dépôt, HTML, JS, Neon, journaux, tests, documentation, commits), **jamais** comparés par un condensat rapide (SHA-256 nu interdit). Seule une empreinte **scrypt** vit dans `PESCE_STUDIO_PASSWORD_HASH` (Vercel, type Secret). Les refus sont **génériques** : aucun message ne distingue une adresse inconnue d'un mot de passe faux. Ne jamais demander à la créatrice de coller son mot de passe dans le code, un ticket ou un chat.

**Génération de l'empreinte (opération unique, locale) :**

```bash
cd app/frontend
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/generate-studio-password-hash.mjs
```

La saisie est masquée et demandée deux fois ; le script refuse toute entrée non interactive (aucun pipe, aucun CI, aucun historique de shell), n'écrit aucun fichier et n'affiche **que** l'empreinte. Coller cette valeur dans Vercel → Settings → Environment Variables → `PESCE_STUDIO_PASSWORD_HASH` (Production, type Secret), puis **redéployer**. Ne jamais committer une empreinte réelle (le scan de secrets la détecte).

Ne jamais imprimer, exposer, journaliser, committer ni révéler un secret : credential, token, clé privée, mot de passe, URL de base de données, secret de webhook, token de bot Telegram ou clé API.

- Ne jamais exécuter de commande qui imprime le contenu d'un `.env` ou une valeur de `process.env.*`.
- Ne jamais coller de chaîne de connexion ou de credential dans un rapport, un commit, un PR ou le chat.
- Pour vérifier un secret : rapporter uniquement **SET / MISSING / VALID / INVALID** (vérifications comportementales), jamais la valeur.
- Si un secret apparaît accidentellement : s'arrêter, le retirer de la sortie et **signaler qu'il doit être révoqué/roté**.
- Ne jamais utiliser un credential réel comme fixture de test ; ne jamais committer de fichier `.env*` contenant des credentials.
- Si une commande risquerait de révéler un secret, ne pas l'exécuter.
- Le scan automatisé existe : `npm run scan` (`scripts/secret-scan.mjs`), intégré à `npm test`. Étendre ses motifs lors de l'ajout de nouveaux types de secrets.

## Régie des directs (MTProto)

La Bot API ne contrôle PAS les livestreams du canal : les flux RTMP (serveur + clé) et l'état
réel des appels sont fournis par l'API utilisateur MTProto (`phone.getGroupCallStreamRtmpUrl`,
`phone.getGroupCall…`), derrière la façade serveur `lib/mtproto.js`. Configuration unique,
réservée au propriétaire du canal (documentée dans `scripts/mtproto-setup.mjs`) :

1. Créer les identifiants sur my.telegram.org (API development tools).
2. En local : `PESCE_MT_PROTO_API_ID=… PESCE_MT_PROTO_API_HASH=… node scripts/mtproto-setup.mjs`
   (connexion interactive), puis sauvegarder la chaîne de session affichée.
3. Sur Vercel (type Secret) : `PESCE_MT_PROTO_API_ID`, `PESCE_MT_PROTO_API_HASH`, `PESCE_MT_PROTO_SESSION`.

Sans configuration, toute opération MTProto échoue proprement (503 explicite) : la clé de
stream ne transite QUE par l'API authentifiée du Studio — jamais par une route publique.
Le compte de la session MTProto doit être **administrateur du canal** (sinon Telegram répond
`CHAT_ADMIN_REQUIRED` — traduit en message éditorial français dans le Studio, jamais exposé brut).

## Commandes utiles

```bash
cd app/frontend
npm test                     # tests unitaires + scan de secrets
npm run scan                 # scan de secrets seul
node scripts/migrate.mjs     # applique les migrations de lib/schema.js (idempotent ; DATABASE_URL requis)
node scripts/smoke.mjs       # vérifie lib/db.js contre Neon (DATABASE_URL requis)
node scripts/preview.mjs     # serveur de prévisualisation local (fixtures, sans Telegram ni Neon)
node scripts/assert-ui.mjs   # assertions navigateur (preview.mjs doit tourner)
node scripts/audit-layout.mjs # audit géométrique mobile/bureau (preview.mjs doit tourner)
node scripts/generate-pwa-icons.mjs            # icônes PWA depuis assets/profilePesce.png
node scripts/generate-studio-password-hash.mjs # empreinte du mot de passe (local, interactif)
node --check <fichier>.js    # vérification de syntaxe
```

## Règles de travail

- Ne pas déployer, committer ni pousser sans demande explicite.
- Ne pas supprimer ou modifier le contenu Telegram/YouTube existant.
- Toute l'interface utilisateur reste en français.
- Corriger l'existant en place : ne pas créer de framework, de base de données, d'API de contenu ou de système de directs dupliqués.
