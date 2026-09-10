// Studio créatrice — module chargé à la demande par app.js (loadStudioModule), uniquement après
// confirmation du rôle via /api/me. Le serveur (/api/studio) reste la vraie frontière : initData valide
// ET identifiant créatrice configuré. Aucun code d'audience dans ce fichier.
(function () {
  if (window.PesceStudio) return; // déjà chargé

  const PesceApp = window.PesceApp;
  const PESCE = window.PESCE;
  if (!PesceApp || !PESCE) { console.error('Studio : dépendances manquantes (PesceApp / PESCE).'); return; }

  const { popup, escapeHtml, escapeAttribute, formatDate, fetchJson, openSection } = PesceApp;
  const initData = () => PesceApp.initData;

  function topicLabel(value) {
    const topic = PESCE.SUPPORT_TOPICS.find((item) => item.value === value);
    return topic ? topic.label : value || '';
  }

  async function studioAction(body) {
    return fetch('./api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData() }, body: JSON.stringify(body) });
  }

  async function open() {
    // Sonde de défense en profondeur : le rôle est déjà connu côté client, mais le serveur décide.
    try {
      const response = await fetch('./api/studio', { headers: { 'x-telegram-init-data': initData() } });
      if (response.status === 403) { popup('Studio privé', 'Accès réservé au compte créateur de Pesce.'); return; }
      if (!response.ok) { popup('Studio indisponible', 'Réessayez dans un instant.'); return; }
      openSection('studio');
      await load();
    } catch (error) {
      popup('Studio indisponible', 'Réessayez dans un instant.');
    }
  }

  async function load() {
    const el = document.getElementById('studioFeed');
    if (!el) return;
    el.innerHTML = '<article class="empty-card"><span>⏳</span><h3>Chargement…</h3></article>';
    try {
      const data = await fetchJson('./api/studio', { headers: { 'x-telegram-init-data': initData() }, cache: 'no-store' });
      currentLives = data.liveSchedules || [];
      el.innerHTML = [renderComposer(), renderBackfill(), renderKpis(data), renderLive(data), renderTelegraph(data), renderDrafts(data), renderTickets(data), renderPayments(data)].join('');
      bindStudioEvents();
    } catch (error) {
      el.innerHTML = `<article class="empty-card"><span>⚠️</span><h3>Studio indisponible</h3><p>${escapeHtml(error.message)}</p></article>`;
    }
  }

  function renderComposer() {
    return `<article class="studio-card studio-composer">
<p class="card-kicker">CRÉER</p>
<h3>Nouvelle publication</h3>
<p class="studio-muted">Rédigez ici. La publication sera envoyée directement sur <strong>${escapeHtml(PESCE.CHANNEL_HANDLE)}</strong> et synchronisée dans Pesce Studio.</p>
<form id="publishForm" class="publish-form">
<input id="articleTitle" type="text" maxlength="256" placeholder="Titre de l’article (optionnel — publie un article Telegraph)">
<textarea id="publishText" rows="8" maxlength="4096" placeholder="Écrivez votre publication…" required></textarea>
<p class="article-hint">Avec un titre : votre texte devient un article Telegraph (telegra.ph), lu instantanément dans Telegram, publié avec le bouton ⭐ Soutenir. Sans titre : publication texte simple.</p>
<div class="composer-actions"><button id="draftButton" class="secondary-button" type="button">Enregistrer le brouillon</button><button class="primary-button" type="submit">Publier sur Telegram</button></div>
<p id="publishStatus" class="form-status" aria-live="polite"></p>
</form>
</article>`;
  }

  function renderBackfill() {
    return `<article class="studio-card">
<p class="card-kicker">SOUTIEN</p>
<h3>Bouton de soutien du canal</h3>
<p class="studio-muted">Les nouvelles publications reçoivent automatiquement le bouton « ⭐ Soutenir le travail de Pesce ». Utilisez ceci une fois pour les publications déjà présentes.</p>
<button id="backfillSupportButton" class="secondary-button" type="button">Ajouter aux publications récentes</button>
<p id="backfillStatus" class="form-status" aria-live="polite"></p>
</article>`;
  }

  function renderKpis(data) {
    const t = data.totals || {};
    return `<div class="studio-kpis">
<article class="kpi-card"><small>Contenus</small><strong>${t.total || 0}</strong><span>${t.text || 0} textes</span></article>
<article class="kpi-card"><small>Vidéos</small><strong>${t.video || 0}</strong></article>
<article class="kpi-card"><small>Photos</small><strong>${t.photo || 0}</strong></article>
<article class="kpi-card"><small>Audios</small><strong>${t.audio || 0}</strong></article>
<article class="kpi-card"><small>Étoiles</small><strong>${Number(data.stars || 0).toLocaleString('fr-FR')} ⭐</strong><span>${data.supporters || 0} soutien(s)</span></article>
</div>`;
  }

  // — Directs : programmation publique (le direct reste diffusé sur sa plateforme externe)
  let editingLiveId = null;
  let currentLives = [];

  function liveStatusLabel(status) {
    return { scheduled: 'programmé', live: 'en direct', cancelled: 'annulé', completed: 'terminé' }[status] || status;
  }

  function toDatetimeLocal(value) {
    const date = value ? new Date(value) : null;
    if (!date || isNaN(date)) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderLive(data) {
    return `<article class="studio-card">
<p class="card-kicker">DIRECTS</p>
<h3>Programmation des directs</h3>
<p class="studio-muted">Planifiez un direct : il apparaît sur l’accueil public (« Prochain direct »). Le direct reste diffusé sur sa plateforme (lien fourni).</p>
<form id="liveForm" class="publish-form">
<input id="liveTitle" type="text" maxlength="256" placeholder="Titre du direct" required>
<textarea id="liveDescription" rows="3" maxlength="4000" placeholder="Description (optionnelle)"></textarea>
<input id="liveDate" type="datetime-local" required>
<p class="article-hint">Heure de votre appareil — l’audience verra l’heure convertie dans son propre fuseau horaire.</p>
<input id="liveLink" type="text" maxlength="512" placeholder="Lien du direct (YouTube, …) — optionnel">
<select id="liveStatus"><option value="scheduled">Programmé</option><option value="live">En direct</option><option value="completed">Terminé</option></select>
<div class="composer-actions"><button id="liveSubmit" class="primary-button" type="submit">Planifier le direct</button></div>
<p id="liveStatusText" class="form-status" aria-live="polite"></p>
</form>
${currentLives.map((live) => `<div class="draft-row" data-live="${escapeAttribute(live.id)}"><div><strong>${escapeHtml(live.title)}</strong><small>${formatDate(live.scheduledAt)} · ${escapeHtml(liveStatusLabel(live.status))}${live.link ? ' · lien fourni' : ''}</small></div><div class="ticket-actions"><button class="secondary-button live-edit" type="button">Modifier</button><button class="secondary-button live-cancel" type="button">Annuler</button></div></div>`).join('') || '<p class="studio-muted">Aucun direct programmé.</p>'}
</article>`;
  }

  function resetLiveForm() {
    editingLiveId = null;
    const form = document.getElementById('liveForm');
    if (form) form.reset();
    const button = document.getElementById('liveSubmit');
    if (button) button.textContent = 'Planifier le direct';
    const status = document.getElementById('liveStatusText');
    if (status) status.textContent = '';
  }

  async function submitLive(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById('liveSubmit');
    const status = document.getElementById('liveStatusText');
    const title = form.querySelector('#liveTitle')?.value.trim() || '';
    const scheduledAtRaw = form.querySelector('#liveDate')?.value || '';
    if (!title || !scheduledAtRaw) return;
    // datetime-local est un horaire « mural » sans fuseau : on le convertit côté client avec le
    // fuseau réel de l'appareil, pour que le serveur (UTC) stocke le bon instant, sans décalage silencieux.
    const scheduledAtIso = new Date(scheduledAtRaw).toISOString();
    const payload = {
      action: editingLiveId ? 'live_update' : 'live_create',
      title,
      description: form.querySelector('#liveDescription')?.value.trim() || '',
      scheduledAt: scheduledAtIso,
      link: form.querySelector('#liveLink')?.value.trim() || '',
      status: form.querySelector('#liveStatus')?.value || 'scheduled',
      ...(editingLiveId ? { liveId: editingLiveId } : {}),
    };
    button.disabled = true; button.textContent = 'Enregistrement…';
    try {
      const response = await studioAction(payload);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Impossible d’enregistrer le direct.');
      resetLiveForm();
      status.textContent = editingLiveId ? 'Direct mis à jour.' : `Direct planifié (${data.liveId}).`;
      await load();
    } catch (error) { status.textContent = error.message || 'Impossible d’enregistrer le direct.'; }
    finally { button.disabled = false; button.textContent = 'Planifier le direct'; }
  }

  function editLive(button) {
    const row = button.closest('[data-live]');
    const live = currentLives.find((item) => item.id === row?.dataset.live);
    const form = document.getElementById('liveForm');
    if (!live || !form) return;
    editingLiveId = live.id;
    form.querySelector('#liveTitle').value = live.title || '';
    form.querySelector('#liveDescription').value = live.description || '';
    form.querySelector('#liveDate').value = toDatetimeLocal(live.scheduledAt);
    form.querySelector('#liveLink').value = live.link || '';
    form.querySelector('#liveStatus').value = live.status || 'scheduled';
    const submit = document.getElementById('liveSubmit');
    if (submit) submit.textContent = 'Enregistrer les modifications';
    const status = document.getElementById('liveStatusText');
    if (status) status.textContent = `Modification de « ${live.title} » — soumettez pour enregistrer.`;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function cancelLive(button) {
    const row = button.closest('[data-live]');
    const liveId = row?.dataset.live;
    if (!liveId) return;
    button.disabled = true;
    try {
      const response = await studioAction({ action: 'live_cancel', liveId });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Annulation impossible.');
      if (editingLiveId === liveId) resetLiveForm();
      await load();
    } catch (error) { popup('Annulation impossible', error.message || 'Réessayez dans un instant.'); }
    finally { button.disabled = false; }
  }

  function renderTelegraph(data) {
    if (data.telegraphConfigured) {
      return `<article class="studio-card">
<p class="card-kicker">ARTICLES</p>
<h3>Articles Telegraph</h3>
<p class="studio-muted">Ajoutez un titre dans le composeur pour publier un article Telegraph (telegra.ph), lu en Instant View. Vous pouvez aussi écrire directement sur telegra.ph et coller le lien dans une publication.</p>
</article>`;
    }
    return `<article class="studio-card">
<p class="card-kicker">ARTICLES</p>
<h3>Articles Telegraph</h3>
<p class="studio-muted">Telegraph n’est pas encore configuré. Créez le compte, puis sauvegardez le jeton reçu dans la variable d’environnement <strong>TELEGRAPH_ACCESS_TOKEN</strong> (Vercel) et redéployez.</p>
<button id="telegraphSetupButton" class="secondary-button" type="button">Configurer Telegraph</button>
<p id="telegraphStatus" class="form-status" aria-live="polite"></p>
</article>`;
  }

  function renderDrafts(data) {
    return `<article class="studio-card">
<p class="card-kicker">BROUILLONS</p>
<h3>Vos brouillons</h3>
${(data.drafts || []).map((draft) => `<div class="draft-row"><div><strong>${escapeHtml((draft.text || '').slice(0, 90))}</strong><small>${formatDate(draft.updatedAt || draft.createdAt)}</small></div><button class="secondary-button draft-load" type="button" data-draft="${escapeAttribute(draft.text || '')}">Reprendre</button></div>`).join('') || '<p class="studio-muted">Aucun brouillon.</p>'}
</article>`;
  }

  function renderTickets(data) {
    return `<article class="studio-card">
<p class="card-kicker">ASSISTANCE</p>
<h3>Demandes ouvertes <span class="count-badge">${data.openTickets || 0}</span></h3>
${(data.recentTickets || []).map((ticket) => `<div class="ticket-card" data-ticket="${escapeAttribute(ticket.id)}">
<strong>${escapeHtml(ticket.id)}</strong>
<small>${escapeHtml(ticket.username ? '@' + ticket.username : ticket.firstName || 'Utilisateur')} · ${formatDate(ticket.createdAt)}${ticket.topic ? ` · ${escapeHtml(topicLabel(ticket.topic))}` : ''}</small>
<p>${escapeHtml(ticket.message || '')}</p>
<textarea class="ticket-reply-input" rows="2" maxlength="4000" placeholder="Répondre dans Telegram…"></textarea>
<div class="ticket-actions"><button class="secondary-button ticket-reply" type="button">Répondre</button><button class="secondary-button ticket-resolve" type="button">Résoudre</button></div>
</div>`).join('') || '<p class="studio-muted">Aucune demande ouverte.</p>'}
</article>`;
  }

  function renderPayments(data) {
    return `<article class="studio-card">
<p class="card-kicker">SOUTIENS</p>
<h3>Derniers paiements</h3>
${(data.recentPayments || []).map((payment) => `<div class="studio-row"><span>⭐ ${payment.amount || 0}</span><small>${escapeHtml(payment.username ? '@' + payment.username : 'Utilisateur')} · ${formatDate(payment.paidAt)}</small></div>`).join('') || '<p class="studio-muted">Aucun paiement.</p>'}
</article>`;
  }

  async function publishFromStudio(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = form.querySelector('#articleTitle')?.value.trim() || '';
    const text = form.querySelector('#publishText')?.value.trim() || '';
    const status = document.getElementById('publishStatus');
    const button = form.querySelector('button[type="submit"]');
    if (!text) return;
    button.disabled = true; button.textContent = 'Publication…';
    try {
      const response = await studioAction({ action: title ? 'article_publish' : 'publish', text, ...(title ? { title } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Publication impossible.');
      form.reset();
      status.textContent = title
        ? 'Article publié sur Telegraph et envoyé sur le canal avec le bouton ⭐ Soutenir.'
        : 'Publication envoyée sur le canal Telegram. Le bouton ⭐ Soutenir est ajouté automatiquement.';
      setTimeout(load, 700);
    } catch (error) { status.textContent = error.message || 'Publication impossible.'; }
    finally { button.disabled = false; button.textContent = 'Publier sur Telegram'; }
  }

  async function saveDraft() {
    const form = document.getElementById('publishForm');
    const text = form?.querySelector('#publishText')?.value.trim() || '';
    const status = document.getElementById('publishStatus');
    const button = document.getElementById('draftButton');
    if (!text) return;
    button.disabled = true; button.textContent = 'Enregistrement…';
    try {
      const response = await studioAction({ action: 'draft', text });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Impossible d’enregistrer le brouillon.');
      status.textContent = `Brouillon ${data.draftId} enregistré.`;
      await load();
    } catch (error) { status.textContent = error.message || 'Impossible d’enregistrer le brouillon.'; }
    finally { button.disabled = false; button.textContent = 'Enregistrer le brouillon'; }
  }

  async function backfillSupport() {
    const button = document.getElementById('backfillSupportButton');
    const status = document.getElementById('backfillStatus');
    if (!button) return;
    button.disabled = true; button.textContent = 'Ajout en cours…';
    try {
      const response = await studioAction({ action: 'backfill_support' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Impossible d’ajouter les boutons.');
      status.textContent = `${data.updated} bouton(s) ajouté(s) sur ${data.checked} publication(s) vérifiée(s).`;
    } catch (error) { status.textContent = error.message || 'Impossible d’ajouter les boutons.'; }
    finally { button.disabled = false; button.textContent = 'Ajouter aux publications récentes'; }
  }

  async function telegraphSetup() {
    const button = document.getElementById('telegraphSetupButton');
    const status = document.getElementById('telegraphStatus');
    if (!button) return;
    button.disabled = true; button.textContent = 'Création du compte…';
    try {
      const response = await studioAction({ action: 'telegraph_setup' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Impossible de configurer Telegraph.');
      status.textContent = `Compte créé. Jeton à sauvegarder dans TELEGRAPH_ACCESS_TOKEN : ${data.accessToken}`;
      await load();
    } catch (error) { status.textContent = error.message || 'Impossible de configurer Telegraph.'; }
    finally { if (button) { button.disabled = false; button.textContent = 'Configurer Telegraph'; } }
  }

  async function replyTicket(button) {
    const card = button.closest('.ticket-card');
    const ticketId = card?.dataset.ticket;
    const text = card?.querySelector('.ticket-reply-input')?.value.trim() || '';
    if (!ticketId || !text) return;
    button.disabled = true; button.textContent = 'Envoi…';
    try {
      const response = await studioAction({ action: 'reply', ticketId, text });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Réponse impossible.');
      await load();
    } catch (error) { popup('Réponse impossible', error.message || 'Réessayez dans un instant.'); }
    finally { button.disabled = false; button.textContent = 'Répondre'; }
  }

  async function resolveTicket(button) {
    const card = button.closest('.ticket-card');
    const ticketId = card?.dataset.ticket;
    if (!ticketId) return;
    button.disabled = true; button.textContent = 'Résolution…';
    try {
      const response = await studioAction({ action: 'resolve', ticketId });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Résolution impossible.');
      await load();
    } catch (error) { popup('Résolution impossible', error.message || 'Réessayez dans un instant.'); }
    finally { button.disabled = false; button.textContent = 'Résoudre'; }
  }

  function bindStudioEvents() {
    document.getElementById('publishForm')?.addEventListener('submit', publishFromStudio);
    document.getElementById('draftButton')?.addEventListener('click', saveDraft);
    document.getElementById('backfillSupportButton')?.addEventListener('click', backfillSupport);
    document.getElementById('telegraphSetupButton')?.addEventListener('click', telegraphSetup);
    document.getElementById('liveForm')?.addEventListener('submit', submitLive);
    document.querySelectorAll('.live-edit').forEach((button) => button.addEventListener('click', () => editLive(button)));
    document.querySelectorAll('.live-cancel').forEach((button) => button.addEventListener('click', () => cancelLive(button)));
    document.querySelectorAll('.draft-load').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById('publishText');
      if (input) { input.value = button.dataset.draft || ''; input.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }));
    document.querySelectorAll('.ticket-reply').forEach((button) => button.addEventListener('click', () => replyTicket(button)));
    document.querySelectorAll('.ticket-resolve').forEach((button) => button.addEventListener('click', () => resolveTicket(button)));
  }

  window.PesceStudio = Object.freeze({ open, load });
})();
