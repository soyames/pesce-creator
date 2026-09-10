const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);

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

async function supportWithStars() {
  if (!inTelegram) return;

  const button = document.getElementById('supportButton');
  const oldText = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Préparation…'; }

  try {
    const response = await fetch('./api/create-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stars: 100, initData: tg.initData })
    });
    const data = await response.json();
    if (!response.ok || !data.invoiceLink) throw new Error(data.message || 'Impossible de créer le paiement.');

    if (tg.openInvoice) {
      tg.openInvoice(data.invoiceLink, (status) => {
        if (status === 'paid') popup('Merci ⭐', 'Votre soutien a bien été reçu. Merci beaucoup !');
        else if (status === 'cancelled') popup('Paiement annulé', 'Aucun montant n’a été débité.');
        else if (status === 'failed') popup('Paiement impossible', 'Telegram n’a pas pu finaliser le paiement. Vous pouvez réessayer.');
      });
    } else {
      window.location.href = data.invoiceLink;
    }
  } catch (error) {
    popup('Soutien indisponible', error.message || 'Le paiement en Étoiles sera bientôt disponible.');
  } finally {
    if (button) { button.disabled = false; button.textContent = oldText || 'Envoyer des Étoiles'; }
  }
}

document.getElementById('supportButton')?.addEventListener('click', supportWithStars);
document.getElementById('navSupport')?.addEventListener('click', supportWithStars);

document.querySelectorAll('[data-channel]').forEach((button) => {
  button.addEventListener('click', () => {
    popup('Canal Telegram', 'Le lien officiel du canal de Pesce sera connecté ici dès que son identifiant public sera configuré.');
  });
});

document.querySelector('[data-youtube]')?.addEventListener('click', () => {
  popup('YouTube', 'Le lien officiel YouTube de Pesce sera connecté ici dès que l’adresse de sa chaîne sera configurée.');
});

if (inTelegram) openSection('home');
