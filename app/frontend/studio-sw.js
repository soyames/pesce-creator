// Service worker du Studio créatrice PRIVÉ (/studio) — installabilité et démarrage de la
// coquille, rien d'autre. Il est servi depuis la racine UNIQUEMENT parce qu'un script placé
// sous /studio/ ne pourrait pas couvrir l'URL « /studio » elle-même (la portée maximale d'un
// worker est le dossier de son script) ; il est enregistré avec la portée explicite « /studio ».
//
// FRONTIÈRE PUBLIC / PRIVÉ (règle non négociable) :
//   - Le Mini App public (« / ») n'est JAMAIS contrôlé : la portée est /studio, et toute
//     navigation hors /studio est laissée au navigateur sans interception.
//   - Aucun appel /api/* n'est intercepté ni mis en cache : réseau uniquement, toujours.
//   - Le cache est une LISTE BLANCHE STRICTE de ressources statiques publiques de la coquille.
//     Aucun brouillon, message, statistique, information de session, identifiant, donnée MTProto
//     ni contenu non publié ne peut y entrer : ces réponses ne passent jamais par le cache.
//   - Installer le Studio n'authentifie personne : la coquille servie hors ligne est la même
//     page de connexion vide, et chaque action privilégiée reste vérifiée côté serveur.
//
// Hors connexion : la coquille s'ouvre et affiche un état de connectivité honnête. Aucune
// publication n'est mise en file d'attente — une mutation qui ne peut pas atteindre le serveur
// est refusée, jamais simulée.
const CACHE = 'pesce-studio-shell-v1';

// Portée du worker : tout ce qui est hors de ce préfixe n'est pas son affaire.
const SCOPE_PREFIX = '/studio';

// Ressources statiques de la coquille du bureau privé — publiques, sans donnée éditoriale.
const SHELL_DOCUMENT = '/studio';
const SHELL_ASSETS = [
  '/studio',
  '/studio/web-studio.css',
  '/studio/web-studio.js',
  '/studio/manifest.webmanifest',
  '/constants.js',
  '/assets/studio-icon-192.png',
  '/assets/studio-icon-512.png',
  '/assets/studio-icon-maskable-512.png',
];

function isStudioScope(url) {
  return url.pathname === SCOPE_PREFIX || url.pathname.startsWith(`${SCOPE_PREFIX}/`);
}

// Seules ces adresses exactes peuvent être mises en cache. Toute autre réponse — et en premier
// lieu /api/* — reste strictement réseau.
function isCacheableAsset(url) {
  return url.origin === self.location.origin && SHELL_ASSETS.includes(url.pathname);
}

async function cacheIfAllowed(request, response) {
  const url = new URL(request.url);
  if (!isCacheableAsset(url)) return;
  if (!response || !response.ok || response.type !== 'basic') return;
  if ((response.headers.get('Cache-Control') || '').includes('no-store')) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Échec tolérant : une ressource momentanément indisponible ne doit pas bloquer
    // l'installation (l'application reste parfaitement fonctionnelle en ligne).
    await Promise.allSettled(SHELL_ASSETS.map((path) => cache.add(new Request(path, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('pesce-studio-') && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;                 // mutations : réseau uniquement
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;      // CDN, polices, Telegram : jamais touchés
  if (url.pathname.startsWith('/api/')) return;         // API authentifiée : JAMAIS de cache

  // Navigation : réseau d'abord (la coquille reste toujours à jour), repli sur la coquille
  // en cache hors connexion. Une navigation hors /studio n'est pas notre affaire.
  if (request.mode === 'navigate') {
    if (!isStudioScope(url)) return;
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        await cacheIfAllowed(new Request(SHELL_DOCUMENT), response);
        return response;
      } catch {
        const cached = await caches.match(SHELL_DOCUMENT);
        if (cached) return cached;
        throw new Error('Studio indisponible hors connexion.');
      }
    })());
    return;
  }

  // Sous-ressources : uniquement celles de la liste blanche. Le cache sert immédiatement puis
  // se rafraîchit en arrière-plan ; tout le reste part au réseau sans interception.
  if (!isCacheableAsset(url)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request)
      .then(async (response) => { await cacheIfAllowed(request, response); return response; })
      .catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
