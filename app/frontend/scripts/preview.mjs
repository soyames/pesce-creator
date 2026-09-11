// Serveur de prévisualisation locale (développement uniquement — jamais déployé).
// Sert app/frontend en statique et, avec ?preview=1, injecte un faux Telegram WebApp
// + des fixtures d'API (contenus, directs, rôle, studio, facture, support, médias) afin de
// visualiser tous les écrans sans Telegram ni Neon. ?preview=visitor simule un non-créateur.
// Aucun secret ici : toutes les données sont des fixtures de démonstration clairement fictives.
// Usage : node scripts/preview.mjs [port]  puis  http://127.0.0.1:4173/?preview=1#ecrits
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNEL_URL, CHANNEL_USERNAME } from '../lib/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// — Fixtures (démo, jamais des données réelles).
function iso(offsetMs) { return new Date(Date.now() + offsetMs).toISOString(); }

const FIXTURE_POSTS = [
  {
    id: 'post-1', source: 'telegram', contentType: 'text',
    text: 'Jeunesse ouest-africaine et souveraineté monétaire : les coulisses du débat qui bouscule les capitales\n\nPendant trois mois, nous avons suivi les économistes de terrain, les collectifs citoyens et les décideurs à Cotonou, Dakar et Abidjan pour percer le silence institutionnel.\n\nPar une tiède soirée de mousson dans un café feutré de la rue des Cocotiers, un jeune chercheur pose deux billets sur la table en acajou : l’un est frappé de la BCEAO, l’autre est une coupure neuve de devises numériques expérimentales. « Regarde bien ces deux bouts de papier, dit-il à voix basse. Ils ne racontent pas la même histoire, et surtout, ils ne parlent pas de la même souveraineté. »\n\nCe geste d’apparence anodin résume la faille géologique qui secoue aujourd’hui les milieux intellectuels de l’Afrique de l’Ouest. Loin des débats diplomatiques convenus tenus dans les salons cossus des capitales partenaires, une nouvelle garde de praticiens, d’ingénieurs en cryptographie et d’universitaires s’empare du tabou monétaire avec une minutie méthodique.\n\nÀ Abidjan comme à Dakar, les colloques ne se tiennent plus seulement dans les amphithéâtres officiels. Des ateliers improvisés regroupent analystes de marché et collectifs citoyens pour disséquer les mécanismes de réserves obligatoires et les règles de parité fixe. On y confronte les modèles asiatiques aux impératifs d’industrialisation du continent.\n\nPour beaucoup de ces jeunes cadres, l’enjeu ne réside plus dans une contestation purement symbolique, mais dans la création de passerelles monétaires panafricaines autonomes capables de résister aux chocs d’inflation importée et de financer les infrastructures de transformation locale.\n\nVersion intégrale : https://telegra.ph/Fixture-Preview-09-11',
    telegramUrl: `${CHANNEL_URL}/100`, mediaFileId: 'lead-photo', mediaWidth: 1200, mediaHeight: 750,
    publishedAt: iso(-4 * 3600e3), updatedAt: iso(-2 * 3600e3),
  },
  {
    id: 'post-2', source: 'telegram', contentType: 'text',
    text: 'Pourquoi la transparence institutionnelle n’est plus négociable\n\nCe n’est pas une question d’idéologie, mais de survie démocratique dans un écosystème numérique saturé de fausses promesses et de communiqués préfabriqués. Les citoyens ne croient plus aux institutions qui se cachent : ils écoutent celles qui montrent leurs comptes, leurs sources et leurs méthodes.',
    telegramUrl: `${CHANNEL_URL}/99`,
    publishedAt: iso(-26 * 3600e3), updatedAt: iso(-26 * 3600e3),
  },
  {
    id: 'post-3', source: 'telegram', contentType: 'text',
    text: '« L’Afrique n’a pas besoin de leçons, mais de rigueur »\n\nPour le chercheur béninois, la réindustrialisation passera d’abord par la sécurisation du droit foncier et la fin des subventions mal ciblées. Entretien au long cours recueilli à Cotonou.\n\nOn ne répare pas une politique publique avec des slogans. La rigueur budgétaire, la stabilité du cadre juridique et la formation des compétences locales forment le triptyque sur lequel tout le reste s’édifie.',
    telegramUrl: `${CHANNEL_URL}/98`,
    publishedAt: iso(-50 * 3600e3), updatedAt: iso(-50 * 3600e3),
  },
  {
    id: 'post-4', source: 'telegram', contentType: 'audio', mediaFileId: 'audio-1', mediaDuration: 760,
    text: 'Carnet de route #14 : Au bord du fleuve Niger, paroles de pêcheurs\n\nImmersion brute au cœur des campements bozos : rumeurs du fleuve, négociations au panier et clameurs des vendeuses avant l’aube.',
    telegramUrl: `${CHANNEL_URL}/97`,
    publishedAt: iso(-30 * 3600e3), updatedAt: iso(-30 * 3600e3),
  },
  {
    id: 'post-5', source: 'telegram', contentType: 'video', mediaFileId: 'video-1', mediaDuration: 1440, mediaThumbnailFileId: 'thumb-1', mediaWidth: 1280, mediaHeight: 720,
    text: 'Dans les archives oubliées de Porto-Novo : secrets d’un royaume sous tutelle\n\nPesce Hounyo a obtenu un accès exceptionnel aux malles documentaires inexplorées de l’ancienne colonie du Dahomey. Révélations sur les traités oubliés du XIXe siècle.',
    telegramUrl: `${CHANNEL_URL}/96`,
    publishedAt: iso(-72 * 3600e3), updatedAt: iso(-72 * 3600e3),
  },
  {
    id: 'post-6', source: 'telegram', contentType: 'photo', mediaFileId: 'photo-1', mediaWidth: 900, mediaHeight: 900,
    text: 'Poste frontalier de Kraké-Plage, à l’aube. Les commerçants et transporteurs chargés de ballots traversent les pistes latéritiques dans la brume matinale.',
    telegramUrl: `${CHANNEL_URL}/95`,
    publishedAt: iso(-96 * 3600e3), updatedAt: iso(-96 * 3600e3),
  },
  {
    id: 'post-7', source: 'telegram', contentType: 'photo', mediaFileId: 'photo-2', mediaWidth: 900, mediaHeight: 900,
    text: 'Porto-Novo : façades afro-brésiliennes sous la lumière dorée de fin d’après-midi.',
    telegramUrl: `${CHANNEL_URL}/94`,
    publishedAt: iso(-120 * 3600e3), updatedAt: iso(-120 * 3600e3),
  },
].map((post) => {
  const enriched = { ...post };
  if (post.mediaFileId) enriched.mediaUrl = `./api/media?file_id=${post.mediaFileId}&token=preview`;
  if (post.mediaThumbnailFileId) enriched.mediaThumbnailUrl = `./api/media?file_id=${post.mediaThumbnailFileId}&token=preview`;
  return enriched;
});

