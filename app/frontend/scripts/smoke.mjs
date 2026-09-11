// Vérification locale de lib/db.js contre la vraie base Neon : exerce chaque fonction,
// vérifie les formes d'objet attendues, puis supprime toutes les données de test (marqueur "smoke").
// Usage : node scripts/migrate.mjs && node scripts/smoke.mjs  (aucun secret journalisé)
import assert from 'node:assert/strict';
import {
  createDraft, createLiveSchedule, createSupportTicket, deleteDraft, deleteSupportSession, getAudienceStats, getPayment,
  getStudioOverview, getSupportSession, getUpcomingLive, listChannelPosts, listDrafts, listLiveSchedules,
  listPayments, listSupportTickets, markPaymentRefunded, markUpdateProcessed, pruneWebhookUpdates,
  setSupportSession, trackAudienceEvent, updateLiveSchedule, updateSupportTicket, upsertChannelPost, upsertPayment, db,
} from '../lib/db.js';
import { createWebSession, destroyWebSession, webSessionEmailFromRequest, WEB_SESSION_COOKIE } from '../lib/web-session.js';
import { listReconcilablePosts, markPostSourceDeleted, mergeIntoExistingArticle } from '../lib/db.js';

const POST_ID = `smoke_post_${Date.now()}`;
const CHARGE_ID = `smoke_charge_${Date.now()}`;
const DRAFT_ID = `smoke_draft_${Date.now()}`;
const SESSION_USER = `smoke_user_${Date.now()}`;
const TICKET_ID = `PS-SMOKE-${String(Date.now()).slice(-5)}`;

let failures = 0;

