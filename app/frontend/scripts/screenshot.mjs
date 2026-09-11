// Capture d'écrans de contrôle (développement uniquement — jamais déployé).
// Pilote Edge/Chrome en mode headless via le protocole DevTools (WebSocket natif de Node ≥ 22,
// aucune dépendance) et attend que CHAQUE écran ait réellement rendu son contenu avant la capture.
// Usage : node scripts/screenshot.mjs [portPreview=4173]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '..', '..', 'preview-shots');
const PREVIEW_PORT = Number(process.argv[2] || 4173);
// Port DevTools aléatoire : évite toute collision avec un Edge résiduel.
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 300);
const LOG_FILE = join(OUT, 'screenshot-log.txt');

function log(message) {
  console.log(message);
  appendFileSync(LOG_FILE, `${message}\n`);
}

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const BROWSER = EDGE_CANDIDATES.find((path) => existsSync(path));
if (!BROWSER) { console.error('Edge/Chrome introuvable.'); process.exit(1); }

const SHOTS = [
  // [nom, largeur, hauteur, URL, condition de prêt (évaluée dans la page)]
  ['gate-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/`, `document.getElementById('telegramGate') && !document.getElementById('telegramGate').hidden && document.fonts.status === 'loaded'`],
  ['home-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1`, `!document.getElementById('telegramApp').hidden && document.getElementById('homeLead').children.length > 0`],
  ['home-820', 820, 1180, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1`, `!document.getElementById('telegramApp').hidden && document.getElementById('homeLead').children.length > 0`],
  ['home-1280', 1280, 1000, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1`, `!document.getElementById('telegramApp').hidden && document.getElementById('homeLead').children.length > 0`],
  ['ecrits-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits`, `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`],
  ['ecrits-820', 820, 1180, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits`, `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`],
  ['ecrits-1280', 1280, 1000, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits`, `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`],
  ['ecrits-videos-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits-videos`, `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`],
  ['ecrits-audios-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits-audios`, `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`],
  ['reader-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#post-1`, `!document.getElementById('reader').hidden && document.getElementById('readerContent').children.length > 0`],
  ['reader-820', 820, 1180, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#post-1`, `!document.getElementById('reader').hidden && document.getElementById('readerContent').children.length > 0`],
  ['reader-1280', 1280, 1000, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#post-1`, `!document.getElementById('reader').hidden && document.getElementById('readerContent').children.length > 0`],
  ['directs-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#directs`, `document.getElementById('directFeed').children.length > 0 && document.getElementById('directFeed').dataset.loading !== 'true'`],
  ['soutenir-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#soutenir`, `document.getElementById('soutenirPacte').children.length > 0`],
  ['studio-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Bonjour, Pesce')`, 60000],
  ['studio-rediger-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-rediger`, `!document.getElementById('studioScreen').hidden && !!document.querySelector('#studioBody #publishForm #publishText')`, 60000],
  ['studio-brouillons-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-brouillons`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Brouillons')`, 60000],
  ['studio-pistes-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-pistes`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Messages & demandes')`, 60000],
  ['studio-audience-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-audience`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Soutiens Telegram Stars')`, 60000],
  ['studio-visitor-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=visitor#studio`, `!document.getElementById('telegramApp').hidden && document.getElementById('studioScreen').hidden`, 60000],
  ['home-empty-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty`, `!document.getElementById('telegramApp').hidden && document.getElementById('homeLead').children.length > 0`],
  ['ecrits-empty-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty#ecrits`, `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`],
  ['directs-empty-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty#directs`, `document.getElementById('directFeed').children.length > 0 && document.getElementById('directFeed').dataset.loading !== 'true'`],
  ['photos-empty-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty#photos`, `document.getElementById('photoFeed').children.length > 0`],
  ['studio-empty-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty#studio`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Bonjour, Pesce')`, 60000],
  ['studio-pistes-empty-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty#studio-pistes`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Messages & demandes')`, 60000],
  ['studio-audience-empty-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=empty#studio-audience`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Soutiens Telegram Stars')`, 60000],
  ['studio-web-login-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio&login=1`, `!document.getElementById('studioLogin').hidden`],
  ['studio-web-login-1280', 1280, 900, `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio&login=1`, `!document.getElementById('studioLogin').hidden`],
  ['studio-web-denied-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio&denied=1`, `!document.getElementById('studioLogin').hidden && !!document.querySelector('#studioLogin button') && (setTimeout(function(){ window.PesceWebStudio.handleGoogleCredential('preview-credential'); }, 300), true)`],
  ['studio-web-bureau-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, `!document.getElementById('studioShell').hidden && document.getElementById('webStudioBody').textContent.includes('Bonjour, Pesce')`],
  ['studio-web-bureau-1280', 1280, 900, `http://127.0.0.1:${PREVIEW_PORT}/studio?preview=webstudio`, `!document.getElementById('studioShell').hidden && document.getElementById('webStudioBody').textContent.includes('Bonjour, Pesce')`],
  ['photos-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#photos`, `document.getElementById('photoFeed').children.length > 0`],
  ['support-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#support`, `document.getElementById('supportTopic').options.length > 0`],
  ['communaute-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#communaute`, `document.getElementById('communaute') && !document.getElementById('communaute').hidden`],
  ['apropos-390', 390, 844, `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#apropos`, `document.getElementById('apropos') && !document.getElementById('apropos').hidden`],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return response.json();
}

// Protocole « flat » : toutes les réponses transitent par le socket navigateur, routées par sessionId.
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

async function waitFor(session, expression, timeoutMs = 30000) {
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
  mkdirSync(OUT, { recursive: true });
  // Profil unique par exécution : aucune suppression, aucun conflit avec un Edge résiduel.
  const profile = join(OUT, `.profile-cdp-${DEBUG_PORT}`);
  let browser = null;
  try {
    browser = spawn(BROWSER, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore' });

    // Garde-fou : quoi qu'il arrive, le navigateur est fermé et le script se termine.
    const watchdog = setTimeout(() => {
      console.error('Temps écoulé — arrêt forcé.');
      browser.kill();
      process.exit(1);
    }, 480000);
    const cleanup = () => { clearTimeout(watchdog); browser.kill(); };
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);

  let browserSocketUrl = null;
  for (let attempt = 0; attempt < 60 && !browserSocketUrl; attempt += 1) {
    await sleep(500);
    try {
      const version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
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

  const results = [];
  const filter = process.argv[3] || '';
  for (const [name, width, height, url, ready, timeout = 30000] of SHOTS) {
    if (filter && !name.includes(filter)) continue;
    const target = await browserSession.send('Target.createTarget', { url: 'about:blank' });
    const targetId = target.targetId;
    const attached = await browserSession.send('Target.attachToTarget', { targetId, flatten: true });
    const pageSession = makeSession(socket, attached.sessionId);

    await pageSession.send('Page.enable');
    await pageSession.send('Runtime.enable');
    await pageSession.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await pageSession.send('Page.navigate', { url });
    const readyOk = await waitFor(pageSession, ready, timeout);
    if (readyOk) await sleep(2000); // laisser Tailwind compiler les utilitaires injectés
    const capture = await pageSession.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(capture.data, 'base64'));
    results.push({ name, readyOk, bytes: capture.data.length });
    log(`${readyOk ? "OK " : "NON-PRÊT "} ${name}.png (${Math.round(capture.data.length / 1024)} Ko)`);
    await browserSession.send('Target.closeTarget', { targetId }).catch(() => {});
  }

    socket.close();
    cleanup();
    const failed = results.filter((result) => !result.readyOk);
    console.log(failed.length ? `ÉCHEC : ${failed.map((f) => f.name).join(', ')}` : 'TOUTES LES CAPTURES SONT PRÊTES.');
    process.exit(failed.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    browser?.kill();
    process.exit(1);
  }
}

main();