const FIXTURE_LIVES = [
  {
    id: 'live-1', title: 'Questions ouvertes des abonnés sur le dossier monétaire ouest-africain',
    description: 'En direct de la rédaction sur Telegram & YouTube',
    scheduledAt: iso(36 * 3600e3), link: '', status: 'scheduled', createdAt: iso(-24 * 3600e3), updatedAt: iso(-24 * 3600e3),
  },
];

function fixtureStudioOverview(isVisitor) {
  return {
    totals: { total: 483, text: 320, video: 96, photo: 55, audio: 12 },
    stars: 8420, supporters: 96,
    audience: { opens: 4210, uniqueUsers: 980, last7Days: 421 },
    liveSchedules: FIXTURE_LIVES,
    drafts: [
      { id: 'draft_1', text: 'L’illusion technologique dans l’éducation rurale\n\nAnalyse de terrain dans les collèges de la vallée de l’Ouémé face aux déploiements d’écrans sans manuels scolaires fondamentaux.', status: 'draft', createdAt: iso(-26 * 3600e3), updatedAt: iso(-2 * 3600e3) },
      { id: 'draft_2', text: 'Rencontre avec le doyen M. Kpohazounde\n\nNote vocale d’archive #042 — audio brut (44 min). Retranscription en cours.', status: 'draft', createdAt: iso(-50 * 3600e3), updatedAt: iso(-26 * 3600e3) },
    ],
    openTickets: 1,
    recentTickets: [
      { id: 'PS-20260911-00001', username: 'amadou_d', firstName: 'Amadou', message: 'Bonjour Pesce, j’ai des documents chiffrés sur le dossier portuaire. Comment vous les transmettre ?', topic: 'contenu', status: 'open', createdAt: iso(-5 * 3600e3) },
    ],
    recentPayments: [
      { id: 'pay_1', username: 'amadou_d', amount: 150, paidAt: iso(-24 * 3600e3), refundedAt: null },
      { id: 'pay_2', username: 'claire_s', amount: 50, paidAt: iso(-48 * 3600e3), refundedAt: null },
    ],
    recentPosts: FIXTURE_POSTS.slice(0, 3),
    telegraphConfigured: true,
    isVisitor: Boolean(isVisitor),
  };
}

