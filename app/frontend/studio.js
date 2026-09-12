// Studio créatrice — espace PRIVÉ chargé à la demande par app.js (loadStudioModule), uniquement
// après confirmation du rôle via /api/me. Le serveur (/api/studio) reste la vraie frontière :
// initData valide ET identifiant créatrice configuré (401/403 sinon). Aucune affordance publique
// ne mène ici : deep link ?startapp=studio uniquement.
// Cinq onglets privés — Bureau, Rédiger, Brouillons, Pistes (messages des lecteurs), Audience —
// alimentés exclusivement par les données réelles des API existantes (Neon / Telegram / Stars).
(function () {
  if (window.PesceStudio) return; // déjà chargé

  const PesceApp = window.PesceApp;
  const PESCE = window.PESCE;
  if (!PesceApp || !PESCE) { console.error('Studio : dépendances manquantes (PesceApp / PESCE).'); return; }

  const { popup, escapeHtml, escapeAttribute, formatDate, fetchJson, openExternal } = PesceApp;
  const initData = () => PesceApp.initData;

  const STUDIO_TABS = ['bureau', 'rediger', 'brouillons', 'pistes', 'audience'];
  const TAB_LABELS = { bureau: 'Bureau', rediger: 'Rédiger', brouillons: 'Brouillons', pistes: 'Pistes & Messages', audience: 'Audience' };

  let currentTab = 'bureau';
  let studioData = null;   // vue d'ensemble /api/studio (réelle)
  let mediaPosts = [];     // publications médias du canal (réelles, via /api/content)
  let mediaFilter = 'tous';
  let formatLabel = 'Grande Enquête';
  let editingLiveId = null;
  let currentLives = [];
  let activeDraftId = null; // brouillon repris : retiré à la publication réussie

  function topicLabel(value) {
    const topic = PESCE.SUPPORT_TOPICS.find((item) => item.value === value);
    return topic ? topic.label : value || '';
  }

  function wordCount(text) {
    return String(text || '').split(/\s+/).filter(Boolean).length;
  }

  async function studioAction(body) {
    return fetch('./api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData() }, body: JSON.stringify(body) });
  }

  // — Ouverture : sonde de défense en profondeur (le serveur décide), puis affichage de la surcouche.
  async function open() {
    try {
      const response = await fetch('./api/studio', { headers: { 'x-telegram-init-data': initData() } });
      if (response.status === 403) { popup('Studio privé', 'Accès réservé au compte créateur de Pesce.'); return; }
      if (!response.ok) { popup('Studio indisponible', 'Réessayez dans un instant.'); return; }
      const screen = document.getElementById('studioScreen');
      if (!screen) return;
      screen.hidden = false;
      if (tg().BackButton) {
        try { tg().BackButton.show(); tg().BackButton.onClick(close); } catch { /* BackButton indisponible */ }
      }
      const tabFromHash = (location.hash.match(/^#studio-(bureau|rediger|brouillons|pistes|audience)$/) || [])[1];
      if (tabFromHash) currentTab = tabFromHash;
      await load();
    } catch (error) {
      popup('Studio indisponible', 'Réessayez dans un instant.');
    }
  }

  function tg() { return window.Telegram?.WebApp; }

  function close() {
    const screen = document.getElementById('studioScreen');
    if (screen) screen.hidden = true;
    const backend = tg().BackButton;
    if (backend) {
      try { backend.offClick(close); backend.hide(); } catch { /* BackButton indisponible */ }
    }
  }

  async function load() {
    const body = document.getElementById('studioBody');
    if (!body) return;
    body.innerHTML = '<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center"><span class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></span><h3 class="font-headline-sm text-headline-sm text-on-surface">Chargement du studio…</h3></article>';
    try {
      studioData = await fetchJson('./api/studio', { headers: { 'x-telegram-init-data': initData() }, cache: 'no-store' });
      currentLives = studioData.liveSchedules || [];
      try {
        const content = await fetchJson('./api/content?limit=50', { cache: 'no-store' });
        mediaPosts = Array.isArray(content.posts)
          ? content.posts.filter((post) => ['photo', 'video', 'audio', 'document'].includes(post.contentType))
          : [];
      } catch { mediaPosts = []; } // la médiathèque reste simplement vide si le flux est indisponible
      body.innerHTML = STUDIO_TABS.map(renderTab).join('');
      bindStudioEvents();
      syncBadges();
      switchTab(currentTab);
      renderStudioClock();
    } catch (error) {
      body.innerHTML = `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center"><span class="material-symbols-outlined text-[28px] text-on-surface-variant">warning</span><h3 class="font-headline-sm text-headline-sm text-on-surface">Studio indisponible</h3><p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(error.message)}</p></article>`;
    }
  }

  function renderStudioClock() {
    const clock = document.getElementById('studioClock');
    if (!clock) return;
    try {
      const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Porto-Novo', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
      const hour = parts.find((part) => part.type === 'hour')?.value || '—';
      const minute = parts.find((part) => part.type === 'minute')?.value || '—';
      clock.textContent = `${hour}h${minute} UTC+1`;
    } catch { /* fuseau indisponible */ }
  }

  function syncBadges() {
    const drafts = studioData?.drafts || [];
    const tickets = studioData?.openTickets || 0;
    const draftsBadge = document.getElementById('studioDraftsBadge');
    const ticketsBadge = document.getElementById('studioTicketsBadge');
    if (draftsBadge) {
      draftsBadge.textContent = String(drafts.length);
      draftsBadge.classList.toggle('hidden', drafts.length === 0);
      draftsBadge.classList.toggle('flex', drafts.length > 0);
    }
    if (ticketsBadge) {
      ticketsBadge.textContent = String(tickets);
      ticketsBadge.classList.toggle('hidden', tickets === 0);
      ticketsBadge.classList.toggle('flex', tickets > 0);
    }
  }

  function switchTab(tab) {
    if (!STUDIO_TABS.includes(tab)) tab = 'bureau';
    currentTab = tab;
    document.querySelectorAll('[data-studio-tab]').forEach((button) => {
      const active = button.dataset.studioTab === tab;
      button.classList.toggle('text-primary', active);
      button.classList.toggle('font-semibold', active);
      button.classList.toggle('text-on-surface-variant', !active);
    });
    document.querySelectorAll('[data-studio-pane]').forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.studioPane !== tab);
    });
    const label = document.getElementById('studioTabLabel');
    if (label) label.textContent = TAB_LABELS[tab];
    if (tab === 'rediger') refreshBat();
    if (tab === 'bureau') renderStudioClock();
  }

  // — Onglets (panes) : contenu réel uniquement, états vides explicites, aucune donnée inventée.
  function renderTab(tab) {
    return `<div class="hidden flex-col w-full pb-24" data-studio-pane="${tab}">${renderers[tab]()}</div>`;
  }

  const renderers = {
    bureau: renderBureau,
    rediger: renderRediger,
    brouillons: renderBrouillons,
    pistes: renderPistes,
    audience: renderAudience,
  };

  // — BUREAU : carnet de bord, actions rapides, chantiers, direct, médiathèque, raccourcis.
  function renderBureau() {
    const drafts = studioData?.drafts || [];
    const audience = studioData?.audience || {};
    const nextLive = (currentLives || []).find((live) => live.status === 'live' || live.status === 'scheduled') || null;
    return `
<div class="px-gutter-mobile py-space-md bg-surface-container-low flex flex-col gap-1">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-kicker-label text-primary uppercase">Carnet de bord</span>
<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-meta-detail text-meta-detail">
<span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
        Édition en direct
      </span>
</div>
<h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Bonjour, Pesce.</h1>
<p class="font-body-sm text-body-sm text-on-surface-variant">Table de rédaction · Cotonou · <span id="studioClock">— UTC+1</span></p>
</div>
<div class="px-gutter-mobile py-space-md bg-surface flex flex-col gap-space-sm">
<button class="w-full flex items-center justify-between px-space-md py-3.5 bg-on-secondary-fixed text-surface rounded shadow-sm active:scale-[0.99] transition-transform" type="button" data-studio-tab-goto="rediger">
<div class="flex items-center gap-2.5">
<span class="material-symbols-outlined text-[1.25rem] text-primary-fixed">edit_square</span>
<span class="font-meta-detail text-meta-detail uppercase tracking-wider font-bold">+ Rédiger une publication</span>
</div>
<span class="material-symbols-outlined text-[1.125rem] text-surface-variant">arrow_forward</span>
</button>
<div class="grid grid-cols-3 gap-2">
<button class="flex flex-col items-start p-3 bg-surface-container-low hover:bg-surface-container rounded transition-colors text-left" type="button" data-studio-tab-goto="rediger">
<span class="material-symbols-outlined text-[1.25rem] text-primary mb-2">article</span>
<span class="font-meta-detail text-[0.6875rem] font-bold text-on-surface uppercase tracking-tight leading-tight">Article Telegraph</span>
<span class="font-meta-detail text-[0.625rem] text-on-surface-variant mt-0.5">Format long</span>
</button>
<button class="flex flex-col items-start p-3 bg-surface-container-low hover:bg-surface-container rounded transition-colors text-left" type="button" data-studio-tab-goto="rediger">
<span class="material-symbols-outlined text-[1.25rem] text-primary mb-2">text_snippet</span>
<span class="font-meta-detail text-[0.6875rem] font-bold text-on-surface uppercase tracking-tight leading-tight">Dépêche Telegram</span>
<span class="font-meta-detail text-[0.625rem] text-on-surface-variant mt-0.5">Texte simple</span>
</button>
<button class="flex flex-col items-start p-3 bg-surface-container-low hover:bg-surface-container rounded transition-colors text-left" type="button" data-studio-scroll="studioLiveSection">
<span class="material-symbols-outlined text-[1.25rem] text-primary mb-2">podium</span>
<span class="font-meta-detail text-[0.6875rem] font-bold text-on-surface uppercase tracking-tight leading-tight">Programmer direct</span>
<span class="font-meta-detail text-[0.625rem] text-on-surface-variant mt-0.5">Canal abonnés</span>
</button>
</div>
</div>
<div class="px-gutter-mobile py-space-sm bg-surface-container">
<div class="grid grid-cols-2 gap-2 py-1">
${renderKpiTile('draw', 'text-tertiary', String(drafts.length), 'Brouillon' + (drafts.length > 1 ? 's' : '') + ' actif' + (drafts.length > 1 ? 's' : ''))}
${renderKpiTile('sensors', 'text-primary', nextLive ? liveShortDate(nextLive.scheduledAt) : 'Aucun', 'Direct programmé')}
${renderKpiTile('mark_email_unread', 'text-primary-container', String(studioData?.openTickets || 0), 'Message' + ((studioData?.openTickets || 0) > 1 ? 's' : '') + ' ouvert' + ((studioData?.openTickets || 0) > 1 ? 's' : ''))}
${renderKpiTile('send', 'text-tertiary', Number(audience.opens || 0).toLocaleString('fr-FR'), 'Ouvertures Pesce Studio')}
</div>
</div>
${renderChantiers()}
${renderLiveSection()}
${renderTelegraphSection()}
${renderBackfillSection()}
${renderMediaSection()}
${renderShortcuts()}
${renderSignOff()}
`;
  }

  function renderKpiTile(icon, tone, value, label) {
    return `<div class="p-2.5 bg-surface rounded flex items-center gap-2.5">
<span class="material-symbols-outlined text-[1.25rem] ${tone}">${icon}</span>
<div class="flex flex-col min-w-0">
<span class="font-headline-sm text-[1rem] leading-none text-on-surface">${escapeHtml(value)}</span>
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant truncate">${escapeHtml(label)}</span>
</div>
</div>`;
  }

  function liveShortDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || isNaN(date)) return '—';
    return `${date.toLocaleString('fr-FR', { weekday: 'short' })}. ${String(date.getHours()).padStart(2, '0')}h`;
  }

  function renderChantiers() {
    const drafts = studioData?.drafts || [];
    return `<section class="px-gutter-mobile pt-space-lg pb-space-sm flex flex-col gap-space-sm bg-surface" id="studioChantiersSection">
<div class="flex items-center justify-between">
<div class="flex items-center gap-2">
<span class="w-2 h-2 bg-primary rounded-full"></span>
<h2 class="font-headline-sm text-headline-sm text-on-surface">Chantiers d'écriture en cours</h2>
</div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${drafts.length} ébauche${drafts.length > 1 ? 's' : ''}</span>
</div>
<div class="flex flex-col gap-space-md mt-1">
${drafts.length ? drafts.map(renderDraftCard).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aucun brouillon pour le moment. Commencez par « Rédiger ».</p>'}
</div>
</section>`;
  }

  function renderDraftCard(draft) {
    const lines = String(draft.text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const title = lines[0]?.slice(0, 90) || 'Brouillon sans titre';
    const excerpt = lines.slice(1).join(' ').trim().slice(0, 160);
    return `<article class="p-space-md bg-surface-container-low rounded flex flex-col gap-space-sm shadow-sm">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-[0.6875rem] text-primary uppercase">Brouillon</span>
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant">Modifié le ${formatDate(draft.updatedAt || draft.createdAt)}</span>
</div>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-on-surface">${escapeHtml(title)}</h3>
${excerpt ? `<p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">${escapeHtml(excerpt)}</p>` : ''}
<div class="pt-2 flex items-center justify-between">
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant">${wordCount(draft.text).toLocaleString('fr-FR')} mots</span>
<div class="flex gap-space-xs">
<button class="draft-load border border-outline-variant px-space-sm py-3 font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-draft="${escapeAttribute(draft.text || '')}" data-draft-id="${escapeAttribute(draft.id)}">Reprendre</button>
<button class="draft-delete border border-outline-variant px-space-sm py-3 font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-draft-id="${escapeAttribute(draft.id)}">Supprimer</button>
</div>
</div>
</article>`;
  }

  // — DIRECTS : programmation réelle (le direct reste diffusé sur sa plateforme externe).
  function liveStatusLabel(status) {
    return { scheduled: 'à venir', ready: 'prêt', live: 'en direct', ended: 'terminé', cancelled: 'annulé', failed: 'échoué' }[status] || status;
  }

  function toDatetimeLocal(value) {
    const date = value ? new Date(value) : null;
    if (!date || isNaN(date)) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderLiveSection() {
    const upcoming = (currentLives || []).filter((live) => live.status === 'live' || live.status === 'scheduled');
    return `<section class="px-gutter-mobile py-space-md bg-surface flex flex-col gap-space-sm" id="studioLiveSection">
<div class="flex items-center justify-between">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Directs</h2>
<span class="px-2 py-0.5 rounded bg-primary-container/15 text-primary font-meta-detail text-[0.6875rem] font-bold">${upcoming.length ? `${upcoming.length} programmé${upcoming.length > 1 ? 's' : ''}` : 'Aucun direct'}</span>
</div>
${upcoming.length ? upcoming.map((live) => {
  const date = live.scheduledAt ? new Date(live.scheduledAt) : null;
  const when = date && !isNaN(date)
    ? `${date.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')} GMT`
    : '';
  return `<div class="p-space-md bg-on-secondary-fixed text-surface rounded shadow-md flex flex-col gap-space-sm">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-[0.6875rem] text-primary-fixed uppercase tracking-wider">${live.status === 'live' ? 'En direct maintenant' : 'Direct programmé'}</span>
${when ? `<span class="inline-flex items-center gap-1 font-meta-detail text-meta-detail text-surface-container-highest"><span class="material-symbols-outlined text-[0.875rem] text-primary-fixed animate-pulse">radio_button_checked</span>${escapeHtml(when)}</span>` : ''}
</div>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-surface-bright">${escapeHtml(live.title)}</h3>
${live.description ? `<p class="font-body-sm text-body-sm text-secondary-fixed-dim">${escapeHtml(live.description)}</p>` : ''}
<div class="py-2 flex flex-col gap-1 text-[0.6875rem] font-meta-detail text-surface-container-high">
<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[0.875rem] text-primary-fixed">send</span><span>Canal Telegram ${escapeHtml(PESCE.CHANNEL_HANDLE)}</span></div>
${live.link ? `<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[0.875rem] text-surface-variant">videocam</span><span>Lien YouTube fourni</span></div>` : '<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[0.875rem] text-surface-variant">videocam</span><span>Diffusion sur la plateforme du direct (lien optionnel)</span></div>'}
</div>
<div class="grid grid-cols-2 gap-2 pt-2">
<button class="live-edit py-3 px-3 bg-surface-container-highest/15 hover:bg-surface-container-highest/25 text-surface text-center rounded font-meta-detail text-[0.6875rem] font-bold uppercase tracking-wider transition-colors" type="button" data-live-id="${escapeAttribute(live.id)}">Modifier la fiche</button>
<button class="live-cancel py-2.5 px-3 bg-primary text-on-primary text-center rounded font-meta-detail text-[0.6875rem] font-bold uppercase tracking-wider" type="button" data-live-id="${escapeAttribute(live.id)}">Annuler le direct</button>
</div>
</div>`;
}).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aucun direct programmé. Planifiez-en un ci-dessous : il apparaît sur l\'accueil public (« Prochain direct »).</p>'}
<form id="liveForm" class="publish-form flex flex-col gap-space-sm mt-space-sm">
<input id="liveTitle" class="editorial-input" type="text" maxlength="256" placeholder="Titre du direct" required>
<textarea id="liveDescription" class="editorial-input" rows="3" maxlength="4000" placeholder="Description (optionnelle)"></textarea>
<input id="liveDate" class="editorial-input" type="datetime-local" required>
<p class="font-meta-detail text-meta-detail text-on-surface-variant text-[11px]">Heure de votre appareil — l'audience verra l'heure convertie dans son propre fuseau horaire.</p>
<input id="liveLink" class="editorial-input" type="text" maxlength="512" placeholder="Lien du direct (YouTube, …) — optionnel">
<select id="liveStatus" class="editorial-input"><option value="scheduled">À venir</option><option value="ready">Prêt</option><option value="live">En direct</option><option value="ended">Terminé</option><option value="cancelled">Annulé</option><option value="failed">Échoué</option></select>
<div class="composer-actions flex gap-space-sm"><button id="liveSubmit" class="flex-1 bg-on-secondary-fixed text-surface py-3 px-space-md font-kicker-label text-kicker-label uppercase tracking-wider hover:bg-primary transition-colors" type="submit">Planifier le direct</button></div>
<p id="liveStatusText" class="form-status" aria-live="polite"></p>
</form>
${(currentLives || []).filter((live) => !['live', 'scheduled'].includes(live.status)).length ? `<div class="flex flex-col gap-space-xs">${(currentLives || []).filter((live) => !['live', 'scheduled'].includes(live.status)).map((live) => `<div class="flex justify-between items-center gap-2 border-t border-outline-variant py-space-sm"><div class="min-w-0"><strong class="font-body-sm text-body-sm text-on-surface">${escapeHtml(live.title)}</strong><small class="block font-meta-detail text-meta-detail text-on-surface-variant mt-0.5">${formatDate(live.scheduledAt)} · ${escapeHtml(liveStatusLabel(live.status))}${live.link ? ' · lien fourni' : ''}</small></div></div>`).join('')}</div>` : ''}
</section>`;
  }

  function renderTelegraphSection() {
    if (studioData?.telegraphConfigured) {
      return `<section class="px-gutter-mobile py-space-md bg-surface flex flex-col gap-space-sm" id="studioTelegraphSection">
<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-[20px]">article</span><h3 class="font-headline-sm text-headline-sm text-on-surface">Articles Telegraph</h3></div>
<p class="font-body-sm text-body-sm text-on-surface-variant">Compte configuré. Créez et publiez vos articles depuis « Rédiger » : un titre transforme votre texte en article Telegraph (telegra.ph), lu en Instant View et publié sur le canal avec le bouton ⭐ Soutenir.</p>
<button class="self-start px-space-md py-3 border border-outline-variant bg-surface-container-lowest text-on-surface font-kicker-label text-kicker-label uppercase tracking-wider hover:bg-surface-container-low transition-colors" type="button" data-studio-tab-goto="rediger">Rédiger un article</button>
</section>`;
    }
    return `<section class="px-gutter-mobile py-space-md bg-surface flex flex-col gap-space-sm" id="studioTelegraphSection">
<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-[20px]">article</span><h3 class="font-headline-sm text-headline-sm text-on-surface">Articles Telegraph</h3></div>
<p class="font-body-sm text-body-sm text-on-surface-variant">Telegraph n'est pas encore configuré. Créez le compte, puis sauvegardez le jeton reçu dans la variable d'environnement <strong>TELEGRAPH_ACCESS_TOKEN</strong> (Vercel) et redéployez.</p>
<button id="telegraphSetupButton" class="self-start px-space-md py-3 border border-outline-variant bg-surface-container-lowest text-on-surface font-kicker-label text-kicker-label uppercase tracking-wider hover:bg-surface-container-low transition-colors" type="button">Configurer Telegraph</button>
<p id="telegraphStatus" class="form-status" aria-live="polite"></p>
</section>`;
  }

  function renderBackfillSection() {
    return `<section class="px-gutter-mobile py-space-md bg-surface flex flex-col gap-space-sm">
<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-[20px]">star</span><h3 class="font-headline-sm text-headline-sm text-on-surface">Bouton de soutien du canal</h3></div>
<p class="font-body-sm text-body-sm text-on-surface-variant">Les nouvelles publications reçoivent automatiquement le bouton « ⭐ Soutenir le travail de Pesce ». Utilisez ceci une fois pour les publications déjà présentes.</p>
<button id="backfillSupportButton" class="self-start px-space-md py-3 border border-outline-variant bg-surface-container-lowest text-on-surface font-kicker-label text-kicker-label uppercase tracking-wider hover:bg-surface-container-low transition-colors" type="button">Ajouter aux publications récentes</button>
<p id="backfillStatus" class="form-status" aria-live="polite"></p>
</section>`;
  }

  // — MÉDIATHÈQUE : médias réels du canal (métadonnées/références — les fichiers restent hébergés par Telegram/YouTube).
  const MEDIA_FILTERS = [
    { key: 'tous', label: 'Tous', types: ['photo', 'video', 'audio', 'document'] },
    { key: 'photos', label: 'Photos', types: ['photo'] },
    { key: 'videos', label: 'Vidéos', types: ['video'] },
    { key: 'audios', label: 'Audios', types: ['audio'] },
    { key: 'documents', label: 'Documents', types: ['document'] },
  ];

  function renderMediaSection() {
    const filter = MEDIA_FILTERS.find((item) => item.key === mediaFilter) || MEDIA_FILTERS[0];
    const items = mediaPosts.filter((post) => filter.types.includes(post.contentType));
    return `<section class="px-gutter-mobile pt-space-lg flex flex-col gap-space-sm" id="studioMediaSection">
<div class="flex items-center justify-between mb-space-sm">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-[1.25rem]">perm_media</span>
<h2 class="font-kicker-label text-kicker-label text-on-surface uppercase tracking-wider font-bold">Médiathèque</h2>
</div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant font-medium">${items.length} pièce${items.length > 1 ? 's' : ''}</span>
</div>
<div class="flex items-center gap-1.5 overflow-x-auto pb-space-xs mb-space-md no-scrollbar">
${MEDIA_FILTERS.map((entry) => `<button class="media-filter px-3 py-2 rounded ${entry.key === mediaFilter ? 'bg-on-secondary-fixed text-surface' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'} font-meta-detail text-[0.75rem] font-bold uppercase tracking-wider whitespace-nowrap" type="button" data-media-filter="${entry.key}">${escapeHtml(entry.label)}</button>`).join('')}
</div>
${items.length ? `<div class="flex flex-col gap-space-sm mb-space-md">${items.map(renderMediaItem).join('')}</div>` : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-space-md">Aucun média de ce type sur le canal pour le moment.</p>'}
<p class="font-body-sm text-body-sm text-on-surface-variant text-[0.75rem]">Les fichiers restent hébergés par Telegram (photos, audios, documents) et YouTube (vidéos) — Pesce Studio ne stocke que les références.</p>
</section>`;
  }

  function mediaCaption(post) {
    const firstLine = String(post.text || '').split('\n').map((line) => line.trim()).find(Boolean);
    return firstLine ? firstLine.slice(0, 90) : ({ photo: 'Photo du canal', video: 'Vidéo du canal', audio: 'Audio du canal', document: 'Document du canal' }[post.contentType] || 'Média du canal');
  }

  function renderMediaItem(post) {
    const dateLabel = formatDate(post.publishedAt);
    const recall = `<button class="recall-post self-start px-space-sm py-3 border border-outline-variant rounded font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-recall="${escapeAttribute(post.id)}">Retirer</button>`;
    if (post.contentType === 'photo') {
      return `<article class="bg-surface-container-low rounded-lg p-space-sm flex gap-space-sm items-start shadow-sm">
<div class="w-20 h-20 rounded bg-surface-container-high flex-shrink-0 overflow-hidden">
${post.mediaUrl ? `<img class="w-full h-full object-cover" src="${escapeAttribute(post.mediaUrl)}" alt="${escapeAttribute(mediaCaption(post))}" loading="lazy">` : ''}
</div>
<div class="flex-1 min-w-0">
<span class="font-kicker-label text-[0.625rem] text-primary uppercase font-bold tracking-wider">Photo de terrain</span>
<h4 class="font-headline-sm text-[1rem] text-on-surface font-semibold truncate leading-tight">${escapeHtml(mediaCaption(post))}</h4>
<p class="font-meta-detail text-[0.75rem] text-on-surface-variant mt-0.5">${escapeHtml(dateLabel)}${post.telegramUrl ? ' · <button class="inline-block py-2 text-primary font-bold hover:underline" type="button" data-studio-link="' + escapeAttribute(post.telegramUrl) + '">Voir sur Telegram</button>' : ''}</p>
${recall}
</div>
</article>`;
    }
    if (post.contentType === 'video') {
      return `<article class="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-space-sm shadow-sm">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-[0.625rem] text-primary uppercase font-bold tracking-wider">Vidéo</span>
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant">${escapeHtml(dateLabel)}${post.mediaDuration ? ` · ${escapeHtml(formatDuration(post.mediaDuration))}` : ''}</span>
</div>
<h4 class="font-headline-sm text-[1rem] text-on-surface font-semibold leading-tight">${escapeHtml(mediaCaption(post))}</h4>
${post.mediaUrl ? `<video class="w-full rounded bg-inverse-surface" controls preload="metadata" src="${escapeAttribute(post.mediaUrl)}"${post.mediaThumbnailUrl ? ` poster="${escapeAttribute(post.mediaThumbnailUrl)}"` : ''}></video>` : ''}
<p class="font-body-sm text-body-sm text-on-surface-variant text-[0.75rem]">Hébergée sur la chaîne YouTube officielle — référencée ici pour la régie.</p>
${recall}
</article>`;
    }
    if (post.contentType === 'audio') {
      return `<article class="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-space-sm shadow-sm">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-[0.625rem] text-primary uppercase font-bold tracking-wider">Enregistrement audio</span>
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant">${escapeHtml(dateLabel)}${post.mediaDuration ? ` · ${escapeHtml(formatDuration(post.mediaDuration))}` : ''}</span>
</div>
<h4 class="font-headline-sm text-[1rem] text-on-surface font-semibold leading-tight">${escapeHtml(mediaCaption(post))}</h4>
${post.mediaUrl ? `<audio class="w-full" controls preload="none" src="${escapeAttribute(post.mediaUrl)}"></audio>` : ''}
${recall}
</article>`;
    }
    return `<article class="bg-surface-container-low rounded-lg p-space-sm flex items-start gap-space-sm shadow-sm">
<div class="w-10 h-10 rounded bg-tertiary/10 text-tertiary flex items-center justify-center flex-shrink-0 mt-0.5"><span class="material-symbols-outlined text-[1.25rem]">description</span></div>
<div class="flex-1 min-w-0">
<span class="font-kicker-label text-[0.625rem] text-on-surface-variant uppercase font-bold tracking-wider">Document</span>
<h4 class="font-headline-sm text-[1rem] text-on-surface font-semibold truncate leading-tight">${escapeHtml(mediaCaption(post))}</h4>
<p class="font-meta-detail text-[0.75rem] text-on-surface-variant mt-0.5">${escapeHtml(dateLabel)}${post.telegramUrl ? ' · <button class="inline-block py-2 text-primary font-bold hover:underline" type="button" data-studio-link="' + escapeAttribute(post.telegramUrl) + '">Ouvrir sur Telegram</button>' : ''}</p>
${recall}
</div>
</article>`;
  }

  function formatDuration(seconds) {
    const total = Math.round(Number(seconds) || 0);
    if (!total) return '';
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function renderShortcuts() {
    return `<div class="px-gutter-mobile pt-space-sm pb-space-lg flex flex-col gap-space-sm">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Raccourcis du pupitre</h2>
<div class="flex flex-col gap-2">
<button class="p-3 bg-surface-container-low hover:bg-surface-container rounded flex items-center justify-between transition-colors text-left" type="button" data-studio-scroll="studioTelegraphSection">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface flex items-center justify-center text-primary"><span class="material-symbols-outlined text-[1.125rem]">article</span></div>
<div class="flex flex-col"><span class="font-meta-detail text-meta-detail font-bold text-on-surface uppercase">Articles Telegraph</span><span class="font-body-sm text-[0.6875rem] text-on-surface-variant">Créer et publier vos articles</span></div>
</div>
<span class="material-symbols-outlined text-tertiary text-[1.125rem]">chevron_right</span>
</button>
<button class="p-3 bg-surface-container-low hover:bg-surface-container rounded flex items-center justify-between transition-colors text-left" type="button" data-studio-scroll="studioMediaSection">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface flex items-center justify-center text-primary"><span class="material-symbols-outlined text-[1.125rem]">perm_media</span></div>
<div class="flex flex-col"><span class="font-meta-detail text-meta-detail font-bold text-on-surface uppercase">Médiathèque</span><span class="font-body-sm text-[0.6875rem] text-on-surface-variant">Photos, vidéos, audios et documents</span></div>
</div>
<span class="material-symbols-outlined text-tertiary text-[1.125rem]">chevron_right</span>
</button>
<button class="p-3 bg-surface-container-low hover:bg-surface-container rounded flex items-center justify-between transition-colors text-left" type="button" data-studio-tab-goto="audience">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface flex items-center justify-center text-primary"><span class="material-symbols-outlined text-[1.125rem]">star</span></div>
<div class="flex flex-col"><span class="font-meta-detail text-meta-detail font-bold text-on-surface uppercase">Soutiens Telegram Stars</span><span class="font-body-sm text-[0.6875rem] text-on-surface-variant">Contributions directes des lecteurs</span></div>
</div>
<span class="material-symbols-outlined text-tertiary text-[1.125rem]">chevron_right</span>
</button>
<button class="p-3 bg-surface-container-low hover:bg-surface-container rounded flex items-center justify-between transition-colors text-left" type="button" data-studio-scroll="studioLiveSection">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface flex items-center justify-center text-primary"><span class="material-symbols-outlined text-[1.125rem]">podium</span></div>
<div class="flex flex-col"><span class="font-meta-detail text-meta-detail font-bold text-on-surface uppercase">Programmation des directs</span><span class="font-body-sm text-[0.6875rem] text-on-surface-variant">Canal Telegram · Lien YouTube</span></div>
</div>
<span class="material-symbols-outlined text-tertiary text-[1.125rem]">chevron_right</span>
</button>
</div>
</div>`;
  }

  function renderSignOff() {
    return `<div class="p-space-sm bg-surface-container text-center flex flex-col items-center gap-1">
<p class="font-meta-detail text-meta-detail text-on-surface-variant italic">« L'indépendance de la plume ne se négocie pas. Elle s'entretient mot après mot. »</p>
<p class="font-kicker-label text-kicker-label uppercase text-secondary text-[10px]">Studio Pesce Hounyo · Carnet de bord interne</p>
</div>`;
  }

  // — RÉDIGER : pupitre d'écriture (publication Telegram ou article Telegraph), aperçu BAT réel.
  const FORMATS = [
    { label: 'Grande Enquête', placeholder: 'Inscrire un titre percutant…', hint: 'Le titre transforme le texte en article Telegraph (telegra.ph), lu en Instant View.' },
    { label: 'Chronique / Opinion', placeholder: 'Titre de la chronique…', hint: 'Le titre transforme le texte en article Telegraph (telegra.ph), lu en Instant View.' },
    { label: 'Dépêche Telegram', placeholder: 'Écrivez votre dépêche…', hint: 'Sans titre : publication texte simple envoyée sur le canal.' },
    { label: 'Entretien', placeholder: 'Titre de l\'entretien…', hint: 'Le titre transforme le texte en article Telegraph (telegra.ph), lu en Instant View.' },
    { label: 'Note de terrain', placeholder: 'Titre de la note…', hint: 'Le titre transforme le texte en article Telegraph (telegra.ph), lu en Instant View.' },
  ];

  function renderRediger() {
    const format = FORMATS.find((item) => item.label === formatLabel) || FORMATS[0];
    return `
<div class="bg-surface-container-low px-gutter-mobile py-space-sm shadow-sm flex items-center justify-between">
<div class="flex items-center gap-space-xs min-w-0">
<span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
<span class="font-kicker-label text-kicker-label text-primary uppercase tracking-wider truncate">PUPITRE D'ÉCRITURE</span>
</div>
<div class="inline-flex p-1 bg-surface-variant rounded-lg">
<button class="desk-mode px-space-sm py-2 rounded font-body-sm text-body-sm transition-all bg-surface-container-lowest text-on-surface shadow-sm font-semibold" type="button" data-desk-mode="redaction">Rédaction</button>
<button class="desk-mode px-space-sm py-2 rounded font-body-sm text-body-sm transition-all text-on-surface-variant hover:text-on-surface" type="button" data-desk-mode="bat">Épreuve BAT</button>
</div>
</div>
<div class="w-full max-w-3xl mx-auto px-gutter-mobile py-space-md flex flex-col gap-space-lg">
<div class="flex flex-col gap-space-lg" id="view-redaction">
<div class="flex flex-col gap-space-xs">
<label class="font-kicker-label text-kicker-label text-on-surface-variant uppercase">Type d'écrit éditorial</label>
<div class="flex items-center gap-space-xs overflow-x-auto pb-1 no-scrollbar">
${FORMATS.map((entry) => `<button class="format-pill px-3 py-2 rounded-lg font-meta-detail text-meta-detail ${entry.label === formatLabel ? 'bg-on-surface text-surface-container-lowest font-medium shadow-sm' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-variant'} whitespace-nowrap" type="button" data-format="${escapeAttribute(entry.label)}">${escapeHtml(entry.label)}</button>`).join('')}
</div>
</div>
<form id="publishForm" class="publish-form flex flex-col gap-space-xs">
<div class="flex flex-col gap-space-xs">
<label class="font-kicker-label text-kicker-label text-on-surface-variant uppercase" for="articleTitle">Titre de l'article</label>
<input id="articleTitle" class="editorial-input" type="text" maxlength="256" placeholder="${escapeAttribute(format.placeholder)}">
<p class="font-meta-detail text-meta-detail text-on-surface-variant text-[11px]">${escapeHtml(format.hint)}</p>
</div>
<div class="flex flex-col gap-space-xs">
<label class="font-kicker-label text-kicker-label text-on-surface-variant uppercase" for="publishText">Corps du tapuscrit</label>
<textarea id="publishText" class="editorial-input" rows="12" maxlength="4096" placeholder="Écrivez votre publication…" required></textarea>
</div>
<div class="flex items-center justify-between pt-space-sm text-on-surface-variant font-meta-detail text-meta-detail">
<span id="publishWords">0 mot</span>
<span class="flex items-center gap-1 text-primary"><span class="material-symbols-outlined text-[1rem]">check_circle</span> Synchronisation directe avec le canal</span>
</div>
</form>
</div>
<div class="hidden flex-col gap-space-md" id="view-bat">
<div class="bg-surface-container-low p-space-md rounded-lg shadow-sm">
<div class="flex items-center justify-between mb-space-sm">
<span class="font-kicker-label text-kicker-label text-primary uppercase">Rendu Épreuve Finale (BAT)</span>
<span class="bg-primary/10 text-primary px-2 py-0.5 rounded font-meta-detail text-meta-detail font-medium" id="batFormatBadge">Format Telegraph / Instant View</span>
</div>
<article class="bg-surface-container-lowest p-space-lg rounded shadow-sm flex flex-col gap-space-sm" id="batPreview"></article>
</div>
</div>
<div class="bg-surface-container-low rounded-lg p-space-md md:p-space-lg shadow-sm flex flex-col gap-space-md">
<div class="flex flex-col gap-space-xs">
<div class="flex items-center gap-space-xs text-primary font-headline-sm text-headline-sm"><span class="material-symbols-outlined text-[1.4rem]">verified</span><span>Épreuve &amp; Pipeline de distribution</span></div>
<p class="font-body-sm text-body-sm text-on-surface-variant">Cette publication sera synchronisée sur le canal officiel <strong class="text-on-surface">${escapeHtml(PESCE.CHANNEL_HANDLE)}</strong>${' — et archivée en article Telegraph si un titre est fourni.'}</p>
</div>
<div class="flex flex-col gap-space-xs bg-surface-container-lowest p-space-md rounded-lg shadow-sm">
<label class="flex items-center gap-space-sm cursor-pointer"><input checked="" class="w-4 h-4 rounded text-primary accent-primary" type="checkbox"><span class="font-body-sm text-body-sm text-on-surface font-medium">Titre et texte vérifiés</span></label>
<label class="flex items-center gap-space-sm cursor-pointer"><input checked="" class="w-4 h-4 rounded text-primary accent-primary" type="checkbox"><span class="font-body-sm text-body-sm text-on-surface font-medium">Conformité à la charte déontologique du Studio</span></label>
<label class="flex items-center gap-space-sm cursor-pointer"><input class="w-4 h-4 rounded text-primary accent-primary" type="checkbox"><span class="font-body-sm text-body-sm text-on-surface font-medium">Canal cible : <span class="text-primary font-semibold">${escapeHtml(PESCE.CHANNEL_HANDLE)}</span></span></label>
</div>
<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-space-sm pt-space-xs">
<button class="w-full sm:flex-1 py-3 px-space-md bg-on-secondary-fixed text-surface-container-lowest font-body-sm text-body-sm font-bold uppercase tracking-wider rounded-lg shadow-md hover:bg-primary-container transition-colors flex items-center justify-center gap-2" type="submit" id="publishSubmit">
<span class="material-symbols-outlined text-[1.2rem]">send</span> Publier
</button>
<button class="w-full sm:w-auto py-3 px-space-md bg-surface-container-lowest text-tertiary hover:text-on-surface rounded-lg font-body-sm text-body-sm font-medium transition-colors flex items-center justify-center" type="button" id="draftButton">Enregistrer l'ébauche</button>
</div>
<p id="publishStatus" class="form-status" aria-live="polite"></p>
</div>
</div>`;
  }

  function refreshBat() {
    const preview = document.getElementById('batPreview');
    const badge = document.getElementById('batFormatBadge');
    const title = document.getElementById('articleTitle')?.value.trim() || '';
    const text = document.getElementById('publishText')?.value.trim() || '';
    if (!preview || !badge) return;
    const paragraphs = text.split('\n\n').map((paragraph) => paragraph.trim()).filter(Boolean);
    const standfirst = paragraphs[0] || '';
    const body = paragraphs.slice(1).join('\n\n');
    if (title) {
      badge.textContent = 'Format Telegraph / Instant View';
      preview.innerHTML = `<span class="font-kicker-label text-kicker-label text-primary uppercase tracking-widest">${escapeHtml(formatLabel.toUpperCase())}</span>
<h1 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h1>
${standfirst ? `<p class="font-editorial-standfirst text-editorial-standfirst italic text-tertiary">${escapeHtml(standfirst.slice(0, 240))}${standfirst.length > 240 ? '…' : ''}</p>` : ''}
${body ? `<div class="flex flex-col gap-space-md">${body.split('\n\n').map((paragraph) => `<p class="font-body-md text-body-md text-on-surface leading-relaxed">${escapeHtml(paragraph.slice(0, 400))}</p>`).join('')}</div>` : ''}
<p class="font-meta-detail text-meta-detail text-on-surface-variant pt-space-xs">Publié ensuite sur le canal avec le bouton ⭐ Soutenir.</p>`;
    } else {
      badge.textContent = 'Dépêche Telegram (texte simple)';
      preview.innerHTML = paragraphs.length
        ? `<span class="font-kicker-label text-kicker-label text-primary uppercase tracking-widest">DÉPÊCHE TELEGRAM</span>
<div class="flex flex-col gap-space-md">${paragraphs.map((paragraph) => `<p class="font-body-md text-body-md text-on-surface leading-relaxed">${escapeHtml(paragraph.slice(0, 400))}</p>`).join('')}</div>
<p class="font-meta-detail text-meta-detail text-on-surface-variant pt-space-xs">Envoyée telle quelle sur le canal.</p>`
        : '<p class="font-body-md text-body-md text-on-surface-variant">Commencez à écrire : l\'épreuve apparaîtra ici.</p>';
    }
  }

  // — BROUILLONS : système de brouillons existant.
  function renderBrouillons() {
    const drafts = studioData?.drafts || [];
    return `<div class="px-gutter-mobile py-space-md flex flex-col gap-space-md">
<div class="flex items-center justify-between">
<div class="flex items-center gap-2"><span class="w-2 h-2 bg-primary rounded-full"></span><h1 class="font-headline-sm text-headline-sm text-on-surface">Brouillons</h1></div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${drafts.length} ébauche${drafts.length > 1 ? 's' : ''}</span>
</div>
${drafts.length ? drafts.map(renderDraftCard).join('') : `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center">
<div class="w-12 h-12 bg-surface-container-highest flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-[24px]">drafts</span></div>
<h3 class="font-headline-sm text-headline-sm text-on-surface">Aucun brouillon</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant">Commencez par « Rédiger » : votre ébauche sera enregistrée ici avant publication.</p>
<button class="bg-on-secondary-fixed text-surface px-space-md py-space-sm font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors" type="button" data-studio-tab-goto="rediger">Rédiger une publication</button>
</article>`}
</div>`;
  }

  // — PISTES : messages des lecteurs, via le système de demandes d'assistance existant.
  function renderPistes() {
    const tickets = studioData?.recentTickets || [];
    return `<div class="px-gutter-mobile py-space-md flex flex-col gap-space-md">
<div class="flex flex-col gap-space-xs">
<div class="flex items-center gap-space-xs"><span class="w-1.5 h-1.5 bg-primary rounded-full"></span><span class="font-kicker-label text-kicker-label text-primary uppercase">Messages des lecteurs</span></div>
<h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Messages &amp; demandes</h1>
<p class="font-body-sm text-body-sm text-on-surface-variant">Les messages proviennent du formulaire d'assistance et du bot ${escapeHtml(PESCE.BOT_USERNAME)} — vos réponses sont envoyées directement dans Telegram.</p>
</div>
${tickets.length ? tickets.map((ticket) => `<article class="bg-surface-container-lowest p-space-md rounded-lg flex flex-col gap-space-sm shadow-sm" data-ticket="${escapeAttribute(ticket.id)}">
<div class="flex items-center justify-between">
<div class="flex items-center gap-1.5">
<span class="font-meta-detail text-[0.6875rem] font-bold tracking-wider uppercase text-primary">${escapeHtml(ticket.id)}</span>
${ticket.topic ? `<span class="font-meta-detail text-meta-detail text-on-surface-variant">· ${escapeHtml(topicLabel(ticket.topic))}</span>` : ''}
</div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${formatDate(ticket.createdAt)}</span>
</div>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-on-surface font-semibold">${escapeHtml(ticket.username ? '@' + ticket.username : ticket.firstName || 'Lecteur')}</h3>
<span class="self-start px-2 py-0.5 rounded ${ticket.status === 'replied' ? 'bg-surface-container-high text-on-surface-variant' : 'bg-primary-fixed text-on-primary-fixed'} font-kicker-label text-kicker-label uppercase">${ticket.status === 'replied' ? 'Répondue · en attente du lecteur' : 'En attente de réponse'}</span>
<p class="font-body-md text-body-md text-on-surface-variant">${escapeHtml(ticket.message || '')}</p>
${ticket.status === 'replied' && ticket.lastReply ? `<div class="bg-surface-container-low rounded p-space-sm flex flex-col gap-0.5">
<span class="font-meta-detail text-meta-detail text-primary uppercase">Votre réponse enregistrée${ticket.lastReplyAt ? ` · ${formatDate(ticket.lastReplyAt)}` : ''}${ticket.lastReplyMessageId ? ` · message Telegram n° ${ticket.lastReplyMessageId}` : ''}</span>
<p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">${escapeHtml(ticket.lastReply)}</p>
</div>` : ''}
<textarea class="ticket-reply-input editorial-input" rows="2" maxlength="4000" placeholder="${ticket.status === 'replied' ? 'Répondre à nouveau dans Telegram…' : 'Répondre dans Telegram…'}"></textarea>
<div class="ticket-actions flex gap-space-xs">
<button class="ticket-reply flex-1 border border-outline-variant px-space-sm py-3 font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">${ticket.status === 'replied' ? 'Répondre à nouveau' : 'Répondre'}</button>
<button class="ticket-resolve flex-1 border border-outline-variant px-space-sm py-3 font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">Résoudre</button>
</div>
</article>`).join('') : `<article class="bg-surface-container-lowest p-space-md shadow-sm flex flex-col items-center gap-space-sm text-center">
<div class="w-12 h-12 bg-surface-container-highest flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-[24px]">mark_email_unread</span></div>
<h3 class="font-headline-sm text-headline-sm text-on-surface">Aucun message pour le moment</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant">Les demandes d'assistance et les messages des lecteurs apparaîtront ici.</p>
</article>`}
</div>`;
  }

  // — AUDIENCE : indicateurs et soutiens réels (Stars Telegram), aucune métrique inventée.
  function renderAudience() {
    const audience = studioData?.audience || {};
    const payments = studioData?.recentPayments || [];
    return `<div class="px-gutter-mobile py-space-md flex flex-col gap-space-md">
<div class="flex flex-col gap-space-xs">
<div class="flex items-center gap-space-xs"><span class="w-1.5 h-1.5 bg-primary rounded-full"></span><span class="font-kicker-label text-kicker-label text-primary uppercase">Audience &amp; Soutiens</span></div>
<h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Audience</h1>
<p class="font-body-sm text-body-sm text-on-surface-variant">Ouvertures de Pesce Studio et soutiens Telegram Stars — sans métriques inventées.</p>
</div>
<div class="grid grid-cols-2 gap-space-sm">
<div class="bg-surface-container-lowest p-space-md rounded-lg flex flex-col justify-between shadow-sm">
<span class="font-meta-detail text-meta-detail text-on-surface-variant uppercase tracking-wider">Ouvertures</span>
<span class="font-headline-md text-headline-md text-on-surface leading-none font-bold my-space-xs">${Number(audience.opens || 0).toLocaleString('fr-FR')}</span>
<span class="font-meta-detail text-[0.6875rem] text-primary">+${Number(audience.last7Days || 0).toLocaleString('fr-FR')} sur 7 jours</span>
</div>
<div class="bg-surface-container-lowest p-space-md rounded-lg flex flex-col justify-between shadow-sm">
<span class="font-meta-detail text-meta-detail text-on-surface-variant uppercase tracking-wider">Visiteurs uniques</span>
<span class="font-headline-md text-headline-md text-on-surface leading-none font-bold my-space-xs">${Number(audience.uniqueUsers || 0).toLocaleString('fr-FR')}</span>
<span class="font-meta-detail text-[0.6875rem] text-secondary">Personnes distinctes</span>
</div>
</div>
<section class="flex flex-col gap-space-md">
<div class="flex flex-col gap-0.5">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Soutiens Telegram Stars</h2>
<p class="font-body-sm text-body-sm text-on-surface-variant">Les contributions directes des lecteurs financent les frais de terrain et l'autonomie éditoriale.</p>
</div>
<div class="bg-surface-container-highest p-space-md rounded-lg flex items-center justify-between shadow-sm">
<div class="flex flex-col">
<span class="font-meta-detail text-meta-detail text-on-surface-variant uppercase tracking-wider">Total reçu</span>
<div class="flex items-center gap-1.5 mt-1">
<span class="material-symbols-outlined text-primary text-[1.5rem]" style="font-variation-settings: 'FILL' 1;">star</span>
<span class="font-headline-md text-headline-md text-on-surface font-bold">${Number(studioData?.stars || 0).toLocaleString('fr-FR')}</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant self-end mb-1">· ${Number(studioData?.supporters || 0).toLocaleString('fr-FR')} soutien${(studioData?.supporters || 0) > 1 ? 's' : ''}</span>
</div>
</div>
</div>
<div class="bg-surface-container-lowest p-space-md rounded-lg flex flex-col gap-space-sm shadow-sm">
<span class="font-meta-detail text-meta-detail font-bold uppercase tracking-wider text-on-surface-variant">Dernières contributions</span>
${payments.length ? payments.map((payment) => `<div class="flex items-center justify-between p-space-sm bg-surface-container-low rounded">
<div class="flex items-center gap-space-sm min-w-0">
<div class="w-8 h-8 rounded-full bg-primary-fixed text-on-primary-fixed flex items-center justify-center font-meta-detail font-bold flex-shrink-0">${escapeHtml((payment.username || 'L').slice(0, 2).toUpperCase())}</div>
<div class="flex flex-col min-w-0">
<span class="font-meta-detail text-meta-detail text-on-surface font-semibold truncate">${escapeHtml(payment.username ? '@' + payment.username : 'Lecteur')}</span>
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant truncate">${formatDate(payment.paidAt)}${payment.refundedAt ? ' · remboursé' : ''}</span>
</div>
</div>
<div class="flex flex-col items-end flex-shrink-0 ml-2 gap-1">
<span class="font-meta-detail text-meta-detail text-primary font-bold">${payment.amount || 0} ⭐</span>
${payment.refundedAt ? '' : `<button class="payment-refund border border-outline-variant px-space-sm py-3 font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-payment="${escapeAttribute(payment.id)}">Rembourser</button>`}
</div>
</div>`).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aucun soutien reçu pour le moment.</p>'}
</div>
</section>
<p class="font-body-sm text-body-sm text-on-surface-variant text-[0.75rem]">Les vidéos restent hébergées sur la chaîne YouTube officielle et le canal Telegram — Pesce Studio ne stocke que les références.</p>
</div>`;
  }

  // — Actions existantes (publication, brouillons, directs, Telegraph, soutiens, messages).
  // Clé d'idempotence : le serveur persiste la publication canonique AVANT la diffusion
  // Telegram — une reprise (même clé) retrouve la même publication, jamais de doublon.
  let pendingPublishKey = null;
  function nextPublishKey() {
    if (!pendingPublishKey) pendingPublishKey = `mini:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    return pendingPublishKey;
  }

  async function publishFromStudio(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = form.querySelector('#articleTitle')?.value.trim() || '';
    const text = form.querySelector('#publishText')?.value.trim() || '';
    const status = document.getElementById('publishStatus');
    const button = document.getElementById('publishSubmit');
    if (!text) return;
    button.disabled = true; button.textContent = 'Publication…';
    try {
      const response = await studioAction({ action: title ? 'article_publish' : 'publish', text, publishKey: nextPublishKey(), ...(title ? { title } : {}), ...(activeDraftId ? { draftId: activeDraftId } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Publication impossible.');
      activeDraftId = null; // publication réussie : le brouillon a été retiré côté serveur
      pendingPublishKey = null;
      form.reset();
      status.textContent = data.distributed === false
        ? 'PUBLICATION RÉUSSIE — la publication est disponible dans Pesce Studio. La diffusion Telegram a échoué (relançable depuis le Studio web).'
        : (title
          ? 'PUBLICATION RÉUSSIE — l’article est disponible dans Pesce Studio et le Mini App, et diffusé sur Telegram.'
          : 'PUBLICATION RÉUSSIE — la publication est disponible dans Pesce Studio et le Mini App, et diffusée sur Telegram.');
      refreshBat();
      setTimeout(load, 700);
    } catch (error) {
      // Persistance canonique d'abord : une erreur signifie que RIEN n'a été publié —
      // la reprise (même clé) ne peut créer aucun doublon.
      status.textContent = error.message || 'Publication impossible — réessayez.';
    }
    finally { button.disabled = false; button.textContent = 'Publier'; }
  }

  async function saveDraft() {
    const text = document.getElementById('publishText')?.value.trim() || '';
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
    finally { button.disabled = false; button.textContent = "Enregistrer l'ébauche"; }
  }

  async function deleteDraftRow(button) {
    const draftId = button.dataset.draftId;
    if (!draftId) return;
    button.disabled = true; button.textContent = 'Suppression…';
    try {
      const response = await studioAction({ action: 'draft_delete', draftId });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Suppression impossible.');
      await load();
    } catch (error) { popup('Suppression impossible', error.message || 'Réessayez dans un instant.'); }
    finally { button.disabled = false; button.textContent = 'Supprimer'; }
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

  function resetLiveForm() {
    editingLiveId = null;
    const form = document.getElementById('liveForm');
    if (form) form.reset();
    const button = document.getElementById('liveSubmit');
    if (button) button.textContent = 'Planifier le direct';
    const status = document.getElementById('liveStatusText');
    if (status) status.textContent = '';
  }

  function editLive(button) {
    const liveId = button.dataset.liveId;
    const live = (currentLives || []).find((item) => item.id === liveId);
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
    const liveId = button.dataset.liveId;
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
    const card = button.closest('[data-ticket]');
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
    const card = button.closest('[data-ticket]');
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

  // Remboursement en deux temps (confirmation locale) : le premier clic arme le bouton, le second exécute.
  async function refundPayment(button) {
    const paymentId = button.dataset.payment;
    if (!paymentId) return;
    if (!button.dataset.armed) {
      button.dataset.armed = '1';
      button.textContent = 'Confirmer le remboursement';
      setTimeout(() => {
        if (button.dataset.armed) { delete button.dataset.armed; button.textContent = 'Rembourser'; }
      }, 6000);
      return;
    }
    delete button.dataset.armed;
    button.disabled = true; button.textContent = 'Remboursement…';
    try {
      const response = await studioAction({ action: 'refund', paymentId });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Remboursement impossible.');
      await load();
    } catch (error) { popup('Remboursement impossible', error.message || 'Réessayez dans un instant.'); }
    finally { button.disabled = false; button.textContent = 'Rembourser'; }
  }

  // Retrait (rappel) d'une publication depuis la médiathèque : deux étapes pour éviter tout
  // retrait accidentel — la publication quitte le Mini App et la médiathèque immédiatement.
  async function recallFromMediatheque(button) {
    const postId = button.dataset.recall;
    if (!postId) return;
    if (!button.dataset.armed) {
      button.dataset.armed = '1';
      button.textContent = 'Confirmer le retrait';
      setTimeout(() => {
        if (button.dataset.armed) { delete button.dataset.armed; button.textContent = 'Retirer'; }
      }, 6000);
      return;
    }
    delete button.dataset.armed;
    button.disabled = true; button.textContent = 'Retrait…';
    try {
      const response = await studioAction({ action: 'recall_post', postId });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Retrait impossible.');
      await load();
    } catch (error) { popup('Retrait impossible', error.message || 'Réessayez dans un instant.'); }
    finally { button.disabled = false; button.textContent = 'Retirer'; }
  }

  // — Liaison des événements (identifiants et actions identiques à l'existant).
  // La médiathèque est déléguée sur #studioBody : ses filtres survivent aux re-rendus sans double liaison.
  function bindStudioEvents() {
    const body = document.getElementById('studioBody');
    if (body && !body.dataset.studioDelegated) {
      body.dataset.studioDelegated = '1';
      body.addEventListener('click', (event) => {
        const mediaFilterButton = event.target.closest('.media-filter');
        if (mediaFilterButton) {
          mediaFilter = mediaFilterButton.dataset.mediaFilter;
          const section = document.getElementById('studioMediaSection');
          if (section) section.outerHTML = renderMediaSection();
          return;
        }
        const studioLink = event.target.closest('[data-studio-link]');
        if (studioLink) { openExternal(studioLink.dataset.studioLink); return; }
        const recallButton = event.target.closest('.recall-post');
        if (recallButton) { recallFromMediatheque(recallButton); return; }
      });
    }
    document.querySelectorAll('[data-studio-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.studioTab)));
    document.querySelectorAll('[data-studio-tab-goto]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.studioTabGoto)));
    document.querySelectorAll('[data-studio-scroll]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById(button.dataset.studioScroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.getElementById('studioBackToJournal')?.addEventListener('click', close);
    document.querySelectorAll('.desk-mode').forEach((button) => button.addEventListener('click', () => switchDeskMode(button.dataset.deskMode)));
    document.querySelectorAll('.format-pill').forEach((button) => button.addEventListener('click', () => {
      formatLabel = button.dataset.format;
      document.querySelectorAll('.format-pill').forEach((pill) => {
        const active = pill.dataset.format === formatLabel;
        pill.classList.toggle('bg-on-surface', active);
        pill.classList.toggle('text-surface-container-lowest', active);
        pill.classList.toggle('shadow-sm', active);
        pill.classList.toggle('bg-surface-container-high', !active);
        pill.classList.toggle('text-on-surface-variant', !active);
      });
      const format = FORMATS.find((item) => item.label === formatLabel);
      const title = document.getElementById('articleTitle');
      if (format && title) title.placeholder = format.placeholder;
      refreshBat();
    }));
    document.getElementById('publishForm')?.addEventListener('submit', publishFromStudio);
    document.getElementById('publishSubmit')?.addEventListener('click', () => document.getElementById('publishForm')?.requestSubmit());
    document.getElementById('draftButton')?.addEventListener('click', saveDraft);
    document.getElementById('backfillSupportButton')?.addEventListener('click', backfillSupport);
    document.getElementById('telegraphSetupButton')?.addEventListener('click', telegraphSetup);
    document.getElementById('liveForm')?.addEventListener('submit', submitLive);
    document.querySelectorAll('.live-edit').forEach((button) => button.addEventListener('click', () => editLive(button)));
    document.querySelectorAll('.live-cancel').forEach((button) => button.addEventListener('click', () => cancelLive(button)));
    document.querySelectorAll('.payment-refund').forEach((button) => button.addEventListener('click', () => refundPayment(button)));
    document.querySelectorAll('.draft-delete').forEach((button) => button.addEventListener('click', () => deleteDraftRow(button)));
    document.querySelectorAll('.draft-load').forEach((button) => button.addEventListener('click', () => {
      activeDraftId = button.dataset.draftId || null;
      const input = document.getElementById('publishText');
      const title = document.getElementById('articleTitle');
      if (title) title.value = '';
      if (input) input.value = button.dataset.draft || '';
      switchTab('rediger');
    }));
    document.querySelectorAll('.ticket-reply').forEach((button) => button.addEventListener('click', () => replyTicket(button)));
    document.querySelectorAll('.ticket-resolve').forEach((button) => button.addEventListener('click', () => resolveTicket(button)));
    document.getElementById('publishText')?.addEventListener('input', () => {
      const words = document.getElementById('publishWords');
      if (words) words.textContent = `${wordCount(document.getElementById('publishText').value).toLocaleString('fr-FR')} mot${wordCount(document.getElementById('publishText').value) > 1 ? 's' : ''}`;
      refreshBat();
    });
    document.getElementById('articleTitle')?.addEventListener('input', refreshBat);
    if (currentTab === 'rediger') refreshBat();
  }

  function switchDeskMode(mode) {
    const viewRedaction = document.getElementById('view-redaction');
    const viewBat = document.getElementById('view-bat');
    if (!viewRedaction || !viewBat) return;
    document.querySelectorAll('.desk-mode').forEach((button) => {
      const active = button.dataset.deskMode === mode;
      button.classList.toggle('bg-surface-container-lowest', active);
      button.classList.toggle('text-on-surface', active);
      button.classList.toggle('shadow-sm', active);
      button.classList.toggle('font-semibold', active);
      button.classList.toggle('text-on-surface-variant', !active);
    });
    viewRedaction.classList.toggle('hidden', mode !== 'redaction');
    viewRedaction.classList.toggle('flex', mode === 'redaction');
    viewBat.classList.toggle('hidden', mode !== 'bat');
    viewBat.classList.toggle('flex', mode === 'bat');
    if (mode === 'bat') refreshBat();
  }

  window.PesceStudio = Object.freeze({ open, close });
})();
