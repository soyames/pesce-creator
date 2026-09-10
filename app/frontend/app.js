// Coquille publique de Pesce Studio : porte Telegram, navigation, flux de contenus, soutien en Étoiles, assistance.
// Le studio créatrice est chargé à la demande (studio.js) uniquement pour la créatrice — voir resolveRole()/loadStudioModule().
const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);
const PESCE = window.PESCE;
if (!PESCE) console.error('PESCE manquant : constants.js n’a pas été chargé.');

const gate = document.getElementById('telegramGate');
const app = document.getElementById('telegramApp');
const home = document.getElementById('home');
const sections = [...document.querySelectorAll('.content-section')];
const navButtons = [...document.querySelectorAll('.nav-button')];

// — Identité : hydrate les textes marqués data-identity depuis les constantes (source unique)
const IDENTITY = { tagline: PESCE.TAGLINE, youtubeHandle: PESCE.YOUTUBE_HANDLE, channelHandle: PESCE.CHANNEL_HANDLE };
document.querySelectorAll('[data-identity]').forEach((el) => {
  const value = IDENTITY[el.dataset.identity];
  if (value) el.textContent = value;
});

// — Porte Telegram (navigateur hors Telegram)
if (inTelegram) {
  gate.hidden = true;
  app.hidden = false;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#0b1220');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#0b1220');
} else {
  gate.hidden = false;
  app.hidden = true;
}

// — Aides partagées
function popup(title, message) {
  if (tg?.showPopup) tg.showPopup({ title, message, buttons: [{ type: 'ok', text: 'Compris' }] });
  else window.alert(message);
}

function openExternal(url) {
  if (inTelegram && url.startsWith('https://t.me/') && tg?.openTelegramLink) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }
function formatDate(value) { const date = value ? new Date(value) : null; return date && !isNaN(date) ? date.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'date inconnue'; }

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Requête impossible.');
  return data;
}