// — Médias de démonstration : images SVG chaudes, audio WAV silencieux.
function svgPlaceholder(width, height, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f3ef"/><stop offset="1" stop-color="#e0bfb7"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" font-family="Georgia, serif" font-size="${Math.round(height / 22)}" fill="#58413c" text-anchor="middle" dominant-baseline="middle">${label}</text>
</svg>`;
}

function silentWav(seconds = 2) {
  const sampleRate = 8000;
  const sampleCount = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + sampleCount);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + sampleCount, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28); // byte rate (8 bits)
  buffer.writeUInt16LE(1, 32); // block align
  buffer.writeUInt16LE(8, 34); // bits par échantillon
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount, 40);
  return buffer; // silence : échantillons à 0
}

const MEDIA_SIZES = {
  'lead-photo': [1200, 750, 'Grand reportage — bordure bénino-nigériane'],
  'thumb-1': [1280, 720, 'Archives de Porto-Novo'],
  'photo-1': [900, 900, 'Poste frontalier de Kraké-Plage'],
  'photo-2': [900, 900, 'Façades afro-brésiliennes'],
};

// — Intercepteur fetch injecté dans index.html (browser) : redirige ./api/* vers ce serveur.
function previewStubScript() {
  const posts = FIXTURE_POSTS.map((post) => ({ ...post, publishedAt: post.publishedAt, updatedAt: post.updatedAt }));
  const lives = FIXTURE_LIVES.map((live) => ({ ...live, scheduledAt: live.scheduledAt }));
  return `<script>
window.__PESCE_PREVIEW__ = true;
(function () {
  var isVisitor = /preview=visitor/.test(location.search);
  var isEmpty = /preview=empty/.test(location.search);
  window.Telegram = { WebApp: {
    initData: 'preview_fixture_init_data',
    initDataUnsafe: { user: { id: 1, first_name: 'Pesce', last_name: 'Hounyo', username: 'pescehounyo', language_code: 'fr' }, start_param: '' },
    ready: function(){}, expand: function(){}, setHeaderColor: function(){}, setBackgroundColor: function(){},
    showPopup: function(p){ console.log('[preview popup]', p.title, p.message); },
    openTelegramLink: function(u){ console.log('[preview t.me]', u); },
    openLink: function(u){ console.log('[preview link]', u); },
    openInvoice: function(u, cb){ console.log('[preview invoice]', u); setTimeout(function(){ cb('paid'); }, 400); },
    BackButton: { show: function(){}, hide: function(){}, onClick: function(){}, offClick: function(){} }
  }};
  var POSTS = ${JSON.stringify(posts)};
  var LIVES = ${JSON.stringify(lives)};
  var realFetch = window.fetch.bind(window);
  var json = function (status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }); };
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isApi = url.indexOf('./api/') === 0 || url.indexOf('/api/') !== -1;
    if (!isApi) return realFetch(input, init);
    if (url.indexOf('/api/content') !== -1) {
      var type = (url.match(/type=([a-z]+)/) || [])[1] || '';
      var limit = Number((url.match(/limit=(\\d+)/) || [])[1] || 30);
      var list = isEmpty ? [] : (type ? POSTS.filter(function (p) { return p.contentType === type; }) : POSTS);
      return Promise.resolve(json(200, { channel: { username: '${CHANNEL_USERNAME}', url: '${CHANNEL_URL}' }, posts: list.slice(0, limit) }));
    }
    if (url.indexOf('/api/live') !== -1) return Promise.resolve(json(200, { lives: isEmpty ? [] : LIVES }));
    if (url.indexOf('/api/me') !== -1) return Promise.resolve(json(200, { user: { id: 1, firstName: 'Pesce', lastName: 'Hounyo', username: 'pescehounyo', languageCode: 'fr', isPremium: false }, isCreator: !isVisitor, creatorConfigured: true }));
    if (url.indexOf('/api/studio') !== -1) {
      if (init && init.method === 'POST') return Promise.resolve(json(200, { ok: true }));
      var overview = ${JSON.stringify(fixtureStudioOverview(false)).replace(/</g, '\\u003c')};
      if (isEmpty) {
        overview.drafts = [];
        overview.recentTickets = [];
        overview.openTickets = 0;
        overview.recentPayments = [];
        overview.recentPosts = [];
        overview.liveSchedules = [];
        overview.audience = { opens: 0, uniqueUsers: 0, last7Days: 0 };
        overview.stars = 0;
        overview.supporters = 0;
      }
      return Promise.resolve(json(200, overview));
    }
    if (url.indexOf('/api/create-invoice') !== -1) return Promise.resolve(json(200, { invoiceLink: 'https://t.me/$/preview-fixture-invoice', stars: 100 }));
    if (url.indexOf('/api/support') !== -1) return Promise.resolve(json(200, { ticketId: 'PS-20260911-00042' }));
    if (url.indexOf('/api/track') !== -1) return Promise.resolve(json(200, { ok: true }));
    return realFetch(input, init);
  };
})();
</script>`;
}

// — Stub du Studio web (/studio) : session Google simulée côté API, jamais de vraie connexion.
//   ?preview=webstudio          → session valide, le bureau s'ouvre
//   ?preview=webstudio&login=1  → pas de session : écran de connexion
//   ?preview=webstudio&denied=1 → connexion refusée : état « accès refusé » après clic démo
function previewWebStudioStub(searchParams) {
  const loginOnly = searchParams.get('preview') === 'webstudio' && searchParams.get('login') === '1';
  const denied = searchParams.get('denied') === '1';
  const overview = JSON.stringify(fixtureStudioOverview(false)).replace(/</g, '\\u003c');
  const postsJson = JSON.stringify(FIXTURE_POSTS.map((post) => ({ ...post })));
  return `<script>
