const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);
const TELEGRAM_CHANNEL_URL = 'https://t.me/PesceHounyoOfficiel';
const YOUTUBE_URL = 'https://www.youtube.com/@gnonnouxopescehounyo2576';
const starOptions = [50, 100, 250, 500, 1000];
let selectedStars = 100;

const gate = document.getElementById('telegramGate');
const app = document.getElementById('telegramApp');
const home = document.getElementById('home');
const sections = [...document.querySelectorAll('.content-section')];
const navButtons = [...document.querySelectorAll('.nav-button')];

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

function popup(title, message) {
  if (tg?.showPopup) {
    tg.showPopup({ title, message, buttons: [{ type: 'ok', text: 'Compris' }] });
  } else {
    window.alert(message);
  }
}

function openExternal(url) {
  if (inTelegram && url.startsWith('https://t.me/') && tg?.openTelegramLink) {
    tg.openTelegramLink(url);
  } else if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function openSection(id) {
  if (!inTelegram) return;
  home.hidden = id !== 'home';
  sections.forEach((section) => { section.hidden = section.id !== id; });
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.section === id || (id === 'home' && button.dataset.home !== undefined)));
  if (id === 'publications' || id === 'audios' || id === 'photos') loadContent(id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-section]').forEach((button) => {
  button.addEventListener('click', () => openSection(button.dataset.section));
});

document.querySelectorAll('[data-home]').forEach((button) => {
  button.addEventListener('click', () => openSection('home'));
});

document.getElementById('profileButton')?.addEventListener('click', () => {
  const user = tg?.initDataUnsafe?.user;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'visiteur';
  popup('Votre profil', `Bienvenue ${name} dans Pesce Studio.`);
});

document.querySelectorAll('[data-stars]').forEach((button) => {
  button.addEventListener('click', () => {
    const amount = Number(button.dataset.stars);
    if (!starOptions.includes(amount)) return;
    selectedStars = amount;
    document.querySelectorAll('[data-stars]').forEach((item) => {
      const active = Number(item.dataset.stars) === selectedStars;
      item.classList.toggle('selected', active);
      item.setAttribute('aria-pressed', String(active));
    });
    const supportButton = document.getElementById('supportButton');
    if (supportButton) supportButton.textContent = `Envoyer ${selectedStars} ⭐`;
  });
});

async function supportWithStars() {
  if (!inTelegram) return;
  const button = document.getElementById('supportButton');
  if (button) { button.disabled = true; button.textContent = 'Préparation…'; }

  try {
    const response = await fetch('./api/create-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stars: selectedStars, initData: tg.initData })
    });
    const data = await response.json();
    if (!response.ok || !data.invoiceLink) throw new Error(data.message || 'Impossible de créer le paiement.');

    if (tg.openInvoice) {
      tg.openInvoice(data.invoiceLink, (status) => {
        if (status === 'paid') popup('Merci ⭐', `Votre soutien de ${data.stars} Étoiles a bien été reçu. Merci beaucoup !`);
        else if (status === 'cancelled') popup('Paiement annulé', 'Aucun montant n’a été débité.');
        else if (status === 'failed') popup('Paiement impossible', 'Telegram n’a pas pu finaliser le paiement. Vous pouvez réessayer.');
      });
    } else {
      window.location.href = data.invoiceLink;
    }
  } catch (error) {
    popup('Soutien indisponible', error.message || 'Le paiement en Étoiles sera bientôt disponible.');
  } finally {
    if (button) { button.disabled = false; button.textContent = `Envoyer ${selectedStars} ⭐`; }
  }
}

document.getElementById('supportButton')?.addEventListener('click', supportWithStars);
document.getElementById('navSupport')?.addEventListener('click', () => openSection('home'));

document.querySelectorAll('[data-channel]').forEach((button) => {
  button.addEventListener('click', () => openExternal(TELEGRAM_CHANNEL_URL));
});

document.querySelector('[data-youtube]')?.addEventListener('click', () => openExternal(YOUTUBE_URL));

