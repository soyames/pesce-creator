// Générateurs d'identifiants partagés (tickets de support, brouillons du studio).

// Ticket de support : PS-YYYYMMDD-XXXXX (ex. PS-20260910-A1B2C)
export function newTicketId(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `PS-${day}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// Brouillon du studio : draft_<timestamp>_<6 caractères>
export function newDraftId(now = Date.now(), rand = Math.random()) {
  const suffix = Math.min(Math.floor(rand * 36 ** 6), 36 ** 6 - 1).toString(36).padStart(6, '0');
  return `draft_${now}_${suffix}`;
}

// Programmation de direct : live_<timestamp>_<6 caractères>
export function newLiveId(now = Date.now(), rand = Math.random()) {
  const suffix = Math.min(Math.floor(rand * 36 ** 6), 36 ** 6 - 1).toString(36).padStart(6, '0');
  return `live_${now}_${suffix}`;
}
