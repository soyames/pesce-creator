const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);
const TELEGRAM_CHANNEL_URL = 'https://t.me/PesceHounyoOfficiel';
const YOUTUBE_URL = 'https://www.youtube.com/@gnonnouxopescehounyo2576';

const gate = document.getElementById('telegramGate');
const app = document.getElementById('telegramApp');
const home = document.getElementById('home');
const sections = [...document.querySelectorAll('.content-section')];
const navButtons = [...document.querySelectorAll('.nav-button')];
const starOptions = [50, 100, 250, 500, 1000];
let selectedStars = 100;

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

document.querySelectorAll('[data-channel-name]').forEach((element) => {
  element.textContent = '@PesceHounyoOfficiel';
});

document.querySelector('[data-youtube]')?.addEventListener('click', () => openExternal(YOUTUBE_URL));

if (inTelegram) {
  document.querySelector('[data-stars="100"]')?.classList.add('selected');
  document.querySelector('[data-stars="100"]')?.setAttribute('aria-pressed', 'true');
  openSection('home');
}