async function loadContent(sectionId) {
  const config = {
    publications: { type: null, target: 'publicationFeed', emptyIcon: '📰', title: 'Aucune publication pour le moment.', text: 'Les prochaines publications du canal officiel apparaîtront ici.' },
    audios: { type: 'audio', target: 'audioFeed', emptyIcon: '🎙️', title: 'Aucun audio pour le moment.', text: 'Les prochains contenus audio du canal officiel apparaîtront ici.' },
    photos: { type: 'photo', target: 'photoFeed', emptyIcon: '📸', title: 'Aucune photo pour le moment.', text: 'Les prochaines photos du canal officiel apparaîtront ici.' }
  }[sectionId];
  if (!config) return;

  const target = document.getElementById(config.target);
  if (!target || target.dataset.loading === 'true') return;
  target.dataset.loading = 'true';
  target.innerHTML = '<article class="empty-card"><span>⏳</span><h3>Chargement…</h3><p>Récupération des contenus de Pesce.</p></article>';

  try {
    const query = config.type ? `?type=${encodeURIComponent(config.type)}&limit=30` : '?limit=30';
    const response = await fetch(`./api/content${query}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Flux indisponible.');

    if (!Array.isArray(data.posts) || data.posts.length === 0) {
      target.innerHTML = `<article class="empty-card"><span>${config.emptyIcon}</span><h3>${config.title}</h3><p>${config.text}</p><button class="secondary-button" data-channel type="button">Ouvrir le canal Telegram</button></article>`;
      target.querySelector('[data-channel]')?.addEventListener('click', () => openExternal(TELEGRAM_CHANNEL_URL));
      return;
    }

    target.innerHTML = data.posts.map(renderPost).join('');
    target.querySelectorAll('[data-post-link]').forEach((button) => {
      button.addEventListener('click', () => openExternal(button.dataset.postLink));
    });
  } catch (error) {
    target.innerHTML = `<article class="empty-card"><span>⚠️</span><h3>Flux momentanément indisponible</h3><p>${escapeHtml(error.message || 'Impossible de charger les contenus.')}</p><button class="secondary-button" data-channel type="button">Ouvrir le canal Telegram</button></article>`;
    target.querySelector('[data-channel]')?.addEventListener('click', () => openExternal(TELEGRAM_CHANNEL_URL));
  } finally {
    target.dataset.loading = 'false';
  }
}

function renderPost(post) {
  const date = post.publishedAt ? new Date(post.publishedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const text = escapeHtml(post.text || '');
  const mediaUrl = post.mediaFileId ? `./api/media?file_id=${encodeURIComponent(post.mediaFileId)}` : '';
  let media = '';

  if (post.contentType === 'photo' && mediaUrl) {
    media = `<img class="post-media post-photo" src="${mediaUrl}" alt="Photo publiée par Pesce Hounyo" loading="lazy">`;
  } else if (post.contentType === 'audio' && mediaUrl) {
    media = `<audio class="post-audio" controls preload="none" src="${mediaUrl}"></audio>`;
  } else if (post.contentType === 'video' && mediaUrl) {
    media = `<video class="post-media" controls preload="metadata" src="${mediaUrl}"></video>`;
  }

  const action = post.telegramUrl
    ? `<button class="secondary-button post-link" type="button" data-post-link="${escapeAttribute(post.telegramUrl)}">Voir sur Telegram</button>`
    : '';

  return `<article class="post-card"><div class="post-meta"><span>${post.contentType === 'photo' ? '📸' : post.contentType === 'audio' ? '🎙️' : post.contentType === 'video' ? '🎥' : '📰'}</span><time>${date}</time></div>${media}${text ? `<p class="post-text">${text.replace(/\n/g, '<br>')}</p>` : ''}${action}</article>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

if (inTelegram) {
  document.querySelector('[data-stars="100"]')?.classList.add('selected');
  document.querySelector('[data-stars="100"]')?.setAttribute('aria-pressed', 'true');
  openSection('home');
}
