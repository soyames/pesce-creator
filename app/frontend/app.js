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
  if (id === 'home') loadHome();
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
  const postLink = event.target.closest('[data-post-link]');
  if (postLink) { openExternal(postLink.dataset.postLink); return; }
  const starOption = event.target.closest('[data-stars]');
  if (starOption) { selectStars(Number(starOption.dataset.stars)); }
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
  publications: { type: null, target: 'publicationFeed', emptyIcon: '📰', title: 'Aucune publication pour le moment.', text: 'Les prochaines publications du canal officiel apparaîtront ici.' },
  videos: { type: 'video', target: 'videoFeed', emptyIcon: '🎥', title: 'Aucune vidéo pour le moment.', text: 'Les vidéos publiées sur le canal officiel apparaîtront ici.' },
  audios: { type: 'audio', target: 'audioFeed', emptyIcon: '🎙️', title: 'Aucun audio pour le moment.', text: 'Les prochains contenus audio du canal officiel apparaîtront ici.' },
  photos: { type: 'photo', target: 'photoFeed', emptyIcon: '📸', title: 'Aucune photo pour le moment.', text: 'Les prochaines photos du canal officiel apparaîtront ici.' },
};

async function loadContent(sectionId) {
  const config = CONTENT_CONFIG[sectionId];
  if (!config) return;
  const target = document.getElementById(config.target);
  if (!target || target.dataset.loading === 'true') return;
  target.dataset.loading = 'true';
  target.innerHTML = '<article class="empty-card"><span>⏳</span><h3>Chargement…</h3><p>Récupération des contenus de Pesce.</p></article>';
  try {
    const query = config.type ? `?type=${encodeURIComponent(config.type)}&limit=30` : '?limit=30';
    const data = await fetchJson(`./api/content${query}`, { cache: 'no-store' });
    if (!Array.isArray(data.posts) || data.posts.length === 0) { renderEmpty(target, config); return; }
    target.innerHTML = data.posts.map(renderPost).join('');
  } catch (error) { renderError(target, error); }
  finally { target.dataset.loading = 'false'; }
}

function renderEmpty(target, config) {
  target.innerHTML = `<article class="empty-card"><span>${config.emptyIcon}</span><h3>${config.title}</h3><p>${config.text}</p><button class="secondary-button" data-channel type="button">Ouvrir le canal Telegram</button></article>`;
}

function renderError(target, error) {
  target.innerHTML = `<article class="empty-card"><span>⚠️</span><h3>Flux momentanément indisponible</h3><p>${escapeHtml(error.message || 'Impossible de charger les contenus.')}</p><button class="secondary-button" data-channel type="button">Ouvrir le canal Telegram</button></article>`;
}

function renderPost(post) {
  const date = formatDate(post.publishedAt);
  const text = escapeHtml(post.text || '');
  const mediaUrl = post.mediaUrl || (post.mediaFileId ? `./api/media?file_id=${encodeURIComponent(post.mediaFileId)}` : '');
  let media = '';
  if (post.contentType === 'photo' && mediaUrl) media = `<img class="post-media post-photo" src="${mediaUrl}" alt="Photo publiée par Pesce Hounyo" loading="lazy">`;
  else if (post.contentType === 'audio' && mediaUrl) media = `<audio class="post-audio" controls preload="none" src="${mediaUrl}"></audio>`;
  else if (post.contentType === 'video' && mediaUrl) media = `<video class="post-media" controls preload="metadata" src="${mediaUrl}"></video>`;
  const articleUrl = (post.text || '').match(/https:\/\/telegra\.ph\/[\w\-./]+/i);
  const articleButton = articleUrl ? `<button class="primary-button post-link" type="button" data-post-link="${escapeAttribute(articleUrl[0])}">Lire l’article</button>` : '';
  const action = post.telegramUrl ? `<button class="secondary-button post-link" type="button" data-post-link="${escapeAttribute(post.telegramUrl)}">Voir sur Telegram</button>` : '';
  return `<article class="post-card"><div class="post-meta"><span>${post.contentType === 'photo' ? '📸' : post.contentType === 'audio' ? '🎙️' : post.contentType === 'video' ? '🎥' : '📰'}</span><time>${date}</time></div>${media}${text ? `<p class="post-text">${text.replace(/\n/g, '<br>')}</p>` : ''}${articleButton}${action}</article>`;
}

// — Accueil : UNE seule requête /api/content, partitionnée côté client en rails (articles, vidéos, audios)
let homeLoaded = false;

async function loadHome() {
  if (!inTelegram || homeLoaded) return;
  try {
    const data = await fetchJson('./api/content?limit=30', { cache: 'no-store' });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const rails = { articles: [], videos: [], audios: [] };
    posts.forEach((post) => {
      if (post.contentType === 'text') rails.articles.push(post);
      else if (post.contentType === 'video') rails.videos.push(post);
      else if (post.contentType === 'audio') rails.audios.push(post);
    });
    renderRail('homeArticles', 'homeArticleFeed', rails.articles);
    renderRail('homeVideos', 'homeVideoFeed', rails.videos);
    renderRail('homeAudios', 'homeAudioFeed', rails.audios);
    const empty = document.getElementById('homeEmpty');
    if (empty) empty.hidden = posts.length !== 0;
    homeLoaded = true;
  } catch (error) {
    console.error('loadHome failed', error); // non bloquant : les sections dédiées restent accessibles
  }
}

function renderRail(railId, feedId, posts) {
  const rail = document.getElementById(railId);
  const feed = document.getElementById(feedId);
  if (!rail || !feed) return;
  const top = posts.slice(0, 3);
  if (top.length === 0) { rail.hidden = true; return; }
  rail.hidden = false;
  feed.innerHTML = top.map(renderPost).join('');
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
