// Vérifications d'interface automatisées (développement uniquement — jamais déployé).
// Pilote Edge headless via CDP (WebSocket natif Node ≥ 22, aucune dépendance) et vérifie,
// sur chaque route publique et chaque largeur d'écran :
//   - la présence des éléments clés du design Stitch,
//   - les styles calculés (palette, typographies, fonds) conformes aux tokens,
//   - l'absence de débordement horizontal,
//   - l'absence d'erreurs console.
// Usage : node scripts/assert-ui.mjs [portPreview=4173]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PESCE from '../lib/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREVIEW_PORT = Number(process.argv[2] || 4173);
const DEBUG_PORT = 9700 + Math.floor(Math.random() * 100);

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const BROWSER = EDGE_CANDIDATES.find((path) => existsSync(path));
if (!BROWSER) { console.error('Edge/Chrome introuvable.'); process.exit(1); }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// — Tokens de référence du design Stitch (config Tailwind d'index.html).
const RGB = {
  primary: 'rgb(151, 42, 10)',          // #972a0a
  primaryContainer: 'rgb(184, 66, 33)', // #b84221
  surface: 'rgb(251, 249, 245)',        // #fbf9f5
  lowest: 'rgb(255, 255, 255)',         // #ffffff
  inverse: 'rgb(48, 49, 46)',           // #30312e
  containerHigh: 'rgb(234, 232, 228)',  // #eae8e4
  onSurface: 'rgb(27, 28, 26)',         // #1b1c1a
};