async function run(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✖ ${name} : ${error.message}`);
  }
}

// Nettoie les éventuelles données de test restantes d'une exécution précédente.
async function sweep() {
  await db().query(`DELETE FROM pesce_posts WHERE id LIKE 'smoke_%'`);
  await db().query(`DELETE FROM pesce_payments WHERE id LIKE 'smoke_%'`);
  await db().query(`DELETE FROM pesce_drafts WHERE id LIKE 'smoke_%'`);
  await db().query(`DELETE FROM pesce_support_sessions WHERE user_id LIKE 'smoke_%'`);
  await db().query(`DELETE FROM pesce_support_tickets WHERE id LIKE 'PS-SMOKE-%'`);
  await db().query(`DELETE FROM pesce_live_schedules WHERE id LIKE 'smoke_%'`);
  await db().query(`DELETE FROM pesce_webhook_updates WHERE update_id >= 800000000000`);
}

await sweep();

await run('publications : upsert (insert + merge) puis lecture exacte', async () => {
  const base = {
    source: 'telegram', channelId: -1000000000001, channelUsername: 'smoke_channel', messageId: 1,
    contentType: 'text', text: 'smoke v1', telegramUrl: null, mediaFileId: null, mediaMimeType: null,
    mediaFileName: null, mediaDuration: null, mediaWidth: null, mediaHeight: null,
    published: true, publishedAt: new Date(), receivedAt: new Date(),
  };
  await upsertChannelPost({ id: POST_ID, ...base });
  await upsertChannelPost({ id: POST_ID, ...base, text: 'smoke v2' }); // merge, comme Firestore set(merge)
  const row = (await db().query('SELECT * FROM pesce_posts WHERE id = $1', [POST_ID])).rows[0];
  assert.ok(row, 'post introuvable après upsert');
  assert.equal(row.text, 'smoke v2');
  assert.equal(row.published, true);
  assert.ok(row.published_at instanceof Date);
  assert.ok(row.updated_at instanceof Date);
  await db().query('DELETE FROM pesce_posts WHERE id = $1', [POST_ID]);
});

await run('source de vérité : une publication marquée supprimée sort des listes publiques, reste en audit', async () => {
  const id = `smoke_source_${Date.now()}`;
  await upsertChannelPost({ id, source: 'telegram', channelId: -1000000000001, channelUsername: 'smoke_channel', messageId: 7000 + (Date.now() % 1000), contentType: 'text', text: 'Publication à supprimer', telegramUrl: null, mediaFileId: null, mediaMimeType: null, mediaFileName: null, mediaDuration: null, mediaWidth: null, mediaHeight: null, published: true, publishedAt: new Date(), receivedAt: new Date() });
  assert.ok((await listChannelPosts({ limit: 50 })).some((post) => post.id === id), 'post actif absent du flux');
  assert.ok((await listReconcilablePosts()).some((post) => post.id === id), 'post absent des candidats à la réconciliation');
  await markPostSourceDeleted(id);
  assert.ok(!(await listChannelPosts({ limit: 50 })).some((post) => post.id === id), 'post supprimé encore dans le flux public');
  const row = (await db().query('SELECT * FROM pesce_posts WHERE id = $1', [id])).rows[0];
  assert.ok(row.source_deleted_at instanceof Date, 'horodatage de suppression non conservé (audit)');
  await db().query('DELETE FROM pesce_posts WHERE id = $1', [id]);
});

await run('articles : les messages 8/9/11 d’un même article Telegraph restent UNE publication', async () => {
  // Scénario réel : le même article a été publié trois fois sur le canal (messages 8, 9, 11).
  // Le webhook fusionne par article_url : une seule ligne canonique, identité Telegram complétée
  // sans être écrasée, aucune seconde publication publique.
  const base = (messageId) => ({
    id: `-1000000000001_${messageId}`, source: 'telegram', channelId: -1000000000001, channelUsername: 'smoke_channel',
    messageId, contentType: 'text', text: 'Article smoke\n\nhttps://telegra.ph/Smoke-Dedup',
    telegramUrl: `https://t.me/smoke_channel/${messageId}`, mediaFileId: null, mediaMimeType: null, mediaFileName: null,
    mediaDuration: null, mediaWidth: null, mediaHeight: null, articleUrl: 'https://telegra.ph/Smoke-Dedup',
    articleImageUrl: 'https://telegra.ph/file/smoke-cover.jpg', published: true, publishedAt: new Date(), receivedAt: new Date(),
  });
  await upsertChannelPost(base(8));
  assert.equal(await mergeIntoExistingArticle(base(9)), '-1000000000001_8', 'message 9 non fusionné');
  assert.equal(await mergeIntoExistingArticle(base(11)), '-1000000000001_8', 'message 11 non fusionné');
  const rows = (await db().query(`SELECT * FROM pesce_posts WHERE article_url = 'https://telegra.ph/Smoke-Dedup'`)).rows;
  assert.equal(rows.length, 1, 'plusieurs publications publiques pour le même article');
  assert.equal(rows[0].id, '-1000000000001_8', 'identité canonique non préservée');
  assert.equal(rows[0].message_id, 8, 'identité Telegram non préservée');
  assert.equal(rows[0].article_image_url, 'https://telegra.ph/file/smoke-cover.jpg', 'couverture perdue lors de la fusion');
  await db().query(`DELETE FROM pesce_posts WHERE article_url = 'https://telegra.ph/Smoke-Dedup'`);
});

await run('publications : idempotence — le rejeu webhook ne duplique ni n’écrase la couverture d’article', async () => {
  // Le Studio écrit la couverture au moment de la publication ; le webhook rejoue ensuite la
  // même dépêche sans image : l'upsert doit conserver article_image_url.
  await upsertChannelPost({
    id: POST_ID, source: 'studio', channelId: -1000000000001, channelUsername: 'smoke_channel', messageId: 1,
    contentType: 'text', text: 'Article smoke\n\nhttps://telegra.ph/Smoke-Article', telegramUrl: 'https://t.me/smoke_channel/1',
    mediaFileId: null, mediaMimeType: null, mediaFileName: null, mediaDuration: null, mediaWidth: null, mediaHeight: null,
    articleUrl: 'https://telegra.ph/Smoke-Article', articleImageUrl: 'https://telegra.ph/file/smoke-cover.jpg',
    published: true, publishedAt: new Date(), receivedAt: new Date(),
  });
  await upsertChannelPost({
    id: POST_ID, source: 'telegram', channelId: -1000000000001, channelUsername: 'smoke_channel', messageId: 1,
    contentType: 'text', text: 'Article smoke\n\nhttps://telegra.ph/Smoke-Article', telegramUrl: 'https://t.me/smoke_channel/1',
    mediaFileId: null, mediaMimeType: null, mediaFileName: null, mediaDuration: null, mediaWidth: null, mediaHeight: null,
    articleUrl: null, articleImageUrl: null,
    published: true, publishedAt: new Date(), receivedAt: new Date(),
  });
  const rows = (await db().query('SELECT * FROM pesce_posts WHERE id = $1', [POST_ID])).rows;
  assert.equal(rows.length, 1, 'rejeu du webhook dupliqué');
  assert.equal(rows[0].article_image_url, 'https://telegra.ph/file/smoke-cover.jpg', 'couverture écrasée par le rejeu');
  assert.equal(rows[0].article_url, 'https://telegra.ph/Smoke-Article', 'URL d’article écrasée par le rejeu');
  await db().query('DELETE FROM pesce_posts WHERE id = $1', [POST_ID]);
});