window.__PESCE_WEB_PREVIEW__ = true;
(function () {
  var LOGIN_ONLY = ${loginOnly ? 'true' : 'false'};
  var DENIED = ${denied ? 'true' : 'false'};
  var realFetch = window.fetch.bind(window);
  var json = function (status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }); };
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') === -1) return realFetch(input, init);
    if (url.indexOf('/api/studio-auth') !== -1) {
      if (url.indexOf('action=session') !== -1) {
        return Promise.resolve(LOGIN_ONLY || DENIED ? json(401, { authenticated: false }) : json(200, { authenticated: true, email: 'pescestudio8@gmail.com' }));
      }
      if (url.indexOf('action=config') !== -1) return Promise.resolve(json(200, { clientId: 'preview-client.apps.googleusercontent.com' }));
      if (init && init.method === 'POST') {
        var body = {};
        try { body = JSON.parse(init.body || '{}'); } catch (e) { body = {}; }
        if (body.action === 'login') return Promise.resolve(DENIED ? json(403, { message: 'Compte non autorisé.' }) : json(200, { ok: true }));
        if (body.action === 'logout') return Promise.resolve(json(200, { ok: true }));
      }
      return Promise.resolve(json(400, { message: 'Action inconnue.' }));
    }
    if (url.indexOf('/api/studio') !== -1) {
      if (init && init.method === 'POST') return Promise.resolve(json(200, { ok: true }));
      return Promise.resolve(json(200, ${overview}));
    }
    if (url.indexOf('/api/content') !== -1) {
      var type = (url.match(/type=([a-z]+)/) || [])[1] || '';
      var limit = Number((url.match(/limit=(\\d+)/) || [])[1] || 30);
      var list = type ? ${postsJson}.filter(function (p) { return p.contentType === type; }) : ${postsJson};
      return Promise.resolve(json(200, { channel: { username: '${CHANNEL_USERNAME}', url: '${CHANNEL_URL}' }, posts: list.slice(0, limit) }));
    }
    if (url.indexOf('/api/live') !== -1) return Promise.resolve(json(200, { lives: [] }));
    return realFetch(input, init);
  };
  if (DENIED) {
    document.addEventListener('DOMContentLoaded', function () {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Tester la connexion (démonstration)';
      button.className = 'mt-space-md px-space-md py-3 bg-on-secondary-fixed text-surface font-kicker-label uppercase tracking-widest rounded-lg';
      button.addEventListener('click', function () { window.PesceWebStudio.handleGoogleCredential('preview-credential'); });
      var card = document.querySelector('#studioLogin > div');
      if (card) card.insertBefore(button, card.querySelector('#loginError'));
    });
  }
})();
</script>`;
}

// — Serveur HTTP.
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/media') {
    const fileId = url.searchParams.get('file_id') || '';
    if (fileId === 'audio-1') {
      const wav = silentWav(2);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      res.end(wav);
      return;
    }
    if (fileId === 'video-1') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': 0 });
      res.end();
      return;
    }
    const [width, height, label] = MEDIA_SIZES[fileId] || [900, 600, 'Média de démonstration'];
    const svg = svgPlaceholder(width, height, label);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(svg);
    return;
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Fixture API inconnue.' }));
    return;
  }

  let filePath = normalize(join(ROOT, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')));
  if (pathname === '/privacy' || pathname.startsWith('/privacy/')) filePath = join(ROOT, 'privacy', 'index.html');
  if (pathname === '/studio' || pathname === '/studio/') filePath = join(ROOT, 'studio', 'index.html');
  if (!filePath.startsWith(ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — introuvable');
    return;
  }

  const isStudio = pathname === '/studio' || pathname === '/studio/';
  const isIndex = filePath.endsWith('index.html') && !isStudio && pathname !== '/privacy';
  let content = readFileSync(filePath);
  if (isStudio && url.searchParams.has('preview')) {
    // Mode preview du Studio web : session serveur simulée (authentifié, refusée ou écran de
    // connexion), mêmes fixtures que le Mini App, bouton de démonstration pour l'état « refusé ».
    const html = content.toString('utf8');
    const injected = html.replace(
      '  <script src="/constants.js"></script>',
      `${previewWebStudioStub(url.searchParams)}\n  <script src="/constants.js"></script>`
    );
    content = Buffer.from(injected, 'utf8');
  } else if (isIndex && url.searchParams.has('preview')) {
    const html = content.toString('utf8');
    // En mode preview : le vrai SDK Telegram écraserait le WebApp simulé — on le retire
    // et on injecte le stub à la place.
    const injected = html.replace(
      '  <script src="https://telegram.org/js/telegram-web-app.js"></script>',
      `${previewStubScript()}\n  <!-- telegram-web-app.js retiré en mode preview (WebApp simulé injecté) -->`
    );
    content = Buffer.from(injected, 'utf8');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
  res.end(content);
});

server.listen(PORT, () => {
  console.log(`Pesce Studio preview : http://127.0.0.1:${PORT}/            (porte Telegram, sans stub)`);
  console.log(`Pesce Studio preview : http://127.0.0.1:${PORT}/?preview=1   (Mini App + fixtures, créatrice)`);
  console.log(`Pesce Studio preview : http://127.0.0.1:${PORT}/?preview=visitor (Mini App, visiteur)`);
  console.log('Ancres : #a-la-une #ecrits #ecrits-videos #ecrits-audios #directs #soutenir #studio #photos #communaute #apropos #support #post-1');
});
