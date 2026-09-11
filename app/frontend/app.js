// Coquille publique de Pesce Studio : porte Telegram, navigation, une éditoriale, flux, lecteur,
// soutien en Étoiles, assistance. Le design Stitch est la source de vérité visuelle ; toute la
// logique (Telegram/Neon/YouTube/Telegraph/Étoiles) existante est conservée telle quelle.
// Le studio créatrice est chargé à la demande (studio.js) uniquement pour la créatrice — voir resolveRole()/loadStudioModule().
const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);
const PESCE = window.PESCE;
if (!PESCE) console.error('PESCE manquant : constants.js n’a pas été chargé.');

const gate = document.getElementById('telegramGate');
const app = document.getElementById('telegramApp');
const sections = [...document.querySelectorAll('.content-section')];
const navButtons = [...document.querySelectorAll('.nav-button')];
const headerLabel = document.getElementById('headerLabel');

// Sections publiques uniquement : le studio créatrice n'est PAS une section publique —
// il s'ouvre en surcouche, uniquement via le deep link ?startapp=studio (serveur = frontière).
const SECTIONS = ['a-la-une', 'ecrits', 'directs', 'photos', 'soutenir', 'communaute', 'apropos', 'support'];
const HEADER_LABELS = { 'a-la-une': 'A La Une', ecrits: 'Publications', directs: 'Directs', photos: 'Photothèque', soutenir: 'Soutien', communaute: 'Communauté', apropos: 'À Propos', support: 'Assistance' };

// — Identité : hydrate les textes marqués data-identity depuis les constantes (source unique).
const IDENTITY = { tagline: PESCE.TAGLINE, youtubeHandle: PESCE.YOUTUBE_HANDLE, channelHandle: PESCE.CHANNEL_HANDLE, botUrl: PESCE.BOT_URL, channelUrl: PESCE.CHANNEL_URL, botUsername: PESCE.BOT_USERNAME };
document.querySelectorAll('[data-identity]').forEach((el) => {
  const value = IDENTITY[el.dataset.identity];
  if (value) el.textContent = value;
});
document.querySelectorAll('[data-identity-href]').forEach((el) => {
  const value = IDENTITY[el.dataset.identityHref];
  if (value) el.href = `${value}${el.dataset.identityHrefSuffix || ''}`;
});

// — Porte Telegram (navigateur hors Telegram)
if (inTelegram) {
  gate.hidden = true;
  app.hidden = false;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#fbf9f5');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#fbf9f5');
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

// « Il y a 4 heures » / « Hier » : horodatage relatif des cartes éditoriales.
function relativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || isNaN(date)) return '';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'À l’instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

// Temps de lecture estimé à partir du texte (≈200 mots/minute).
function readingTime(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function readingLabel(text) { return `${readingTime(text)} min de lecture`; }

// Durée média (secondes) → mm:ss, ou chaîne vide si inconnue.
function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (!total) return '';
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Requête impossible.');
  return data;
}

// — Toast (notification basse du design Stitch).
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = message;
  toast.classList.remove('opacity-0', 'pointer-events-none');
  toast.classList.add('opacity-100');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('opacity-100');
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, 2400);
}

// — Navigation par sections (publiques uniquement).
function applyHeaderState(id) {
  if (headerLabel) headerLabel.textContent = HEADER_LABELS[id] || 'A La Une';
}

function openSection(id) {
  if (!inTelegram || !SECTIONS.includes(id)) return;
  sections.forEach((section) => { section.hidden = section.id !== id; });
  navButtons.forEach((button) => {
    const active = button.dataset.section === id;
    button.classList.toggle('text-primary', active);
    button.classList.toggle('font-bold', active);
    button.classList.toggle('text-on-surface-variant', !active);
  });
  applyHeaderState(id);
  if (id === 'a-la-une') { loadHome(); loadLive(); }
  if (id === 'ecrits') loadPublications();
  if (id === 'directs') loadDirects();
  if (id === 'photos') loadPhotos();
  // Le studio ne s'ouvre PAS automatiquement ici : studio.js appelle openSection('studio')
  // une fois le rôle confirmé ; sans tentative, les non-créateurs voient la carte « espace réservé ».
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// — Routage par délégation : couvre le HTML statique ET les cartes rendues dynamiquement.
document.addEventListener('click', (event) => {
  const sectionButton = event.target.closest('[data-section]');
  if (sectionButton) { openSection(sectionButton.dataset.section); return; }
  const homeButton = event.target.closest('[data-home]');
  if (homeButton) { openSection('a-la-une'); return; }
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
  const readerNav = event.target.closest('[data-reader-nav]');
  if (readerNav) { openReader(readerNav.dataset.post); return; }
  const postLink = event.target.closest('[data-post-link]');
  if (postLink) { openExternal(postLink.dataset.postLink); return; }
  const liveLink = event.target.closest('[data-live-link]');
  if (liveLink) { openExternal(liveLink.dataset.liveLink || PESCE.CHANNEL_URL); return; }
  const starOption = event.target.closest('[data-stars]');
  if (starOption) { selectStars(Number(starOption.dataset.stars)); return; }
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) { setFilterAndLoad(filterButton.dataset.filter); return; }
  const rubricButton = event.target.closest('[data-rubric]');
  if (rubricButton) {
    currentFilter = rubricButton.dataset.rubric;
    syncFilterButtons();
    openSection('ecrits'); // loadPublications() charge avec le filtre déjà posé
    fetchPublications(currentFilter); // reprise si la une était déjà chargée
    return;
  }
  const bookmarkButton = event.target.closest('[data-bookmark]');
  if (bookmarkButton) { toggleBookmark(bookmarkButton); return; }
  const youtubeFrame = event.target.closest('.video-frame[data-youtube-src]');
  if (youtubeFrame) { openExternal(youtubeFrame.dataset.youtubeSrc); return; }
  const videoFrame = event.target.closest('.video-frame[data-video-src]');
  if (videoFrame) { playInlineVideo(videoFrame); return; }
  const listenButton = event.target.closest('[data-listen]');
  if (listenButton) { toggleListen(); return; }
  // La carte éditoriale entière ouvre le lecteur — sauf interaction avec un média ou un contrôle.
  if (!event.target.closest('video,audio,img,button,a,input,select,textarea')) {
    const card = event.target.closest('.editorial-card[data-post-id]');
    if (card) { openReader(card.dataset.postId); return; }
  }
});

// — Lecture vidéo en place : le cadre devient un lecteur natif (poster + bouton du design).
function playInlineVideo(frame) {
  if (frame.dataset.playing === '1') return;
  const src = frame.dataset.videoSrc;
  if (!src) return;
  frame.dataset.playing = '1';
  frame.innerHTML = `<video class="w-full h-full object-cover" controls autoplay playsinline preload="metadata" src="${escapeAttribute(src)}"${frame.dataset.videoPoster ? ` poster="${escapeAttribute(frame.dataset.videoPoster)}"` : ''}></video>`;
}

// — Lecture audio partagée : un seul flux à la fois, icône + timecode synchronisés.
const audioPlayer = { element: null, source: null, button: null, icon: null, timecode: null };

function setPlayIcon(button) {
  const icon = button?.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = 'play_arrow';
}

function setPauseIcon(button) {
  const icon = button?.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = 'pause';
}

function bindAudioControls(container) {
  container.querySelectorAll('.audio-play-btn[data-audio]').forEach((button) => {
    button.addEventListener('click', () => toggleAudio(button));
  });
}

function toggleAudio(button) {
  const src = button.dataset.audio;
  if (!src) { showToast('Audio indisponible pour le moment.'); return; }
  // Un autre morceau jouait : on l'arrête et on réinitialise son icône.
  if (audioPlayer.source && audioPlayer.source !== src && audioPlayer.element) {
    audioPlayer.element.pause();
    setPlayIcon(audioPlayer.button);
  }
  const card = button.closest('[data-audio-card]');
  if (audioPlayer.source === src && audioPlayer.element && !audioPlayer.element.paused) {
    audioPlayer.element.pause();
    setPlayIcon(button);
    return;
  }
  let element = audioPlayer.element;
  if (audioPlayer.source !== src) {
    element = new Audio(src);
    element.preload = 'metadata';
    audioPlayer.element = element;
    audioPlayer.source = src;
  }
  audioPlayer.button = button;
  audioPlayer.icon = button.querySelector('.material-symbols-outlined');
  audioPlayer.timecode = card?.querySelector('.audio-timecode') || null;
  element.onloadedmetadata = () => {
    if (audioPlayer.timecode) audioPlayer.timecode.textContent = `00:00 / ${formatDuration(element.duration)}`;
  };
  element.ontimeupdate = () => {
    if (audioPlayer.timecode) audioPlayer.timecode.textContent = `${formatDuration(element.currentTime)} / ${formatDuration(element.duration)}`;
  };
  element.onended = () => setPlayIcon(audioPlayer.button);
  element.play().then(() => setPauseIcon(button)).catch(() => {
    setPlayIcon(button);
    showToast('Lecture audio impossible pour le moment.');
  });
}

