# Scénarios de test — Pesce Studio

**Prérequis**

- Déploiement en ligne : `https://pesce-creator.vercel.app/`.
- Bot `@PesceStudioBot` administrateur du canal `@PesceHounyoOfficiel` ; webhook `message`, `channel_post`, `pre_checkout_query`.
- **Mini App principale déclarée dans BotFather** (nécessaire pour les liens `?startapp=` — scénario D ; sinon utiliser la forme `https://t.me/PesceStudioBot/app?startapp=…`).
- Deux comptes Telegram : le compte créatrice (Pesce) et un second compte « public ».
- Un navigateur de bureau (pour la porte d’entrée) + Telegram mobile/desktop.
- Toute modification d’env Vercel exige un **redéploiement** pour prendre effet.

## A. Utilisateur public — identifiant créatrice NON configuré

1. Ouvrir le Mini App : aucune erreur, l’accueil s’affiche.
2. **Aucune affordance studio** : pas de bouton « Studio » (topbar), rien dans la nav, rien dans le DOM (`#studioButton` masqué), aucune requête vers `studio.js`/`studio.css` dans l’onglet réseau.
3. `?startapp=studio` → accueil, silencieux, aucun popup.
4. Rails d’accueil : derniers articles, vidéos, audios alimentés depuis le canal ; rails vides masqués ; carte vide unique si aucun contenu.
5. Sections Publications / Vidéos / Audios / Photos : chargées, états vides en français, vidéos du canal dans l’onglet Vidéos (plus de « 121 vidéos » en dur).
6. « Soutenir » : la nav et le CTA ouvrent la section Soutenir (carte Étoiles uniquement là, jamais flottante au-dessus des autres sections) ; les 5 montants sont sélectionnables.
7. Aide : carte du bot `@PesceStudioBot` présente ; le formulaire envoie (avec sujet) ; confirmation « Le bot Pesce Studio vous répondra » ; la créatrice reçoit la notification (plural env uniquement).
8. `?startapp=support` → ouvre la section Aide.
9. Surbrillance de la nav correcte sur chaque section (y compris Soutenir).
10. `/support` et `/paysupport` au bot → session de support → ticket créé.

## B. Créatrice — identifiant PAS encore configuré

1. Elle ouvre le Mini App : accueil normal, identique à un visiteur, aucune erreur, aucun popup.
2. `?startapp=studio` → accueil, silencieux (le studio est masqué tant que l’ID n’est pas configuré).
3. `curl /api/me` avec son initData → `isCreator: false`, `creatorConfigured: false` ; un avertissement apparaît une fois dans les logs Vercel.

## C. Créatrice — identifiant configuré (redéployer après ajout de l’env)

1. Le bouton « Studio » apparaît (et réapparaît instantanément à la réouverture grâce au cache de session).
2. Ouverture du studio sans popup 403 ; KPIs (dont Vidéos), brouillons, tickets, paiements affichés.
3. Publication texte → message sur le canal avec bouton ⭐ Soutenir → apparaît dans le Mini App (Publications + rail articles).
4. **Article Telegraph** : titre + texte → page telegra.ph créée, post canal avec le lien et le bouton ⭐ ; le Mini App affiche « Lire l’article ». (Si `TELEGRAPH_ACCESS_TOKEN` absent : « Configurer Telegraph » → jeton affiché → enregistrer dans Vercel → redéployer.)
5. Brouillon : enregistré, repris, visible après rechargement.
6. Backfill : `X bouton(s) ajouté(s) sur Y publication(s) vérifiée(s)`.
7. Tickets : « Répondre » envoie un DM au demandeur et marque le ticket ; « Résoudre » clôt le ticket.
8. `/studio` au bot (créatrice) → lien privé ; le second compte ne reçoit **aucune** réponse.
9. Le second compte (public) ne voit toujours aucune affordance studio ; `GET /api/studio` avec son initData → 403.
10. `curl /api/me` (créatrice) → `isCreator: true`.

## Directs

