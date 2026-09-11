// Studio créatrice WEB (/studio) — portail de bureau pour créer, gérer et publier le contenu.
// Authentification : Google Sign-In, vérifié et autorisé CÔTÉ SERVEUR (/api/studio-auth) ;
// session HttpOnly/Secure/SameSite adossée à Neon. Aucune donnée privée n'est rendue ni
// récupérée avant l'authentification. Les actions passent par les MÊMES APIs que le Studio
// Telegram (/api/studio, /api/content, /api/live) — aucune couche de synchronisation.
(function () {
  const PREVIEW = Boolean(window.__PESCE_WEB_PREVIEW__);
  const PESCE = window.PESCE;

  const TABS = ['bureau', 'rediger', 'brouillons', 'ecrits', 'videos', 'audios', 'photos', 'telegraph', 'directs', 'messages', 'audience', 'parametres'];
  let currentTab = 'bureau';
  let studioData = null;
  let posts = [];           // publications du canal (réelles, /api/content)
  let formatLabel = 'Grande Enquête';
  let editingLiveId = null;
  let sessionEmail = '';
  let articleImages = []; // images d'article (hébergées par Telegraph), état du pupitre

  const FORMATS = [
    { label: 'Grande Enquête', placeholder: 'Inscrire un titre percutant…' },
    { label: 'Chronique / Opinion', placeholder: 'Titre de la chronique…' },
    { label: 'Dépêche Telegram', placeholder: 'Écrivez votre dépêche…' },
    { label: 'Entretien', placeholder: 'Titre de l’entretien…' },
    { label: 'Note de terrain', placeholder: 'Titre de la note…' },
  ];

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    return date && !isNaN(date) ? date.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'date inconnue';
  }

  function wordCount(text) { return String(text || '').split(/\s+/).filter(Boolean).length; }
  function topicLabel(value) {
    const topic = (PESCE?.SUPPORT_TOPICS || []).find((item) => item.value === value);
    return topic ? topic.label : value || '';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    if (response.status === 401) { showLogin(); throw new Error('Session expirée.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Requête impossible.');
    return data;
  }

  function studioAction(body) {
    return fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  function showLogin(message) {
    document.getElementById('studioShell').hidden = true;
    document.getElementById('studioLogin').hidden = false;
    if (message) {
      const box = document.getElementById('loginError');
      const text = document.getElementById('loginErrorText');
      if (box && text) { box.hidden = false; text.textContent = message; }
    }
  }

  async function enterShell() {
    document.getElementById('studioLogin').hidden = true;
    document.getElementById('studioShell').hidden = false;
    document.getElementById('studioShell').classList.remove('hidden');
    await load();
  }

  // — Authentification Google (côté client : bouton et jeton ; toute vérification est serveur).
  // Le script GIS est chargé en différé : on réessaie jusqu'à ce qu'il soit disponible.
  async function initGoogleButton(attempt = 0) {
    if (PREVIEW) return;
    const hint = document.getElementById('loginHint');
    const config = await fetch('/api/studio-auth?action=config').then((response) => response.json()).catch(() => ({ clientId: null }));
    if (!config.clientId) {
      // Incident de configuration : erreur technique discrète, jamais de détail d'infrastructure.
      if (hint) hint.textContent = 'La connexion est momentanément indisponible — réessayez dans un instant.';
      return;
    }
    if (typeof google === 'undefined' || !google?.accounts) {
      if (attempt < 6) { setTimeout(() => initGoogleButton(attempt + 1), 1200); return; }
      if (hint) hint.textContent = 'La connexion est momentanément indisponible — réessayez dans un instant.';
      return;
    }
    try {
      // use_fedcm_for_prompt : flux FedCM de Google Identity Services (migration officielle) —
      // garantit que le clic du bouton aboutit même lorsque les cookies tiers sont bloqués.
      google.accounts.id.initialize({ client_id: config.clientId, locale: 'fr', use_fedcm_for_prompt: true, callback: (response) => handleGoogleCredential(response?.credential || (typeof response === 'string' ? response : '')) });
      google.accounts.id.renderButton(document.getElementById('gsiContainer'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 280 });
    } catch {
      if (hint) hint.textContent = 'La connexion est momentanément indisponible — réessayez dans un instant.';
    }
  }

  // Après un jeton Google accepté, on ne dépend PAS d'un rechargement : la session est
  // immédiatement vérifiée puis le Bureau s'ouvre directement (rechargement en repli).
  async function handleGoogleCredential(credential) {
    const hint = document.getElementById('loginHint');
    if (!credential) { showLogin('Connexion impossible — jeton Google manquant.'); return; }
    if (hint) hint.textContent = 'Connexion en cours…';
    try {
      const response = await fetch('/api/studio-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'login', credential }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) { showLogin('Ce compte Google n’est pas autorisé à accéder au Studio. Seul l’administrateur du Studio peut entrer.'); return; }
      if (!response.ok) { console.warn('studio login refused', response.status, data.message || ''); showLogin(data.message || 'Connexion impossible — réessayez.'); return; }
      // Succès : la session (cookie HttpOnly) est posée — on l'utilise immédiatement.
      try {
        const sessionResponse = await fetch('/api/studio-auth?action=session', { cache: 'no-store', credentials: 'include' });
        if (sessionResponse.ok) { await enterShell(); return; }
      } catch (error) { console.warn('studio session check failed', error); }
      location.reload();
    } catch (error) {
      console.warn('studio login failed', error);
      showLogin('Connexion impossible — réessayez dans un instant.');
    }
  }

  window.PesceWebStudio = Object.freeze({ handleGoogleCredential, showLogin });

  // — Chargement des données réelles (mêmes APIs que le Studio Telegram).
  async function load() {
    const body = document.getElementById('webStudioBody');
    if (!body) return;
    body.innerHTML = '<div class="p-space-lg flex flex-col items-center gap-space-sm text-center"><span class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></span><p class="font-body-sm text-body-sm text-on-surface-variant">Chargement du bureau…</p></div>';
    try {
      studioData = await api('/api/studio', { cache: 'no-store' });
      try {
        const content = await api('/api/content?limit=50', { cache: 'no-store' });
        posts = Array.isArray(content.posts) ? content.posts : [];
      } catch { posts = []; }
      try {
        const session = await api('/api/studio-auth?action=session', { cache: 'no-store' });
        sessionEmail = session.email || '';
      } catch { sessionEmail = ''; }
      const emailEl = document.getElementById('webSessionEmail');
      if (emailEl) emailEl.textContent = sessionEmail ? `Connecté : ${sessionEmail}` : '';
      body.innerHTML = TABS.map(renderTab).join('');
      bindEvents();
      switchTab('bureau');
    } catch (error) {
      body.innerHTML = `<div class="p-space-lg flex flex-col items-center gap-space-sm text-center"><span class="material-symbols-outlined text-[28px] text-on-surface-variant">warning</span><p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(error.message)}</p></div>`;
    }
  }

  function renderTab(tab) {
    return `<section class="hidden w-full max-w-5xl mx-auto px-gutter-mobile py-space-lg flex-col gap-space-lg" data-web-pane="${tab}">${renderers[tab]()}</section>`;
  }

  const renderers = {
    bureau: renderBureau,
    rediger: renderRediger,
    brouillons: renderBrouillons,
    ecrits: () => renderPostList('text', 'Écrits'),
    videos: renderVideos,
    audios: renderAudios,
    photos: () => renderPostList('photo', 'Photos'),
    telegraph: renderTelegraph,
    directs: renderDirects,
    messages: renderMessages,
    audience: renderAudience,
    parametres: renderParametres,
  };

  function switchTab(tab) {
    if (!TABS.includes(tab)) tab = 'bureau';
    currentTab = tab;
    document.querySelectorAll('[data-web-tab]').forEach((button) => {
      button.classList.toggle('web-active', button.dataset.webTab === tab);
      button.classList.toggle('text-on-surface', button.dataset.webTab === tab);
      button.classList.toggle('text-on-surface-variant', button.dataset.webTab !== tab);
    });
    document.querySelectorAll('[data-web-pane]').forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.webPane !== tab);
      pane.classList.toggle('flex', pane.dataset.webPane === tab);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // — BUREAU : vue d'ensemble réelle, « Rédiger » en action principale.
  function renderBureau() {
    const totals = studioData?.totals || {};
    const audience = studioData?.audience || {};
    const drafts = studioData?.drafts || [];
    const tickets = studioData?.openTickets || 0;
    const upcoming = (studioData?.liveSchedules || []).filter((live) => live.status === 'live' || live.status === 'scheduled');
    const nextLive = upcoming[0] || null;
    return `
<div class="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-1">
<span class="font-kicker-label text-kicker-label text-primary uppercase">Carnet de bord</span>
<h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Bonjour, Pesce.</h1>
<p class="font-body-md text-body-md text-on-surface-variant">Voici votre espace pour créer, gérer et publier le contenu de Pesce — synchronisé avec le canal Telegram et la base Neon.</p>
<button class="self-start mt-space-sm inline-flex items-center gap-2 px-space-md py-3 bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-wider hover:bg-primary transition-colors rounded-lg" type="button" data-web-tab-goto="rediger"><span class="material-symbols-outlined text-[20px]">edit_square</span> Rédiger une publication</button>
</div>
<div class="grid grid-cols-2 md:grid-cols-4 gap-space-sm">
${renderKpi('auto_stories', Number(totals.total || 0).toLocaleString('fr-FR'), 'Publications au canal')}
${renderKpi('drafts', String(drafts.length), 'Brouillon' + (drafts.length > 1 ? 's' : ''))}
${renderKpi('podium', nextLive ? liveShortDate(nextLive.scheduledAt) : 'Aucun', 'Direct programmé')}
${renderKpi('mark_email_unread', String(tickets), 'Message' + (tickets > 1 ? 's' : '') + ' ouvert' + (tickets > 1 ? 's' : ''))}
${renderKpi('send', Number(audience.opens || 0).toLocaleString('fr-FR'), 'Ouvertures Pesce Studio')}
${renderKpi('group', Number(audience.uniqueUsers || 0).toLocaleString('fr-FR'), 'Visiteurs uniques')}
${renderKpi('star', Number(studioData?.stars || 0).toLocaleString('fr-FR'), 'Telegram Stars reçues')}
${renderKpi('history_edu', String(drafts.length + Number(totals.total || 0)), 'Ébauches & publications')}
</div>
<div class="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
<section class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
<div class="flex items-center justify-between">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Chantiers d'écriture</h2>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${drafts.length} ébauche${drafts.length > 1 ? 's' : ''}</span>
</div>
${drafts.length ? drafts.slice(0, 3).map(renderDraftCard).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aucun brouillon pour le moment — commencez par « Rédiger ».</p>'}
<button class="self-start mt-space-xs px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button" data-web-tab-goto="brouillons">Tous les brouillons</button>
</section>
<section class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
<div class="flex items-center justify-between">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Direct à venir</h2>
${nextLive ? '<span class="px-2 py-0.5 rounded bg-primary-container/15 text-primary font-meta-detail text-[0.6875rem] font-bold">Programmé</span>' : ''}
</div>
${nextLive ? `<div class="p-space-md bg-on-secondary-fixed text-surface rounded-lg flex flex-col gap-space-xs">
<span class="font-kicker-label text-[0.6875rem] text-primary-fixed uppercase tracking-wider">${nextLive.status === 'live' ? 'En direct maintenant' : 'Diffusion programmée'}</span>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-surface-bright">${escapeHtml(nextLive.title)}</h3>
<p class="font-body-sm text-body-sm text-secondary-fixed-dim">${nextLive.description ? escapeHtml(nextLive.description) : 'Canal Telegram' + (nextLive.link ? ' · lien YouTube fourni' : '')} · ${escapeHtml(liveLongDate(nextLive.scheduledAt))}</p>
</div>` : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aucun direct programmé.</p>'}
<button class="self-start mt-space-xs px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button" data-web-tab-goto="directs">Gérer les directs</button>
</section>
</div>
`;
  }

  function renderKpi(icon, value, label) {
    return `<div class="p-space-md bg-surface-container-lowest rounded-xl shadow-sm flex items-center gap-space-sm">
<span class="material-symbols-outlined text-[22px] text-primary">${icon}</span>
<div class="flex flex-col min-w-0">
<span class="font-headline-sm text-[1.1rem] leading-none text-on-surface">${escapeHtml(value)}</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant truncate mt-1">${escapeHtml(label)}</span>
</div>
</div>`;
  }

  function liveShortDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || isNaN(date)) return '—';
    return `${date.toLocaleString('fr-FR', { weekday: 'short' })}. ${String(date.getHours()).padStart(2, '0')}h`;
  }

  function liveLongDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || isNaN(date)) return '';
    return `${date.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')} GMT`;
  }

  function renderDraftCard(draft) {
    const lines = String(draft.text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const title = lines[0]?.slice(0, 90) || 'Brouillon sans titre';
    return `<article class="p-space-md bg-surface-container-low rounded-lg flex flex-col gap-space-xs">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-[0.6875rem] text-primary uppercase">Brouillon</span>
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant">${formatDate(draft.updatedAt || draft.createdAt)}</span>
</div>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-on-surface">${escapeHtml(title)}</h3>
<div class="pt-1 flex items-center justify-between">
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant">${wordCount(draft.text).toLocaleString('fr-FR')} mots</span>
<div class="flex gap-space-xs">
<button class="draft-load px-space-sm py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-draft="${escapeAttribute(draft.text || '')}">Reprendre</button>
<button class="draft-delete px-space-sm py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-draft-id="${escapeAttribute(draft.id)}">Supprimer</button>
</div>
</div>
</article>`;
  }

  // — RÉDIGER : pupitre principal (publication Telegram ou article Telegraph), aperçu BAT réel.
  function renderRediger() {
    const format = FORMATS.find((item) => item.label === formatLabel) || FORMATS[0];
    return `
<div class="flex items-center justify-between">
<div>
<span class="font-kicker-label text-kicker-label text-primary uppercase">Pupitre d'écriture</span>
<h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Rédiger</h1>
</div>
<div class="inline-flex p-1 bg-surface-variant rounded-lg">
<button class="desk-mode px-space-sm py-2 rounded font-body-sm text-body-sm bg-surface-container-lowest text-on-surface shadow-sm font-semibold" type="button" data-desk-mode="redaction">Rédaction</button>
<button class="desk-mode px-space-sm py-2 rounded font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface" type="button" data-desk-mode="bat">Épreuve BAT</button>
</div>
</div>
<div class="grid grid-cols-1 xl:grid-cols-2 gap-space-lg">
<div class="flex flex-col gap-space-md" id="view-redaction">
<div class="flex flex-col gap-space-xs">
<label class="font-kicker-label text-kicker-label text-on-surface-variant uppercase">Type d'écrit éditorial</label>
<div class="flex items-center gap-space-xs overflow-x-auto pb-1 no-scrollbar">
${FORMATS.map((entry) => `<button class="format-pill px-3 py-2 rounded-lg font-meta-detail text-meta-detail ${entry.label === formatLabel ? 'bg-on-surface text-surface-container-lowest shadow-sm' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-variant'} whitespace-nowrap" type="button" data-format="${escapeAttribute(entry.label)}">${escapeHtml(entry.label)}</button>`).join('')}
</div>
</div>
<form id="publishForm" class="flex flex-col gap-space-md">
<div class="flex flex-col gap-space-xs">
<label class="font-kicker-label text-kicker-label text-on-surface-variant uppercase" for="articleTitle">Titre de l'article</label>
<input id="articleTitle" class="editorial-input" type="text" maxlength="256" placeholder="${escapeAttribute(format.placeholder)}">
<p class="font-meta-detail text-meta-detail text-on-surface-variant text-[11px]">Avec un titre : votre texte devient un article Telegraph (telegra.ph), lu en Instant View, publié avec le bouton ⭐ Soutenir. Sans titre : publication texte simple.</p>
</div>
<div class="flex flex-col gap-space-xs">
<label class="font-kicker-label text-kicker-label text-on-surface-variant uppercase">Média de l'article</label>
<div id="articleMediaList" class="flex flex-col gap-space-sm"></div>
<button id="mediaAddButton" class="self-start px-space-md py-2.5 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button"><span class="material-symbols-outlined text-[18px] align-middle">add_photo_alternate</span> Ajouter un média</button>
<div id="mediaAddPanel" class="hidden w-full bg-surface-container-low rounded-lg p-space-md flex flex-col gap-space-sm">
<div class="flex items-center gap-space-sm flex-wrap">
<button id="mediaChannelPick" class="px-space-md py-2.5 border border-outline-variant rounded-lg bg-surface-container-lowest font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button">Choisir une photo du canal</button>
<button id="mediaUploadPick" class="px-space-md py-2.5 border border-outline-variant rounded-lg bg-surface-container-lowest font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button">Téléverser une image</button>
<input id="mediaFileInput" class="hidden" type="file" accept="image/jpeg,image/png,image/gif,image/webp">
</div>
<div id="mediaPickerGrid" class="hidden grid grid-cols-3 md:grid-cols-4 gap-space-sm"></div>
<p class="font-meta-detail text-meta-detail text-on-surface-variant text-[11px]">Les images sont hébergées par Telegraph et apparaissent dans l'article publié (couverture en tête, images insérées après le paragraphe choisi).</p>
</div>
</div>
<div class="flex flex-col gap-space-xs">
<label class="font-kicker-label text-kicker-label text-on-surface-variant uppercase" for="publishText">Corps du tapuscrit</label>
<textarea id="publishText" class="editorial-input" rows="16" maxlength="4096" placeholder="Écrivez votre publication…" required></textarea>
<div class="flex items-center justify-between pt-space-xs text-on-surface-variant font-meta-detail text-meta-detail">
<span id="publishWords">0 mot</span>
<span class="flex items-center gap-1 text-primary"><span class="material-symbols-outlined text-[1rem]">check_circle</span> Publication directe sur le canal</span>
</div>
</div>
<div class="flex flex-col sm:flex-row items-stretch gap-space-sm">
<button id="publishSubmit" class="flex-1 py-3 px-space-md bg-on-secondary-fixed text-surface font-body-sm text-body-sm font-bold uppercase tracking-wider rounded-lg hover:bg-primary-container transition-colors flex items-center justify-center gap-2" type="button"><span class="material-symbols-outlined text-[1.2rem]">send</span> Publier sur Telegram</button>
<button id="draftButton" class="sm:w-auto py-3 px-space-md bg-surface-container-lowest border border-outline-variant text-on-surface font-body-sm text-body-sm font-medium rounded-lg transition-colors flex items-center justify-center" type="button">Enregistrer l'ébauche</button>
</div>
<p id="publishStatus" class="form-status" aria-live="polite"></p>
</form>
</div>
<div class="hidden flex-col gap-space-md" id="view-bat">
<div class="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-sm h-fit">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-kicker-label text-primary uppercase">Rendu Épreuve Finale (BAT)</span>
<span class="bg-primary/10 text-primary px-2 py-0.5 rounded font-meta-detail text-meta-detail font-medium" id="batFormatBadge">Format Telegraph / Instant View</span>
</div>
<article class="bg-surface-container-lowest p-space-lg rounded-lg shadow-sm flex flex-col gap-space-sm" id="batPreview"></article>
</div>
</div>
</div>
<div class="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-md h-fit">
<div class="flex items-center gap-space-xs text-primary font-headline-sm text-headline-sm"><span class="material-symbols-outlined text-[1.4rem]">verified</span><span>Épreuve &amp; Pipeline de distribution</span></div>
<p class="font-body-sm text-body-sm text-on-surface-variant">Cette publication sera synchronisée sur le canal officiel <strong class="text-on-surface">${escapeHtml(channelHandle())}</strong> — et archivée en article Telegraph si un titre est fourni.</p>
<div class="flex flex-col gap-space-xs bg-surface-container-lowest p-space-md rounded-lg">
<label class="flex items-center gap-space-sm cursor-pointer"><input checked class="w-4 h-4 rounded text-primary accent-primary" type="checkbox"><span class="font-body-sm text-body-sm text-on-surface font-medium">Titre et texte vérifiés</span></label>
<label class="flex items-center gap-space-sm cursor-pointer"><input checked class="w-4 h-4 rounded text-primary accent-primary" type="checkbox"><span class="font-body-sm text-body-sm text-on-surface font-medium">Conformité à la charte déontologique du Studio</span></label>
<label class="flex items-center gap-space-sm cursor-pointer"><input class="w-4 h-4 rounded text-primary accent-primary" type="checkbox"><span class="font-body-sm text-body-sm text-on-surface font-medium">Canal cible : <span class="text-primary font-semibold">${escapeHtml(channelHandle())}</span></span></label>
</div>
</div>
`;
  }

  function channelHandle() {
    return PESCE?.CHANNEL_HANDLE || 'le canal officiel';
  }

  function refreshBat() {
    const preview = document.getElementById('batPreview');
    const badge = document.getElementById('batFormatBadge');
    const title = document.getElementById('articleTitle')?.value.trim() || '';
    const text = document.getElementById('publishText')?.value.trim() || '';
    if (!preview || !badge) return;
    const paragraphs = text.split('\n\n').map((paragraph) => paragraph.trim()).filter(Boolean);
    const images = collectArticleImages();
    const cover = images.find((image) => image.placement === 'cover');
    const inline = images.filter((image) => image.placement !== 'cover');
    const figureHtml = (image) => `<figure class="my-space-sm"><img class="w-full rounded-lg" src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.caption || 'Image d\'article')}">${(image.caption || image.credit) ? `<figcaption class="font-meta-detail text-meta-detail text-on-surface-variant mt-1 text-center italic">${escapeHtml([image.caption, image.credit].filter(Boolean).join(' — '))}</figcaption>` : ''}</figure>`;
    if (title) {
      badge.textContent = 'Format Telegraph / Instant View';
      const bodyParts = [];
      paragraphs.forEach((paragraph, index) => {
        const html = `<p class="font-body-md text-body-md text-on-surface leading-relaxed">${escapeHtml(paragraph.slice(0, 400))}</p>`;
        if (index === 0) bodyParts.push(`<p class="font-editorial-standfirst text-editorial-standfirst italic text-tertiary">${escapeHtml(paragraph.slice(0, 240))}</p>`);
        else bodyParts.push(html);
        for (const image of inline.filter((item) => item.afterParagraph === index + 1)) bodyParts.push(figureHtml(image));
      });
      for (const image of inline.filter((item) => item.afterParagraph > paragraphs.length)) bodyParts.push(figureHtml(image));
      preview.innerHTML = `<span class="font-kicker-label text-kicker-label text-primary uppercase tracking-widest">${escapeHtml(formatLabel.toUpperCase())}</span>
<h1 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h1>
${cover ? figureHtml(cover) : ''}
${bodyParts.join('')}
<p class="font-meta-detail text-meta-detail text-on-surface-variant pt-space-xs">Publié ensuite sur le canal avec le bouton ⭐ Soutenir.</p>`;
    } else {
      badge.textContent = 'Dépêche Telegram (texte simple)';
      preview.innerHTML = paragraphs.length
        ? `<span class="font-kicker-label text-kicker-label text-primary uppercase tracking-widest">DÉPÊCHE TELEGRAM</span>${paragraphs.map((paragraph) => `<p class="font-body-md text-body-md text-on-surface leading-relaxed">${escapeHtml(paragraph.slice(0, 400))}</p>`).join('')}${images.length ? '<p class="font-meta-detail text-meta-detail text-on-surface-variant pt-space-xs">Les images nécessitent un titre (article Telegraph).</p>' : '<p class="font-meta-detail text-meta-detail text-on-surface-variant pt-space-xs">Envoyée telle quelle sur le canal.</p>'}`
        : '<p class="font-body-md text-body-md text-on-surface-variant">Commencez à écrire : l\'épreuve apparaîtra ici.</p>';
    }
  }

  // — MÉDIA DE L'ARTICLE : hébergement Telegraph (couverture + images insérées).
  function collectArticleImages() {
    return articleImages.map((image) => {
      const caption = document.getElementById(`img-caption-${image.id}`)?.value ?? image.caption;
      const credit = document.getElementById(`img-credit-${image.id}`)?.value ?? image.credit;
      const after = document.getElementById(`img-after-${image.id}`)?.value;
      return {
        src: image.src,
        url: image.url,
        caption: String(caption || '').trim(),
        credit: String(credit || '').trim(),
        placement: image.placement,
        afterParagraph: Math.max(1, Math.min(Number(after) || image.afterParagraph || 1, 99)),
      };
    });
  }

  function renderMediaList() {
    const list = document.getElementById('articleMediaList');
    if (!list) return;
    list.innerHTML = articleImages.map((image) => `<article class="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-space-xs" data-media-id="${image.id}">
<div class="flex items-center gap-space-sm">
<img class="w-16 h-16 rounded object-cover bg-surface-container-high shrink-0" src="${escapeAttribute(image.url)}" alt="Image d'article">
<div class="flex flex-col gap-1 min-w-0 flex-1">
<input id="img-caption-${image.id}" class="editorial-input" type="text" maxlength="1000" placeholder="Légende de l'image" value="${escapeAttribute(image.caption)}">
<input id="img-credit-${image.id}" class="editorial-input" type="text" maxlength="300" placeholder="Crédit / source (ex. Pesce Hounyo)" value="${escapeAttribute(image.credit)}">
</div>
<button class="media-remove shrink-0 px-space-sm py-2 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-media-remove="${image.id}">Retirer</button>
</div>
<div class="flex items-center gap-space-sm flex-wrap">
<button class="media-cover px-space-sm py-2 rounded-lg font-kicker-label text-kicker-label uppercase ${image.placement === 'cover' ? 'bg-on-surface text-surface' : 'bg-surface-container-high text-on-surface-variant'}" type="button" data-media-cover="${image.id}">Image de couverture</button>
<button class="media-inline px-space-sm py-2 rounded-lg font-kicker-label text-kicker-label uppercase ${image.placement !== 'cover' ? 'bg-on-surface text-surface' : 'bg-surface-container-high text-on-surface-variant'}" type="button" data-media-inline="${image.id}">Insérer dans l'article</button>
${image.placement !== 'cover' ? `<span class="flex items-center gap-1 font-meta-detail text-meta-detail text-on-surface-variant"><label class="font-kicker-label text-kicker-label uppercase" for="img-after-${image.id}">Après le paragraphe</label><input id="img-after-${image.id}" class="editorial-input w-16 text-center" type="number" min="1" max="99" value="${image.afterParagraph}"></span>` : ''}
</div>
</article>`).join('');
  }

  function bindMediaEvents() {
    const panel = document.getElementById('mediaAddPanel');
    const fileInput = document.getElementById('mediaFileInput');
    const grid = document.getElementById('mediaPickerGrid');
    document.getElementById('mediaAddButton')?.addEventListener('click', () => panel?.classList.toggle('hidden'));
    document.getElementById('mediaChannelPick')?.addEventListener('click', () => {
      grid?.classList.toggle('hidden');
      if (grid && !grid.dataset.filled) {
        grid.dataset.filled = '1';
        const photos = posts.filter((post) => post.contentType === 'photo' && post.mediaFileId).slice(0, 12);
        grid.innerHTML = photos.length
          ? photos.map((post) => {
            const caption = (post.text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
            return `<button class="media-pick bg-surface-container-lowest rounded-lg overflow-hidden flex flex-col shadow-sm" type="button" data-file-id="${escapeAttribute(post.mediaFileId)}" data-caption="${escapeAttribute(caption.slice(0, 120))}">
<img class="w-full aspect-square object-cover" src="${escapeAttribute(post.mediaUrl || '')}" alt="" loading="lazy">
<span class="p-1 font-meta-detail text-[0.625rem] text-on-surface-variant line-clamp-2 text-left">${escapeHtml(caption.slice(0, 90) || 'Photo du canal')}</span>
</button>`;
          }).join('')
          : '<p class="col-span-3 font-body-sm text-body-sm text-on-surface-variant">Aucune photo sur le canal pour le moment — téléversez une image.</p>';
      }
    });
    document.getElementById('mediaUploadPick')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) uploadArticleImage(file);
      fileInput.value = '';
    });
    grid?.addEventListener('click', (event) => {
      const pick = event.target.closest('.media-pick');
      if (!pick) return;
      const fileId = pick.dataset.fileId;
      if (fileId) addImageFromChannel(fileId, pick.dataset.caption || '');
    });
    document.getElementById('articleMediaList')?.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-media-remove]');
      const cover = event.target.closest('[data-media-cover]');
      const inline = event.target.closest('[data-media-inline]');
      if (remove) {
        articleImages = articleImages.filter((image) => image.id !== remove.dataset.mediaRemove);
        renderMediaList(); refreshBat();
      }
      if (cover) {
        articleImages.forEach((image) => { image.placement = image.id === cover.dataset.mediaCover ? 'cover' : 'inline'; });
        renderMediaList(); refreshBat();
      }
      if (inline) {
        articleImages.forEach((image) => { if (image.id === inline.dataset.mediaInline) image.placement = 'inline'; });
        renderMediaList(); refreshBat();
      }
    });
    document.getElementById('articleMediaList')?.addEventListener('input', (event) => {
      const match = (event.target.id || '').match(/^img-after-(.+)$/);
      if (match) {
        const image = articleImages.find((item) => item.id === match[1]);
        if (image) image.afterParagraph = Math.max(1, Math.min(Number(event.target.value) || 1, 99));
      }
      refreshBat();
    });
    renderMediaList();
  }

  async function uploadArticleImage(file) {
    if (file.size > 4 * 1024 * 1024) { alert('Image trop volumineuse (4 Mo maximum).'); return; }
    const status = document.getElementById('publishStatus');
    if (status) status.textContent = 'Téléversement vers Telegraph…';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const response = await studioAction({ action: 'article_image_upload', data: String(reader.result), filename: file.name });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { showLogin(); return; }
        if (!response.ok) throw new Error(data.message || 'Téléversement impossible.');
        articleImages.push({ id: String(Date.now()) + '-' + articleImages.length, src: data.src, url: data.url, caption: '', credit: '', placement: articleImages.length === 0 ? 'cover' : 'inline', afterParagraph: 1 });
        renderMediaList(); refreshBat();
        if (status) status.textContent = 'Image téléversée vers Telegraph.';
      } catch (error) { if (status) status.textContent = error.message || 'Téléversement impossible.'; }
    };
    reader.readAsDataURL(file);
  }

  async function addImageFromChannel(fileId, caption) {
    const status = document.getElementById('publishStatus');
    if (status) status.textContent = 'Transfert de la photo vers Telegraph…';
    try {
      const response = await studioAction({ action: 'article_image_from_channel', fileId });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Transfert impossible.');
      articleImages.push({ id: String(Date.now()) + '-' + articleImages.length, src: data.src, url: data.url, caption: caption || '', credit: '', placement: articleImages.length === 0 ? 'cover' : 'inline', afterParagraph: 1 });
      renderMediaList(); refreshBat();
      if (status) status.textContent = 'Photo transférée vers Telegraph.';
    } catch (error) { if (status) status.textContent = error.message || 'Transfert impossible.'; }
  }

  // — BROUILLONS : système existant.
  function renderBrouillons() {
    const drafts = studioData?.drafts || [];
    return `
<div class="flex items-center justify-between">
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Tapuscrits</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Brouillons</h1></div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${drafts.length} ébauche${drafts.length > 1 ? 's' : ''}</span>
</div>
${drafts.length ? `<div class="grid grid-cols-1 xl:grid-cols-2 gap-space-md">${drafts.map(renderDraftCard).join('')}</div>` : `<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col items-center gap-space-sm text-center">
<div class="w-12 h-12 bg-surface-container-highest flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-[24px]">drafts</span></div>
<h3 class="font-headline-sm text-headline-sm text-on-surface">Aucun brouillon</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant">Commencez par « Rédiger » : votre ébauche sera enregistrée ici avant publication.</p>
<button class="mt-space-sm px-space-md py-3 bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors rounded-lg" type="button" data-web-tab-goto="rediger">Rédiger une publication</button>
</div>`}`;
  }

  // — ÉCRITS / VIDÉOS / AUDIOS / PHOTOS : publications réelles du canal (mêmes données que le public).
  function renderPostList(type, title) {
    const items = posts.filter((post) => post.contentType === type);
    const kindLabel = { text: 'Écrit', video: 'Vidéo', audio: 'Audio', photo: 'Photo' }[type] || 'Publication';
    return `
<div class="flex items-center justify-between">
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Canal officiel</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">${escapeHtml(title)}</h1></div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${items.length} ${kindLabel.toLowerCase()}${items.length > 1 ? 's' : ''}</span>
</div>
${type === 'text' ? `<div class="bg-surface-container-low rounded-xl p-space-md flex items-center justify-between gap-space-md">
<p class="font-body-sm text-body-sm text-on-surface-variant">Les écrits publiés depuis le canal ou le pupitre apparaissent ici — la source éditoriale reste Telegram.</p>
<button class="shrink-0 px-space-md py-3 bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors rounded-lg" type="button" data-web-tab-goto="rediger">Rédiger</button>
</div>` : ''}
${items.length ? `<div class="grid grid-cols-1 ${type === 'photo' ? 'md:grid-cols-3' : 'xl:grid-cols-2'} gap-space-md">${items.map((post) => renderPostItem(post, type)).join('')}</div>` : `<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm text-center"><p class="font-body-sm text-body-sm text-on-surface-variant">Aucun contenu de ce type sur le canal pour le moment.</p></div>`}
`;
  }

  function renderPostItem(post, type) {
    const headline = (post.text || '').split('\n').map((line) => line.trim()).find(Boolean) || `${type === 'photo' ? 'Photo' : 'Publication'} du ${formatDate(post.publishedAt)}`;
    const mediaUrl = post.mediaUrl || '';
    if (type === 'photo') {
      return `<article class="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col">
${mediaUrl ? `<img class="w-full aspect-square object-cover" src="${escapeAttribute(mediaUrl)}" alt="${escapeAttribute(headline)}" loading="lazy">` : '<div class="w-full aspect-square bg-surface-container-high"></div>'}
<div class="p-space-md flex flex-col gap-1">
<span class="font-kicker-label text-[0.6875rem] text-primary uppercase">Photo</span>
<p class="font-body-sm text-body-sm text-on-surface line-clamp-2">${escapeHtml(headline)}</p>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${formatDate(post.publishedAt)}${post.telegramUrl ? ` · <a class="text-primary font-bold hover:underline" href="${escapeAttribute(post.telegramUrl)}" target="_blank" rel="noopener">Voir sur Telegram</a>` : ''}</span>
${post.mediaFileId ? `<button class="photo-insert self-start mt-1 px-space-md py-2.5 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button" data-photo-insert="${escapeAttribute(post.mediaFileId)}" data-photo-caption="${escapeAttribute(headline.slice(0, 120))}">Insérer dans un article</button>` : ''}
</div>
</article>`;
    }
    if (type === 'video') {
      const youtubeId = youtubeIdOf(post.text || '');
      const frame = mediaUrl
        ? `<video class="w-full" controls preload="metadata" src="${escapeAttribute(mediaUrl)}"${post.mediaThumbnailUrl ? ` poster="${escapeAttribute(post.mediaThumbnailUrl)}"` : ''}></video>`
        : youtubeId
          ? `<a href="https://www.youtube.com/watch?v=${escapeAttribute(youtubeId)}" target="_blank" rel="noopener" aria-label="Ouvrir la vidéo YouTube"><img class="w-full aspect-video object-cover" src="https://i.ytimg.com/vi/${escapeAttribute(youtubeId)}/hqdefault.jpg" alt="${escapeAttribute(headline)}" loading="lazy"></a>`
          : '<div class="w-full aspect-video bg-inverse-surface"></div>';
      return `<article class="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col">
${frame}
<div class="p-space-md flex flex-col gap-1">
<span class="font-kicker-label text-[0.6875rem] text-primary uppercase">Vidéo${post.mediaDuration ? ` · ${escapeHtml(formatDuration(post.mediaDuration))}` : ''}</span>
<p class="font-body-sm text-body-sm text-on-surface line-clamp-2">${escapeHtml(headline)}</p>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${formatDate(post.publishedAt)}${post.telegramUrl ? ` · <a class="text-primary font-bold hover:underline" href="${escapeAttribute(post.telegramUrl)}" target="_blank" rel="noopener">Voir sur Telegram</a>` : ''}</span>
${post.messageId ? `<button class="video-edit self-start mt-1 px-space-md py-2.5 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button" data-video-edit="${escapeAttribute(post.id)}">Modifier</button>` : ''}
</div>
</article>`;
    }
    if (type === 'audio') {
      return `<article class="bg-surface-container-lowest rounded-xl shadow-sm p-space-md flex flex-col gap-space-sm">
<span class="font-kicker-label text-[0.6875rem] text-primary uppercase">Audio${post.mediaDuration ? ` · ${escapeHtml(formatDuration(post.mediaDuration))}` : ''}</span>
<p class="font-body-sm text-body-sm text-on-surface">${escapeHtml(headline)}</p>
${mediaUrl ? `<audio class="w-full" controls preload="none" src="${escapeAttribute(mediaUrl)}"></audio>` : ''}
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${formatDate(post.publishedAt)}${post.telegramUrl ? ` · <a class="text-primary font-bold hover:underline" href="${escapeAttribute(post.telegramUrl)}" target="_blank" rel="noopener">Voir sur Telegram</a>` : ''}</span>
</article>`;
    }
    return `<article class="bg-surface-container-lowest rounded-xl shadow-sm p-space-md flex flex-col gap-space-xs">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-[0.6875rem] text-primary uppercase">Écrit</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${formatDate(post.publishedAt)}</span>
</div>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-on-surface">${escapeHtml(headline)}</h3>
<p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">${escapeHtml((post.text || '').split('\n').slice(1).join(' ').trim().slice(0, 200))}</p>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${post.telegramUrl ? `<a class="text-primary font-bold hover:underline" href="${escapeAttribute(post.telegramUrl)}" target="_blank" rel="noopener">Voir sur Telegram</a>` : 'Canal Telegram'}</span>
</article>`;
  }

  function formatDuration(seconds) {
    const total = Math.round(Number(seconds) || 0);
    if (!total) return '';
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  // — VIDÉOS : YouTube reste l'hébergeur (V1). Le studio publie la référence validée,
  // la miniature est dérivée de l'identifiant — aucun fichier vidéo n'est téléversé.
  const youtubeIdOf = (value) => {
    const source = String(value || '').trim();
    const match = source.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
  };
  let videoEditingMessageId = null;

  function renderVideos() {
    const items = posts.filter((post) => post.contentType === 'video');
    return `
<div class="flex items-center justify-between">
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Canal officiel &amp; YouTube</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Vidéos</h1></div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${items.length} vidéo${items.length > 1 ? 's' : ''}</span>
</div>
<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Ajouter une vidéo</h2>
<p class="font-body-sm text-body-sm text-on-surface-variant">YouTube héberge la vidéo : collez son lien, la miniature est dérivée automatiquement et la publication part sur le canal avec le bouton ⭐ Soutenir.</p>
<form id="videoForm" class="flex flex-col gap-space-md">
<input id="videoTitle" class="editorial-input" type="text" maxlength="256" placeholder="Titre de la vidéo" required>
<textarea id="videoDescription" class="editorial-input" rows="3" maxlength="4000" placeholder="Description (optionnelle)"></textarea>
<input id="videoUrl" class="editorial-input" type="text" maxlength="512" placeholder="Lien YouTube (watch, youtu.be, shorts, embed…)">
<div class="flex items-center gap-space-sm">
<div id="videoPreview" class="hidden w-40 aspect-video rounded-lg overflow-hidden bg-inverse-surface"><img id="videoPreviewImg" class="w-full h-full object-cover" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Aperçu de la vidéo"></div>
<p id="videoUrlStatus" class="font-meta-detail text-meta-detail text-on-surface-variant"></p>
</div>
<div class="flex flex-col sm:flex-row gap-space-sm">
<button id="videoPublish" class="flex-1 py-3 px-space-md bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors rounded-lg" type="button">Publier sur Telegram</button>
<button id="videoDraft" class="sm:w-auto py-3 px-space-md border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">Enregistrer l'ébauche</button>
</div>
<p id="videoStatus" class="form-status" aria-live="polite"></p>
</form>
</div>
${items.length ? `<div class="grid grid-cols-1 xl:grid-cols-2 gap-space-md">${items.map((post) => renderPostItem(post, 'video')).join('')}</div>` : '<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm text-center"><p class="font-body-sm text-body-sm text-on-surface-variant">Aucune vidéo pour le moment — ajoutez-en une ci-dessus.</p></div>'}
`;
  }

  async function publishVideo() {
    const title = document.getElementById('videoTitle')?.value.trim() || '';
    const description = document.getElementById('videoDescription')?.value.trim() || '';
    const youtubeUrl = document.getElementById('videoUrl')?.value.trim() || '';
    const status = document.getElementById('videoStatus');
    const button = document.getElementById('videoPublish');
    if (!title || !youtubeIdOf(youtubeUrl)) { if (status) status.textContent = 'Le titre et un lien YouTube valide sont requis.'; return; }
    button.disabled = true; button.textContent = 'Publication…';
    try {
      const response = await studioAction({ action: videoEditingMessageId ? 'video_update' : 'video_publish', title, description, youtubeUrl, ...(videoEditingMessageId ? { messageId: videoEditingMessageId } : {}) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Publication impossible.');
      if (status) status.textContent = videoEditingMessageId ? 'Vidéo mise à jour sur le canal.' : 'Vidéo publiée sur le canal Telegram — le Mini App la présente en carte avec miniature et bouton ⭐ Soutenir.';
      videoEditingMessageId = null;
      document.getElementById('videoForm')?.reset();
      document.getElementById('videoPreview')?.classList.add('hidden');
      setTimeout(load, 900);
    } catch (error) { if (status) status.textContent = error.message || 'Publication impossible.'; }
    finally { button.disabled = false; button.textContent = 'Publier sur Telegram'; }
  }

  function bindVideoComposer() {
    const urlInput = document.getElementById('videoUrl');
    const preview = document.getElementById('videoPreview');
    const previewImg = document.getElementById('videoPreviewImg');
    const urlStatus = document.getElementById('videoUrlStatus');
    const form = document.getElementById('videoForm');
    urlInput?.addEventListener('input', () => {
      const id = youtubeIdOf(urlInput.value);
      if (id && preview && previewImg) {
        previewImg.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        preview.classList.remove('hidden');
        if (urlStatus) urlStatus.textContent = 'Lien YouTube valide';
      } else {
        preview?.classList.add('hidden');
        if (urlStatus) urlStatus.textContent = urlInput.value ? 'Lien YouTube invalide' : '';
      }
    });
    document.getElementById('videoPublish')?.addEventListener('click', publishVideo);
    document.getElementById('videoDraft')?.addEventListener('click', async () => {
      const title = document.getElementById('videoTitle')?.value.trim() || '';
      const description = document.getElementById('videoDescription')?.value.trim() || '';
      const youtubeUrl = document.getElementById('videoUrl')?.value.trim() || '';
      const status = document.getElementById('videoStatus');
      if (!title && !description && !youtubeUrl) { if (status) status.textContent = 'Rien à enregistrer.'; return; }
      try {
        const response = await studioAction({ action: 'draft', text: `[Vidéo]\n${title}\n\n${description}\n\n${youtubeUrl}` });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { showLogin(); return; }
        if (!response.ok) throw new Error(data.message || 'Impossible d’enregistrer l’ébauche.');
        if (status) status.textContent = `Ébauche ${data.draftId} enregistrée (métadonnées de la vidéo).`;
        form?.reset();
      } catch (error) { if (status) status.textContent = error.message || 'Impossible d’enregistrer l’ébauche.'; }
    });
    document.querySelectorAll('.video-edit').forEach((button) => button.addEventListener('click', () => {
      const post = posts.find((item) => item.id === button.dataset.videoEdit);
      const formTitle = document.getElementById('videoTitle');
      const formDescription = document.getElementById('videoDescription');
      const formUrl = document.getElementById('videoUrl');
      const status = document.getElementById('videoStatus');
      if (!post || !formTitle) return;
      videoEditingMessageId = post.messageId || null;
      formTitle.value = (post.text || '').split('\n')[0]?.trim().slice(0, 256) || '';
      formDescription.value = (post.text || '').split('\n').slice(1).filter((line) => !line.includes('youtu')).join(' ').trim().slice(0, 4000);
      formUrl.value = (post.text || '').match(/(https?:\/\/(?:www\.)?youtu[^\s]+)/)?.[1] || '';
      formUrl.dispatchEvent(new Event('input', { bubbles: true }));
      if (status) status.textContent = 'Modification de la vidéo — publiez pour enregistrer sur le canal.';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  // — AUDIOS : enregistrement navigateur ou import, fichier hébergé par Telegram (canon),
  // Neon ne garde que la référence ; le Mini App joue l'audio via /api/media.
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordTimerId = null;
  let recordStartedAt = 0;
  let audioDataUrl = null;
  let audioFileName = 'note-vocale.webm';

  function renderAudios() {
    const items = posts.filter((post) => post.contentType === 'audio');
    return `
<div class="flex items-center justify-between">
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Notes de terrain</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Audios</h1></div>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${items.length} audio${items.length > 1 ? 's' : ''}</span>
</div>
<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Enregistrer un audio</h2>
<p class="font-body-sm text-body-sm text-on-surface-variant">L'enregistrement est hébergé par Telegram (aucun fichier dans Neon) et publié sur le canal avec le bouton ⭐ Soutenir — le Mini App le présente avec lecteur intégré.</p>
<div class="flex items-center gap-space-sm">
<button id="recordButton" class="px-space-md py-3 bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors rounded-lg inline-flex items-center gap-2" type="button"><span class="material-symbols-outlined text-[18px]">mic</span> Enregistrer</button>
<button id="stopButton" class="hidden px-space-md py-3 bg-error text-on-error font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary-container transition-colors rounded-lg inline-flex items-center gap-2" type="button"><span class="material-symbols-outlined text-[18px]">stop</span> Arrêter</button>
<span id="recordTimer" class="font-meta-detail text-meta-detail text-on-surface-variant">0:00</span>
<button id="audioImportButton" class="px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors inline-flex items-center gap-2" type="button"><span class="material-symbols-outlined text-[18px]">upload_file</span> Importer un audio</button>
<input id="audioFileInput" class="hidden" type="file" accept="audio/*">
</div>
<audio id="recordPreview" class="w-full hidden" controls preload="metadata"></audio>
<div class="flex flex-col gap-space-md">
<input id="audioTitle" class="editorial-input" type="text" maxlength="256" placeholder="Titre de l'audio">
<textarea id="audioDescription" class="editorial-input" rows="3" maxlength="4000" placeholder="Description / contexte de la note"></textarea>
<input id="audioAuthor" class="editorial-input" type="text" maxlength="256" placeholder="Auteur / source (optionnel)">
</div>
<div class="flex flex-col sm:flex-row gap-space-sm">
<button id="audioPublish" class="flex-1 py-3 px-space-md bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors rounded-lg" type="button">Publier sur Telegram</button>
<button id="audioDraft" class="sm:w-auto py-3 px-space-md border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">Enregistrer l'ébauche</button>
</div>
<p id="audioStatus" class="form-status" aria-live="polite"></p>
</div>
${items.length ? `<div class="grid grid-cols-1 xl:grid-cols-2 gap-space-md">${items.map((post) => renderPostItem(post, 'audio')).join('')}</div>` : '<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm text-center"><p class="font-body-sm text-body-sm text-on-surface-variant">Aucun audio pour le moment — enregistrez ou importez une note ci-dessus.</p></div>'}
`;
  }

  function bindAudioComposer() {
    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const timer = document.getElementById('recordTimer');
    const status = document.getElementById('audioStatus');
    const preview = document.getElementById('recordPreview');
    const fileInput = document.getElementById('audioFileInput');
    recordButton?.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined;
        mediaRecorder = new MediaRecorder(stream, options);
        recordedChunks = [];
        mediaRecorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.push(event.data); };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          audioFileName = (mediaRecorder.mimeType || '').includes('ogg') ? 'note-vocale.ogg' : 'note-vocale.webm';
          if (preview) { preview.src = URL.createObjectURL(blob); preview.classList.remove('hidden'); }
          const reader = new FileReader();
          reader.onload = () => { audioDataUrl = String(reader.result); };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        recordStartedAt = Date.now();
        recordButton.classList.add('hidden');
        stopButton?.classList.remove('hidden');
        recordTimerId = setInterval(() => {
          const seconds = Math.floor((Date.now() - recordStartedAt) / 1000);
          if (timer) timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        }, 1000);
        if (status) status.textContent = 'Enregistrement en cours…';
      } catch (error) {
        if (status) status.textContent = 'Micro indisponible — utilisez « Importer un audio ».';
      }
    });
    stopButton?.addEventListener('click', () => {
      mediaRecorder?.stop();
      clearInterval(recordTimerId);
      recordButton?.classList.remove('hidden');
      stopButton?.classList.add('hidden');
      if (status) status.textContent = 'Enregistrement prêt — écoutez l\'aperçu puis publiez.';
    });
    document.getElementById('audioImportButton')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) { if (status) status.textContent = 'Fichier trop volumineux (3 Mo maximum).'; return; }
      audioFileName = file.name || 'audio';
      const reader = new FileReader();
      reader.onload = () => {
        audioDataUrl = String(reader.result);
        if (preview) { preview.src = URL.createObjectURL(file); preview.classList.remove('hidden'); }
        if (status) status.textContent = 'Audio importé — écoutez l\'aperçu puis publiez.';
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });
    document.getElementById('audioPublish')?.addEventListener('click', publishAudio);
    document.getElementById('audioDraft')?.addEventListener('click', async () => {
      const title = document.getElementById('audioTitle')?.value.trim() || '';
      const description = document.getElementById('audioDescription')?.value.trim() || '';
      if (!title && !description) { if (status) status.textContent = 'Rien à enregistrer.'; return; }
      try {
        const response = await studioAction({ action: 'draft', text: `[Audio]\n${title}\n\n${description}` });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { showLogin(); return; }
        if (!response.ok) throw new Error(data.message || 'Impossible d’enregistrer l’ébauche.');
        if (status) status.textContent = `Ébauche ${data.draftId} enregistrée (métadonnées — l'enregistrement devra être re-téléversé avant publication).`;
      } catch (error) { if (status) status.textContent = error.message || 'Impossible d’enregistrer l’ébauche.'; }
    });
  }

  async function publishAudio() {
    const title = document.getElementById('audioTitle')?.value.trim() || '';
    const description = document.getElementById('audioDescription')?.value.trim() || '';
    const author = document.getElementById('audioAuthor')?.value.trim() || '';
    const status = document.getElementById('audioStatus');
    const button = document.getElementById('audioPublish');
    if (!title || !audioDataUrl) { if (status) status.textContent = 'Un enregistrement (ou un fichier importé) et un titre sont requis.'; return; }
    button.disabled = true; button.textContent = 'Publication…';
    try {
      const response = await studioAction({ action: 'audio_publish', title, description, author, data: audioDataUrl, filename: audioFileName });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Publication impossible.');
      if (status) status.textContent = 'Audio publié sur le canal Telegram — le Mini App le présente avec lecteur intégré et bouton ⭐ Soutenir.';
      audioDataUrl = null;
      const preview = document.getElementById('recordPreview');
      if (preview) { preview.src = ''; preview.classList.add('hidden'); }
      document.getElementById('audioTitle').value = '';
      document.getElementById('audioDescription').value = '';
      document.getElementById('audioAuthor').value = '';
      setTimeout(load, 900);
    } catch (error) { if (status) status.textContent = error.message || 'Publication impossible.'; }
    finally { button.disabled = false; button.textContent = 'Publier sur Telegram'; }
  }

  // — ARTICLES TELEGRAPH : capacité existante, terminologie corrigée.
  function renderTelegraph() {
    if (studioData?.telegraphConfigured) {
      return `
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Instant View</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Articles Telegraph</h1></div>
<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-[22px]">article</span><h2 class="font-headline-sm text-headline-sm text-on-surface">Compte configuré</h2></div>
<p class="font-body-md text-body-md text-on-surface-variant">Créez et publiez vos articles depuis « Rédiger » : un titre transforme votre texte en article Telegraph (telegra.ph), lu en Instant View et publié sur le canal avec le bouton ⭐ Soutenir.</p>
<button class="self-start mt-space-xs px-space-md py-3 bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors rounded-lg" type="button" data-web-tab-goto="rediger">Rédiger un article</button>
</div>`;
    }
    return `
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Instant View</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Articles Telegraph</h1></div>
<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
<div class="flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-[22px]">article</span><h2 class="font-headline-sm text-headline-sm text-on-surface">Telegraph n'est pas encore configuré</h2></div>
<p class="font-body-md text-body-md text-on-surface-variant">Créez le compte, puis sauvegardez le jeton reçu dans la variable d'environnement <strong>TELEGRAPH_ACCESS_TOKEN</strong> (Vercel) et redéployez.</p>
<button id="telegraphSetupButton" class="self-start mt-space-xs px-space-md py-3 border border-outline-variant bg-surface-container-lowest text-on-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-surface-container-low transition-colors rounded-lg" type="button">Configurer Telegraph</button>
<p id="telegraphStatus" class="form-status" aria-live="polite"></p>
</div>`;
  }

  // — DIRECTS : programmation réelle (créer, modifier, annuler).
  function renderDirects() {
    const lives = studioData?.liveSchedules || [];
    return `
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Régie</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Directs</h1></div>
<div class="grid grid-cols-1 xl:grid-cols-2 gap-space-lg">
<div class="flex flex-col gap-space-md">
${lives.length ? lives.map((live) => `<div class="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-space-xs" data-live-id="${escapeAttribute(live.id)}">
<div class="flex items-center justify-between">
<span class="font-kicker-label text-[0.6875rem] text-primary uppercase">${live.status === 'live' ? 'En direct' : 'Programmé'}</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${formatDate(live.scheduledAt)}</span>
</div>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-on-surface">${escapeHtml(live.title)}</h3>
${live.description ? `<p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(live.description)}</p>` : ''}
<p class="font-meta-detail text-meta-detail text-on-surface-variant">Canal Telegram${live.link ? ' · lien fourni' : ''}</p>
<div class="flex gap-space-xs pt-1">
<button class="live-edit px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button" data-live-id="${escapeAttribute(live.id)}">Modifier</button>
<button class="live-cancel px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button" data-live-id="${escapeAttribute(live.id)}">Annuler</button>
</div>
</div>`).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aucun direct programmé.</p>'}
</div>
<form id="liveForm" class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md h-fit">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Planifier un direct</h2>
<p class="font-body-sm text-body-sm text-on-surface-variant">Le direct apparaît sur l'accueil public (« Prochain direct ») ; la diffusion reste sur sa plateforme externe.</p>
<input id="liveTitle" class="editorial-input" type="text" maxlength="256" placeholder="Titre du direct" required>
<textarea id="liveDescription" class="editorial-input" rows="3" maxlength="4000" placeholder="Description (optionnelle)"></textarea>
<input id="liveDate" class="editorial-input" type="datetime-local" required>
<p class="font-meta-detail text-meta-detail text-on-surface-variant text-[11px]">Heure de votre appareil — l'audience verra l'heure convertie dans son propre fuseau horaire.</p>
<input id="liveLink" class="editorial-input" type="text" maxlength="512" placeholder="Lien du direct (YouTube, …) — optionnel">
<select id="liveStatus" class="editorial-input"><option value="scheduled">Programmé</option><option value="live">En direct</option><option value="completed">Terminé</option></select>
<button id="liveSubmit" class="py-3 px-space-md bg-on-secondary-fixed text-surface font-kicker-label text-kicker-label uppercase tracking-widest hover:bg-primary transition-colors rounded-lg" type="submit">Planifier le direct</button>
<p id="liveStatusText" class="form-status" aria-live="polite"></p>
</form>
</div>`;
  }

  // — MESSAGES & DEMANDES : tickets d'assistance existants.
  function renderMessages() {
    const tickets = studioData?.recentTickets || [];
    return `
<div class="flex items-center justify-between">
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Messages des lecteurs</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Messages &amp; demandes</h1></div>
<span class="px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-kicker-label text-kicker-label uppercase">${studioData?.openTickets || 0}</span>
</div>
<p class="font-body-sm text-body-sm text-on-surface-variant -mt-space-sm">Les messages proviennent du formulaire d'assistance et du bot — vos réponses sont envoyées directement dans Telegram.</p>
${tickets.length ? tickets.map((ticket) => `<article class="bg-surface-container-lowest rounded-xl p-space-md shadow-sm flex flex-col gap-space-sm" data-ticket="${escapeAttribute(ticket.id)}">
<div class="flex items-center justify-between">
<span class="font-meta-detail text-[0.6875rem] font-bold uppercase text-primary">${escapeHtml(ticket.id)}</span>
<span class="font-meta-detail text-meta-detail text-on-surface-variant">${formatDate(ticket.createdAt)}${ticket.topic ? ` · ${escapeHtml(topicLabel(ticket.topic))}` : ''}</span>
</div>
<h3 class="font-headline-sm text-[1.125rem] leading-snug text-on-surface">${escapeHtml(ticket.username ? '@' + ticket.username : ticket.firstName || 'Lecteur')}</h3>
<p class="font-body-md text-body-md text-on-surface-variant">${escapeHtml(ticket.message || '')}</p>
<textarea class="ticket-reply-input editorial-input" rows="3" maxlength="4000" placeholder="Répondre dans Telegram…"></textarea>
<div class="flex gap-space-sm">
<button class="ticket-reply flex-1 py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">Répondre</button>
<button class="ticket-resolve flex-1 py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">Résoudre</button>
</div>
</article>`).join('') : `<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col items-center gap-space-sm text-center"><h3 class="font-headline-sm text-headline-sm text-on-surface">Aucun message pour le moment</h3><p class="font-body-sm text-body-sm text-on-surface-variant">Les demandes d'assistance apparaîtront ici.</p></div>`}`;
  }

  // — AUDIENCE & STARS : indicateurs réels uniquement.
  function renderAudience() {
    const audience = studioData?.audience || {};
    const payments = studioData?.recentPayments || [];
    return `
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Audience &amp; Soutiens</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Audience &amp; Stars</h1></div>
<div class="grid grid-cols-2 xl:grid-cols-4 gap-space-md">
${renderKpi('send', Number(audience.opens || 0).toLocaleString('fr-FR'), `Ouvertures (+${Number(audience.last7Days || 0).toLocaleString('fr-FR')} sur 7 jours)`)}
${renderKpi('group', Number(audience.uniqueUsers || 0).toLocaleString('fr-FR'), 'Visiteurs uniques')}
${renderKpi('star', Number(studioData?.stars || 0).toLocaleString('fr-FR'), 'Telegram Stars reçues')}
${renderKpi('volunteer_activism', Number(studioData?.supporters || 0).toLocaleString('fr-FR'), 'Soutiens')}
</div>
<section class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Dernières contributions</h2>
${payments.length ? payments.map((payment) => `<div class="flex items-center justify-between p-space-md bg-surface-container-low rounded-lg">
<div class="flex flex-col min-w-0">
<span class="font-meta-detail text-meta-detail text-on-surface font-semibold">${escapeHtml(payment.username ? '@' + payment.username : 'Lecteur')}</span>
<span class="font-meta-detail text-[0.6875rem] text-on-surface-variant">${formatDate(payment.paidAt)}${payment.refundedAt ? ' · remboursé' : ''}</span>
</div>
<div class="flex items-center gap-space-sm">
<span class="font-meta-detail text-meta-detail text-primary font-bold">${payment.amount || 0} ⭐</span>
${payment.refundedAt ? '' : `<button class="payment-refund px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container transition-colors" type="button" data-payment="${escapeAttribute(payment.id)}">Rembourser</button>`}
</div>
</div>`).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aucun soutien reçu pour le moment.</p>'}
<p class="font-body-sm text-body-sm text-on-surface-variant text-[0.75rem]">Les vidéos restent hébergées sur la chaîne YouTube officielle et le canal Telegram — Pesce Studio ne stocke que les références.</p>
</section>`;
  }

  // — PARAMÈTRES : identité de session, Telegraph, bouton de soutien, déconnexion.
  function renderParametres() {
    return `
<div><span class="font-kicker-label text-kicker-label text-primary uppercase">Réglages du bureau</span><h1 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface tracking-tight">Paramètres</h1></div>
<div class="grid grid-cols-1 xl:grid-cols-2 gap-space-lg">
<section class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Session administrateur</h2>
<p class="font-body-md text-body-md text-on-surface-variant">Connecté en tant que <strong class="text-on-surface">${escapeHtml(sessionEmail || 'compte Google autorisé')}</strong>. La session expire automatiquement après 7 jours et reste validée par le serveur à chaque requête.</p>
<button id="paramLogout" class="self-start px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">Se déconnecter</button>
</section>
<section class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Bouton de soutien du canal</h2>
<p class="font-body-md text-body-md text-on-surface-variant">Les nouvelles publications reçoivent automatiquement le bouton « ⭐ Soutenir le travail de Pesce ». Utilisez ceci une fois pour les publications déjà présentes.</p>
<button id="backfillSupportButton" class="self-start px-space-md py-3 border border-outline-variant rounded-lg font-kicker-label text-kicker-label uppercase text-on-surface hover:bg-surface-container-low transition-colors" type="button">Ajouter aux publications récentes</button>
<p id="backfillStatus" class="form-status" aria-live="polite"></p>
</section>
<section class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col gap-space-sm xl:col-span-2">
<h2 class="font-headline-sm text-headline-sm text-on-surface">Studio Telegram</h2>
<p class="font-body-md text-body-md text-on-surface-variant">Le Studio Telegram (Mini App) reste disponible pour la création sur mobile : même base de données, mêmes brouillons, mêmes directs et mêmes messages. Ouvrez-le avec <strong>${escapeHtml(studioDeepLink())}</strong> depuis le compte créateur.</p>
</section>
</div>`;
  }

  function studioDeepLink() {
    return PESCE?.STUDIO_URL || 'le bot Pesce Studio (?startapp=studio)';
  }

  // — Actions (identiques au Studio Telegram : mêmes API, même base).
  async function publishFromStudio() {
    const title = document.getElementById('articleTitle')?.value.trim() || '';
    const text = document.getElementById('publishText')?.value.trim() || '';
    const status = document.getElementById('publishStatus');
    const button = document.getElementById('publishSubmit');
    if (!text) return;
    const images = collectArticleImages();
    if (images.length > 0 && !title) {
      if (status) status.textContent = 'Les images nécessitent un titre : ajoutez un titre pour publier un article Telegraph illustré.';
      return;
    }
    button.disabled = true; button.textContent = 'Publication…';
    try {
      const response = await studioAction({ action: title ? 'article_publish' : 'publish', text, ...(title ? { title, images } : {}) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Publication impossible.');
      status.textContent = title
        ? (images.length ? 'Article illustré publié sur Telegraph (images hébergées par Telegraph) et envoyé sur le canal avec le bouton ⭐ Soutenir.' : 'Article publié sur Telegraph et envoyé sur le canal avec le bouton ⭐ Soutenir.')
        : 'Publication envoyée sur le canal Telegram. Le bouton ⭐ Soutenir est ajouté automatiquement.';
      articleImages = [];
      renderMediaList();
      document.getElementById('publishForm')?.reset();
      refreshBat();
      setTimeout(load, 900);
    } catch (error) {
      const confirmed = await verifyPublish(text);
      status.textContent = confirmed
        ? 'Publication partie sur le canal (confirmation reçue via la synchronisation).'
        : `Publication incertaine — vérifiez le canal Telegram avant de réessayer. (${error.message || 'erreur inconnue'})`;
      if (confirmed) { articleImages = []; renderMediaList(); document.getElementById('publishForm')?.reset(); setTimeout(load, 900); }
    }
    finally { button.disabled = false; button.textContent = 'Publier sur Telegram'; }
  }

  async function verifyPublish(text) {
    try {
      const overview = await api('/api/studio', { cache: 'no-store' });
      return (overview.recentPosts || []).some((post) => (post.text || '') === text);
    } catch { return false; }
  }

  async function saveDraft() {
    const text = document.getElementById('publishText')?.value.trim() || '';
    const status = document.getElementById('publishStatus');
    const button = document.getElementById('draftButton');
    if (!text) return;
    button.disabled = true; button.textContent = 'Enregistrement…';
    try {
      const response = await studioAction({ action: 'draft', text });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
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
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Suppression impossible.');
      await load();
    } catch (error) { alert(error.message || 'Suppression impossible.'); }
    finally { button.disabled = false; button.textContent = 'Supprimer'; }
  }

  async function backfillSupport() {
    const button = document.getElementById('backfillSupportButton');
    const status = document.getElementById('backfillStatus');
    if (!button) return;
    button.disabled = true; button.textContent = 'Ajout en cours…';
    try {
      const response = await studioAction({ action: 'backfill_support' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
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
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
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
    const live = (studioData?.liveSchedules || []).find((item) => item.id === liveId);
    const form = document.getElementById('liveForm');
    if (!live || !form) return;
    editingLiveId = live.id;
    form.querySelector('#liveTitle').value = live.title || '';
    form.querySelector('#liveDescription').value = live.description || '';
    if (live.scheduledAt) {
      const date = new Date(live.scheduledAt);
      const pad = (part) => String(part).padStart(2, '0');
      form.querySelector('#liveDate').value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
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
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Annulation impossible.');
      if (editingLiveId === liveId) resetLiveForm();
      await load();
    } catch (error) { alert(error.message || 'Annulation impossible.'); }
    finally { button.disabled = false; }
  }

  async function telegraphSetup() {
    const button = document.getElementById('telegraphSetupButton');
    const status = document.getElementById('telegraphStatus');
    if (!button) return;
    button.disabled = true; button.textContent = 'Création du compte…';
    try {
      const response = await studioAction({ action: 'telegraph_setup' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
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
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Réponse impossible.');
      await load();
    } catch (error) { alert(error.message || 'Réponse impossible.'); }
    finally { button.disabled = false; button.textContent = 'Répondre'; }
  }

  async function resolveTicket(button) {
    const card = button.closest('[data-ticket]');
    const ticketId = card?.dataset.ticket;
    if (!ticketId) return;
    button.disabled = true; button.textContent = 'Résolution…';
    try {
      const response = await studioAction({ action: 'resolve', ticketId });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Résolution impossible.');
      await load();
    } catch (error) { alert(error.message || 'Résolution impossible.'); }
    finally { button.disabled = false; button.textContent = 'Résoudre'; }
  }

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
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { showLogin(); return; }
      if (!response.ok) throw new Error(data.message || 'Remboursement impossible.');
      await load();
    } catch (error) { alert(error.message || 'Remboursement impossible.'); }
    finally { button.disabled = false; button.textContent = 'Rembourser'; }
  }

  async function logout() {
    try { await fetch('/api/studio-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); } catch { /* cookie effacé quoi qu'il arrive */ }
    location.reload();
  }

  // — Liaison des événements.
  function bindEvents() {
    document.querySelectorAll('[data-web-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.webTab)));
    document.querySelectorAll('[data-web-tab-goto]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.webTabGoto)));
    document.getElementById('webLogout')?.addEventListener('click', logout);
    document.getElementById('paramLogout')?.addEventListener('click', logout);
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
    document.getElementById('publishSubmit')?.addEventListener('click', publishFromStudio);
    document.getElementById('draftButton')?.addEventListener('click', saveDraft);
    bindMediaEvents();
    bindVideoComposer();
    bindAudioComposer();
    // Délégation du corps : « Insérer dans un article » depuis la Photothèque.
    document.getElementById('webStudioBody')?.addEventListener('click', (event) => {
      const photoInsert = event.target.closest('.photo-insert');
      if (!photoInsert) return;
      if (photoInsert.dataset.photoInsert) addImageFromChannel(photoInsert.dataset.photoInsert, photoInsert.dataset.photoCaption || '');
      switchTab('rediger');
    });
    document.getElementById('backfillSupportButton')?.addEventListener('click', backfillSupport);
    document.getElementById('telegraphSetupButton')?.addEventListener('click', telegraphSetup);
    document.getElementById('liveForm')?.addEventListener('submit', submitLive);
    document.querySelectorAll('.live-edit').forEach((button) => button.addEventListener('click', () => editLive(button)));
    document.querySelectorAll('.live-cancel').forEach((button) => button.addEventListener('click', () => cancelLive(button)));
    document.querySelectorAll('.payment-refund').forEach((button) => button.addEventListener('click', () => refundPayment(button)));
    document.querySelectorAll('.draft-delete').forEach((button) => button.addEventListener('click', () => deleteDraftRow(button)));
    document.querySelectorAll('.draft-load').forEach((button) => button.addEventListener('click', () => {
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
    refreshBat();
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

  // — Démarrage : la session est établie côté serveur ; rien d'autre avant.
  // En mode preview, la session simulée est décidée par le stub — le flux reste identique.
  (async function boot() {
    try {
      const response = await fetch('/api/studio-auth?action=session', { cache: 'no-store' });
      if (response.ok) { await enterShell(); return; }
    } catch { /* serveur indisponible : écran de connexion */ }
    if (PREVIEW) return; // pas de session simulée : l'écran de connexion reste (bouton démo du stub)
    initGoogleButton();
  })();
})();