// — Ondes sonores décoratives du design (hauteurs h-2..h-8 et tonalités).
const WAVEFORM_REPORTAGE = [
  [2, 'secondary'], [4, 'secondary'], [6, 'primary'], [7, 'primary'], [3, 'secondary'], [5, 'secondary'], [8, 'primary'], [4, 'secondary'],
  [2, 'secondary'], [6, 'primary'], [5, 'secondary'], [7, 'primary'], [3, 'secondary'], [4, 'secondary'], [8, 'primary'], [3, 'secondary'],
  [5, 'secondary'], [4, 'primary'], [2, 'secondary'], [7, 'primary'], [4, 'secondary'], [3, 'secondary'], [5, 'primary'], [2, 'secondary'],
];
const WAVEFORM_NOTE = [
  [2, 'primary'], [4, 'primary'], [6, 'primary'], [3, 'primary'], [5, 'primary'], [2, 'primary'],
  [4, 'outline-variant'], [5, 'outline-variant'], [3, 'outline-variant'], [2, 'outline-variant'], [6, 'outline-variant'], [4, 'outline-variant'], [2, 'outline-variant'], [3, 'outline-variant'], [5, 'outline-variant'],
];

function waveformBars(sequence, firstPulse = false, rounded = false) {
  const width = sequence === WAVEFORM_REPORTAGE ? 'w-[3px]' : 'w-1';
  const round = rounded ? ' rounded-full' : '';
  return sequence.map(([height, tone], index) => {
    const pulse = firstPulse && index === 0 ? ' animate-pulse' : '';
    return `<span class="${width}${round} ${tone === 'primary' ? 'bg-primary' : tone === 'secondary' ? 'bg-secondary' : 'bg-outline-variant'} h-${height}${pulse}"></span>`;
  }).join('');
}

// — Étiquettes éditoriales par type de contenu.
const POST_LABELS = {
  text: { category: 'ARTICLE', action: 'Lire la publication' },
  photo: { category: 'PHOTO', action: 'Voir la photo' },
  video: { category: 'VIDÉO', action: 'Regarder' },
  audio: { category: 'AUDIO', action: 'Écouter' },
  document: { category: 'DOCUMENT', action: 'Lire la publication' },
  other: { category: 'PUBLICATION', action: 'Lire la publication' },
};

const KICKERS = {
  text: 'Enquête & Analyse',
  photo: 'Photoreportage',
  video: 'Grand Format Vidéo',
  audio: 'Reportage Sonore',
  document: 'Document',
  other: 'Publication',
};

const kickerOf = (post) => KICKERS[post.contentType] || KICKERS.other;
const labelOf = (post) => POST_LABELS[post.contentType] || POST_LABELS.other;

function hasText(post) { return Boolean((post.text || '').trim()); }