1. Studio : planifier un direct (titre, description, date/heure, lien, statut « Programmé ») → il apparaît dans la liste du studio.
2. Accueil public : le bloc « Prochain direct » apparaît avec le titre, la date convertie dans le fuseau du visiteur et le bouton « Rejoindre le direct » (si lien).
3. Sans direct programmé/en cours : le bloc est totalement absent de l’accueil.
4. Statut « En direct » → le bloc affiche le badge rouge et « Regarder le direct ».
5. Modifier un direct (changer titre/heure) → l’accueil reflète la modification.
6. Annuler un direct → il disparaît de l’accueil, reste visible (annulé) dans le studio.
7. « Terminé » → disparaît de l’accueil, reste visible (terminé) dans le studio.
8. `GET /api/live` : sans en-tête → 200 `{ lives }` ; `live_create`/`live_update`/`live_cancel` sur `/api/studio` sans initData → 401 ; avec un compte non créatrice → 403.

## D. Liens profonds

| Lien | Attendu |
|---|---|
| D1 `https://t.me/PesceStudioBot?startapp=support` | section Aide |
| D2 `https://t.me/PesceStudioBot?startapp=studio` | studio (créatrice) / accueil silencieux (autres) |
| D3 `https://t.me/PesceStudioBot?startapp` | accueil |
| D4 bouton `/start` du bot | accueil (Mini App) |
| D5 bouton ⭐ d’un post du canal | section Aide (`?startapp=support`) |

Si D1/D2/D5 n’ouvrent pas l’app : déclarer la Mini App principale dans BotFather, ou passer les constantes à la forme `t.me/PesceStudioBot/app?startapp=…`.

## E. Publications directes sur le canal Telegram

Publier depuis l’app Telegram (compte de la chaîne), puis vérifier la base PostgreSQL/Neon (table `pesce_posts`) + Mini App :

1. Texte seul → post « text » → rail articles + Publications.
2. Photo (± légende) → « photo » → Photos + rail photos.
3. Audio / note vocale → « audio » → Audios + rail audios.
4. Vidéo < 20 Mo → « video » → Vidéos + rail vidéos (lecture OK).
5. Vidéo > 20 Mo → le lecteur échoue (limite `getFile` 20 Mo) mais « Voir sur Telegram » fonctionne.
6. Document → « document » → Publications (flux mixte).
7. Chaque post porte le bouton ⭐ Soutenir (attaché par le webhook).

## F. Étoiles

1. Les 5 montants sont sélectionnables ; l’invoice s’ouvre.
2. Annulation / échec → messages français attendus.
3. Paiement réussi → `pesce_payments` créé, message de remerciement du bot, créatrice notifiée, KPI Étoiles du studio incrémenté.
4. `POST /api/create-invoice` avec `stars: 7` → 400 (plus de montant par défaut silencieux).

## G. Régression

1. `/api/media?file_id=…` sans jeton → 403 ; jeton expiré → 403 ; jeton valide (via `/api/content`) → 200.
2. `/api/content?type=bogus` → 200, flux complet (pas d’erreur).
3. Navigateur hors Telegram → porte d’entrée uniquement.
4. Source HTML de `/` : `#studioButton` avec `hidden`, aucun `<script src="./studio.js">`.
5. Support mini app envoyé avec uniquement `PESCE_CREATOR_TELEGRAM_USER_IDS` (plural) configuré → la créatrice est notifiée (bug corrigé).
6. Sans `TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET` → le webhook fonctionne et un avertissement unique apparaît dans les logs.

## H. Matrice curl post-déploiement

| Requête | Attendu |
|---|---|
| `GET /api/me` (sans en-tête) | 401 |
| `GET /api/me` (initData falsifiée) | 401 |
| `GET /api/me` (initData réelle, env créatrice absent) | 200 `isCreator:false, creatorConfigured:false` |
| `GET /api/me` (initData réelle, env créatrice présent) | 200 `isCreator:true` |
| `GET /api/content?limit=30` | 200, `channel.username` correct |
| `GET /api/studio` (sans en-tête) | 401 |
| `GET /api/studio` (initData non-créatrice) | 403 |
| `POST /api/telegram-pesce-studio.webhook` (mauvais secret) | 401 |

## Local

```bash
cd app/frontend
node --check app.js && node --check studio.js && node --check constants.js
npm test        # node:test, aucune dépendance nécessaire
```

Pour un essai d’API local : `vercel dev`, puis copier une `initData` fraîche depuis le Mini App en cours (valide 24 h) et l’envoyer dans l’en-tête `x-telegram-init-data`.