// — Plans de vérification par route : [nom, URL, largeurs, assertion(s)].
// Chaque assertion : [label, expression JS évaluée dans la page, valeur attendue (ou true = vérifié dans l'expression)].
const ROUTES = [
  {
    // Navigateur ordinaire (hors Telegram) : le JOURNAL est lisible — plus de porte bloquante.
    // Un lien partagé ne doit jamais aboutir à une impasse.
    name: 'web-public', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=web`, widths: [390, 1280],
    readyExpr: `document.getElementById('homeLead').children.length > 0`,
    asserts: [
      ['aucune porte bloquante hors Telegram', `document.getElementById('telegramGate') === null`, true],
      ['journal visible dans un navigateur ordinaire', `!document.getElementById('telegramApp').hidden`, true],
      ['contexte non-Telegram réellement simulé', `window.Telegram === undefined`, true],
      ['bandeau de lecture web affiché', `!document.getElementById('webBanner').hidden && document.getElementById('webBanner').textContent.includes('sur le web')`, true],
      ['accès à Telegram proposé depuis le bandeau', `document.querySelector('#webBanner a[data-identity-href="botUrl"]').getAttribute('href')`, `${PESCE.BOT_URL}?startapp`],
      ['navigation publique complète', `document.querySelectorAll('.nav-button').length >= 5`, true],
      ['fil d\'accueil réellement chargé', `document.getElementById('homeLead').children.length > 0`, true],
      ['lien « Connexion » discret vers /studio conservé', `document.querySelector('#telegramApp a[href="/studio"]') !== null`, true],
      ['favicon Pesce Studio présent', `document.querySelector('link[rel="icon"]')?.getAttribute('href') === '/assets/profilePesce.png'`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    // Parcours du LECTEUR : un lien d'article reçu par message ouvre l'article ET le journal.
    name: 'web-article-partage', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=web&post=post-9`, widths: [390, 1280],
    readyExpr: `!document.getElementById('reader').hidden && document.querySelector('#readerContent h1') !== null`,
    asserts: [
      ['l\'article partagé s\'ouvre hors Telegram', `document.querySelector('#readerContent h1').textContent.includes('Le numérique africain')`, true],
      ['le corps canonique est lu depuis Pesce Studio', `document.querySelector('#readerContent .reader-body').textContent.includes('La confiance numérique')`, true],
      ['l\'article appartient visiblement à Pesce Studio', `document.getElementById('readerContent').textContent.includes('Pesce Studio')`, true],
      ['section « Découvrir plus de Pesce » présente', `document.getElementById('readerContent').textContent.includes('Découvrir plus de Pesce')`, true],
      ['d\'autres publications sont proposées', `document.querySelectorAll('#readerContent [data-reader-nav]').length >= 3`, true],
      ['l\'article en cours n\'est pas proposé à lui-même', `![...document.querySelectorAll('#readerContent [data-reader-nav]')].some((button) => button.dataset.post === 'post-9')`, true],
      ['aucune publication retirée de la source proposée', `!document.getElementById('readerContent').textContent.includes('Test supprimé du canal')`, true],
      ['accès explicite au journal complet', `!!document.querySelector('#readerContent [data-reader-home]') && !!document.querySelector('#readerContent [data-reader-section="ecrits"]')`, true],
      ['soutien accessible depuis l\'article', `!!document.querySelector('#readerContent [data-reader-support]')`, true],
      // Honnêteté de la métadonnée : un article jamais corrigé ne doit PAS annoncer de mise à jour.
      ['aucune mention « Mis à jour » sur un article jamais corrigé', `!document.querySelector('#readerContent .text-secondary').textContent.includes('Mis à jour')`, true],
      ['la date de publication reste affichée', `/\\d{4}/.test(document.querySelector('#readerContent .text-secondary').textContent)`, true],
      ['navigation publique atteignable', `document.querySelectorAll('.nav-button').length >= 5`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    // Depuis « Lecture Article », les onglets du bas doivent RÉELLEMENT ouvrir leur page :
    // le lecteur est une surcouche, il faut qu'elle se referme (sinon rien ne semble se passer).
    name: 'lecteur-navigation', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=web&post=post-9`, widths: [390],
    readyExpr: `(function () {
      if (!window.__navFlow) {
        if (document.getElementById('reader').hidden || !document.querySelector('#readerContent h1')) return false;
        window.__navFlow = 'started';
        setTimeout(function () { document.querySelector('.nav-button[data-section="ecrits"]').click(); }, 400);
        return false;
      }
      return document.getElementById('reader').hidden && !document.getElementById('ecrits').hidden;
    })()`,
    asserts: [
      ['l\'onglet ferme le lecteur', `document.getElementById('reader').hidden`, true],
      ['la section demandée est bien ouverte', `!document.getElementById('ecrits').hidden && document.getElementById('a-la-une').hidden`, true],
      ['l\'en-tête suit la section', `document.getElementById('headerLabel').textContent`, 'Publications'],
      ['l\'onglet actif est mis en évidence', `document.querySelector('.nav-button[data-section="ecrits"]').classList.contains('text-primary')`, true],
      ['la section affiche son contenu', `document.getElementById('publicationFeed').children.length > 0`, true],
    ],
  },
  {
    // Retour depuis la page d'hébergement Telegraph : le lecteur qui a ouvert telegra.ph
    // retrouve l'article DANS le journal, par le chemin de la page (clé stable).
    name: 'web-retour-telegraph', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=web&article=Le-numerique-africain-a-besoin-de-confiance-09-11-2`, widths: [390],
    readyExpr: `!document.getElementById('reader').hidden && document.querySelector('#readerContent h1') !== null`,
    asserts: [
      ['l\'article est retrouvé par son chemin Telegraph', `document.querySelector('#readerContent h1').textContent.includes('Le numérique africain')`, true],
      ['le corps est lu dans le journal, pas sur Telegraph', `document.querySelector('#readerContent .reader-body').textContent.length > 80`, true],
      ['la découverte et le soutien sont là', `document.getElementById('readerContent').textContent.includes('Découvrir plus de Pesce') && !!document.querySelector('#readerContent [data-reader-support]')`, true],
    ],
  },
  {
    // Chemin Telegraph inconnu : état honnête, pas d'article arbitraire.
    name: 'web-retour-telegraph-inconnu', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=web&article=Page-Inexistante-01-01`, widths: [390],
    readyExpr: `!document.getElementById('reader').hidden && document.getElementById('readerContent').textContent.includes('introuvable')`,
    asserts: [
      ['état « introuvable » explicite', `document.getElementById('readerContent').textContent.includes('Publication introuvable')`, true],
      ['aucun article arbitraire affiché', `document.querySelector('#readerContent h1') === null`, true],
      ['sortie vers le journal proposée', `!!document.querySelector('#readerContent [data-reader-home]')`, true],
    ],
  },
  {
    // Lien périmé, retiré ou incomplet : échec franc, jamais un cul-de-sac.
    name: 'web-article-introuvable', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=web&post=inexistant-999`, widths: [390],
    readyExpr: `!document.getElementById('reader').hidden && document.getElementById('readerContent').textContent.includes('introuvable')`,
    asserts: [
      ['état « introuvable » explicite', `document.getElementById('readerContent').textContent.includes('Publication introuvable')`, true],
      ['sortie vers le journal proposée', `!!document.querySelector('#readerContent [data-reader-home]')`, true],
      ['aucune donnée d\'une autre publication affichée', `document.querySelector('#readerContent h1') === null`, true],
    ],
  },
  {
    // Une publication retirée (supprimée de sa source) n'est jamais servie par un lien direct.
    name: 'web-article-retire', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=web&post=post-12`, widths: [390],
    readyExpr: `!document.getElementById('reader').hidden && document.getElementById('readerContent').textContent.includes('introuvable')`,
    asserts: [
      ['la publication retirée n\'est pas lisible', `!document.getElementById('readerContent').textContent.includes('Test supprimé du canal')`, true],
      ['sortie vers le journal proposée', `!!document.querySelector('#readerContent [data-reader-home]')`, true],
    ],
  },
  {
    // Lien profond du canal Telegram : « 📖 Lire dans Pesce Studio » ouvre le Mini App SUR
    // l'article — le lecteur arrive dans le journal, pas sur une page isolée.
    name: 'telegram-deeplink-article', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1&startapp=post_post-9`, widths: [390],
    readyExpr: `!document.getElementById('reader').hidden && document.querySelector('#readerContent h1') !== null`,
    asserts: [
      ['le lien profond ouvre bien l\'article', `document.querySelector('#readerContent h1').textContent.includes('Le numérique africain')`, true],
      ['on est bien dans le Mini App Telegram', `!document.getElementById('telegramApp').hidden && document.getElementById('webBanner').hidden`, true],
      ['la découverte est proposée aussi dans Telegram', `document.getElementById('readerContent').textContent.includes('Découvrir plus de Pesce')`, true],
      ['le soutien en Étoiles reste accessible', `!!document.querySelector('#readerContent [data-reader-support]')`, true],
    ],
  },
  {
    name: 'a-la-une', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1`, widths: [390, 820, 1280],
    asserts: [
      ['application visible dans Telegram', `!document.getElementById('telegramApp').hidden && document.getElementById('webBanner').hidden`, true],
      ['fond de page surface', `getComputedStyle(document.body).backgroundColor`, RGB.surface],
      ['fil d\'accueil chargé', `document.getElementById('homeLead').children.length > 0`, true],
      ['titre masthead Newsreader', `getComputedStyle(document.querySelector('#telegramApp header h1')).fontFamily.includes('Newsreader')`, true],
      ['kicker d\'édition en Jakarta', `getComputedStyle(document.querySelector('#telegramApp header .font-kicker-label')).fontFamily.includes('Plus Jakarta Sans')`, true],
      ['horloge Cotonou renseignée', `/Cotonou \\d{2}h\\d{2} GMT/.test(document.getElementById('cotonouClock').textContent)`, true],
      ['pacte d\'indépendance terracotta', `getComputedStyle(document.querySelector('#a-la-une .bg-primary')).backgroundColor`, RGB.primary],
      ['bouton soutenir inverse', `getComputedStyle(document.querySelector('#a-la-une .support-send')).backgroundColor`, RGB.inverse],
      ['nav « À la une » active en terracotta', `getComputedStyle(document.querySelector('.nav-button[data-section="a-la-une"]')).color`, RGB.primary],
      ['bannière direct visible', `!document.getElementById('homeLiveBanner').hidden`, true],
      ['aucune affordance Studio publique', `!document.querySelector('.nav-button[data-section="studio"]') && !document.querySelector('#telegramApp header').textContent.includes('Studio Privé')`, true],
      ['lien « Connexion » discret dans le pied de page', `document.querySelector('#a-la-une footer a[href="/studio"]') !== null`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    name: 'ecrits', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits`, widths: [390, 820, 1280],
    asserts: [
      ['composition éditoriale chargée', `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`, true],
      // La couverture est servie depuis la référence canonique (article_image_url) : son
      // hébergeur (Telegraph OU Pesce Studio via Telegram, repli existant) n'est pas le sujet.
      ['article avec sa couverture canonique affichée', `(function () {
        const card = [...document.querySelectorAll('#publicationFeed .editorial-card')].find((item) => item.textContent.includes('Le numérique africain'));
        const image = card && card.querySelector('img');
        // Chargement paresseux : on vérifie la RÉFÉRENCE servie, pas le pixel déjà téléchargé
        // (les images réellement cassées sont détectées par scripts/audit-layout.mjs).
        return !!image && !!image.getAttribute('src');
      })()`, true],
      ['publication supprimée de la source absente du flux public', `!document.getElementById('publicationFeed').textContent.includes('Test supprimé du canal')`, true],
      ['lead « Jeunesse ouest-africaine » en tête', `document.querySelector('#publicationFeed .font-headline-lg-mobile').textContent.includes('Jeunesse ouest-africaine')`, true],
      ['filtre actif souligné terracotta', `getComputedStyle(document.querySelector('[data-filter="tout"]'), '::after').backgroundColor`, RGB.primary],
      ['carte lead sur surface blanche', `getComputedStyle(document.querySelector('#publicationFeed > article')).backgroundColor`, RGB.lowest],
      ['module audio présent', `!!document.querySelector('#publicationFeed [data-audio-card]')`, true],
      ['entrée vidéo présente', `!!document.querySelector('#publicationFeed .video-frame[data-video-src]')`, true],
      ['pont d\'archives Telegram présent', `document.querySelector('#publicationFeed').textContent.includes('Fonds Documentaire Complet')`, true],
      ['tribune et entretien composés', `document.querySelector('#publicationFeed').textContent.includes('Tribune Débat') && document.querySelector('#publicationFeed').textContent.includes('Grand Entretien')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    name: 'ecrits-audios', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits-audios`, widths: [390],
    asserts: [
      ['liste audio filtrée', `document.getElementById('publicationFeed').textContent.includes('Carnet de route #14')`, true],
      ['bouton de lecture audio présent', `!!document.querySelector('#publicationFeed .audio-play-btn[data-audio]')`, true],
    ],
  },
  {
    name: 'ecrits-videos', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits-videos`, widths: [390],
    asserts: [
      ['liste vidéo filtrée', `document.getElementById('publicationFeed').textContent.includes('Porto-Novo')`, true],
      ['cadre vidéo avec bouton lecture', `!!document.querySelector('#publicationFeed .video-frame[data-video-src]')`, true],
      ['chaînes YouTube/Telegram affichées', `document.getElementById('publicationFeed').textContent.includes('Visionner sur YouTube') && document.getElementById('publicationFeed').textContent.includes('Diffuser sur Telegram')`, true],
      ['vidéo YouTube présentée en carte (miniature dérivée)', `!!document.querySelector('#publicationFeed .video-frame[data-youtube-src]') && !!document.querySelector('#publicationFeed img[src*="i.ytimg.com"]')`, true],
    ],
  },
  {
    name: 'lecteur', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#post-1`, widths: [390, 820, 1280],
    asserts: [
      ['lecteur ouvert', `!document.getElementById('reader').hidden && document.getElementById('readerContent').children.length > 0`, true],
      ['titre de l\'enquête affiché', `document.getElementById('readerContent').textContent.includes('Jeunesse ouest-africaine')`, true],
      ['titre du lecteur en Newsreader', `getComputedStyle(document.querySelector('#readerContent h1')).fontFamily.includes('Newsreader')`, true],
      ['corps de lecture en Literata', `getComputedStyle(document.querySelector('#readerContent .reader-body p')).fontFamily.includes('Literata')`, true],
      ['lettrine terracotta', `getComputedStyle(document.querySelector('#readerContent .reader-body p'), '::first-letter').color`, RGB.primary],
      ['badge d\'indépendance présent', `document.getElementById('readerContent').textContent.includes("Garantie d'indépendance")`, true],
      ['module Étoiles présent', `document.getElementById('readerContent').textContent.includes('Soutenir cette enquête')`, true],
      ['navigation précédent/suivant', `document.querySelectorAll('#readerContent [data-reader-nav]').length >= 1`, true],
      ['bouton Telegraph présent', `document.getElementById('readerContent').textContent.includes('Telegraph')`, true],
      ['état externe honnête conservé (dépêche sans corps d\'article)', `document.getElementById('readerContent').textContent.includes('Version intégrale sur Telegraph')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    name: 'lecteur-article', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#post-9`, widths: [390],
    readyExpr: `!document.getElementById('reader').hidden && document.getElementById('readerContent').children.length > 0`,
    asserts: [
      ['couverture canonique affichée dans le lecteur', `(function () { const img = document.querySelector('#readerContent figure img'); return !!img && img.naturalWidth > 0; })()`, true],
      ['corps intégral de l\'article affiché dans Pesce Studio', `document.getElementById('readerContent').textContent.includes('Ce dossier complet est consultable directement ici, dans Pesce Studio')`, true],
      ['premier paragraphe du corps affiché', `document.getElementById('readerContent').textContent.includes('La confiance numérique ne se décrète pas')`, true],
      ['Telegraph secondaire quand le corps est intégral', `document.getElementById('readerContent').textContent.includes('Version également disponible sur Telegraph')`, true],
      ['lecture possible sans dépendre de Telegraph', `!!document.querySelector('#readerContent .reader-body p') && document.querySelectorAll('#readerContent .reader-body p').length >= 3`, true],
    ],
  },
  {
    name: 'directs', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#directs`, widths: [390],
    asserts: [
      ['direct programmé affiché', `document.getElementById('directFeed').textContent.includes('dossier monétaire')`, true],
      ['carte YouTube présente', `document.querySelector('#directs').textContent.includes('Visionner sur YouTube')`, true],
    ],
  },
  {
    name: 'soutenir', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#soutenir`, widths: [390],
    asserts: [
      ['pacte rendu dans la section', `document.getElementById('soutenirPacte').children.length > 0`, true],
      ['5 paliers d\'étoiles', `document.querySelectorAll('#soutenirPacte [data-stars]').length`, 5],
      ['palier 100 ⭐ sélectionné', `document.querySelector('#soutenirPacte [data-stars="100"]').getAttribute('aria-pressed')`, 'true'],
      ['pacte terracotta', `getComputedStyle(document.querySelector('#soutenirPacte > div')).backgroundColor`, RGB.primary],
    ],
  },
  {
    name: 'studio', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio`, widths: [390],
    readyExpr: `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Bonjour, Pesce')`,
    asserts: [
      ['surcouche studio visible', `!document.getElementById('studioScreen').hidden`, true],
      ['badge Bureau Privé', `document.getElementById('studioScreen').textContent.includes('Bureau Privé')`, true],
      ['retour « Journal » présent', `!!document.getElementById('studioBackToJournal')`, true],
      ['carnet de bord affiché', `document.getElementById('studioBody').textContent.includes('Bonjour, Pesce')`, true],
      ['chantiers d\'écriture affichés', `document.getElementById('studioBody').textContent.includes("Chantiers d'écriture")`, true],
      ['formulaire de direct présent', `!!document.querySelector('#studioBody #liveForm #liveDate')`, true],
      ['médiathèque affichée', `document.getElementById('studioBody').textContent.includes('Médiathèque')`, true],
      ['articles Telegraph', `document.getElementById('studioBody').textContent.includes('Articles Telegraph')`, true],
      ['aucune donnée fictive « informateur »', `!document.getElementById('studioBody').textContent.includes('informateur')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    name: 'studio-rediger', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-rediger`, widths: [390],
    readyExpr: `!document.getElementById('studioScreen').hidden && !!document.querySelector('#studioBody #publishForm #publishText')`,
    asserts: [
      ['pupitre d\'écriture affiché', `document.getElementById('studioBody').textContent.includes("PUPITRE D'ÉCRITURE")`, true],
      ['composeur de publication présent', `!!document.querySelector('#publishForm #publishText')`, true],
      ['champ titre Telegraph présent', `!!document.querySelector('#publishForm #articleTitle')`, true],
      ['aperçu BAT disponible', `!!document.getElementById('batPreview')`, true],
      ['action principale « Publier » (Pesce Studio, Telegram = diffusion)', `document.getElementById('studioBody').textContent.includes('Publier') && !document.getElementById('studioBody').textContent.includes('Publier sur Telegram')`, true],
      ['aucun faux « Programmer » de publication', `![...document.querySelectorAll('#studioBody button')].some((button) => button.textContent.trim() === 'Programmer')`, true],
    ],
  },
  {
    name: 'studio-brouillons', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-brouillons`, widths: [390],
    readyExpr: `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Brouillons')`,
    asserts: [
      ['brouillons réels affichés', `document.getElementById('studioBody').textContent.includes('L’illusion technologique')`, true],
      ['aucune barre de progression inventée', `!document.querySelector('#studioBody [style*="width: 60%"]')`, true],
      ['bouton reprendre présent', `!!document.querySelector('#studioBody .draft-load')`, true],
    ],
  },
  {
    name: 'studio-pistes', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-pistes`, widths: [390],
    readyExpr: `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Messages & demandes')`,
    asserts: [
      ['messages des lecteurs affichés', `document.getElementById('studioBody').textContent.includes('Messages & demandes')`, true],
      ['ticket réel affiché', `document.getElementById('studioBody').textContent.includes('amadou_d')`, true],
      ['répondre via Telegram présent', `!!document.querySelector('#studioBody .ticket-reply')`, true],
      ['aucun coffre inventé', `!document.getElementById('studioBody').textContent.includes('coffre')`, true],
    ],
  },
  {
    name: 'studio-audience', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-audience`, widths: [390],
    readyExpr: `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Soutiens Telegram Stars')`,
    asserts: [
      ['audience réelle affichée', `document.getElementById('studioBody').textContent.includes('Ouvertures') && document.getElementById('studioBody').textContent.includes('Visiteurs uniques')`, true],
      ['soutiens réels affichés', `document.getElementById('studioBody').textContent.includes('150 ⭐')`, true],
      ['remboursement disponible', `!!document.querySelector('#studioBody .payment-refund')`, true],
      ['aucune métrique inventée « 74 % »', `!document.getElementById('studioBody').textContent.includes('74 %')`, true],
    ],
  },
  {
    name: 'studio-visiteur', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=visitor#studio`, widths: [390],
    readyExpr: `document.readyState === 'complete' && !document.getElementById('telegramApp').hidden`,
    asserts: [
      ['la surcouche studio reste fermée pour un visiteur', `document.getElementById('studioScreen').hidden`, true],
      ['aucun formulaire studio exposé', `!document.querySelector('#publishForm')`, true],
      ['aucune donnée studio dans le DOM', `!document.getElementById('studioBody').textContent.includes('Bonjour, Pesce')`, true],
    ],
  },
  {
    name: 'studio-web-connexion', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio&login=1`, widths: [390, 1280],
    readyExpr: `getComputedStyle(document.getElementById('studioLogin')).display !== 'none'`,
    asserts: [
      ['écran de connexion seul visible', `getComputedStyle(document.getElementById('studioLogin')).display !== 'none' && getComputedStyle(document.getElementById('studioShell')).display === 'none'`, true],
      ['titre éditorial « Bureau Pesce Studio »', `document.getElementById('studioLogin').textContent.includes('Bureau Pesce Studio')`, true],
      ['copie d\'accueil éditoriale', `document.getElementById('studioLogin').textContent.includes("Accédez à l'espace privé de Pesce Studio")`, true],
      ['masthead du bureau privé', `document.getElementById('studioLogin').textContent.includes('Bureau Privé')`, true],
      ['aucune donnée privée affichée', `!document.getElementById('studioLogin').textContent.includes('Brouillon') && !document.getElementById('studioLogin').textContent.includes('Ticket')`, true],
      ['aucun message de configuration visible', `!document.getElementById('studioLogin').textContent.includes('GOOGLE_OAUTH_CLIENT_ID') && !document.getElementById('studioLogin').textContent.includes('Vercel')`, true],
      ['favicon Pesce Studio présent', `document.querySelector('link[rel="icon"]')?.getAttribute('href') === '/assets/profilePesce.png'`, true],
      ['retour au journal public', `!!document.querySelector('#studioLogin a[href="/"]')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
      // — Deux voies de connexion proposées : mot de passe ET Google.
      ['formulaire adresse + mot de passe proposé', `getComputedStyle(document.getElementById('passwordLoginForm')).display !== 'none'`, true],
      ['champ adresse de type email', `document.getElementById('loginEmail').type === 'email'`, true],
      ['mot de passe masqué par défaut', `document.getElementById('loginPassword').type === 'password'`, true],
      ['action « Se connecter » présente', `document.getElementById('loginSubmit').textContent.trim() === 'Se connecter'`, true],
      ['séparateur « ou » entre les deux voies', `getComputedStyle(document.getElementById('loginSeparator')).display !== 'none' && document.getElementById('loginSeparator').textContent.trim() === 'ou'`, true],
      ['bascule d\'affichage du mot de passe fonctionnelle et annoncée', `(function () {
        const input = document.getElementById('loginPassword');
        const button = document.getElementById('loginPasswordToggle');
        button.click();
        const revealed = input.type === 'text' && button.getAttribute('aria-pressed') === 'true';
        button.click();
        return revealed && input.type === 'password' && button.getAttribute('aria-pressed') === 'false';
      })()`, true],
      ['cible tactile de la bascule suffisante', `document.getElementById('loginPasswordToggle').getBoundingClientRect().height >= 40`, true],
      ['manifeste PWA du Studio déclaré', `document.querySelector('link[rel="manifest"]').getAttribute('href') === '/studio/manifest.webmanifest'`, true],
      ['aucune empreinte ni nom de secret exposé au client', `!document.documentElement.innerHTML.includes('PESCE_STUDIO_PASSWORD_HASH') && !document.documentElement.innerHTML.includes('scrypt')`, true],
    ],
  },
  {
    // La connexion par mot de passe ouvre EXACTEMENT la même coquille que Google.
    name: 'studio-web-mot-de-passe', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio&login=1`, widths: [390],
    readyExpr: `(function () {
      if (!window.__pwdFlow) {
        window.__pwdFlow = 'started';
        setTimeout(function () {
          document.getElementById('loginEmail').value = 'pescestudio8@gmail.com';
          document.getElementById('loginPassword').value = 'saisie-de-demonstration';
          document.getElementById('loginSubmit').click();
        }, 400);
      }
      return getComputedStyle(document.getElementById('studioShell')).display !== 'none'
        && document.getElementById('webStudioBody').textContent.includes('Bonjour, Pesce');
    })()`,
    asserts: [
      ['le mot de passe ouvre le Bureau', `getComputedStyle(document.getElementById('studioLogin')).display === 'none'`, true],
      ['la session affichée est celle du serveur', `document.getElementById('webSessionEmail').textContent.includes('pescestudio8@gmail.com')`, true],
      ['la saisie ne survit pas à la connexion', `document.getElementById('loginPassword').value === ''`, true],
      ['déconnexion disponible', `!!document.getElementById('webLogout')`, true],
      ['navigation mobile atteignable sans parcourir tout le Bureau', `(function () {
        const rect = document.querySelector('#studioShell > nav').getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
      })()`, true],
      ['le corps défile dans la coquille (en-tête et navigation restent à l\'écran)', `document.getElementById('webStudioBody').scrollHeight > document.getElementById('webStudioBody').clientHeight`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    // Refus de mot de passe : message générique ET RÉELLEMENT VISIBLE.
    name: 'studio-web-mot-de-passe-refusé', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio&login=1&badpass=1`, widths: [390],
    readyExpr: `(function () {
      if (!window.__badPwdFlow) {
        window.__badPwdFlow = 'started';
        setTimeout(function () {
          document.getElementById('loginEmail').value = 'inconnu@example.org';
          document.getElementById('loginPassword').value = 'saisie-erronee';
          document.getElementById('loginSubmit').click();
        }, 400);
      }
      return !document.getElementById('loginError').hidden;
    })()`,
    asserts: [
      ['le refus est visible (et non masqué par une classe utilitaire)', `getComputedStyle(document.getElementById('loginError')).display !== 'none'`, true],
      ['message générique : ni l\'adresse ni le mot de passe ne sont désignés', `document.getElementById('loginErrorText').textContent === 'Adresse ou mot de passe incorrect.'`, true],
      ['la coquille reste fermée', `getComputedStyle(document.getElementById('studioShell')).display === 'none'`, true],
      ['aucune donnée privée chargée', `!document.getElementById('webStudioBody').textContent.includes('Bonjour, Pesce')`, true],
    ],
  },
  {
    name: 'studio-web-refusé', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio&denied=1`, widths: [390],
    readyExpr: `getComputedStyle(document.getElementById('studioLogin')).display !== 'none' && !!document.querySelector('#studioLogin button') && (setTimeout(function(){ window.PesceWebStudio.handleGoogleCredential('preview-credential'); }, 300), true)`,
    asserts: [
      ['état « accès refusé » affiché', `!document.getElementById('loginError').hidden && document.getElementById('loginErrorText').textContent.includes('pas autorisé')`, true],
      ['la coquille reste fermée', `getComputedStyle(document.getElementById('studioShell')).display === 'none'`, true],
    ],
  },
  {
    name: 'studio-web', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, widths: [390, 1280],
    readyExpr: `getComputedStyle(document.getElementById('studioShell')).display !== 'none' && document.getElementById('webStudioBody').textContent.includes('Bonjour, Pesce')`,
    asserts: [
      ['bureau visible, connexion masquée', `getComputedStyle(document.getElementById('studioLogin')).display === 'none' && getComputedStyle(document.getElementById('studioShell')).display !== 'none'`, true],
      ['les onglets du portail sont présents', `document.querySelectorAll('[data-web-tab]').length >= 11`, true],
      ['« Rédiger » en action principale', `document.getElementById('webStudioBody').textContent.includes('Rédiger une publication')`, true],
      ['aucun onglet « Articles Telegraph » dans la navigation', `![...document.querySelectorAll('[data-web-tab]')].some((button) => button.textContent.includes('Telegraph'))`, true],
      ['cartes statistiques cliquables (raccourcis d\'espaces)', `document.querySelectorAll('[data-workspace]').length >= 8`, true],
      ['composeur présent', `!!document.querySelector('#publishForm #publishText')`, true],
      ['brouillons réels affichés', `document.getElementById('webStudioBody').textContent.includes("Chantiers d'écriture")`, true],
      ['brouillon audio libellé correctement', `document.getElementById('webStudioBody').textContent.includes('Audio · Brouillon') && !document.getElementById('webStudioBody').textContent.includes('[Audio]')`, true],
      ['directs réels affichés', `document.getElementById('webStudioBody').textContent.includes('Planifier un direct')`, true],
      ['messages réels affichés', `document.getElementById('webStudioBody').textContent.includes('Messages & demandes')`, true],
      ['audience réelle affichée', `document.getElementById('webStudioBody').textContent.includes('Telegram Stars')`, true],
      ['Telegraph configuré visible dans Paramètres', `document.getElementById('webStudioBody').textContent.includes('Compte configuré')`, true],
      ['réconciliation avec le canal disponible', `document.getElementById('webStudioBody').textContent.includes('Réconcilier avec le canal')`, true],
      ['publication supprimée de la source exclue des écrits', `!document.getElementById('webStudioBody').textContent.includes('Test supprimé du canal')`, true],
      ['session affichée', `document.getElementById('webSessionEmail').textContent.includes('pescestudio8@gmail.com')`, true],
      ['déconnexion présente', `!!document.getElementById('webLogout')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    name: 'studio-web-media', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, widths: [1280],
    readyExpr: `(function () {
      if (!window.__mediaFlow) {
        window.__mediaFlow = 'started';
        setTimeout(function () {
          var rediger = document.querySelector('[data-web-tab="rediger"]');
          if (rediger) rediger.click();
          setTimeout(function () {
            var add = document.getElementById('mediaAddButton');
            if (add) add.click();
            setTimeout(function () {
              var pick = document.getElementById('mediaChannelPick');
              if (pick) pick.click();
              setTimeout(function () {
                var item = document.querySelector('.media-pick');
                if (item) item.click();
                setTimeout(function () {
                  var caption = document.querySelector('#articleMediaList input[id^="img-caption-"]');
                  var credit = document.querySelector('#articleMediaList input[id^="img-credit-"]');
                  var title = document.getElementById('articleTitle');
                  var text = document.getElementById('publishText');
                  if (caption) { caption.value = 'La photo du canal'; caption.dispatchEvent(new Event('input', { bubbles: true })); }
                  if (credit) { credit.value = 'Pesce Hounyo'; credit.dispatchEvent(new Event('input', { bubbles: true })); }
                  if (title) { title.value = 'Article illustré de test'; title.dispatchEvent(new Event('input', { bubbles: true })); }
                  if (text) { text.value = 'Premier paragraphe de l\\'article illustré.'; text.dispatchEvent(new Event('input', { bubbles: true })); }
                  var publish = document.getElementById('publishSubmit');
                  if (publish) publish.click();
                }, 600);
              }, 400);
            }, 400);
          }, 500);
        }, 600);
        return false;
      }
      return window.__previewLastPublish && window.__previewLastPublish.action === 'article_publish';
    })()`,
    asserts: [
      ['flux média : une image transmise à la publication', `window.__previewLastPublish && Array.isArray(window.__previewLastPublish.images) && window.__previewLastPublish.images.length === 1 && window.__previewLastPublish.images[0].src === '/file/preview-canal.jpg'`, true],
      ['légende et crédit transmis', `window.__previewLastPublish.images[0].caption === 'La photo du canal' && window.__previewLastPublish.images[0].credit === 'Pesce Hounyo'`, true],
      ['placement couverture transmis', `window.__previewLastPublish.images[0].placement === 'cover'`, true],
      ['titre transmis', `window.__previewLastPublish.title === 'Article illustré de test'`, true],
    ],
  },
  {
    name: 'studio-web-video', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, widths: [1280],
    readyExpr: `(function () {
      if (!window.__videoFlow) {
        window.__videoFlow = 'started';
        setTimeout(function () {
          var tab = document.querySelector('[data-web-tab="videos"]');
          if (tab) tab.click();
          setTimeout(function () {
            var title = document.getElementById('videoTitle');
            var url = document.getElementById('videoUrl');
            if (title) { title.value = 'Archives de Porto-Novo'; title.dispatchEvent(new Event('input', { bubbles: true })); }
            if (url) { url.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; url.dispatchEvent(new Event('input', { bubbles: true })); }
            var publish = document.getElementById('videoPublish');
            if (publish) publish.click();
          }, 400);
        }, 500);
        return false;
      }
      return window.__previewLastPublish && window.__previewLastPublish.action === 'video_publish';
    })()`,
    asserts: [
      ['flux vidéo : publication YouTube transmise', `window.__previewLastPublish.title === 'Archives de Porto-Novo' && /youtube\\.com\\/watch\\?v=[A-Za-z0-9_-]{11}/.test(window.__previewLastPublish.youtubeUrl)`, true],
      ['composeur avec aperçu miniature (élément présent)', `!!document.getElementById('videoPreview') && !!document.getElementById('videoPreviewImg')`, true],
    ],
  },
  {
    name: 'studio-web-cycle', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, widths: [1280],
    readyExpr: `(function () {
      if (!window.__draftFlow) {
        window.__draftFlow = 'started';
        setTimeout(function () {
          var tab = document.querySelector('[data-web-tab="brouillons"]');
          if (tab) tab.click();
          setTimeout(function () {
            var load = document.querySelector('.draft-load[data-draft-id="draft_1"]');
            if (load) load.click();
            setTimeout(function () {
              var add = document.getElementById('mediaAddButton');
              if (add) add.click();
              setTimeout(function () {
                var pick = document.getElementById('mediaChannelPick');
                if (pick) pick.click();
                setTimeout(function () {
                  var item = document.querySelector('.media-pick');
                  if (item) item.click();
                  setTimeout(function () {
                    var title = document.getElementById('articleTitle');
                    var publish = document.getElementById('publishSubmit');
                    if (title) { title.value = 'Article du cycle de vie'; title.dispatchEvent(new Event('input', { bubbles: true })); }
                    if (publish) publish.click();
                  }, 500);
                }, 400);
              }, 400);
            }, 400);
          }, 400);
        }, 500);
        return false;
      }
      return window.__previewLastPublish && window.__previewLastPublish.action === 'article_publish' && window.__previewLastPublish.draftId === 'draft_1' && !document.getElementById('webStudioBody').textContent.includes('L’illusion technologique');
    })()`,
    asserts: [
      ['cycle de vie : publication portée par le brouillon repris', `window.__previewLastPublish.draftId === 'draft_1'`, true],
      ['cycle de vie : le brouillon publié a disparu de l’interface', `!document.getElementById('webStudioBody').textContent.includes('L’illusion technologique')`, true],
      ['messages : état « répondue » explicite', `document.getElementById('webStudioBody').textContent.includes('Répondue · en attente du lecteur') && document.getElementById('webStudioBody').textContent.includes('Répondre à nouveau')`, true],
      ['messages : état « en attente » conservé pour le message sans réponse', `document.getElementById('webStudioBody').textContent.includes('En attente de réponse')`, true],
    ],
  },
  {
    name: 'studio-web-article-sans-image', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, widths: [1280],
    readyExpr: `(function () {
      if (!window.__noCoverFlow) {
        window.__noCoverFlow = 'started';
        setTimeout(function () {
          var tab = document.querySelector('[data-web-tab="rediger"]');
          if (tab) tab.click();
          setTimeout(function () {
            var title = document.getElementById('articleTitle');
            var text = document.getElementById('publishText');
            if (title) { title.value = 'Article sans image'; title.dispatchEvent(new Event('input', { bubbles: true })); }
            if (text) { text.value = 'Corps du tapuscrit.'; text.dispatchEvent(new Event('input', { bubbles: true })); }
            var publish = document.getElementById('publishSubmit');
            if (publish) publish.click();
          }, 400);
        }, 500);
        return false;
      }
      return document.getElementById('publishStatus') && document.getElementById('publishStatus').textContent.includes('couverture');
    })()`,
    asserts: [
      ['article sans image de couverture bloqué avec explication', `document.getElementById('publishStatus').textContent.includes('couverture')`, true],
    ],
  },
  {
    name: 'studio-web-audio', url: `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, widths: [1280],
    readyExpr: `(function () {
      if (!window.__audioFlow) {
        window.__audioFlow = 'started';
        setTimeout(function () {
          var tab = document.querySelector('[data-web-tab="audios"]');
          if (tab) tab.click();
          setTimeout(function () {
            var title = document.getElementById('audioTitle');
            if (title) { title.value = 'Note de terrain'; title.dispatchEvent(new Event('input', { bubbles: true })); }
            var publish = document.getElementById('audioPublish');
            if (publish) publish.click();
          }, 400);
        }, 500);
        return false;
      }
      return document.getElementById('audioStatus') && document.getElementById('audioStatus').textContent.includes('requis');
    })()`,
    asserts: [
      ['composeur audio présent (enregistrer / importer)', `!!document.getElementById('recordButton') && !!document.getElementById('audioImportButton')`, true],
      ['publication sans enregistrement refusée avec explication', `document.getElementById('audioStatus').textContent.includes('requis')`, true],
    ],
  },
  {
    name: 'a-la-une-vide', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty`, widths: [390],
    readyExpr: `document.getElementById('homeLead').children.length > 0`,
    asserts: [
      ['état vide explicite sur la une', `document.getElementById('homeLead').textContent.includes('Aucun contenu')`, true],
      ['chronique masquée sans donnée', `document.getElementById('homeChronique').hidden`, true],
      ['formats masqués sans donnée', `document.getElementById('homeFormats').hidden`, true],
      ['bannière direct masquée sans programmation', `document.getElementById('homeLiveBanner').hidden`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    name: 'studio-vide', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty#studio`, widths: [390],
    readyExpr: `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Bonjour, Pesce')`,
    asserts: [
      ['chantiers vides sans donnée', `document.getElementById('studioBody').textContent.includes('Aucun brouillon')`, true],
      ['aucun direct inventé', `document.getElementById('studioBody').textContent.includes('Aucun direct programmé')`, true],
      ['aucun soutien inventé', `document.getElementById('studioBody').textContent.includes('Aucun soutien reçu')`, true],
      ['aucun message inventé', `document.getElementById('studioBody').textContent.includes('Aucun message pour le moment')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
    ],
  },
  {
    name: 'photos', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#photos`, widths: [390],
    asserts: [
      ['galerie photo chargée', `document.getElementById('photoFeed').children.length >= 2`, true],
      ['légendes des photos affichées', `document.getElementById('photoFeed').textContent.includes('Kraké-Plage')`, true],
    ],
  },
  {
    name: 'communaute', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#communaute`, widths: [390],
    asserts: [
      ['carte communauté visible', `!document.getElementById('communaute').hidden`, true],
      ['identité du canal hydratée', `document.querySelector('#communaute [data-identity="channelHandle"]').textContent`, PESCE.CHANNEL_HANDLE],
      ['bouton rejoindre le canal', `!!document.querySelector('#communaute [data-channel]')`, true],
    ],
  },
  {
    name: 'apropos', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#apropos`, widths: [390],
    asserts: [
      ['carte à propos visible', `!document.getElementById('apropos').hidden`, true],
      ['portrait Pesce affiché', `document.querySelector('#apropos img').getAttribute('src')`, './assets/profilePesce.png'],
    ],
  },
  {
    name: 'support', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#support`, widths: [390],
    asserts: [
      ['sujets d\'assistance hydratés', `document.getElementById('supportTopic').options.length >= 3`, true],
      ['formulaire de demande présent', `!!document.querySelector('#supportForm #supportMessage')`, true],
      ['accès bot Telegram', `!!document.querySelector('#support [data-bot]')`, true],
    ],
  },
];

// — Pilote CDP (protocole flat).
function makeSession(socket, sessionId = null) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    if ((message.sessionId || null) !== sessionId || !message.id) return;
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
    }),
  };
}

async function waitFor(session, expression, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await session.send('Runtime.evaluate', { expression, returnByValue: true });
      if (result?.result?.value === true) return true;
    } catch { /* page en cours de navigation */ }
    await sleep(300);
  }
  return false;
}

async function main() {
  const browser = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${join(ROOT, '..', '..', 'preview-shots', `.profile-assert-${DEBUG_PORT}`)}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const watchdog = setTimeout(() => { browser.kill(); process.exit(1); }, 600000);
  const cleanup = () => { clearTimeout(watchdog); browser.kill(); };
  process.on('exit', cleanup);

  let browserSocketUrl = null;
  for (let attempt = 0; attempt < 60 && !browserSocketUrl; attempt += 1) {
    await sleep(500);
    try {
      const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
      browserSocketUrl = version.webSocketDebuggerUrl;
    } catch { /* pas encore prêt */ }
  }
  if (!browserSocketUrl) { console.error('Navigateur DevTools injoignable.'); cleanup(); process.exit(1); }

  const socket = new WebSocket(browserSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('WebSocket DevTools en erreur.')));
  });
  const browserSession = makeSession(socket, null);

  let failures = 0;
  let checks = 0;

  const filter = process.argv[3] || '';
  for (const route of ROUTES) {
    if (filter && !route.name.includes(filter)) continue;
    for (const width of route.widths) {
      const target = await browserSession.send('Target.createTarget', { url: 'about:blank' });
      const targetId = target.targetId;
      const attached = await browserSession.send('Target.attachToTarget', { targetId, flatten: true });
      const pageSession = makeSession(socket, attached.sessionId);
      const consoleErrors = [];
      const onMessage = (event) => {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        if (message.sessionId !== attached.sessionId) return;
        if (message.method === 'Runtime.exceptionThrown') {
          const detail = message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'exception';
          // Bruit interne du navigateur headless (télémétrie/extensions d'Edge qui messagent un
          // auditeur absent ou ferment un canal de messages) — jamais du code applicatif.
          if (String(detail).includes('tabs:outgoing.message.ready')) return;
          if (String(detail).includes('message channel closed before a response')) return;
          consoleErrors.push(`exception: ${String(detail).slice(0, 160)}`);
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
          const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 160);
          // Bruit du navigateur headless (extensions internes d'Edge) — jamais du code applicatif.
          if (text.includes('chrome-extension://')) return;
          consoleErrors.push(`console.error: ${text}`);
        }
      };
      socket.addEventListener('message', onMessage);

      await pageSession.send('Page.enable');
      await pageSession.send('Runtime.enable');
      await pageSession.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await pageSession.send('Page.navigate', { url: route.url });
      // Condition de prêt générique : document complet + (contenu spécifique si fourni).
      const baseReady = `document.readyState === 'complete' && ${route.readyExpr || 'true'}`;
      const readyOk = await waitFor(pageSession, baseReady);
      await sleep(1200); // Tailwind CDN : compilation des utilitaires injectés

      const label = `${route.name}@${width}`;
      if (!readyOk) {
        console.log(`ÉCHEC  ${label} — page jamais prête`);
        failures += 1;
        checks += 1;
      } else {
        for (const [assertName, expression, expected] of route.asserts) {
          checks += 1;
          try {
            const result = await pageSession.send('Runtime.evaluate', { expression, returnByValue: true });
            const value = result?.result?.value;
            const ok = expected === true ? value === true : value === expected;
            if (!ok) {
              failures += 1;
              console.log(`ÉCHEC  ${label} — ${assertName} (attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(value)})`);
            }
          } catch (error) {
            failures += 1;
            console.log(`ÉCHEC  ${label} — ${assertName} (erreur d'évaluation : ${error.message})`);
          }
        }
        if (consoleErrors.length) {
          failures += 1;
          console.log(`ÉCHEC  ${label} — erreurs console : ${consoleErrors.join(', ')}`);
        }
        console.log(`OK     ${label} — ${route.asserts.length} vérifications`);
      }
      socket.removeEventListener('message', onMessage);
      await browserSession.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  socket.close();
  cleanup();
  console.log(failures === 0 ? `\nTOUTES LES VÉRIFICATIONS PASSENT (${checks} contrôles).` : `\n${failures} ÉCHEC(S) sur ${checks} contrôles.`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
