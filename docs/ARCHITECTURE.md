# Architecture — Pesce Studio

## Vue d’ensemble

```text
                       Telegram
                 ┌───────┴────────┐
                 │                │
            @PesceStudioBot   @PesceHounyoOfficiel
                 │                │
        commandes / support / paiements / channel_post
                 │                │
                 ▼                ▼
        webhook Vercel ────► PostgreSQL/Neon (métadonnées)
                 │
        Mini App (audience)      Studio (créatrice, masqué)
        Vercel statique          /api/me + /api/studio
                 │                       │
        /api/content, /api/media,        sendMessage, Telegraph
        /api/create-invoice, /api/support
                 │
              YouTube (vidéos, lien externe)
```

## Runtime

- **Hébergement** : Vercel, Root Directory `app/frontend`, fonctions serverless zero-config sous `app/frontend/api/` (convention `api/`, aucun `vercel.json`). Node ≥ 22.
- **Frontend** : statique, sans framework ni bundler ni étape de build. Un seul fichier `index.html` + scripts classiques (`constants.js`, `app.js`) + module studio chargé à la demande (`studio.js` + `studio.css`).
- **Données** : PostgreSQL/Neon (intégration Vercel), accès exclusivement côté serveur via `lib/db.js` (driver `@neondatabase/serverless`, pool). Aucun accès client direct ; le schéma est géré par `migrations/*.sql` (runner `scripts/migrate.mjs`, suivi `schema_migrations`).
- **Médias** : jamais copiés. Le Mini App les récupère via `api/media` (proxy du fichier Telegram, protégé par jeton HMAC). Limite connue : l’API Bot `getFile` plafonne à 20 Mo — les vidéos plus lourdes nécessitent le bouton « Voir sur Telegram ».

## Flux de requêtes

| Origine | Destination | Rôle |
|---|---|---|
| Mini App (audience) | `GET /api/content` | flux public des publications (`published == true`) |
| Mini App | `GET /api/media?file_id=&token=` | proxy média signé (HMAC, TTL 12 h) |
| Mini App | `POST /api/create-invoice` | facture Stars (`XTR`), initData validée |
| Mini App | `POST /api/support` | ticket de support (réponse via le bot) |
| Mini App | `GET /api/me` | rôle de l’utilisateur (aucune dépendance de base de données) |
| Studio (créatrice) | `GET/POST /api/studio` | vue d’ensemble + actions (publish, article_publish, draft, backfill, telegraph_setup, tickets, resolve, reply) |
| Telegram | `POST /api/telegram-pesce-studio.webhook` | commandes, sessions de support, paiements, `channel_post` |
| Studio | API Bot Telegram | `sendMessage` vers le canal, `editMessageReplyMarkup` |
| Studio | API Telegraph | `createAccount` / `createPage` (articles telegra.ph) |

## Modèle d’authentification

1. **InitData Telegram** : chaque requête sensible porte l’`initData` (en-tête `x-telegram-init-data` pour studio/me, corps JSON pour support/facture). Validation serveur : HMAC-SHA256 (clé dérivée de `WebAppData` + token du bot), âge max 24 h, tolérance d’horloge −60 s (`lib/telegram-auth.js`).
2. **Frontière créatrice** : `PESCE_CREATOR_TELEGRAM_USER_IDS` (liste, avec repli legacy sur le singulier) → `isCreatorTelegramUser`. Aucun identifiant configuré ⇒ personne n’est créatrice ⇒ le studio reste masqué partout (fail-closed), mais l’application publique fonctionne normalement. L’autorisation n’existe que côté serveur (`/api/studio` renvoie 403) ; le masquage côté client est de l’UX, pas de la sécurité.
3. **Webhook** : secret `x-telegram-bot-api-secret-token` vs `TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET`. Fonctionnel sans secret (avertissement bruyant dans les logs) pour ne pas casser l’ingestion du canal ; à rendre obligatoire via `setWebhook`.
4. **Rôles côté client** : `GET /api/me` renvoie `{ user, isCreator, creatorConfigured }` ; le client cache le rôle en `sessionStorage` et ne charge `studio.js`/`studio.css` que si `isCreator === true`.

## Base de données (PostgreSQL / Neon)

Tables (migrations dans `app/frontend/migrations/`, colonnes snake_case mappées vers les objets camelCase par `lib/db.js`) :

- `pesce_posts` — id `chatId_messageId` ; index partiels sur `published_at` et `(content_type, published_at)`
- `pesce_payments` — id `telegram_payment_charge_id` ; index sur `paid_at`
- `pesce_support_sessions` — clé primaire `user_id`
- `pesce_support_tickets` — id `PS-YYYYMMDD-XXXXX` ; index `(status, created_at)`
- `pesce_drafts` — id `draft_<ts>_<6>` ; index sur `updated_at`
- `schema_migrations` — suivi des migrations appliquées

Les tris et filtres se font en SQL (`ORDER BY … LIMIT`) ; l’accueil du Mini App ne fait qu’**une seule** requête `/api/content` partitionnée côté client (articles, vidéos, audios).

## Constantes partagées

`constants.js` (script classique, assigne `globalThis.PESCE` gelé) est la source unique de l’identité et des URLs — consommé par le navigateur, par `lib/config.js` (vue ESM pour les fonctions serveur et les tests) et par les tests. Un test garde-fou interdit de réécrire ces identifiants en dur ailleurs dans le code.

## Publication

- **Texte simple** : `/api/studio` `publish` → `sendMessage` vers `@PesceHounyoOfficiel` avec le bouton ⭐ Soutenir. La persistance vient du `channel_post` renvoyé par Telegram au webhook (source de vérité Telegram).
- **Article Telegraph** : `article_publish` crée une page telegra.ph (API Telegraph, jeton `TELEGRAPH_ACCESS_TOKEN`) puis publie titre + URL sur le canal. Le Mini App affiche un bouton « Lire l’article » sur les posts contenant un lien telegra.ph. Limites Telegraph : contenu pratique ≲ 20 Ko, titres h3/h4, upload d’images instable — les articles du studio restent du texte simple.
- **Médias** : publication directe depuis Telegram (V1) ; le webhook synchronise `channel_post` → la base sans dupliquer le média.
- **Bouton de soutien** : attaché automatiquement aux nouveaux posts (`channel_post`) ; `backfill_support` le réapplique aux 50 posts récents.

## Contraintes

- Pas de nouveau backend lourd, pas de CMS complexe.
- Pas de stockage vidéo local (YouTube héberge).
- Pas de système de paiement propriétaire (Étoiles Telegram uniquement).
- Pas de duplication de contenu Telegram (métadonnées uniquement).
- Pas de secrets dans le frontend ni dans les URLs (`initData` uniquement en en-tête pour studio/me).