function headlineAndStandfirst(post) {
  const lines = (post.text || '').split('\n').map((line) => line.trim()).filter(Boolean).filter((line) => !/^https?:\/\//.test(line));
  let headline = '';
  let standfirst = '';
  if (lines.length > 0) {
    headline = lines[0].slice(0, 110);
    const rest = lines.slice(1).join(' ').trim();
    if (rest) standfirst = rest.length > 160 ? `${rest.slice(0, 160)}…` : rest;
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

// — Cache des publications (lecteur immédiat + navigation précédent/suivant).
const postCache = new Map();
let lastFeed = [];

function cachePosts(posts) {
  posts.forEach((post) => postCache.set(post.id, post));
}

// — Cartes d'état (vides / erreurs / chargement) dans la langue du design.
function renderEmptyCard(title, text) {
  return `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center">
<div class="w-12 h-12 bg-surface-container-highest flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-[24px]">history_edu</span></div>
<h3 class="font-headline-sm text-headline-sm text-on-surface">${escapeHtml(title)}</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(text)}</p>
<button class="bg-on-secondary-fixed text-surface px-space-md py-space-sm font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors" type="button" data-channel>Rejoindre le canal Telegram</button>
</article>`;
}

function renderErrorCard(error) {
  return `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center">
<div class="w-12 h-12 bg-surface-container-highest flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-[24px]">cloud_off</span></div>
<h3 class="font-headline-sm text-headline-sm text-on-surface">Flux momentanément indisponible</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(error?.message || 'Impossible de charger les contenus.')}</p>
<button class="bg-on-secondary-fixed text-surface px-space-md py-space-sm font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors" type="button" data-channel>Ouvrir le canal Telegram</button>
</article>`;
}

function renderLoadingCard(title, text) {
  return `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center">
<span class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
<h3 class="font-headline-sm text-headline-sm text-on-surface">${escapeHtml(title)}</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(text)}</p>
</article>`;
}

// — Cadres média du design : photo pleine largeur avec crédit, vidéo avec badge de lecture.
function photoFrame(post, { caption = 'Cliché Pesce Hounyo', badge = '', zoom = false } = {}) {
  const mediaUrl = post.mediaUrl || (post.mediaFileId ? `./api/media?file_id=${encodeURIComponent(post.mediaFileId)}` : '');
  if (!mediaUrl) return '';
  const zoomClasses = zoom ? ' transition-transform duration-500 hover:scale-105' : '';
  const badgeHtml = badge ? `<div class="absolute top-space-xs left-space-xs bg-primary px-space-xs py-0.5"><span class="font-kicker-label text-kicker-label text-on-primary uppercase tracking-widest text-[10px]">${escapeHtml(badge)}</span></div>` : '';
  return `<div class="relative w-full aspect-[16/10] overflow-hidden my-space-xs bg-surface-container">
<img class="w-full h-full object-cover${zoomClasses}" src="${escapeAttribute(mediaUrl)}" alt="${escapeAttribute(kickerOf(post))} publiée par Pesce Hounyo" loading="lazy">
<div class="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-on-secondary-fixed/80 via-on-secondary-fixed/40 to-transparent text-surface">
<span class="font-meta-detail text-[11px] text-surface-container-low opacity-90 tracking-tight">${escapeHtml(caption)}</span>
</div>
${badgeHtml}
</div>`;
}

function videoFrame(post, { rounded = false } = {}) {
  const src = post.mediaUrl || (post.mediaFileId ? `./api/media?file_id=${encodeURIComponent(post.mediaFileId)}` : '');
  const youtube = youtubeInfo(post.text);
  const poster = post.mediaThumbnailUrl || (youtube ? youtube.thumbnail : '');
  const roundClass = rounded ? ' rounded-full' : '';
  // Référence YouTube (pas de fichier local) : le clic ouvre YouTube, la miniature vient de l'identifiant.
  if (!src && youtube) {
    return `<div class="video-frame relative w-full aspect-[16/9] overflow-hidden bg-inverse-surface my-space-xs group cursor-pointer" data-youtube-src="${escapeAttribute(youtube.url)}">
<img class="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" src="${escapeAttribute(youtube.thumbnail)}" alt="${escapeAttribute(kickerOf(post))} par Pesce Hounyo" loading="lazy">
<div class="absolute inset-0 bg-gradient-to-t from-inverse-surface/90 via-transparent to-transparent"></div>
<div class="absolute inset-0 flex items-center justify-center">
<div class="w-14 h-14 bg-primary text-on-primary flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform${roundClass}">
<span class="material-symbols-outlined text-[32px]">play_arrow</span>
</div>
</div>
<div class="absolute bottom-2 left-3 right-3 flex items-center justify-between text-surface">
<span class="font-meta-detail text-[11px] bg-inverse-surface/80 px-2 py-0.5 uppercase tracking-wider">${escapeHtml(kickerOf(post))}</span>
<span class="font-meta-detail text-[11px] opacity-80">YouTube</span>
</div>
</div>`;
  }
  return `<div class="video-frame relative w-full aspect-[16/9] overflow-hidden bg-inverse-surface my-space-xs group cursor-pointer" data-video-src="${escapeAttribute(src)}" data-video-poster="${escapeAttribute(poster)}">
${poster ? `<img class="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" src="${escapeAttribute(poster)}" alt="${escapeAttribute(kickerOf(post))} par Pesce Hounyo" loading="lazy">` : ''}
<div class="absolute inset-0 bg-gradient-to-t from-inverse-surface/90 via-transparent to-transparent"></div>
<div class="absolute inset-0 flex items-center justify-center">
<div class="w-14 h-14 bg-primary text-on-primary flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform${roundClass}">
<span class="material-symbols-outlined text-[32px]">play_arrow</span>
</div>
</div>
<div class="absolute bottom-2 left-3 right-3 flex items-center justify-between text-surface">
<span class="font-meta-detail text-[11px] bg-inverse-surface/80 px-2 py-0.5 uppercase tracking-wider">${escapeHtml(kickerOf(post))}</span>
${post.mediaDuration ? `<span class="font-meta-detail text-[11px] opacity-80">${escapeHtml(formatDuration(post.mediaDuration))}</span>` : ''}
</div>
</div>`;
}

function mediaUrlOf(post) {
  return post.mediaUrl || (post.mediaFileId ? `./api/media?file_id=${encodeURIComponent(post.mediaFileId)}` : '');
}

// Référence YouTube dans une publication : YouTube reste l'hébergeur (V1) — le Mini App
// dérive l'identifiant et la miniature, sans jamais stocker de fichier vidéo.
function youtubeInfo(text) {
  const match = String(text || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!match) return null;
  return { id: match[1], url: `https://www.youtube.com/watch?v=${match[1]}`, thumbnail: `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` };
}

// — SOUTIEN EN ÉTOILES : pacte d'indépendance (une + soutenir).
const starAmounts = PESCE.STAR_TIERS.map((tier) => tier.amount);
let selectedStars = 100;

function renderStarOptions() {
  return PESCE.STAR_TIERS.map((tier) => {
    const active = tier.amount === selectedStars;
    return `<button class="star-option px-space-sm py-1.5 border ${active ? 'star-selected bg-surface text-primary border-surface' : 'border-on-primary/40 text-on-primary'} flex flex-col items-center font-kicker-label text-kicker-label uppercase tracking-wider transition-colors" type="button" data-stars="${tier.amount}" aria-pressed="${active}">
<strong class="text-[13px]">${tier.amount} ⭐</strong>
<small class="font-meta-detail text-[10px] opacity-80 mt-0.5">${escapeHtml(tier.label)}</small>
</button>`;
  }).join('');
}

function renderPacte() {
  return `<div class="bg-primary text-on-primary p-space-md flex flex-col gap-space-sm">
<div class="flex items-center gap-space-xs">
<span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="font-kicker-label text-kicker-label uppercase tracking-widest text-primary-fixed">Le Pacte d'Indépendance</span>
</div>
<h3 class="font-headline-sm text-headline-sm leading-snug font-normal text-on-primary">Soutenez une voix libre : Pesce Studio vit grâce aux étoiles Telegram et à vos contributions directes.</h3>
<p class="font-body-sm text-body-sm text-on-primary-container leading-relaxed">Sans votre soutien régulier, les déplacements d'investigation en région et les dossiers de fond ne peuvent exister. Chaque don garantit notre autonomie éditoriale totale.</p>
<div class="star-options flex flex-wrap gap-space-xs pt-space-xs" role="group" aria-label="Choisir un montant en Étoiles">${renderStarOptions()}</div>
<div class="pt-space-xs flex flex-col sm:flex-row gap-space-xs">
<button class="support-send w-full py-3 px-space-md bg-inverse-surface text-surface font-kicker-label text-kicker-label uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-black transition-colors" type="button">
<span class="material-symbols-outlined text-primary-fixed text-[18px]" style="font-variation-settings: 'FILL' 1;">grade</span>
<span class="support-send-label">Soutenir avec Telegram Stars</span>
</button>
<button class="w-full py-3 px-space-md bg-transparent text-on-primary font-kicker-label text-kicker-label uppercase tracking-wider hover:bg-primary-container transition-colors" type="button" data-section="support">Autre moyen de contribution</button>
</div>
<div class="flex items-center justify-center gap-space-sm text-on-primary-container font-meta-detail text-meta-detail text-[11px] pt-space-xs">
<span>🔒 Paiement direct Telegram sécurisé</span><span>·</span><span>Reçu certifié</span>
</div>
</div>`;
}

function selectStars(amount) {
  if (!starAmounts.includes(amount)) return;
  selectedStars = amount;
  document.querySelectorAll('[data-stars]').forEach((item) => {
    const active = Number(item.dataset.stars) === selectedStars;
    item.classList.toggle('star-selected', active);
    item.classList.toggle('bg-surface', active);
    item.classList.toggle('text-primary', active);
    item.classList.toggle('border-surface', active);
    item.classList.toggle('text-on-primary', !active);
    item.classList.toggle('border-on-primary/40', !active);
    item.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.support-send-label').forEach((label) => {
    label.textContent = `Soutenir avec ${selectedStars} ⭐`;
  });
}

async function supportWithStars() {
  if (!inTelegram) return;
  const buttons = [...document.querySelectorAll('.support-send')];
  buttons.forEach((button) => { button.disabled = true; });
  const labels = [...document.querySelectorAll('.support-send-label')];
  labels.forEach((label) => { label.textContent = 'Préparation…'; });
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
  finally {
    buttons.forEach((button) => { button.disabled = false; });
    labels.forEach((label) => { label.textContent = `Soutenir avec ${selectedStars} ⭐`; });
  }
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

// — À LA UNE : flux mixte composé (lead, chronique, derniers formats) + programmation des directs.
let homeLoaded = false;

async function loadHome() {
  if (!inTelegram || homeLoaded) return;
  homeLoaded = true;
  const leadSlot = document.getElementById('homeLead');
  const chronique = document.getElementById('homeChronique');
  const chroniqueCard = document.getElementById('homeChroniqueCard');
  const formats = document.getElementById('homeFormats');
  const videoCard = document.getElementById('homeVideoCard');
  const audioCard = document.getElementById('homeAudioCard');
  try {
    const data = await fetchJson('./api/content?limit=30', { cache: 'no-store' });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    lastFeed = posts;
    cachePosts(posts);
    if (!posts.length) {
      if (leadSlot) leadSlot.innerHTML = renderEmptyCard('Aucun contenu pour le moment.', 'Les publications du canal officiel apparaîtront ici.');
      if (chronique) chronique.hidden = true;
      if (formats) formats.hidden = true;
      return;
    }
    const textPosts = posts.filter(hasText);
    const videoPosts = posts.filter((post) => post.contentType === 'video');
    const audioPosts = posts.filter((post) => post.contentType === 'audio');
    const photoPosts = posts.filter((post) => post.contentType === 'photo');
    const lead = textPosts[0] || photoPosts[0] || videoPosts[0] || audioPosts[0];
    if (leadSlot && lead) leadSlot.innerHTML = renderHomeLead(lead);
    const chroniquePost = textPosts[1] || null;
    if (chronique && chroniqueCard) {
      if (chroniquePost) { chroniqueCard.innerHTML = renderChroniqueCard(chroniquePost); chronique.hidden = false; }
      else chronique.hidden = true;
    }
    const videoPost = videoPosts[0] || null;
    const audioPost = audioPosts[0] || null;
    if (formats && videoCard && audioCard) {
      if (videoPost) videoCard.innerHTML = renderDispatchVideoCard(videoPost);
      if (audioPost) { audioCard.innerHTML = renderDispatchAudioCard(audioPost); bindAudioControls(audioCard); }
      formats.hidden = !videoPost && !audioPost;
    }
  } catch (error) {
    // État d'erreur explicite sur l'accueil (jamais un accueil vide et muet).
    if (leadSlot) leadSlot.innerHTML = renderErrorCard(error);
    if (chronique) chronique.hidden = true;
    if (formats) formats.hidden = true;
    console.error('loadHome failed', error); // non bloquant : les sections dédiées restent accessibles
  }
}

function renderHomeLead(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const media = post.contentType === 'photo' ? photoFrame(post, { caption: 'Pesce Hounyo / Pesce Studio', badge: 'Grand Reportage' }) : post.contentType === 'video' ? videoFrame(post) : articleCoverFrame(post);
  return `<article class="w-full flex flex-col gap-space-sm bg-surface editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
${media}
<div class="flex items-center gap-space-xs pt-space-xs">
<span class="font-kicker-label text-kicker-label text-primary uppercase tracking-widest font-bold">${escapeHtml(kickerOf(post).toUpperCase())} · PESCE STUDIO</span>
</div>
<h2 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface leading-tight tracking-tight">${escapeHtml(headline)}</h2>
${standfirst ? `<p class="font-editorial-standfirst text-editorial-standfirst text-on-surface-variant leading-snug">${escapeHtml(standfirst)}</p>` : ''}
<div class="flex flex-wrap items-center gap-x-space-md gap-y-1 py-space-xs text-on-surface-variant font-meta-detail text-meta-detail">
<span class="font-medium text-on-surface">Par ${escapeHtml(PESCE.CREATOR_NAME)}</span><span>·</span>
<span>${escapeHtml(relativeTime(post.publishedAt))}</span><span>·</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span>${readingLabel(post.text)}</span>
</div>
<div class="pt-space-xs flex flex-wrap items-center justify-between gap-space-xs">
<button class="px-space-md py-3 bg-on-surface text-surface font-kicker-label text-kicker-label uppercase tracking-wider inline-flex items-center gap-space-xs hover:bg-primary transition-colors" type="button" data-reader="${escapeAttribute(post.id)}">
<span>Lire l'enquête complète</span><span class="material-symbols-outlined text-[16px]">east</span>
</button>
<button class="w-10 h-10 shrink-0 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors" type="button" data-bookmark title="Ajouter aux favoris" aria-label="Ajouter aux favoris">
<span class="material-symbols-outlined text-[22px]">bookmark_border</span>
</button>
</div>
</article>`;
}

function renderChroniqueCard(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  return `<article class="editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<h3 class="font-headline-sm text-headline-sm text-on-surface leading-snug">${escapeHtml(headline)}</h3>
<p class="font-body-md text-body-md text-on-surface-variant leading-relaxed">${escapeHtml(standfirst || (post.text || '').slice(0, 180))}</p>
<div class="pt-space-xs flex items-center justify-between text-on-surface-variant font-meta-detail text-meta-detail">
<div class="flex items-center gap-space-xs">
<img alt="Pesce Hounyo" class="w-6 h-6 rounded-full object-cover" src="./assets/profilePesce.png">
<span class="font-medium text-on-surface">Tribune libre</span>
</div>
<button class="py-2 text-primary font-kicker-label text-kicker-label uppercase font-bold hover:underline" type="button" data-reader="${escapeAttribute(post.id)}">Lire la tribune (${readingTime(post.text)} min) →</button>
</div>
</article>`;
}

function renderDispatchVideoCard(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const duration = formatDuration(post.mediaDuration);
  const youtube = youtubeInfo(post.text);
  const poster = post.mediaThumbnailUrl || (youtube ? youtube.thumbnail : '');
  return `<article class="flex flex-col bg-surface-container p-space-sm gap-space-xs editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<div class="relative w-full">
<div class="video-frame relative w-full aspect-video bg-surface-container-high overflow-hidden group cursor-pointer" data-video-src="${escapeAttribute(mediaUrlOf(post))}" data-video-poster="${escapeAttribute(poster)}"${!mediaUrlOf(post) && youtube ? ` data-youtube-src="${escapeAttribute(youtube.url)}"` : ''}>
${poster ? `<img class="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" src="${escapeAttribute(poster)}" alt="${escapeAttribute(kickerOf(post))} par Pesce Hounyo" loading="lazy">` : ''}
<div class="absolute inset-0 bg-inverse-surface/30 flex items-center justify-center">
<span class="w-12 h-12 bg-primary text-on-primary flex items-center justify-center rounded-full shadow-md group-hover:scale-105 transition-transform"><span class="material-symbols-outlined text-[28px]" style="font-variation-settings: 'FILL' 1;">play_arrow</span></span>
</div>
</div>
<div class="absolute bottom-2 left-2 bg-on-surface/90 text-surface text-[10px] font-kicker-label uppercase px-1.5 py-0.5 tracking-wider">${escapeHtml(labelOf(post).category)}${duration ? ` · ${duration} min` : ''}</div>
</div>
<span class="font-kicker-label text-kicker-label text-primary uppercase pt-1 tracking-wider">${escapeHtml(kickerOf(post).toUpperCase())}</span>
<h4 class="font-headline-sm text-[1.125rem] leading-snug text-on-surface hover:text-primary transition-colors cursor-pointer" data-reader="${escapeAttribute(post.id)}">${escapeHtml(headline)}</h4>
<p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">${escapeHtml(standfirst)}</p>
</article>`;
}

function renderDispatchAudioCard(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const duration = formatDuration(post.mediaDuration);
  const telegramUrl = post.telegramUrl || PESCE.CHANNEL_URL;
  return `<article class="bg-surface-container-low p-space-sm flex flex-col gap-space-xs" data-audio-card>
<div class="flex items-center justify-between">
<div class="flex items-center gap-space-xs">
<span class="material-symbols-outlined text-primary text-[18px]">mic</span>
<span class="font-kicker-label text-kicker-label uppercase tracking-widest text-on-surface">Note Vocale de Terrain</span>
</div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${escapeHtml(relativeTime(post.publishedAt))}${duration ? ` · ${duration} min` : ''}</span>
</div>
<div class="flex items-center gap-space-sm pt-1">
<button class="audio-play-btn w-10 h-10 bg-on-surface text-surface flex items-center justify-center shrink-0 hover:bg-primary transition-colors" type="button" data-audio="${escapeAttribute(mediaUrlOf(post))}">
<span class="material-symbols-outlined text-[22px]">play_arrow</span>
</button>
<div class="flex flex-col flex-1 min-w-0">
<div class="font-meta-detail text-meta-detail font-medium text-on-surface truncate">${escapeHtml(headline)}</div>
<div class="flex items-center gap-[2px] h-6 py-1">${waveformBars(WAVEFORM_NOTE)}</div>
</div>
</div>
<div class="flex justify-between items-center text-on-surface-variant font-meta-detail text-meta-detail pt-0.5">
<span class="audio-timecode">${duration ? `00:00 / ${duration}` : '00:00 / —:—'}</span>
<button class="py-2 text-primary font-medium" type="button" data-post-link="${escapeAttribute(telegramUrl)}">Écouter sur Telegram WebApp</button>
</div>
</article>`;
}

// — Directs : bannière « Prochain direct » (accueil) et programmation complète (section Directs).
async function loadLive() {
  if (!inTelegram) return;
  try {
    const data = await fetchJson('./api/live', { cache: 'no-store' });
    const banner = document.getElementById('homeLiveBanner');
    if (!banner) return;
    const lives = Array.isArray(data.lives) ? data.lives : [];
    if (lives.length === 0) { banner.hidden = true; return; }
    banner.innerHTML = renderLiveBanner(lives[0]);
    banner.hidden = false;
  } catch (error) {
    console.error('loadLive failed', error); // jamais de bloc vide : la bannière reste masquée en cas d'erreur
  }
}

function renderLiveBanner(live) {
  const date = live.scheduledAt ? new Date(live.scheduledAt) : null;
  const when = date && !isNaN(date)
    ? `${date.toLocaleString('fr-FR', { weekday: 'long' })} · ${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')} GMT`
    : '';
  const isLive = live.status === 'live';
  const statusLabel = isLive ? 'En Direct Vidéo' : 'Prochain Direct Vidéo';
  return `<div class="w-full bg-surface-container-highest p-space-sm flex flex-col gap-space-xs">
<div class="flex items-center justify-between">
<div class="flex items-center gap-1.5">
<span class="w-2 h-2 rounded-full bg-error animate-pulse"></span>
<span class="font-kicker-label text-kicker-label text-error uppercase tracking-wider">${statusLabel}</span>
</div>
${when ? `<span class="font-meta-detail text-meta-detail text-on-surface-variant">${escapeHtml(when)}</span>` : ''}
</div>
<p class="font-body-sm text-body-sm text-on-surface font-medium leading-tight">${escapeHtml(live.title)}${live.description ? ` — ${escapeHtml(live.description)}` : ''}</p>
<div class="flex flex-wrap items-center justify-between gap-1 pt-1">
<div class="flex items-center gap-space-xs text-on-surface-variant font-meta-detail text-meta-detail min-w-0">
<span class="material-symbols-outlined text-[16px] shrink-0">notifications_active</span>
<span>${isLive ? 'En cours sur Telegram & YouTube' : 'Diffusion sur Telegram & YouTube'}</span>
</div>
<button class="inline-flex items-center gap-1 py-2 shrink-0 font-kicker-label text-kicker-label uppercase text-primary font-bold hover:underline" type="button" data-live-link="${escapeAttribute(live.link || '')}">Rejoindre le salon <span class="material-symbols-outlined text-[14px]">arrow_forward</span></button>
</div>
</div>`;
}

let directsLoaded = false;

async function loadDirects() {
  if (!inTelegram || directsLoaded) return;
  directsLoaded = true;
  const feed = document.getElementById('directFeed');
  if (!feed) return;
  feed.innerHTML = renderLoadingCard('Chargement de la programmation…', 'Récupération des directs annoncés.');
  try {
    const data = await fetchJson('./api/live', { cache: 'no-store' });
    const lives = Array.isArray(data.lives) ? data.lives : [];
    feed.innerHTML = lives.length
      ? lives.map(renderLiveBanner).join('')
      : renderEmptyCard('Aucun direct programmé.', 'La prochaine programmation de direct apparaîtra ici, ainsi que sur le canal Telegram.');
  } catch (error) {
    feed.innerHTML = renderErrorCard(error);
  }
}

// — ÉCRITS : la une des publications (composition éditoriale + filtres par type de contenu).
const FILTERS = {
  tout: { label: 'Tout', type: null },
  enquetes: { label: 'Enquêtes', type: 'text' },
  societe: { label: 'Société', type: 'text' },
  opinion: { label: 'Opinion', type: 'text' },
  videos: { label: 'Vidéos', type: 'video' },
  audios: { label: 'Audios', type: 'audio' },
  entretiens: { label: 'Entretiens', type: 'text' },
};

let currentFilter = 'tout';
let publicationsLoaded = false;

function syncFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('filter-active', active);
    button.classList.toggle('text-on-surface-variant', !active);
  });
  document.querySelectorAll('[data-rubric]').forEach((button) => {
    button.classList.toggle('rubric-active', button.dataset.rubric === currentFilter);
  });
}

async function loadPublications() {
  if (!inTelegram || publicationsLoaded) return;
  await fetchPublications(currentFilter);
}

function setFilterAndLoad(filterKey) {
  if (!FILTERS[filterKey]) return;
  currentFilter = filterKey;
  syncFilterButtons();
  fetchPublications(filterKey);
}

async function fetchPublications(filterKey) {
  const filter = FILTERS[filterKey] || FILTERS.tout;
  const target = document.getElementById('publicationFeed');
  if (!target || target.dataset.loading === 'true') return;
  target.dataset.loading = 'true';
  target.innerHTML = renderLoadingCard('Chargement des publications…', 'Récupération des contenus du canal officiel.');
  try {
    const query = filter.type ? `?type=${encodeURIComponent(filter.type)}&limit=30` : '?limit=30';
    const data = await fetchJson(`./api/content${query}`, { cache: 'no-store' });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    lastFeed = posts;
    cachePosts(posts);
    if (!posts.length) {
      target.innerHTML = renderEmptyCard('Aucune publication pour le moment.', 'Les publications du canal officiel apparaîtront ici.');
      publicationsLoaded = true;
      return;
    }
    target.innerHTML = filterKey === 'tout' ? renderFrontPage(posts) : renderFilteredList(posts);
    bindAudioControls(target);
    publicationsLoaded = true;
  } catch (error) {
    target.innerHTML = renderErrorCard(error);
    publicationsLoaded = true;
  } finally {
    target.dataset.loading = 'false';
  }
}

// Composition « à la une des écrits » : lead, tribune, entretien, reportage sonore, grand format vidéo, archives.
function renderFrontPage(posts) {
  const used = new Set();
  const textPosts = posts.filter(hasText);
  const photoPosts = posts.filter((post) => post.contentType === 'photo');
  const videoPosts = posts.filter((post) => post.contentType === 'video');
  const audioPosts = posts.filter((post) => post.contentType === 'audio');
  const lead = textPosts[0] || photoPosts[0] || videoPosts[0] || audioPosts[0] || null;
  if (!lead) return renderEmptyCard('Aucune publication pour le moment.', 'Les publications du canal officiel apparaîtront ici.');
  used.add(lead.id);
  const tribune = textPosts.find((post) => !used.has(post.id)) || null;
  if (tribune) used.add(tribune.id);
  const entretien = textPosts.find((post) => !used.has(post.id)) || photoPosts.find((post) => !used.has(post.id)) || null;
  if (entretien) used.add(entretien.id);
  const audio = audioPosts.find((post) => !used.has(post.id)) || null;
  if (audio) used.add(audio.id);
  const video = videoPosts.find((post) => !used.has(post.id)) || null;
  if (video) used.add(video.id);

  const blocks = [renderLeadCard(lead)];
  const secondary = [];
  if (tribune) secondary.push(renderTribuneCard(tribune));
  if (entretien) secondary.push(renderEntretienCard(entretien));
  if (secondary.length) blocks.push(`<div class="grid grid-cols-1 gap-space-md">${secondary.join('')}</div>`);
  if (audio) blocks.push(renderAudioModule(audio));
  if (video) blocks.push(renderVideoEntry(video));
  // Tous les écrits publiés restent visibles : liste compacte des publications non composées.
  const remainingTexts = textPosts.filter((post) => !used.has(post.id));
  if (remainingTexts.length) {
    blocks.push(`<div class="flex flex-col gap-space-md">
<div class="flex items-center gap-2"><span class="w-2 h-2 bg-primary rounded-full"></span><h3 class="font-headline-sm text-headline-sm text-on-surface">Derniers écrits</h3></div>
${remainingTexts.map(renderTextCard).join('')}
</div>`);
  }
  blocks.push(renderArchiveBridge());
  return blocks.join('');
}

function articleCoverFrame(post) {
  // Couverture d'article hébergée par Telegraph (métadonnée de référence — aucun binaire dans Neon).
  if (!post.articleImageUrl) return '';
  return `<div class="relative w-full aspect-[16/10] overflow-hidden my-space-xs bg-surface-container">
<img class="w-full h-full object-cover" src="${escapeAttribute(post.articleImageUrl)}" alt="Couverture de l'article" loading="lazy">
<div class="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-on-secondary-fixed/80 via-on-secondary-fixed/40 to-transparent text-surface">
<span class="font-meta-detail text-[11px] text-surface-container-low opacity-90 tracking-tight">Article Telegraph • Couverture Pesce Studio</span>
</div>
</div>`;
}

function renderLeadCard(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const media = post.contentType === 'photo' ? photoFrame(post, { caption: `${kickerOf(post)} • Cliché Pesce Hounyo`, zoom: true }) : post.contentType === 'video' ? videoFrame(post) : articleCoverFrame(post);
  return `<article class="flex flex-col bg-surface-container-lowest p-space-md shadow-sm editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<div class="flex items-center justify-between mb-space-xs">
<span class="font-kicker-label text-kicker-label uppercase text-primary tracking-wider font-bold">${escapeHtml(kickerOf(post).toUpperCase())}</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">bookmark_border</span> Dossier</span>
</div>
${media}
<h2 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mt-space-sm leading-tight hover:text-primary transition-colors cursor-pointer" data-reader="${escapeAttribute(post.id)}">${escapeHtml(headline)}</h2>
${standfirst ? `<p class="font-editorial-standfirst text-editorial-standfirst text-on-surface-variant mt-space-xs leading-snug">${escapeHtml(standfirst)}</p>` : ''}
<div class="flex items-center justify-between mt-space-md pt-space-xs bg-surface-container-low px-space-sm py-2">
<div class="flex items-center gap-2">
<span class="font-meta-detail text-meta-detail font-semibold text-on-surface">${escapeHtml(PESCE.CREATOR_NAME)}</span>
<span class="text-on-surface-variant font-meta-detail text-meta-detail">• ${escapeHtml(relativeTime(post.publishedAt))} • ${readingLabel(post.text)}</span>
</div>
<button class="bg-on-secondary-fixed text-surface text-kicker-label font-kicker-label uppercase tracking-widest px-3 py-3 hover:bg-primary transition-colors" type="button" data-reader="${escapeAttribute(post.id)}">Lire</button>
</div>
</article>`;
}

function renderTribuneCard(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  return `<article class="bg-surface-container-low p-space-md shadow-sm relative overflow-hidden editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<div class="flex items-center justify-between mb-space-xs">
<span class="font-kicker-label text-kicker-label uppercase tracking-widest text-primary font-bold">Tribune Débat</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${readingTime(post.text)} min</span>
</div>
<div class="pl-space-sm bg-surface-container-lowest p-space-md my-space-xs shadow-inner">
<p class="font-headline-sm text-headline-sm text-on-surface italic leading-snug">« ${escapeHtml(headline)} »</p>
</div>
<p class="font-body-md text-body-md text-on-surface-variant mt-space-xs">${escapeHtml(standfirst || '')}</p>
<div class="flex items-center justify-between mt-space-sm text-on-surface-variant">
<span class="font-meta-detail text-meta-detail italic">Par ${escapeHtml(PESCE.CREATOR_NAME)} • Cotonou</span>
<button class="py-2 font-kicker-label text-kicker-label text-primary uppercase font-bold tracking-wider hover:underline" type="button" data-reader="${escapeAttribute(post.id)}">Parcourir l'essai →</button>
</div>
</article>`;
}

function renderEntretienCard(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const portrait = post.contentType === 'photo' ? mediaUrlOf(post) : '';
  return `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<div class="flex items-center justify-between mb-space-xs">
<span class="font-kicker-label text-kicker-label uppercase tracking-widest text-secondary font-bold">Grand Entretien</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${escapeHtml(kickerOf(post))}</span>
</div>
<div class="flex ${portrait ? 'flex-row' : 'flex-col'} gap-space-md items-start mt-space-xs">
${portrait ? `<div class="w-24 h-28 shrink-0 bg-surface-container overflow-hidden"><img class="w-full h-full object-cover" src="${escapeAttribute(portrait)}" alt="Portrait publié par Pesce Hounyo" loading="lazy"></div>` : ''}
<div class="flex flex-col min-w-0">
<h3 class="font-headline-sm text-headline-sm text-on-surface leading-tight hover:text-primary transition-colors cursor-pointer" data-reader="${escapeAttribute(post.id)}">« ${escapeHtml(headline)} »</h3>
<span class="font-meta-detail text-meta-detail text-primary font-medium mt-1">${escapeHtml(PESCE.CREATOR_NAME)}</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant mt-0.5">Journaliste d'investigation — Pesce Studio</span>
</div>
</div>
<p class="font-body-md text-body-md text-on-surface-variant mt-space-sm">${escapeHtml(standfirst || '')}</p>
<div class="mt-space-sm pt-2 bg-surface-container-low px-space-sm py-1.5 flex items-center justify-between">
<span class="font-meta-detail text-meta-detail text-on-surface">Propos recueillis par la Rédaction</span>
<button class="py-2 font-kicker-label text-kicker-label text-primary uppercase font-bold tracking-wider" type="button" data-reader="${escapeAttribute(post.id)}">Texte intégral</button>
</div>
</article>`;
}

function renderAudioModule(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const duration = formatDuration(post.mediaDuration);
  return `<section class="bg-surface-container-high p-space-md shadow-sm relative overflow-hidden" data-audio-card>
<div class="flex items-center justify-between mb-space-xs">
<div class="flex items-center gap-1.5">
<span class="material-symbols-outlined text-primary text-[18px]">graphic_eq</span>
<span class="font-kicker-label text-kicker-label uppercase text-primary font-bold tracking-widest">Reportage Sonore</span>
</div>
<span class="font-meta-detail text-meta-detail bg-surface text-on-surface px-2 py-0.5 shadow-sm">Stéréo${duration ? ` • ${duration}` : ''}</span>
</div>
<h3 class="font-headline-sm text-headline-sm text-on-surface mt-space-xs leading-snug hover:text-primary transition-colors cursor-pointer editorial-card" data-post-id="${escapeAttribute(post.id)}">${escapeHtml(headline)}</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${escapeHtml(standfirst || '')}</p>
<div class="bg-surface-container-lowest p-space-sm mt-space-md flex flex-col gap-2" id="audio-player-box">
<div class="flex items-center justify-between gap-space-sm">
<button class="audio-play-btn w-10 h-10 bg-primary hover:bg-primary-container text-on-primary flex items-center justify-center shrink-0 transition-transform active:scale-95" type="button" data-audio="${escapeAttribute(mediaUrlOf(post))}">
<span class="material-symbols-outlined text-[24px]">play_arrow</span>
</button>
<div class="flex items-end gap-[3px] h-8 flex-1 overflow-hidden py-1" id="waveform-container">${waveformBars(WAVEFORM_REPORTAGE, true)}</div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant font-mono shrink-0 audio-timecode">${duration ? `00:00 / ${duration}` : '00:00 / —:—'}</span>
</div>
</div>
</section>`;
}

function renderVideoEntry(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const duration = formatDuration(post.mediaDuration);
  const telegramUrl = post.telegramUrl || PESCE.CHANNEL_URL;
  return `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<div class="flex items-center justify-between mb-space-xs">
<span class="font-kicker-label text-kicker-label uppercase text-primary tracking-widest font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[15px]">videocam</span> Grand Format Vidéo</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${duration ? `${duration} HD` : 'HD'}</span>
</div>
${videoFrame(post)}
<h3 class="font-headline-md text-headline-md text-on-surface mt-space-sm leading-tight hover:text-primary transition-colors cursor-pointer" data-reader="${escapeAttribute(post.id)}">${escapeHtml(headline)}</h3>
<p class="font-body-md text-body-md text-on-surface-variant mt-space-xs">${escapeHtml(standfirst || '')}</p>
<div class="flex items-center gap-space-sm mt-space-md pt-space-xs bg-surface-container-low p-space-sm">
<button class="flex items-center gap-1.5 py-2 font-kicker-label text-kicker-label uppercase tracking-widest text-on-surface hover:text-primary transition-colors" type="button" data-youtube><span class="material-symbols-outlined text-[16px]">smart_display</span> Visionner sur YouTube</button>
<span class="text-on-surface-variant opacity-40">•</span>
<button class="flex items-center gap-1.5 py-2 font-kicker-label text-kicker-label uppercase tracking-widest text-primary hover:text-on-surface transition-colors" type="button" data-post-link="${escapeAttribute(telegramUrl)}"><span class="material-symbols-outlined text-[16px]">send</span> Diffuser sur Telegram</button>
</div>
</article>`;
}

function renderArchiveBridge() {
  return `<section class="bg-surface-container-highest p-space-lg shadow-sm flex flex-col gap-space-sm text-center">
<div class="w-12 h-12 bg-on-secondary-fixed text-surface mx-auto flex items-center justify-center"><span class="material-symbols-outlined text-[26px]">history_edu</span></div>
<div class="flex flex-col gap-1">
<span class="font-kicker-label text-kicker-label uppercase text-primary tracking-widest font-bold">Fonds Documentaire Complet</span>
<h4 class="font-headline-sm text-headline-sm text-on-surface">Accéder aux publications historiques</h4>
<p class="font-body-sm text-body-sm text-on-surface-variant max-w-md mx-auto">Retrouvez l'intégralité des billets de terrain, dépêches instantanées, notes de lecture et documents déclassifiés depuis 2018 sur le canal Telegram officiel du Studio.</p>
</div>
<div class="mt-space-xs flex flex-col gap-2">
<button class="inline-flex items-center justify-center gap-2 bg-on-secondary-fixed text-surface px-space-lg py-3 font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-all active:scale-[0.99]" type="button" data-channel>
<span class="material-symbols-outlined text-[18px]">send</span> Rejoindre ${escapeHtml(PESCE.CHANNEL_HANDLE)}
</button>
<span class="font-meta-detail text-meta-detail text-on-surface-variant italic">Accès libre, sans algorithme</span>
</div>
</section>`;
}

// Carte d'écrit : couverture Telegraph le cas échéant, titre, chapeau, « Lire ».
function renderTextCard(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  return `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col gap-space-xs editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<div class="flex items-center justify-between"><span class="font-kicker-label text-kicker-label uppercase text-primary font-bold">${escapeHtml(kickerOf(post))}</span><span class="font-meta-detail text-meta-detail text-on-surface-variant">${escapeHtml(relativeTime(post.publishedAt))} · ${readingTime(post.text)} min</span></div>
${post.articleImageUrl ? `<div class="relative w-full aspect-[16/9] overflow-hidden bg-surface-container"><img class="w-full h-full object-cover" src="${escapeAttribute(post.articleImageUrl)}" alt="Couverture de l'article" loading="lazy"></div>` : ''}
<h3 class="font-headline-sm text-headline-sm text-on-surface leading-snug">${escapeHtml(headline)}</h3>
<p class="font-body-md text-body-md text-on-surface-variant line-clamp-2">${escapeHtml(standfirst || '')}</p>
<div class="pt-space-xs flex items-center justify-between"><span class="font-meta-detail text-meta-detail text-on-surface">${escapeHtml(PESCE.CREATOR_NAME)}</span><button class="py-2 font-kicker-label text-kicker-label text-primary uppercase font-bold tracking-wider hover:underline" type="button" data-reader="${escapeAttribute(post.id)}">Lire →</button></div>
</article>`;
}

// Vues filtrées : listes d'un seul type de contenu, dans la même langue visuelle.
function renderFilteredList(posts) {
  return posts.map((post) => {
    const { headline } = headlineAndStandfirst(post);
    if (post.contentType === 'video') return renderVideoEntry(post);
    if (post.contentType === 'audio') return renderAudioModule(post);
    if (post.contentType === 'photo') {
      return `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col gap-space-xs editorial-card cursor-pointer" data-post-id="${escapeAttribute(post.id)}">
<div class="flex items-center justify-between"><span class="font-kicker-label text-kicker-label uppercase text-primary font-bold">${escapeHtml(kickerOf(post))}</span><span class="font-meta-detail text-meta-detail text-on-surface-variant">${escapeHtml(relativeTime(post.publishedAt))}</span></div>
<div class="relative w-full aspect-[16/10] overflow-hidden bg-surface-container"><img class="w-full h-full object-cover" src="${escapeAttribute(mediaUrlOf(post))}" alt="Photo publiée par Pesce Hounyo" loading="lazy"></div>
<p class="font-body-md text-body-md text-on-surface-variant">${escapeHtml(headline)}</p>
</article>`;
    }
    return renderTextCard(post);
  }).join('');
}

// — PHOTOS : galerie du canal.
let photosLoaded = false;

async function loadPhotos() {
  if (!inTelegram || photosLoaded) return;
  photosLoaded = true;
  const target = document.getElementById('photoFeed');
  if (!target) return;
  target.innerHTML = `<div class="col-span-2">${renderLoadingCard('Chargement des photos…', 'Récupération des images du canal officiel.')}</div>`;
  try {
    const data = await fetchJson('./api/content?type=photo&limit=50', { cache: 'no-store' });
    const posts = Array.isArray(data.posts) ? data.posts : [];
    lastFeed = posts;
    cachePosts(posts);
    if (!posts.length) {
      target.innerHTML = `<div class="col-span-2">${renderEmptyCard('Aucune photo pour le moment.', 'Les prochaines photos du canal officiel apparaîtront ici.')}</div>`;
      return;
    }
    target.innerHTML = posts.map((post) => `<article class="editorial-card bg-surface-container-lowest shadow-sm overflow-hidden cursor-pointer flex flex-col" data-post-id="${escapeAttribute(post.id)}">
<div class="aspect-square bg-surface-container overflow-hidden"><img class="w-full h-full object-cover" src="${escapeAttribute(mediaUrlOf(post))}" alt="Photo publiée par Pesce Hounyo" loading="lazy"></div>
<div class="p-space-sm flex flex-col gap-1">
<span class="font-kicker-label text-kicker-label text-primary uppercase">Photo</span>
<p class="font-body-sm text-body-sm text-on-surface line-clamp-2">${escapeHtml((post.text || '').trim() || 'Photo du canal Pesce Studio')}</p>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${escapeHtml(relativeTime(post.publishedAt))}</span>
</div>
</article>`).join('');
  } catch (error) {
    target.innerHTML = `<div class="col-span-2">${renderErrorCard(error)}</div>`;
  }
}

// — LECTEUR DE PUBLICATION (recouvre l'application ; retour via le bouton, le fond ou le BackButton Telegram).
let readerOpen = false;
let currentReaderPost = null;
let bookmarkActive = false;

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
      const posts = Array.isArray(data.posts) ? data.posts : [];
      lastFeed = posts;
      cachePosts(posts);
      post = posts.find((item) => item.id === postId) || null;
    } catch { post = null; }
  }
  const reader = document.getElementById('reader');
  const content = document.getElementById('readerContent');
  if (!reader || !content) return;
  currentReaderPost = post;
  bookmarkActive = false;
  content.innerHTML = post
    ? renderReader(post)
    : `<article class="empty-card bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center">
<span class="material-symbols-outlined text-[28px] text-on-surface-variant">warning</span>
<h3 class="font-headline-sm text-headline-sm text-on-surface">Publication introuvable</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant">Cette publication n’est plus disponible pour le moment.</p>
<button class="bg-on-secondary-fixed text-surface px-space-md py-space-sm font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors" type="button" data-reader-close>Retour</button>
</article>`;
  reader.hidden = false;
  readerOpen = true;
  bindBackButton();
  const scrollBox = document.getElementById('readerContent');
  if (scrollBox) scrollBox.scrollTop = 0;
  const progress = document.getElementById('readingProgress');
  if (progress) progress.style.width = '0%';
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function closeReader() {
  const reader = document.getElementById('reader');
  if (reader) reader.hidden = true;
  readerOpen = false;
  currentReaderPost = null;
  unbindBackButton();
}