await run('publications : listes filtrées par type et par limite', async () => {
  await upsertChannelPost({ id: POST_ID, source: 'telegram', channelId: -1000000000001, channelUsername: 'smoke_channel', messageId: 1, contentType: 'photo', text: '', telegramUrl: null, mediaFileId: 'smoke_file', mediaMimeType: 'image/jpeg', mediaFileName: null, mediaDuration: null, mediaWidth: 10, mediaHeight: 10, published: true, publishedAt: new Date(), receivedAt: new Date() });
  const all = await listChannelPosts({ limit: 50 });
  assert.ok(Array.isArray(all));
  const mine = all.find((post) => post.id === POST_ID);
  assert.ok(mine, 'post absent de la liste');
  assert.equal(mine.contentType, 'photo');
  assert.equal(mine.channelId, -1000000000001);
  assert.equal(mine.mediaWidth, 10);
  assert.ok(mine.publishedAt instanceof Date);
  const photos = await listChannelPosts({ type: 'photo', limit: 10 });
  assert.ok(photos.every((post) => post.contentType === 'photo'));
  const texts = await listChannelPosts({ type: 'text', limit: 10 });
  assert.ok(!texts.some((post) => post.id === POST_ID), 'filtre de type non respecté');
  await db().query('DELETE FROM pesce_posts WHERE id = $1', [POST_ID]);
});

await run('paiements : upsert + liste', async () => {
  await upsertPayment({ telegramPaymentChargeId: CHARGE_ID, telegramProviderChargeId: 'smoke_provider', userId: 42, username: 'smoke', amount: 100, currency: 'XTR', payload: 'smoke_payload', paidAt: new Date() });
  await upsertPayment({ telegramPaymentChargeId: CHARGE_ID, telegramProviderChargeId: 'smoke_provider_2', userId: 42, username: 'smoke', amount: 100, currency: 'XTR', payload: 'smoke_payload', paidAt: new Date() });
  const row = (await db().query('SELECT * FROM pesce_payments WHERE id = $1', [CHARGE_ID])).rows[0];
  assert.ok(row, 'paiement introuvable après upsert');
  assert.equal(row.provider_charge_id, 'smoke_provider_2');
  assert.equal(row.amount, 100);
  const payments = await listPayments({ limit: 200 });
  assert.ok(Array.isArray(payments));
  assert.equal(payments.find((payment) => payment.id === CHARGE_ID).userId, 42);
  await assert.rejects(() => upsertPayment({}), /Paiement sans identifiant/);
  await db().query('DELETE FROM pesce_payments WHERE id = $1', [CHARGE_ID]);
});

await run('brouillons : création + liste', async () => {
  await createDraft({ id: DRAFT_ID, text: 'smoke brouillon', status: 'draft', authorTelegramUserId: '42' });
  const drafts = await listDrafts({ limit: 20 });
  const draft = drafts.find((item) => item.id === DRAFT_ID);
  assert.ok(draft, 'brouillon absent de la liste');
  assert.equal(draft.text, 'smoke brouillon');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.authorTelegramUserId, '42');
  assert.ok(draft.createdAt instanceof Date);
  await deleteDraft(DRAFT_ID);
  assert.ok(!(await listDrafts({ limit: 50 })).some((item) => item.id === DRAFT_ID), 'brouillon non supprimé');
});

await run('sessions de support : set / get / upsert / delete', async () => {
  await setSupportSession(SESSION_USER, { status: 'awaiting_message', chatId: 43 });
  const session = await getSupportSession(SESSION_USER);
  assert.ok(session, 'session introuvable');
  assert.equal(session.id, SESSION_USER);
  assert.equal(session.status, 'awaiting_message');
  assert.equal(session.chatId, 43);
  await setSupportSession(SESSION_USER, { status: 'awaiting_message', chatId: 44 }); // upsert
  assert.equal((await getSupportSession(SESSION_USER)).chatId, 44);
  await deleteSupportSession(SESSION_USER);
  assert.equal(await getSupportSession(SESSION_USER), null);
  assert.equal(await getSupportSession(''), null);
});

