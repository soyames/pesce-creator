// Réconciliation avec la source éditoriale de vérité : le canal Telegram.
// La Bot API ne permet PAS de lister les messages historiques ni de détecter les suppressions —
// le seul signal autoritatif accessible est l'aperçu public du canal (t.me/s/<canal>). La
// réconciliation :
//   1. lit les messages visibles de l'aperçu (fenêtre récente, pagination optionnelle) ;
//   2. marque source_deleted_at sur les publications actives dont le message n'est PLUS dans la
//      fenêtre couverte — jamais sur un échec de lecture (règle de sécurité : un échec ne fait
//      RIEN, une réponse vide non plus) ;
//   3. ingère les articles Telegraph visibles dans l'aperçu et absents de pesce_posts
//      (déduplication par article_url puis par titre — jamais de doublon).
// Idempotent par construction.

// Extrait les identifiants de messages visibles dans une page d'aperçu (t.me/s).
export function extractMessageIdsFromPreview(html) {
  const ids = [];
  for (const match of String(html || '').matchAll(/data-post="[^"]+\/(\d+)"/g)) {
    const id = Number(match[1]);
    if (Number.isFinite(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Décision pure (testable) : parmi les lignes candidates, quels messages sont couverts par la
// fenêtre lue ET absents de l'aperçu → supprimés de la source. La fenêtre [minId, maxId] est
// la plage contiguë réellement lue ; un échec partiel hors plage ne touche à rien.
export function computeRemovedMessageIds(rows, fetchedIds, { now = Date.now } = {}) {
  if (!Array.isArray(fetchedIds) || fetchedIds.length === 0) return []; // sécurité : rien sans donnée
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const present = new Set(fetchedIds);
  const minId = Math.min(...fetchedIds);
  const maxId = Math.max(...fetchedIds);
  const removed = [];
  for (const row of rows) {
    const id = Number(row?.messageId);
    if (!Number.isFinite(id)) continue;
    // Uniquement les messages dans la fenêtre couverte et absents de l'aperçu.
    if (id >= minId && id <= maxId && !present.has(id)) removed.push(row.id);
  }
  return removed;
}

// Récupère une page d'aperçu public du canal (injectable pour les tests). `before` pagine
// vers les messages plus anciens (t.me/s/<canal>?before=<message_id>).
export async function fetchChannelPreview(username, { before = null, fetchImpl = fetch } = {}) {
  const url = `https://t.me/s/${encodeURIComponent(username)}${before ? `?before=${encodeURIComponent(String(before))}` : ''}`;
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'PesceStudio-Reconcile/1.0' },
  });
  if (!response.ok) throw new Error(`Aperçu du canal indisponible (${response.status}).`);
  return response.text();
}

// Seule une ligne TÉLÉGRAM-ORIGINÉE peut être marquée supprimée par réconciliation : une
// publication créée dans le Studio survit à la suppression de sa copie Telegram (distribution).
// Les lignes héritées sans origine conservent l'ancien comportement (réconciliables).
export function isReconcilableSourceRow(row) {
  if (!row || row.origin === 'studio') return false;
  const messageId = Number(row.messageId);
  return Number.isFinite(messageId) && messageId > 0;
}

// Fenêtre paginée d'identifiants : lit l'aperçu jusqu'à couvrir `untilMessageId` (messages plus
// anciens compris), bornée à `maxPages`. Les lignes hors fenêtre restent intouchées (règle de
// sécurité : on ne peut rien affirmer sur ce qu'on n'a pas lu). `startFrom` évite de relire la
// première page déjà consommée.
export async function fetchPreviewWindow(username, { startFrom = null, untilMessageId = null, maxPages = 30, fetchImpl = fetch, log = null } = {}) {
  const allIds = [];
  let before = startFrom;
  let covered = untilMessageId === null;
  for (let page = 0; page < maxPages; page += 1) {
    const html = await fetchChannelPreview(username, { before, fetchImpl });
    const ids = extractMessageIdsFromPreview(html);
    if (ids.length === 0) break;
    for (const id of ids) if (!allIds.includes(id)) allIds.push(id);
    const minId = Math.min(...ids);
    if (untilMessageId !== null && minId <= untilMessageId) { covered = true; break; }
    before = minId;
  }
  if (!covered && untilMessageId !== null && typeof log === 'function') log(`fenêtre de réconciliation bornée à ${maxPages} pages (les messages antérieurs restent hors couverture)`);
  return allIds;
}
