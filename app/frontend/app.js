const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

document.getElementById('supportButton')?.addEventListener('click', () => {
  if (tg?.showPopup) {
    tg.showPopup({
      title: 'Soutenir Pesce',
      message: 'Le soutien par Étoiles Telegram sera activé ici dans la prochaine étape.',
      buttons: [{ type: 'ok', text: 'Compris' }]
    });
  } else {
    alert('Le soutien par Étoiles Telegram sera activé ici dans la prochaine étape.');
  }
});

document.querySelectorAll('.tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    if (tg?.showPopup) {
      tg.showPopup({
        title: tile.querySelector('strong')?.textContent || 'Pesce Studio',
        message: 'Cette rubrique sera disponible dans la prochaine version.',
        buttons: [{ type: 'ok', text: 'Compris' }]
      });
    }
  });
});
