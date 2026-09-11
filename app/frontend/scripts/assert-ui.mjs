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
    name: 'gate', url: `http://127.0.0.1:${PREVIEW_PORT}/`, widths: [390],
    asserts: [
      ['portail Telegram visible', `!document.getElementById('telegramGate').hidden`, true],
      ['wordmark SVG présent', `!!document.querySelector('#telegramGate svg')`, true],
      ['titre du wordmark', `document.querySelector('#telegramGate .masthead-title').textContent`, 'PESCE STUDIO'],
      ['bouton bot → deep link startapp', `document.querySelector('#telegramGate .telegram-button').getAttribute('href')`, `${PESCE.BOT_URL}?startapp`],
      ['bouton primaire terracotta', `getComputedStyle(document.querySelector('#telegramGate .telegram-button')).backgroundColor`, RGB.primary],
      ['lien canal présent', `document.querySelector('#telegramGate [data-identity-href="channelUrl"]') !== null`, true],
      ['lien « Connexion » discret vers /studio', `document.querySelector('#telegramGate a[href="/studio"]') !== null`, true],
    ],
  },
  {
    name: 'a-la-une', url: `http://127.0.0.1:${PREVIEW_PORT}/?preview=1`, widths: [390, 820, 1280],
    asserts: [
      ['application visible (portail masqué)', `!document.getElementById('telegramApp').hidden && document.getElementById('telegramGate').hidden`, true],
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
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
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
      ['publication vers le canal', `document.getElementById('studioBody').textContent.includes('Publier sur Telegram')`, true],
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
      ['retour au journal public', `!!document.querySelector('#studioLogin a[href="/"]')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
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
      ['les onglets du portail sont présents', `document.querySelectorAll('[data-web-tab]').length >= 12`, true],
      ['« Rédiger » en action principale', `document.getElementById('webStudioBody').textContent.includes('Rédiger une publication')`, true],
      ['composeur présent', `!!document.querySelector('#publishForm #publishText')`, true],
      ['brouillons réels affichés', `document.getElementById('webStudioBody').textContent.includes("Chantiers d'écriture")`, true],
      ['directs réels affichés', `document.getElementById('webStudioBody').textContent.includes('Planifier un direct')`, true],
      ['messages réels affichés', `document.getElementById('webStudioBody').textContent.includes('Messages & demandes')`, true],
      ['audience réelle affichée', `document.getElementById('webStudioBody').textContent.includes('Telegram Stars')`, true],
      ['session affichée', `document.getElementById('webSessionEmail').textContent.includes('pescestudio8@gmail.com')`, true],
      ['déconnexion présente', `!!document.getElementById('webLogout')`, true],
      ['aucun débordement horizontal', `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, true],
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
          // Bruit interne du navigateur headless (Edge injecte des scripts de télémétrie qui
          // messagent un auditeur absent) — ne se produit pas sur about:blank et n'a aucun
          // rapport avec le code de l'application. Ignoré pour ne signaler que les vraies erreurs.
          if (String(detail).includes('tabs:outgoing.message.ready')) return;
          consoleErrors.push(`exception: ${String(detail).slice(0, 160)}`);
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
          const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 160);
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