function neighborPosts(postId) {
  const index = lastFeed.findIndex((post) => post.id === postId);
  if (index === -1) return { prev: null, next: null };
  return { prev: lastFeed[index - 1] || null, next: lastFeed[index + 1] || null };
}

function renderReader(post) {
  const { headline, standfirst } = headlineAndStandfirst(post);
  const articleUrl = articleUrlOf(post);
  const published = post.publishedAt ? new Date(post.publishedAt) : null;
  const updated = post.updatedAt ? new Date(post.updatedAt) : null;
  const dateLine = published && !isNaN(published)
    ? `${published.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${updated && !isNaN(updated) ? ` · Mis à jour à ${updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''} · ${readingLabel(post.text)}`
    : '';
  const media = readerMedia(post, standfirst);
  const { prev, next } = neighborPosts(post.id);
  const body = readerBody(post.text || '');
  return `<article class="flex flex-col px-margin-mobile py-space-md max-w-xl mx-auto w-full">
<div class="flex items-center gap-space-xs mb-space-sm">
<span class="inline-block w-2 h-2 rounded-full bg-primary-container"></span>
<span class="font-kicker-label text-kicker-label uppercase text-primary-container tracking-wider">${escapeHtml(kickerOf(post))} · Pesce Studio</span>
</div>
<h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight mb-space-md">${escapeHtml(headline)}</h1>
${standfirst ? `<p class="font-editorial-standfirst text-editorial-standfirst italic text-on-surface-variant mb-space-lg leading-relaxed">${escapeHtml(standfirst)}</p>` : ''}
<div class="bg-surface-container-low rounded-xl p-space-md mb-space-lg flex flex-col gap-space-md">
<div class="flex items-center gap-space-sm">
<img class="w-12 h-12 rounded-full object-cover shadow-sm flex-shrink-0" src="./assets/profilePesce.png" alt="Portrait de Pesce Hounyo">
<div class="flex flex-col min-w-0">
<div class="flex items-center gap-space-xs">
<span class="font-kicker-label text-kicker-label text-on-surface font-semibold truncate">${escapeHtml(PESCE.CREATOR_NAME)}</span>
<span class="material-symbols-outlined text-[14px] text-primary" style="font-variation-settings: 'FILL' 1;">verified</span>
</div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant truncate">Journaliste d'investigation</span>
${dateLine ? `<span class="font-meta-detail text-meta-detail text-secondary text-[11px] mt-0.5">${escapeHtml(dateLine)}</span>` : ''}
</div>
</div>
<div class="flex items-center justify-between pt-space-xs">
<div class="flex items-center gap-space-sm">
<button class="flex items-center gap-1.5 px-3 py-3 rounded-lg bg-surface-container text-on-surface text-[12px] font-kicker-label tracking-wide active:scale-95 transition-all" type="button" data-listen>
<span class="material-symbols-outlined text-[16px] text-primary" id="listenIcon" style="font-variation-settings: 'FILL' 1;">play_circle</span>
<span id="listenLabel">Écouter (${readingTime(post.text)} min)</span>
</button>
<button class="w-10 h-10 shrink-0 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors" type="button" data-bookmark aria-label="Ajouter aux favoris">
<span class="material-symbols-outlined text-[18px]" id="bookmarkIcon">bookmark</span>
</button>
</div>
<button class="flex items-center gap-1 px-3 py-3 rounded-lg bg-surface-container text-on-surface text-[12px] font-kicker-label tracking-wide hover:bg-surface-container-high transition-colors" type="button" data-share>
<span class="material-symbols-outlined text-[16px] text-primary-container">send</span><span>Partager</span>
</button>
</div>
<div class="hidden bg-surface-container-highest rounded-lg p-space-sm flex-col gap-2 transition-all" id="inlinePlayer">
<div class="flex items-center justify-between text-[11px] font-meta-detail text-on-surface-variant">
<span class="flex items-center gap-1 font-semibold text-primary"><span class="material-symbols-outlined text-[14px]">graphic_eq</span> Lecture audio en cours</span>
<span id="timecode">00:00 / —:—</span>
</div>
<div class="flex items-end gap-1 h-6 w-full px-1 py-0.5">${waveformBars(WAVEFORM_NOTE, false, true)}</div>
</div>
</div>
${media}
<div class="bg-surface-container rounded-lg p-space-sm mb-space-lg flex items-start gap-space-sm">
<span class="material-symbols-outlined text-[18px] text-primary flex-shrink-0 mt-0.5">shield_with_heart</span>
<p class="font-meta-detail text-meta-detail text-on-surface-variant text-[12px] leading-snug"><strong class="text-on-surface font-semibold">Garantie d'indépendance :</strong> Ce reportage d'investigation a été réalisé sans aucun soutien institutionnel ni subvention politique, exclusivement financé par les contributions des lecteurs de Pesce Studio.</p>
</div>
<div class="reader-body flex flex-col gap-space-md text-on-surface">${body}</div>
${articleUrl ? `<div class="bg-surface-container-low rounded-lg p-space-sm mt-space-lg flex items-center justify-between">
<span class="font-meta-detail text-meta-detail text-on-surface-variant">Version intégrale sur Telegraph</span>
<button class="py-2 font-kicker-label text-kicker-label text-primary uppercase font-bold tracking-wider hover:underline" type="button" data-post-link="${escapeAttribute(articleUrl[0])}">Lire sur Telegraph →</button>
</div>` : ''}
<div class="mt-space-xl flex items-center gap-space-sm">
<div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary font-serif font-bold text-sm">P</div>
<div class="flex flex-col">
<span class="font-kicker-label text-[11px] uppercase tracking-wider text-on-surface font-semibold">Pesce Studio Enquêtes</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">Reproduction libre avec mention de source</span>
</div>
</div>
<div class="mt-space-xl bg-surface-container-low rounded-xl p-space-lg flex flex-col items-center text-center shadow-sm">
<div class="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center text-on-primary-fixed mb-space-sm"><span class="material-symbols-outlined text-[26px]">star</span></div>
<h3 class="font-headline-sm text-headline-sm text-on-surface font-semibold mb-space-xs">Vous appréciez cette enquête ?</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant max-w-sm mb-space-md">Permettez à Pesce Hounyo de poursuivre ses reportages de terrain indépendants à travers l'Afrique de l'Ouest.</p>
<button class="w-full py-3 px-space-md rounded-lg bg-on-surface text-surface font-kicker-label uppercase text-[12px] tracking-wider font-bold active:scale-[0.98] transition-transform flex items-center justify-center gap-2 hover:bg-primary" type="button" data-reader-support><span>⭐ Soutenir cette enquête (Telegram Stars)</span></button>
<span class="font-meta-detail text-[11px] text-secondary mt-2">Paiement sécurisé instantané dans Telegram</span>
</div>
<div class="mt-space-lg bg-surface-container rounded-xl p-space-md flex flex-col gap-space-sm">
<div class="flex items-center justify-between">
<div class="flex items-center gap-space-xs">
<span class="material-symbols-outlined text-primary text-[20px]">forum</span>
<span class="font-kicker-label text-kicker-label uppercase text-on-surface font-bold">Débat &amp; Réactions</span>
</div>
</div>
<p class="font-body-sm text-body-sm text-on-surface-variant">Que pensez-vous de ce dossier ? Participez au salon d'analyse ouvert sur notre canal officiel.</p>
<button class="w-full py-3 px-space-md rounded-lg bg-surface-container-high text-on-surface font-kicker-label text-[12px] uppercase tracking-wide font-semibold hover:bg-surface-container-highest transition-colors flex items-center justify-center gap-1.5" type="button" data-channel><span>Rejoindre la discussion Telegram</span><span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>
</div>
${prev || next ? `<div class="mt-space-lg mb-space-xl flex items-center justify-between gap-space-sm pt-space-md">
${prev ? `<button class="flex-1 p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors flex flex-col min-w-0 text-left" type="button" data-reader-nav data-post="${escapeAttribute(prev.id)}">
<span class="font-meta-detail text-[11px] text-secondary flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">arrow_back</span> Précédent</span>
<span class="font-headline-sm text-[13px] text-on-surface truncate font-serif mt-1">${escapeHtml(headlineAndStandfirst(prev).headline)}</span>
</button>` : '<span class="flex-1"></span>'}
${next ? `<button class="flex-1 p-space-sm rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors flex flex-col items-end text-right min-w-0" type="button" data-reader-nav data-post="${escapeAttribute(next.id)}">
<span class="font-meta-detail text-[11px] text-secondary flex items-center gap-1">Suivant <span class="material-symbols-outlined text-[14px]">arrow_forward</span></span>
<span class="font-headline-sm text-[13px] text-on-surface truncate font-serif mt-1">${escapeHtml(headlineAndStandfirst(next).headline)}</span>
</button>` : '<span class="flex-1"></span>'}
</div>` : ''}
</article>`;
}

function readerMedia(post, caption) {
  const url = mediaUrlOf(post);
  if (!url && post.articleImageUrl) {
    return `<figure class="mb-space-lg"><div class="relative rounded-xl overflow-hidden shadow-sm bg-surface-container">
<img class="w-full h-64 object-cover" src="${escapeAttribute(post.articleImageUrl)}" alt="Couverture de l'article">
<div class="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-inverse-surface/70 text-inverse-on-surface text-[10px] font-kicker-label tracking-wide uppercase">Telegraph</div>
</div></figure>`;
  }
  if (post.contentType === 'photo' && url) {
    return `<figure class="mb-space-lg">
<div class="relative rounded-xl overflow-hidden shadow-sm bg-surface-container">
<img class="w-full h-64 object-cover" src="${escapeAttribute(url)}" alt="${escapeAttribute(kickerOf(post))} publiée par Pesce Hounyo">
<div class="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-inverse-surface/70 text-inverse-on-surface text-[10px] font-kicker-label tracking-wide uppercase">${escapeHtml(relativeTime(post.publishedAt))}</div>
</div>
${caption ? `<figcaption class="mt-2 text-center font-meta-detail text-meta-detail text-on-surface-variant italic">${escapeHtml(caption)}</figcaption>` : ''}
</figure>`;
  }
  if (post.contentType === 'video' && url) {
    return `<figure class="mb-space-lg"><div class="rounded-xl overflow-hidden shadow-sm bg-surface-container"><video class="w-full" controls preload="metadata" src="${escapeAttribute(url)}"${post.mediaThumbnailUrl ? ` poster="${escapeAttribute(post.mediaThumbnailUrl)}"` : ''}></video></div></figure>`;
  }
  if (post.contentType === 'video') {
    // Référence YouTube : miniature dérivée de l'identifiant, clic → YouTube (jamais de fichier local).
    const youtube = youtubeInfo(post.text);
    if (youtube) {
      return `<figure class="mb-space-lg"><div class="video-frame relative rounded-xl overflow-hidden shadow-sm bg-inverse-surface aspect-video group cursor-pointer" data-youtube-src="${escapeAttribute(youtube.url)}">
<img class="w-full h-full object-cover" src="${escapeAttribute(youtube.thumbnail)}" alt="Vidéo YouTube par Pesce Hounyo">
<div class="absolute inset-0 flex items-center justify-center"><div class="w-14 h-14 bg-primary text-on-primary flex items-center justify-center shadow-lg"><span class="material-symbols-outlined text-[32px]">play_arrow</span></div></div>
</div></figure>`;
    }
  }
  if (post.contentType === 'audio' && url) {
    return `<figure class="mb-space-lg"><div class="rounded-xl overflow-hidden shadow-sm bg-surface-container p-space-sm"><audio class="w-full" controls preload="none" src="${escapeAttribute(url)}"></audio></div></figure>`;
  }
  return '';
}

// Corps de lecture : paragraphes de la dépêche, lettrine éditoriale sur le premier.
function readerBody(text) {
  const paragraphs = String(text || '')
    .split('\n\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !/^https?:\/\//.test(paragraph));
  if (!paragraphs.length) return '<p class="font-body-lg text-body-lg text-on-surface leading-relaxed">Publication du canal Pesce Studio.</p>';
  return paragraphs.map((paragraph, index) => {
    const dropCap = index === 0 && paragraph.length > 60
      ? ' first-letter:float-left first-letter:text-5xl first-letter:pr-3 first-letter:font-editorial-standfirst first-letter:text-primary first-letter:font-bold first-letter:leading-none'
      : '';
    return `<p class="font-body-lg text-body-lg text-on-surface leading-relaxed${dropCap}">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// Micro-interactions du lecteur (fidèles au design) : écoute, favori, partage.
let listenActive = false;

function toggleListen() {
  const player = document.getElementById('inlinePlayer');
  const icon = document.getElementById('listenIcon');
  const label = document.getElementById('listenLabel');
  if (!player || !icon || !label) return;
  listenActive = !listenActive;
  if (listenActive) {
    player.classList.remove('hidden');
    player.classList.add('flex');
    icon.textContent = 'pause_circle';
    label.textContent = 'Pause';
    showToast('Lecture du dossier audio démarrée');
  } else {
    player.classList.add('hidden');
    player.classList.remove('flex');
    icon.textContent = 'play_circle';
    const minutes = currentReaderPost ? readingTime(currentReaderPost.text) : 11;
    label.textContent = `Écouter (${minutes} min)`;
    showToast('Lecture en pause');
  }
}

function toggleBookmark(button) {
  bookmarkActive = !bookmarkActive;
  const icon = button?.querySelector('.material-symbols-outlined') || document.getElementById('bookmarkIcon');
  if (!icon) return;
  if (bookmarkActive) {
    icon.textContent = icon.id === 'bookmarkIcon' ? 'bookmark_added' : 'bookmark';
    icon.style.fontVariationSettings = "'FILL' 1";
    icon.classList.add('text-primary');
    showToast('Enquête enregistrée dans vos lectures');
  } else {
    icon.textContent = icon.id === 'bookmarkIcon' ? 'bookmark' : 'bookmark_border';
    icon.style.fontVariationSettings = "'FILL' 0";
    icon.classList.remove('text-primary');
    showToast('Retiré de vos favoris');
  }
}

function shareArticle() {
  const post = currentReaderPost;
  const title = post ? headlineAndStandfirst(post).headline : 'Pesce Studio';
  const url = window.location.href;
  if (navigator.share) {
    navigator.share({ title, text: 'Enquête exclusive par Pesce Hounyo sur Pesce Studio', url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Lien copié dans le presse-papiers')).catch(() => {});
  }
}

// — Rôle créatrice (GET /api/me) et chargement du studio à la demande.
// Le masquage client est de l'UX : le serveur (/api/studio : initData 401 + allowlist 403) reste la vraie frontière.
function getCachedRole() {
  try { return sessionStorage.getItem('pesce.isCreator'); } catch { return null; }
}

function setCachedRole(isCreator) {
  try { sessionStorage.setItem('pesce.isCreator', isCreator ? '1' : '0'); } catch { /* stockage indisponible (WebView privée) */ }
}

async function resolveRole() {
  const cached = getCachedRole();
  try {
    const data = await fetchJson('./api/me', { headers: { 'x-telegram-init-data': tg.initData }, cache: 'no-store' });
    if (typeof data.isCreator !== 'boolean') throw new Error('Réponse de rôle invalide.');
    setCachedRole(data.isCreator);
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

// Le studio s'ouvre pour la créatrice — uniquement via le deep link ?startapp=studio (ou #studio
// en développement). Aucun bouton public ne mène ici ; les non-créateurs ne voient rien s'ouvrir,
// et /api/studio (401/403) reste la vraie frontière. Tentative unique à la fois.
let studioOpening = false;

function attemptStudio() {
  if (studioOpening) return;
  studioOpening = true;
  const done = () => { studioOpening = false; };
  const cached = getCachedRole();
  if (cached === '1') { loadStudioModule().then((studio) => studio.open()).finally(done); return; }
  resolveRole()
    .then((isCreator) => {
      if (!isCreator) return; // silencieux : l'espace studio n'est pas une affordance publique
      return loadStudioModule().then((studio) => studio.open()).catch(() => {});
    })
    .catch(() => {})
    .finally(done);
}

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

// — Horloge éditoriale de Cotonou (fuseau Africa/Porto-Novo).
function renderCotonouClock() {
  const clock = document.getElementById('cotonouClock');
  if (!clock) return;
  try {
    const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Porto-Novo', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
    const hour = parts.find((part) => part.type === 'hour')?.value || '—';
    const minute = parts.find((part) => part.type === 'minute')?.value || '—';
    clock.textContent = `Cotonou ${hour}h${minute} GMT`;
  } catch { /* fuseau indisponible : libellé générique conservé */ }
}

// — Routage par ancre (sections publiques, filtre d'écrits, publication du lecteur).
// #studio (et #studio-<onglet>) est le seul chemin d'ancre vers l'espace privé : la tentative
// est validée côté serveur ; jamais d'affordance publique.
function routeFromHash() {
  const hash = decodeURIComponent(location.hash || '').replace(/^#/, '');
  if (!hash) return null;
  if (hash === 'studio' || /^studio-(bureau|rediger|brouillons|pistes|audience)$/.test(hash)) return { studio: true };
  if (SECTIONS.includes(hash)) return { section: hash };
  const filterMatch = hash.match(/^ecrits-(tout|enquetes|societe|opinion|videos|audios|entretiens)$/);
  if (filterMatch) return { section: 'ecrits', filter: filterMatch[1] };
  // L'identifiant complet de publication commence par « post- » : on le conserve tel quel.
  if (hash.startsWith('post-') && hash.length > 5) return { post: hash };
  return null;
}

// — Démarrage
if (inTelegram) {
  initSupportTopic();
  renderCotonouClock();
  document.querySelectorAll('.support-send').forEach((button) => button.addEventListener('click', supportWithStars));
  document.getElementById('supportForm')?.addEventListener('submit', sendSupport);
  document.getElementById('readerShare')?.addEventListener('click', shareArticle);
  document.getElementById('profileButton')?.addEventListener('click', () => {
    const user = tg?.initDataUnsafe?.user;
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'visiteur';
    popup('Votre profil', `Bienvenue ${name} dans Pesce Studio.`);
  });

  const soutenirPacte = document.getElementById('soutenirPacte');
  if (soutenirPacte) soutenirPacte.innerHTML = renderPacte();
  const starOptionsHome = document.getElementById('starOptionsHome');
  if (starOptionsHome) starOptionsHome.innerHTML = renderStarOptions();
  selectStars(selectedStars);

  const startParam = getStartParam();
  const route = routeFromHash();
  let firstSection = 'a-la-une';
  if (startParam === 'support') firstSection = 'support';
  if (startParam === 'studio') firstSection = 'studio';
  if (route?.section) firstSection = route.section;
  if (route?.filter) currentFilter = route.filter;
  openSection(firstSection);
  if (route?.post) openReader(route.post);
  trackOpen();
  if (startParam === 'studio' || route?.studio) {
    // Entrée privée : le rôle est revalidé puis le serveur décide (/api/studio). Silencieux sinon.
    attemptStudio();
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
