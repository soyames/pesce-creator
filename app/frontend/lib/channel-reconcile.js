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

// Récupère une page d'aperçu public du canal (injectable pour les tests).
export async function fetchChannelPreview(username, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`https://t.me/s/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': 'PesceStudio-Reconcile/1.0' },
  });
  if (!response.ok) throw new Error(`Aperçu du canal indisponible (${response.status}).`);
  return response.text();
}
