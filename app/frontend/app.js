const tg = window.Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);

const gate = document.getElementById('telegramGate');
const app = document.getElementById('telegramApp');

if (inTelegram) {
  gate.hidden = true;
  app.hidden = false;
  tg.ready();
  tg.expand();
} else {
  gate.hidden = false;
  app.hidden = true;
}

document.getElementById('supportButton')?.addEventListener('click', () => {
  if (!inTelegram) return;

  if (tg?.showPopup) {
    tg.showPopup({
      title: 'Soutenir Pesce',
      message: 'Le soutien par Étoiles Telegram sera activé ici dans la prochaine étape.',
      buttons: [{ type: 'ok', text: 'Compris' }]
    });
  }
});

document.querySelectorAll('.tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    if (!inTelegram) return;

    if (tg?.showPopup) {
      tg.showPopup({
        title: tile.querySelector('strong')?.textContent || 'Pesce Studio',
        message: 'Cette rubrique sera disponible dans la prochaine version.',
        buttons: [{ type: 'ok', text: 'Compris' }]
      });
    }
  });
});