// — Navigation par sections.
// Règle de mise en évidence : un bouton de nav est actif ssi il pointe vers la section courante ;
// l'accueil est porté par data-home. Les sections hors nav (studio) n'activent aucun bouton.
function openSection(id) {
  if (!inTelegram) return;
  home.hidden = id !== 'home';
  sections.forEach((section) => { section.hidden = section.id !== id; });
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.section === id || (id === 'home' && button.dataset.home !== undefined)));
  if (id === 'home') { loadHome(); loadLive(); }
  if (id === 'publications' || id === 'videos' || id === 'audios' || id === 'photos') loadContent(id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// — Routage par délégation : couvre le HTML statique ET les cartes rendues dynamiquement (rails, flux).
document.addEventListener('click', (event) => {
  const sectionButton = event.target.closest('[data-section]');
  if (sectionButton) { openSection(sectionButton.dataset.section); return; }
  const homeButton = event.target.closest('[data-home]');
  if (homeButton) { openSection('home'); return; }
  const channelButton = event.target.closest('[data-channel]');
  if (channelButton) { openExternal(PESCE.CHANNEL_URL); return; }
  const youtubeButton = event.target.closest('[data-youtube]');
  if (youtubeButton) { openExternal(PESCE.YOUTUBE_URL); return; }
  const botButton = event.target.closest('[data-bot]');
  if (botButton) { openExternal(PESCE.BOT_URL); return; }
  const readerClose = event.target.closest('[data-reader-close]');
  if (readerClose) { closeReader(); return; }
  const readerSupport = event.target.closest('[data-reader-support]');
  if (readerSupport) { closeReader(); openSection('soutenir'); return; }
  const readButton = event.target.closest('[data-reader]');
  if (readButton) { openReader(readButton.dataset.reader); return; }
  const postLink = event.target.closest('[data-post-link]');
  if (postLink) { openExternal(postLink.dataset.postLink); return; }
  const liveLink = event.target.closest('[data-live-link]');
  if (liveLink) { openExternal(liveLink.dataset.liveLink); return; }
  const starOption = event.target.closest('[data-stars]');
  if (starOption) { selectStars(Number(starOption.dataset.stars)); return; }
  // La carte éditoriale entière ouvre le lecteur — sauf interaction avec un média ou un contrôle.
  if (!event.target.closest('video,audio,img,button,a,input,select,textarea')) {
    const card = event.target.closest('.editorial-card[data-post-id]');
    if (card) { openReader(card.dataset.postId); return; }
  }
});

// — Soutien en Étoiles
const starAmounts = PESCE.STAR_TIERS.map((tier) => tier.amount);
let selectedStars = 100;

function selectStars(amount) {
  if (!starAmounts.includes(amount)) return;
  selectedStars = amount;
  document.querySelectorAll('[data-stars]').forEach((item) => {
    const active = Number(item.dataset.stars) === selectedStars;
    item.classList.toggle('selected', active);
    item.setAttribute('aria-pressed', String(active));
  });
  const supportButton = document.getElementById('supportButton');
  if (supportButton) supportButton.textContent = `Envoyer ${selectedStars} ⭐`;
}

async function supportWithStars() {
  if (!inTelegram) return;
  const button = document.getElementById('supportButton');
  if (button) { button.disabled = true; button.textContent = 'Préparation…'; }
  try {
    const data = await fetchJson('./api/create-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stars: selectedStars, initData: tg.initData }) });
    if (!data.invoiceLink) throw new Error('Impossible de créer le paiement.');
    if (tg.openInvoice) tg.openInvoice(data.invoiceLink, (status) => {
      if (status === 'paid') popup('Merci ⭐', `Votre soutien de ${data.stars} Étoiles a bien été reçu. Merci beaucoup !`);
      else if (status === 'cancelled') popup('Paiement annulé', 'Aucun montant n’a été débité.');
      else if (status === 'failed') popup('Paiement impossible', 'Telegram n’a pas pu finaliser le paiement. Vous pouvez réessayer.');
    });
    else window.location.href = data.invoiceLink;
  } catch (error) { popup('Soutien indisponible', error.message || 'Le paiement en Étoiles sera bientôt disponible.'); }
  finally { if (button) { button.disabled = false; button.textContent = `Envoyer ${selectedStars} ⭐`; } }
}

// — Assistance (mini app + bot @PesceStudioBot)
function initSupportTopic() {
  const select = document.getElementById('supportTopic');
  if (!select) return;
  PESCE.SUPPORT_TOPICS.forEach((topic) => {
    const option = document.createElement('option');
    option.value = topic.value;
    option.textContent = topic.label;
    select.appendChild(option);
  });
}

async function sendSupport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('supportSubmit');
  const status = document.getElementById('supportStatus');
  const message = form.querySelector('#supportMessage')?.value.trim();
  const topic = form.querySelector('#supportTopic')?.value || '';
  if (!message) return;
  button.disabled = true; button.textContent = 'Envoi…';
  try {
    const data = await fetchJson('./api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, topic, initData: tg.initData }) });
    form.reset();
    status.textContent = `Demande ${data.ticketId} envoyée. Le bot Pesce Studio vous répondra dans Telegram.`;
  } catch (error) { status.textContent = error.message || 'Échec de l’envoi.'; }
  finally { button.disabled = false; button.textContent = 'Envoyer la demande'; }
}

// — Flux de contenus
const CONTENT_CONFIG = {
  publications: { type: null, target: 'publicationFeed', title: 'Les publications de Pesce', text: 'Les prochaines publications du canal officiel apparaîtront ici.' },
  videos: { type: 'video', target: 'videoFeed', title: 'Les vidéos de Pesce', text: 'Les vidéos publiées sur le canal officiel apparaîtront ici.' },
  audios: { type: 'audio', target: 'audioFeed', title: 'Les chroniques audio de Pesce', text: 'Les prochains contenus audio du canal officiel apparaîtront ici.' },
  photos: { type: 'photo', target: 'photoFeed', title: 'Les photos de Pesce', text: 'Les prochaines photos du canal officiel apparaîtront ici.' },
};

async function loadContent(sectionId) {
  const config = CONTENT_CONFIG[sectionId];
  if (!config) return;
  const target = document.getElementById(config.target);
  if (!target || target.dataset.loading === 'true') return;
  target.dataset.loading = 'true';
  target.innerHTML = '<article class="empty-card"><h3>Chargement…</h3><p>Récupération des contenus de Pesce.</p></article>';
  try {
    const query = config.type ? `?type=${encodeURIComponent(config.type)}&limit=30` : '?limit=30';
    const data = await fetchJson(`./api/content${query}`, { cache: 'no-store' });
    if (!Array.isArray(data.posts) || data.posts.length === 0) { renderEmpty(target, config); return; }
    target.innerHTML = data.posts.map(renderPost).join('');
  } catch (error) { renderError(target, error); }
  finally { target.dataset.loading = 'false'; }
}

function renderEmpty(target, config) {
  target.innerHTML = `<article class="empty-card"><h3>${config.title}</h3><p>${config.text}</p><button class="secondary-button" data-channel type="button">Ouvrir le canal Telegram</button></article>`;
}

function renderError(target, error) {
  target.innerHTML = `<article class="empty-card"><h3>Flux momentanément indisponible</h3><p>${escapeHtml(error.message || 'Impossible de charger les contenus.')}</p><button class="secondary-button" data-channel type="button">Ouvrir le canal Telegram</button></article>`;
}

// — Cartes éditoriales + lecteur de publication.
// Le lecteur est l'action principale ; « Voir sur Telegram » devient une action secondaire interne au lecteur.
const postCache = new Map();

const POST_LABELS = {
  text: { category: 'ARTICLE', action: 'Lire la publication' },
  photo: { category: 'PHOTO', action: 'Voir la photo' },
  video: { category: 'VIDÉO', action: 'Regarder' },
  audio: { category: 'AUDIO', action: 'Écouter' },
  document: { category: 'DOCUMENT', action: 'Lire la publication' },
  other: { category: 'PUBLICATION', action: 'Lire la publication' },
};

function renderMedia(post) {
  const mediaUrl = post.mediaUrl || (post.mediaFileId ? `./api/media?file_id=${encodeURIComponent(post.mediaFileId)}` : '');
  if (post.contentType === 'photo' && mediaUrl) return `<img class="post-media post-photo" src="${mediaUrl}" alt="Photo publiée par Pesce Hounyo" loading="lazy">`;
  if (post.contentType === 'audio' && mediaUrl) return `<audio class="post-audio" controls preload="none" src="${mediaUrl}"></audio>`;
  if (post.contentType === 'video' && mediaUrl) return `<video class="post-media" controls preload="metadata" src="${mediaUrl}"${post.mediaThumbnailUrl ? ` poster="${escapeAttribute(post.mediaThumbnailUrl)}"` : ''}></video>`;
  return '';
}

function headlineAndStandfirst(post) {
  const lines = (post.text || '').split('\n').map((line) => line.trim()).filter(Boolean).filter((line) => !/^https?:\/\//.test(line));
  let headline = '';
  let standfirst = '';
  if (lines.length > 0) {
    headline = lines[0].slice(0,110);
    const rest = lines.slice(1).join(' ').trim();
    if (rest) {
      standfirst = rest.length > 160 ? `${rest.slice(0, 160)}…` : rest;
    }
  }
  if (!headline) {
    // Publication sans texte : entrée d'archive datée plutôt qu'un titre de base de données inventé.
    const dateLabel = formatDate(post.publishedAt);
    headline = { video: `Vidéo du ${dateLabel}`, audio: `Audio du ${dateLabel}`, photo: `Photo du ${dateLabel}` }[post.contentType] || `Publication du ${dateLabel}`;
  }
  return { headline, standfirst };
}

function articleUrlOf(post) {
  return (post.text || '').match(/https:\/\/telegra\.ph\/[\w\-./]+/i);
}

function renderPost(post) {
  postCache.set(post.id, post);
  const label = POST_LABELS[post.contentType] || POST_LABELS.other;
  const { headline, standfirst } = headlineAndStandfirst(post);
  const action = articleUrlOf(post) ? 'Lire l’article' : label.action;
  const media = renderMedia(post);
  return `<article class="post-card editorial-card" data-post-id="${escapeAttribute(post.id)}">
<div class="post-meta-top"><span class="post-category">${label.category}</span><time>${escapeHtml(formatDate(post.publishedAt))}</time></div>
<h3 class="post-headline">${escapeHtml(headline)}</h3>
${standfirst ? `<p class="post-standfirst">${escapeHtml(standfirst)}</p>` : ''}
${media}
<div class="post-footer"><span class="post-author">${escapeHtml(PESCE.CREATOR_NAME)}</span><button class="primary-button post-read" type="button" data-reader="${escapeAttribute(post.id)}">${action}</button></div>
</article>`;
}

// — Lecteur de publication (recouvre l'application ; retour via le bouton, le fond ou le BackButton Telegram)
let readerOpen = false;

function bindBackButton() {
  if (!tg?.BackButton) return;
  try { tg.BackButton.show(); tg.BackButton.onClick(closeReader); } catch { /* BackButton indisponible */ }
}

function unbindBackButton() {
  if (!tg?.BackButton) return;
  try { tg.BackButton.offClick(closeReader); tg.BackButton.hide(); } catch { /* BackButton indisponible */ }
}

async function openReader(postId) {
  if (!inTelegram) return;
  let post = postCache.get(postId);
  if (!post) {
    try {
      const data = await fetchJson('./api/content?limit=50', { cache: 'no-store' });
      post = (Array.isArray(data.posts) ? data.posts : []).find((item) => item.id === postId) || null;
      if (post) postCache.set(post.id, post);
    } catch { post = null; }
  }
  const reader = document.getElementById('reader');
  const content = document.getElementById('readerContent');
  if (!reader || !content) return;
  content.innerHTML = post
    ? renderReader(post)
    : '<article class="empty-card"><span>⚠️</span><h3>Publication introuvable</h3><p>Cette publication n’est plus disponible pour le moment.</p><button class="secondary-button" type="button" data-reader-close>Retour</button></article>';
  reader.hidden = false;
  readerOpen = true;
  bindBackButton();
  reader.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function closeReader() {
  const reader = document.getElementById('reader');
  if (reader) reader.hidden = true;
  readerOpen = false;
  unbindBackButton();
}

function renderReader(post) {
  const label = POST_LABELS[post.contentType] || POST_LABELS.other;
  const { headline } = headlineAndStandfirst(post);
  const articleUrl = articleUrlOf(post);
  const media = renderMedia(post);
  const body = escapeHtml(post.text || '').replace(/\n/g, '<br>');
  const paragraphs = body.split('<br><br>').map((paragraph) => `<p>${paragraph}</p>`).join('');
  const longDate = post.publishedAt ? new Date(post.publishedAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `<article class="reader-card">
<p class="card-kicker">${label.category}</p>
<h2>${escapeHtml(headline)}</h2>
<div class="reader-meta"><img class="reader-avatar" src="./assets/profilePesce.png" alt="Pesce Hounyo"><span class="post-author">${escapeHtml(PESCE.CREATOR_NAME)}</span><time>${escapeHtml(longDate)}</time></div>
${media}
<div class="reader-body">${paragraphs}</div>
${articleUrl ? `<button class="primary-button post-read" type="button" data-post-link="${escapeAttribute(articleUrl[0])}">Lire l’article complet sur Telegraph</button>` : ''}
<aside class="reader-support"><span class="star-badge">⭐</span><div><p class="card-kicker">SOUTENIR PESCE</p><p>Ce travail vous plaît ? Soutenez-le en Étoiles Telegram.</p></div><button class="primary-button" type="button" data-reader-support>⭐ Soutenir Pesce</button></aside>
<div class="reader-actions">${post.telegramUrl ? `<button class="secondary-button" type="button" data-post-link="${escapeAttribute(post.telegramUrl)}">Voir sur Telegram</button>` : ''}<button class="secondary-button" type="button" data-channel>Suivre le canal</button></div>
</article>`;
}

// — Accueil : une requête /api/content (flux mixte : articles, vidéos, audios, photos)
// et la programmation publique des directs (/api/live).
let homeLoaded = false;

async function loadHome() {
  if (!inTelegram || homeLoaded) return;
  try {
    const data = await fetchJson('./api/content?limit=6', { cache: 'no-store' });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const feed = document.getElementById('homeFeedList');
    const rail = document.getElementById('homeFeed');
    if (feed) feed.innerHTML = posts.slice(0, 5).map(renderPost).join('');
    if (rail) rail.hidden = posts.length === 0;
    const empty = document.getElementById('homeEmpty');
    if (empty) empty.hidden = posts.length !== 0;
    homeLoaded = true;
  } catch (error) {
    // État d'erreur explicite sur l'accueil (jamais un accueil vide et muet).
    const empty = document.getElementById('homeEmpty');
    if (empty) {
      empty.innerHTML = '<span>⚠️</span><h3>Flux momentanément indisponible</h3><p>Les dernières publications réapparaîtront ici dès que possible.</p><button class="secondary-button" data-channel type="button">Ouvrir le canal Telegram</button>';
      empty.hidden = false;
    }
    console.error('loadHome failed', error); // non bloquant : les sections dédiées restent accessibles
  }
}

// — Directs : le bloc « Prochain direct » n'apparaît que lorsqu'un direct est programmé ou en cours.
async function loadLive() {
  if (!inTelegram) return;
  try {
    const data = await fetchJson('./api/live', { cache: 'no-store' });
    const rail = document.getElementById('homeLive');
    const card = document.getElementById('homeLiveCard');
    if (!rail || !card) return;
    const lives = Array.isArray(data.lives) ? data.lives : [];
    if (lives.length === 0) { rail.hidden = true; return; }
    card.innerHTML = renderLiveCard(lives[0]);
    rail.hidden = false;
  } catch (error) {
    console.error('loadLive failed', error); // jamais de bloc vide : le rail reste masqué en cas d'erreur
  }
}

function renderLiveCard(live) {
  const date = live.scheduledAt ? new Date(live.scheduledAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  const isLive = live.status === 'live';
  const badge = isLive ? '<span class="live-badge live-now">En direct</span>' : '<span class="live-badge">Programmé</span>';
  const action = live.link ? `<button class="primary-button" type="button" data-live-link="${escapeAttribute(live.link)}">${isLive ? 'Regarder le direct' : 'Rejoindre le direct'}</button>` : '';
  return `<article class="live-card"><div class="live-meta"><span>🔴</span>${badge}<time>${escapeHtml(date)}</time></div><h3>${escapeHtml(live.title)}</h3>${live.description ? `<p>${escapeHtml(live.description)}</p>` : ''}${action}</article>`;
}

// — Rôle créatrice (GET /api/me) et chargement du studio à la demande.
// Le bouton Studio est masqué par défaut dans le HTML : un échec ou une réponse lente ne peut que le laisser masqué.
function applyRole(isCreator) {
  const button = document.getElementById('studioButton');
  if (button) button.hidden = !isCreator;
}

function getCachedRole() {
  try { return sessionStorage.getItem('pesce.isCreator'); } catch { return null; }
}

function setCachedRole(isCreator) {
  try { sessionStorage.setItem('pesce.isCreator', isCreator ? '1' : '0'); } catch { /* stockage indisponible (WebView privée) */ }
}

async function resolveRole() {
  const cached = getCachedRole();
  if (cached === '1') applyRole(true); // affichage immédiat pour la créatrice, revalidation ci-dessous
  try {
    const data = await fetchJson('./api/me', { headers: { 'x-telegram-init-data': tg.initData }, cache: 'no-store' });
    if (typeof data.isCreator !== 'boolean') throw new Error('Réponse de rôle invalide.');
    setCachedRole(data.isCreator);
    applyRole(data.isCreator);
    return data.isCreator;
  } catch (error) {
    console.error('resolveRole failed', error);
    return cached === '1'; // en cas d'échec, on s'en tient au cache ; jamais de promotion implicite
  }
}

let studioModulePromise = null;

function loadStudioModule() {
  if (window.PesceStudio) return Promise.resolve(window.PesceStudio);
  if (!studioModulePromise) {
    studioModulePromise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = './studio.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = './studio.js';
      script.onload = () => resolve(window.PesceStudio);
      script.onerror = () => { studioModulePromise = null; reject(new Error('Impossible de charger le studio.')); };
      document.head.appendChild(script);
    });
  }
  return studioModulePromise;
}

document.getElementById('studioButton')?.addEventListener('click', () => {
  loadStudioModule().then((studio) => studio.open()).catch(() => { /* le studio reste fermé ; /api/studio reste la vraie frontière */ });
});

// — Mesure d'audience V1 : ouverture du Mini App (feu-et-oublie, ne bloque jamais l'interface, silencieux)
function trackOpen() {
  if (!inTelegram || !tg?.initData) return;
  fetch('./api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'open', initData: tg.initData }) }).catch(() => { /* silencieux */ });
}

// — Paramètre de démarrage Telegram (startapp)
function getStartParam() {
  const unsafe = tg?.initDataUnsafe?.start_param;
  if (typeof unsafe === 'string' && unsafe) return unsafe;
  try { return new URLSearchParams(tg?.initData || '').get('start_param') || ''; } catch { return ''; }
}

// — Démarrage
if (inTelegram) {
  initSupportTopic();
  document.getElementById('supportButton')?.addEventListener('click', supportWithStars);
  document.getElementById('supportForm')?.addEventListener('submit', sendSupport);
  document.getElementById('profileButton')?.addEventListener('click', () => {
    const user = tg?.initDataUnsafe?.user;
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'visiteur';
    popup('Votre profil', `Bienvenue ${name} dans Pesce Studio.`);
  });

  const startParam = getStartParam();
  openSection(startParam === 'support' ? 'support' : 'home');
  trackOpen();
  if (startParam === 'studio') {
    resolveRole().then((isCreator) => {
      if (!isCreator) return; // silencieux : l'espace studio n'est pas une affordance publique
      loadStudioModule().then((studio) => studio.open()).catch(() => {});
    });
  } else {
    resolveRole();
  }
}

// — Surface partagée avec le module studio (chargé à la demande)
window.PesceApp = Object.freeze({
  popup,
  escapeHtml,
  escapeAttribute,
  formatDate,
  fetchJson,
  openSection,
  openExternal,
  get initData() { return tg?.initData || ''; },
});
