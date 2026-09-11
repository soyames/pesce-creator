// Audit visuel/UX automatisé (développement uniquement — jamais déployé).
// Pilote Edge headless via CDP et mesure, sur chaque écran, la géométrie réelle :
//   - chevauchements en-tête fixe / contenu et contenu / barre de navigation,
//   - cibles tactiles trop petites (< 40 px),
//   - débordements horizontaux internes (hors zones volontairement scrollables),
//   - polices du design réellement chargées,
//   - images cassées (naturalWidth 0),
//   - éléments tronqués qui coupent du texte utile.
// Usage : node scripts/audit-layout.mjs [portPreview=4173]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREVIEW_PORT = Number(process.argv[2] || 4173);
const DEBUG_PORT = 9800 + Math.floor(Math.random() * 90);

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const BROWSER = EDGE_CANDIDATES.find((path) => existsSync(path));
if (!BROWSER) { console.error('Edge/Chrome introuvable.'); process.exit(1); }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ROUTES = [
  ['porte (hors Telegram)', `http://127.0.0.1:${PREVIEW_PORT}/`, `!document.getElementById('telegramGate').hidden`, [390, 320]],
  ['à la une', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1`, `document.getElementById('homeLead').children.length > 0`, [390, 320]],
  ['écrits', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#ecrits`, `document.getElementById('publicationFeed').children.length > 0 && document.getElementById('publicationFeed').dataset.loading !== 'true'`, [390, 320]],
  ['lecteur', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#post-1`, `!document.getElementById('reader').hidden && document.getElementById('readerContent').children.length > 0`, [390, 320]],
  ['studio bureau', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio`, `!document.getElementById('studioScreen').hidden && document.getElementById('studioBody').textContent.includes('Bonjour, Pesce')`, [390, 320]],
  ['studio rédiger', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-rediger`, `!!document.querySelector('#studioBody #publishForm #publishText')`, [390, 320]],
  ['studio brouillons', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-brouillons`, `document.getElementById('studioBody').textContent.includes('Brouillons')`, [390, 320]],
  ['studio pistes', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-pistes`, `document.getElementById('studioBody').textContent.includes('Messages & demandes')`, [390, 320]],
  ['studio audience', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#studio-audience`, `document.getElementById('studioBody').textContent.includes('Soutiens Telegram Stars')`, [390, 320]],
  ['soutenir', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#soutenir`, `document.getElementById('soutenirPacte').children.length > 0`, [390, 320]],
  ['directs', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#directs`, `document.getElementById('directFeed').children.length > 0 && document.getElementById('directFeed').dataset.loading !== 'true'`, [390, 320]],
  ['photos', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#photos`, `document.getElementById('photoFeed').children.length > 0`, [390, 320]],
  ['support', `http://127.0.0.1:${PREVIEW_PORT}/?preview=1#support`, `document.getElementById('supportTopic').options.length > 0`, [390, 320]],
];

// — L'expression d'audit s'exécute dans la page et renvoie un rapport JSON (async : chargement des polices).
const AUDIT_EXPRESSION = `(async () => {
  const report = { fonts: {}, images: [], smallTargets: [], clipped: [], overflows: [] };
  // Réinitialise le défilement (ancrage #… et scroll fluide du démarrage) avant de mesurer.
  window.scrollTo({ top: 0, behavior: 'instant' });
  const studioBody = document.getElementById('studioBody');
  if (studioBody) studioBody.scrollTop = 0;
  const readerContent = document.getElementById('readerContent');
  if (readerContent) readerContent.scrollTop = 0;
  await new Promise((resolve) => setTimeout(resolve, 350));
  const vw = document.documentElement.clientWidth;

  // Polices du design : chargement explicite (les polices se chargent à l'usage) puis vérification.
  for (const family of ['Newsreader', 'Plus Jakarta Sans', 'Literata']) {
    try { await document.fonts.load('1rem ' + family); } catch { /* police indisponible */ }
    report.fonts[family] = document.fonts.check('1rem ' + family);
  }

  // Images cassées
  document.querySelectorAll('img').forEach((img) => {
    if (img.complete && img.naturalWidth === 0 && !img.dataset.noFail) {
      report.images.push(img.getAttribute('src') || '(sans src)');
    }
  });

  // Cibles tactiles : deux gabarits.
  //   - boutons réels (fond/bordure) et icônes seules : ≥ 40 px ;
  //   - liens textuels et puces éditoriales (filtres, rubriques, formats, paliers, onglets) : ≥ 32 px.
  // Les cases à cocher sont ignorées : le libellé qui les enveloppe est la cible réelle.
  const isChipLike = (el) => el.closest('.filter-btn, .rubric-btn, .format-pill, .media-filter, .star-option, .desk-mode');
  document.querySelectorAll('button, a[href], input:not([type="checkbox"]), select, textarea').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const cs = getComputedStyle(el);
      const hasSurface = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0);
      const iconOnly = !(el.textContent || '').trim() && !el.getAttribute('aria-label');
      const minimum = isChipLike(el) ? 32 : (iconOnly || hasSurface ? 40 : 32);
      if (rect.width < minimum || rect.height < minimum) {
        let path = el.id ? '#' + el.id : el.tagName.toLowerCase();
        let parent = el.parentElement;
        while (parent && parent !== document.body && path.length < 120) {
          path = (parent.id ? '#' + parent.id : parent.tagName.toLowerCase() + '.' + (String(parent.className).split(' ')[0] || '')) + '>' + path;
          parent = parent.parentElement;
        }
        report.smallTargets.push({
          tag: el.tagName.toLowerCase() + (isChipLike(el) ? '/chip' : ''),
          text: (el.textContent || el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').trim().slice(0, 30),
          w: Math.round(rect.width), h: Math.round(rect.height),
          path,
        });
      }
    }
  });

  // Débordements horizontaux internes (hors conteneurs volontairement scrollables,
  // hors SVG dont le viewport rogne par conception).
  document.querySelectorAll('*').forEach((el) => {
    if (el.closest('.overflow-x-auto, .no-scrollbar, .truncate, .line-clamp-2, svg, [hidden]')) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.right > vw + 2) {
      report.overflows.push({
        sel: (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 40)),
        right: Math.round(rect.right),
      });
    }
  });

  // Éléments coupant visiblement leur texte (scrollWidth > clientWidth sans classe de troncature).
  // Les glyphes d'icônes (material-symbols) débordent légèrement leur boîte par nature : ignorés.
  document.querySelectorAll('h1,h2,h3,h4,span,p,label').forEach((el) => {
    if (el.closest('.truncate, .line-clamp-2, .material-symbols-outlined, svg, [hidden]')) return;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 40) {
      report.clipped.push({
        sel: (el.id ? '#' + el.id : el.tagName.toLowerCase()),
        text: (el.textContent || '').trim().slice(0, 30),
      });
    }
  });

  // Chevauchements : en-tête fixe vs premier bloc de contenu ; dernier bloc vs barre de navigation.
  // On mesure la SURFACE réellement visible (app, surcouche studio, lecteur ou porte Telegram).
  const appVisible = document.getElementById('telegramApp') && !document.getElementById('telegramApp').hidden;
  const studioVisible = document.getElementById('studioScreen') && !document.getElementById('studioScreen').hidden;
  const readerVisible = document.getElementById('reader') && !document.getElementById('reader').hidden;
  const gateVisible = document.getElementById('telegramGate') && !document.getElementById('telegramGate').hidden;
  let header = null;
  let nav = null;
  let contentRoot = null;
  if (studioVisible) {
    header = document.querySelector('#studioScreen > header');
    nav = document.querySelector('#studioScreen > nav');
    contentRoot = document.getElementById('studioBody');
  } else if (readerVisible) {
    header = document.querySelector('#reader > header');
    contentRoot = document.getElementById('readerContent');
  } else if (gateVisible) {
    contentRoot = document.getElementById('telegramGate');
  } else if (appVisible) {
    header = document.querySelector('#telegramApp > header');
    nav = document.querySelector('#telegramApp > nav');
    contentRoot = [...document.querySelectorAll('section.content-section')].find((section) => !section.hidden);
  }
  report.headerBottom = header ? Math.round(header.getBoundingClientRect().bottom) : null;
  report.navTop = nav ? Math.round(nav.getBoundingClientRect().top) : null;
  if (header && contentRoot) {
    const first = contentRoot.getBoundingClientRect();
    report.firstContentTop = Math.round(first.top);
    report.headerOverlap = first.top < header.getBoundingClientRect().bottom - 2;
  }
  if (nav && contentRoot) {
    // Le contenu est-il recouvert par la barre de navigation ? On compare l'espace restant
    // sous la racine de contenu (marges/paddings du conteneur défilant) à la hauteur de la barre.
    // Si le contenu tient dans le viewport (pas de défilement), il n'y a jamais de recouvrement.
    const navHeight = Math.round(nav.getBoundingClientRect().height);
    const scrollBox = contentRoot.closest('.overflow-y-auto') || document.documentElement;
    const below = Math.round(scrollBox.scrollHeight - contentRoot.getBoundingClientRect().bottom);
    report.lastContentBottom = Math.round(contentRoot.getBoundingClientRect().bottom);
    report.navOverlap = scrollBox.scrollHeight > scrollBox.clientHeight && below < navHeight - 2;
  }
  report.viewport = vw;
  return report;
})()`;

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
    } catch { /* navigation en cours */ }
    await sleep(300);
  }
  return false;
}

async function main() {
  const browser = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${join(ROOT, '..', '..', 'preview-shots', `.profile-audit-${DEBUG_PORT}`)}`,
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

  let issues = 0;
  for (const [label, url, ready, widths] of ROUTES) {
    for (const width of widths) {
      const target = await browserSession.send('Target.createTarget', { url: 'about:blank' });
      const targetId = target.targetId;
      const attached = await browserSession.send('Target.attachToTarget', { targetId, flatten: true });
      const pageSession = makeSession(socket, attached.sessionId);
      await pageSession.send('Page.enable');
      await pageSession.send('Runtime.enable');
      await pageSession.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await pageSession.send('Page.navigate', { url });
      const readyOk = await waitFor(pageSession, ready);
      await sleep(1200);
      if (!readyOk) {
        console.log(`PROBLÈME ${label}@${width} — écran jamais prêt`);
        issues += 1;
        await browserSession.send('Target.closeTarget', { targetId }).catch(() => {});
        continue;
      }
      const result = await pageSession.send('Runtime.evaluate', { expression: AUDIT_EXPRESSION, returnByValue: true, awaitPromise: true });
      const report = result?.result?.value;
      if (!report) {
        console.log(`PROBLÈME ${label}@${width} — audit indisponible`);
        issues += 1;
        await browserSession.send('Target.closeTarget', { targetId }).catch(() => {});
        continue;
      }
      const problems = [];
      for (const [family, ok] of Object.entries(report.fonts || {})) if (!ok) problems.push(`police « ${family} » non chargée`);
      if (report.headerOverlap) problems.push(`en-tête chevauche le contenu (entête bas ${report.headerBottom}px, contenu haut ${report.firstContentTop}px)`);
      if (report.navOverlap) problems.push(`la barre de navigation recouvre le contenu (nav haut ${report.navTop}px, contenu bas ${report.lastContentBottom}px)`);
      for (const image of report.images || []) problems.push(`image cassée : ${image}`);
      const seenTargets = new Set();
      for (const target of report.smallTargets || []) {
        const key = `${target.w}×${target.h}|${target.tag}|${target.text}|${target.path || ''}`;
        if (seenTargets.has(key)) continue;
        seenTargets.add(key);
        problems.push(`cible tactile ${target.w}×${target.h} : ${target.tag} « ${target.text} » (${target.path || '?'})`);
      }
      for (const overflow of (report.overflows || []).slice(0, 5)) problems.push(`débordement horizontal : ${overflow.sel} (droite ${overflow.right}px > ${report.viewport}px)`);
      for (const clipped of (report.clipped || []).slice(0, 5)) problems.push(`texte coupé : ${clipped.sel} « ${clipped.text} »`);
      if (problems.length) {
        issues += problems.length;
        console.log(`PROBLÈME ${label}@${width}`);
        for (const problem of problems) console.log(`  - ${problem}`);
      } else {
        console.log(`OK       ${label}@${width}`);
      }
      await browserSession.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }

  socket.close();
  cleanup();
  console.log(issues === 0 ? '\nAUDIT VISUEL PROPRE — aucun problème détecté.' : `\n${issues} problème(s) détecté(s).`);
  process.exit(issues ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