await run('tickets : création, liste par statut, mise à jour', async () => {
  await createSupportTicket({ id: TICKET_ID, chatId: 45, userId: SESSION_USER, username: 'smoke', firstName: 'Smoke', message: 'smoke ticket', topic: 'stars', status: 'open', source: 'smoke' });
  const open = await listSupportTickets({ status: 'open', limit: 100 });
  const ticket = open.find((item) => item.id === TICKET_ID);
  assert.ok(ticket, 'ticket absent de la liste ouverte');
  assert.equal(ticket.topic, 'stars');
  assert.equal(ticket.chatId, 45);
  assert.ok(ticket.createdAt instanceof Date);
  await updateSupportTicket(TICKET_ID, { status: 'resolved', resolvedAt: new Date(), resolvedBy: '42', lastReply: 'smoke réponse', lastReplyAt: new Date(), lastReplyBy: '42' });
  const row = (await db().query('SELECT * FROM pesce_support_tickets WHERE id = $1', [TICKET_ID])).rows[0];
  assert.equal(row.status, 'resolved');
  assert.equal(row.resolved_by, '42');
  assert.ok(row.resolved_at instanceof Date);
  assert.ok(!(await listSupportTickets({ status: 'open', limit: 100 })).some((item) => item.id === TICKET_ID));
  const resolved = await listSupportTickets({ status: 'resolved', limit: 100 });
  assert.ok(resolved.some((item) => item.id === TICKET_ID));
  await updateSupportTicket(TICKET_ID, {}); // aucune colonne → pas d'erreur
  await db().query('DELETE FROM pesce_support_tickets WHERE id = $1', [TICKET_ID]);
});

await run('directs : création, liste, mise à jour, annulation, prochains directs', async () => {
  const liveId = `smoke_live_${Date.now()}`;
  const future = new Date(Date.now() + 2 * 3600 * 1000);
  await createLiveSchedule({ id: liveId, title: 'Direct smoke', description: 'Description smoke', scheduledAt: future, link: 'https://example.com/live', status: 'scheduled' });
  const all = await listLiveSchedules({ limit: 50 });
  const created = all.find((live) => live.id === liveId);
  assert.ok(created, 'direct introuvable après création');
  assert.equal(created.title, 'Direct smoke');
  assert.equal(created.status, 'scheduled');
  assert.ok(created.scheduledAt instanceof Date);
  await updateLiveSchedule(liveId, { title: 'Direct smoke v2', link: null, status: 'live' });
  const row = (await db().query('SELECT * FROM pesce_live_schedules WHERE id = $1', [liveId])).rows[0];
  assert.equal(row.title, 'Direct smoke v2');
  assert.equal(row.status, 'live');
  assert.equal(row.link, null, 'lien effacé par la mise à jour');
  const upcoming = await getUpcomingLive();
  assert.ok(upcoming.some((live) => live.id === liveId), 'direct absent des prochains directs');
  await updateLiveSchedule(liveId, { status: 'cancelled' });
  assert.ok(!(await getUpcomingLive()).some((live) => live.id === liveId), 'direct annulé encore listé');
  await db().query('DELETE FROM pesce_live_schedules WHERE id = $1', [liveId]);
});

await run('webhook : déduplication des updates et nettoyage', async () => {
  const first = 800000000000 + (Date.now() % 100000);
  const second = first + 1;
  assert.equal(await markUpdateProcessed(first), true, 'première update non acceptée');
  assert.equal(await markUpdateProcessed(first), false, 'update rejouée non ignorée');
  await pruneWebhookUpdates(0); // garde uniquement la plus récente
  assert.equal(await markUpdateProcessed(second), true, 'update plus récente non acceptée après nettoyage');
  await db().query('DELETE FROM pesce_webhook_updates WHERE update_id = ANY($1::bigint[])', [[first, second]]);
});

