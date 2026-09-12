# Pesce Studio — règles du projet

## Architecture (ne pas créer de doublons)

- **Vercel** (Root Directory `app/frontend`) héberge le Mini App statique + les fonctions serverless `api/*.js`. Aucun framework, bundler ni build step.
- **Neon PostgreSQL** est la **seule** base de données de l'application (driver `@neondatabase/serverless`, `lib/db.js`, migrations `migrations/*.sql` via `scripts/migrate.mjs`). Firestore/Firebase a été entièrement migré : **ne jamais réintroduire Firebase**.
- **Pesce Studio publie canoniquement dans Neon** (`pesce_posts`, colonne `origin` : `studio` | `telegram`) : le Mini App consomme Neon directement — jamais de dépendance au webhook ni à la réouverture du Studio pour qu'une publication devienne publique. **Telegram est un canal de distribution** : le webhook ingère les publications du canal (`origin='telegram'`, réconciliation possible → inactive) ; une publication créée dans le Studio (`origin='studio'`) **survit à la suppression de sa copie Telegram**. Identité unique : `chat_id`+`message_id` et `article_url` dédupliqués, `publish_key` idempotent. Les médias restent hébergés par Telegram/Telegraph ; Neon ne stocke que des métadonnées/références. **Ne jamais dupliquer les médias dans Neon.**
- **YouTube** héberge les vidéos ; le Mini App ne fait que référencer/ouvrir des liens. Aucun upload YouTube n'existe — ne pas en créer sans demande explicite.
- **Deux expériences dans un seul Mini App** : l'espace public (défaut) et le studio créatrice **masqué** (bouton réservé à la créatrice via `GET /api/me`, deep link `?startapp=studio`, commande `/studio` ; `studio.js`/`studio.css` chargés à la demande). L'autorisation est **toujours** validée côté serveur (`/api/studio` : initData 401 + allowlist créatrice 403) — le masquage client est de l'UX, pas de la sécurité.
- **Studio créatrice web `/studio`** (portail de bureau, `app/frontend/studio/index.html`) : authentification Google Sign-In (jeton d'identité vérifié côté serveur — signature JWKS, audience, expiration — via `api/studio-auth.js`), session HttpOnly/Secure/SameSite adossée à Neon (`pesce_web_sessions`, `lib/web-session.js`), allowlist stricte (`PESCE_WEB_ADMIN_EMAILS`, défaut : l'administrateur du Studio). `/api/studio` accepte **soit** la session web autorisée, **soit** l'initData Telegram — même base, mêmes actions, aucune couche de synchronisation. Variables requises (noms uniquement) : `GOOGLE_OAUTH_CLIENT_ID` (identifiant OAuth public, audience du jeton — aucun secret client nécessaire) et `PESCE_WEB_ADMIN_EMAILS`.
- Les directs (`pesce_live_schedules`, `api/live.js`, actions `live_*` du studio) ne stockent que la programmation ; le direct reste sur sa plateforme externe.
- Constantes partagées : `app/frontend/constants.js` (`globalThis.PESCE`) + vue ESM `lib/config.js`. Un test garde-fou interdit de réécrire ces identifiants en dur.

## Sécurité — règle permanente (ne jamais enfreindre)

Authentification : la vérification d'identité est **toujours** serveur. Le Studio web (`/studio`) ne rend **aucune** donnée privée avant l'authentification (l'écran de connexion est la seule surface visible), refuse tout compte Google hors allowlist (403), et la session (cookie HttpOnly/Secure/SameSite) expire après 7 jours. Aucune vérification par localStorage, paramètre d'URL ou condition JavaScript côté client.

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
node scripts/migrate.mjs     # applique migrations/*.sql (idempotent ; DATABASE_URL requis)
node scripts/smoke.mjs       # vérifie lib/db.js contre Neon (DATABASE_URL requis)
node --check <fichier>.js    # vérification de syntaxe
```

## Règles de travail

- Ne pas déployer, committer ni pousser sans demande explicite.
- Ne pas supprimer ou modifier le contenu Telegram/YouTube existant.
- Toute l'interface utilisateur reste en français.
- Corriger l'existant en place : ne pas créer de framework, de base de données, d'API de contenu ou de système de directs dupliqués.
