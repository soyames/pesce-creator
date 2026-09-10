# Pesce Studio — règles du projet

## Architecture (ne pas créer de doublons)

- **Vercel** (Root Directory `app/frontend`) héberge le Mini App statique + les fonctions serverless `api/*.js`. Aucun framework, bundler ni build step.
- **Neon PostgreSQL** est la **seule** base de données de l'application (driver `@neondatabase/serverless`, `lib/db.js`, migrations `migrations/*.sql` via `scripts/migrate.mjs`). Firestore/Firebase a été entièrement migré : **ne jamais réintroduire Firebase**.
- **Telegram** est la source de vérité éditoriale : le canal alimente `pesce_posts` via le webhook (`api/telegram-pesce-studio.webhook.js` → `channel_post`). Les médias restent hébergés par Telegram ; Neon ne stocke que des métadonnées/références. **Ne jamais dupliquer les médias dans Neon.**
- **YouTube** héberge les vidéos ; le Mini App ne fait que référencer/ouvrir des liens. Aucun upload YouTube n'existe — ne pas en créer sans demande explicite.
- **Deux expériences dans un seul Mini App** : l'espace public (défaut) et le studio créatrice **masqué** (bouton réservé à la créatrice via `GET /api/me`, deep link `?startapp=studio`, commande `/studio` ; `studio.js`/`studio.css` chargés à la demande). L'autorisation est **toujours** validée côté serveur (`/api/studio` : initData 401 + allowlist créatrice 403) — le masquage client est de l'UX, pas de la sécurité.
- Les directs (`pesce_live_schedules`, `api/live.js`, actions `live_*` du studio) ne stockent que la programmation ; le direct reste sur sa plateforme externe.
- Constantes partagées : `app/frontend/constants.js` (`globalThis.PESCE`) + vue ESM `lib/config.js`. Un test garde-fou interdit de réécrire ces identifiants en dur.

## Sécurité — règle permanente (ne jamais enfreindre)

Ne jamais imprimer, exposer, journaliser, committer ni révéler un secret : credential, token, clé privée, mot de passe, URL de base de données, secret de webhook, token de bot Telegram ou clé API.

- Ne jamais exécuter de commande qui imprime le contenu d'un `.env` ou une valeur de `process.env.*`.
- Ne jamais coller de chaîne de connexion ou de credential dans un rapport, un commit, un PR ou le chat.
- Pour vérifier un secret : rapporter uniquement **SET / MISSING / VALID / INVALID** (vérifications comportementales), jamais la valeur.
- Si un secret apparaît accidentellement : s'arrêter, le retirer de la sortie et **signaler qu'il doit être révoqué/roté**.
- Ne jamais utiliser un credential réel comme fixture de test ; ne jamais committer de fichier `.env*` contenant des credentials.
- Si une commande risquerait de révéler un secret, ne pas l'exécuter.
- Le scan automatisé existe : `npm run scan` (`scripts/secret-scan.mjs`), intégré à `npm test`. Étendre ses motifs lors de l'ajout de nouveaux types de secrets.

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