await run('audience : événements, statistiques, drapeau de remboursement', async () => {
  const userId = 500000000 + (Date.now() % 100000);
  await trackAudienceEvent({ userId, event: 'open' });
  await trackAudienceEvent({ userId, event: 'open' });
  assert.equal(await trackAudienceEvent({ userId, event: 'bogus' }), null, 'événement hors liste blanche accepté');
  const stats = await getAudienceStats();
  assert.ok(stats.opens >= 2);
  assert.ok(stats.uniqueUsers >= 1);
  await upsertPayment({ telegramPaymentChargeId: CHARGE_ID, telegramProviderChargeId: 'smoke_provider', userId, username: 'smoke', amount: 50, currency: 'XTR', payload: 'smoke', paidAt: new Date() });
  const before = await getPayment(CHARGE_ID);
  assert.equal(before.refundedAt, null);
  await markPaymentRefunded(CHARGE_ID);
  const after = await getPayment(CHARGE_ID);
  assert.ok(after.refundedAt instanceof Date, 'refundedAt non enregistré');
  await db().query('DELETE FROM pesce_payments WHERE id = $1', [CHARGE_ID]);
  await db().query('DELETE FROM pesce_audience_events WHERE user_id = $1', [userId]);
});

await run('sessions web : création, validation, expiration, destruction', async () => {
  const { token } = await createWebSession('smoke-admin@example.com', { ttlMs: 5000 });
  const request = { headers: { cookie: `${WEB_SESSION_COOKIE}=${token}` } };
  assert.equal(await webSessionEmailFromRequest(request), 'smoke-admin@example.com', 'session valide refusée');
  assert.equal(await webSessionEmailFromRequest({ headers: {} }), null, 'session absente acceptée');
  assert.equal(await webSessionEmailFromRequest({ headers: { cookie: `${WEB_SESSION_COOKIE}=jeton-inexistant` } }), null, 'session inconnue acceptée');
  await db().query(`UPDATE pesce_web_sessions SET expires_at = now() - interval '1 hour' WHERE email = 'smoke-admin@example.com'`);
  assert.equal(await webSessionEmailFromRequest(request), null, 'session expirée acceptée');
  await destroyWebSession({ headers: { cookie: `${WEB_SESSION_COOKIE}=jeton-inexistant` } }); // sans effet
  await db().query(`DELETE FROM pesce_web_sessions WHERE email = 'smoke-admin@example.com'`);
  const { token: second } = await createWebSession('smoke-admin@example.com', { ttlMs: 5000 });
  assert.equal(await webSessionEmailFromRequest({ headers: { cookie: `${WEB_SESSION_COOKIE}=${second}` } }), 'smoke-admin@example.com');
  await destroyWebSession({ headers: { cookie: `${WEB_SESSION_COOKIE}=${second}` } });
  assert.equal(await webSessionEmailFromRequest({ headers: { cookie: `${WEB_SESSION_COOKIE}=${second}` } }), null, 'session détruite encore valide');
});

await run('vue d’ensemble du studio', async () => {
  const overview = await getStudioOverview();
  assert.equal(typeof overview.totals.total, 'number');
  for (const key of ['text', 'photo', 'audio', 'video', 'document', 'other']) {
    assert.equal(typeof overview.totals[key], 'number', `totals.${key} manquant`);
  }
  assert.equal(typeof overview.stars, 'number');
  assert.equal(typeof overview.payments, 'number');
  assert.equal(typeof overview.supporters, 'number');
  assert.equal(typeof overview.openTickets, 'number');
  assert.ok(Array.isArray(overview.recentPosts));
  assert.ok(Array.isArray(overview.recentPayments));
  assert.ok(Array.isArray(overview.recentTickets));
  assert.ok(Array.isArray(overview.drafts));
  assert.ok(Array.isArray(overview.liveSchedules), 'liveSchedules manquant de la vue d’ensemble');
  assert.equal(typeof overview.audience?.opens, 'number', 'audience manquante de la vue d’ensemble');
});

console.log(failures === 0 ? 'SMOKE OK — toutes les fonctions db.js passent.' : `SMOKE ÉCHEC — ${failures} étape(s) en échec.`);
try { await db().end(); } catch { /* fermeture du pool avant la sortie */ }
// Sortie naturelle (pas de process.exit) : évite l'assertion libuv Windows pendant la fermeture des handles du driver.
process.exitCode = failures === 0 ? 0 : 1;
