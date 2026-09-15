// Tests de la façade MTProto : fail-closed absolu sans configuration, aucun secret dans le code
// public, et les routes RTMP restent hors de portée de toute surface publique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getChannelLiveState, getChannelRtmp, mtProtoConfigured, normalizeBroadcastStats } from '../lib/mtproto.js';
import { mtProtoEditorialError } from '../api/studio.js';

function withEnv(env, fn) {
  const saved = process.env;
  const next = { ...saved };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  process.env = next;
  return Promise.resolve(fn()).finally(() => { process.env = saved; });
}

test('mtProtoConfigured : exige les trois variables de session', () => {
  assert.equal(mtProtoConfigured({}), false);
  assert.equal(mtProtoConfigured({ PESCE_MT_PROTO_API_ID: '1' }), false);
  assert.equal(mtProtoConfigured({ PESCE_MT_PROTO_API_ID: '1', PESCE_MT_PROTO_API_HASH: 'x' }), false);
  assert.equal(mtProtoConfigured({ PESCE_MT_PROTO_API_ID: '1', PESCE_MT_PROTO_API_HASH: 'x', PESCE_MT_PROTO_SESSION: 's' }), true);
});

test('getChannelRtmp : refus explicite sans configuration (jamais d’identifiants fabriqués)', async () => {
  await withEnv({ PESCE_MT_PROTO_API_ID: undefined, PESCE_MT_PROTO_API_HASH: undefined, PESCE_MT_PROTO_SESSION: undefined }, async () => {
    await assert.rejects(() => getChannelRtmp({ channelUsername: 'PesceHounyoOfficiel' }), /MTProto non configuré/);
    await assert.rejects(() => getChannelLiveState({ channelUsername: 'PesceHounyoOfficiel' }), /MTProto non configuré/);
  });
});

test('aucun secret ni identifiant RTMP dans les surfaces publiques', () => {
  const publicFiles = ['../app.js', '../index.html', '../constants.js', '../privacy/index.html'];
  for (const file of publicFiles) {
    const content = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.ok(!content.includes('PESCE_MT_PROTO_SESSION'), `session MTProto exposée dans ${file}`);
    assert.ok(!content.includes('PESCE_MT_PROTO_API_HASH'), `hash MTProto exposé dans ${file}`);
    assert.ok(!/RTMP|stream.?key|clé de stream/i.test(content), `référence RTMP publique dans ${file}`);
  }
});

test('la session MTProto n’est jamais écrite dans le dépôt', () => {
  const setup = readFileSync(fileURLToPath(new URL('../scripts/mtproto-setup.mjs', import.meta.url)), 'utf8');
  assert.ok(setup.includes('console.log'), 'script de configuration présent');
  assert.ok(!/PESCE_MT_PROTO_SESSION\s*=\s*['"][A-Za-z0-9]/.test(setup), 'session codée en dur dans le script de configuration');
  assert.ok(setup.includes('client.session.save()'), 'la session doit être produite dynamiquement par la connexion');
});

// — Statistiques de diffusion : Telegram ne renvoie PAS de compteurs bruts.
// La lecture doit suivre le schéma réel (stats.broadcastStats) : valeurs « actuelle/précédente »
// et MOYENNES PAR PUBLICATION. Lire un champ `counters` inexistant renvoyait des zéros partout —
// des chiffres inventés, présentés comme des mesures.
test('normalizeBroadcastStats : schéma réel de Telegram, moyennes par publication', () => {
  const stats = normalizeBroadcastStats({
    followers: { current: 1240.0, previous: 1180.0 },
    viewsPerPost: { current: 432.6, previous: 410.0 },
    sharesPerPost: { current: 12.4, previous: 9.0 },
    reactionsPerPost: { current: 38.2, previous: 30.0 },
    enabledNotifications: { part: 620, total: 1240 },
    period: { minDate: 1757894400, maxDate: 1758499200 },
  });
  assert.equal(stats.followers, 1240);
  assert.equal(stats.viewsPerPost, 433, 'la moyenne par publication n’est pas arrondie');
  assert.equal(stats.sharesPerPost, 12);
  assert.equal(stats.reactionsPerPost, 38);
  assert.equal(stats.notificationsPercent, 50);
  assert.equal(stats.period.from, '2025-09-15T00:00:00.000Z');
  assert.equal(stats.period.to, '2025-09-22T00:00:00.000Z');
  // Aucun champ « counters » n'existe dans le schéma : s'y fier redonnerait des zéros.
  assert.equal(normalizeBroadcastStats({ counters: { followers: 10, views: 20 } }), null, 'un champ inexistant est lu comme une mesure');
});

test('normalizeBroadcastStats : forme inconnue → null (jamais de zéros présentés comme des mesures)', () => {
  assert.equal(normalizeBroadcastStats(null), null);
  assert.equal(normalizeBroadcastStats(undefined), null);
  assert.equal(normalizeBroadcastStats({}), null);
  assert.equal(normalizeBroadcastStats('stats'), null);
  // Une valeur partielle reste exploitable : on ne jette pas ce que Telegram a fourni.
  const partial = normalizeBroadcastStats({ followers: { current: 52 } });
  assert.equal(partial.followers, 52);
  assert.equal(partial.viewsPerPost, null, 'une mesure absente doit rester absente, pas valoir 0');
  assert.equal(partial.notificationsPercent, null);
  // Division par zéro impossible sur le pourcentage de notifications.
  assert.equal(normalizeBroadcastStats({ followers: { current: 1 }, enabledNotifications: { part: 5, total: 0 } }).notificationsPercent, null);
});

test('statistiques : le centre de données de Telegram est suivi (STATS_MIGRATE)', () => {
  // Telegram héberge les statistiques d'un canal sur un DC précis et répond STATS_MIGRATE_<dc> :
  // sans rejeu sur ce DC, les statistiques échouent avec une session pourtant valide.
  const source = readFileSync(fileURLToPath(new URL('../lib/mtproto.js', import.meta.url)), 'utf8');
  const block = source.slice(source.indexOf('export async function getChannelBroadcastStats'));
  assert.ok(/STATS_MIGRATE_\(\d\+\)/.test(block) || block.includes('STATS_MIGRATE_'), 'la migration de centre de données n’est pas gérée');
  assert.ok(block.includes('client.invoke(request, Number(migrate[1]))'), 'la requête n’est pas rejouée sur le bon centre de données');
});

test('messages MTProto : chaque échec désigne la bonne cause, jamais « droits manquants » par défaut', () => {
  assert.match(mtProtoEditorialError(new Error('CHAT_ADMIN_REQUIRED')), /administrateur du canal/);
  assert.match(mtProtoEditorialError(new Error('AUTH_KEY_UNREGISTERED')), /n’est plus valide/);
  assert.match(mtProtoEditorialError(new Error('SESSION_REVOKED')), /n’est plus valide/);
  assert.match(mtProtoEditorialError(new Error('CHANNEL_PRIVATE')), /n’a pas accès à ce canal/);
  assert.match(mtProtoEditorialError(new Error('FLOOD_WAIT_120')), /2 minutes/);
  assert.match(mtProtoEditorialError(new Error('MTProto non configuré : …')), /MTProto non configuré/);
  // Chaque cause a SON message : une session expirée et un manque de droits ne doivent pas
  // envoyer la créatrice chercher au même endroit.
  const causes = ['CHAT_ADMIN_REQUIRED', 'AUTH_KEY_UNREGISTERED', 'CHANNEL_PRIVATE', 'FLOOD_WAIT_120', 'BROADCAST_REQUIRED']
    .map((code) => mtProtoEditorialError(new Error(code)));
  assert.equal(new Set(causes).size, causes.length, 'deux causes différentes donnent le même message');
  // Un échec inconnu ne prétend jamais connaître la cause.
  const unknown = mtProtoEditorialError(new Error('QUELQUE_CHOSE_D_INATTENDU'));
  assert.ok(!/administrateur|plus valide|accès à ce canal/.test(unknown), 'une cause est devinée pour un échec inconnu');
});

// — Deux causes, un seul code d'erreur Telegram. Le propriétaire du canal reçoit
// CHAT_ADMIN_REQUIRED sur les statistiques tant que le seuil d'abonnés n'est pas atteint :
// lui dire « régénérez la session » l'enverrait corriger ce qui fonctionne déjà.
test('statistiques refusées à un administrateur : la cause réelle est nommée', () => {
  const threshold = mtProtoEditorialError(Object.assign(new Error('Statistiques de canal non encore ouvertes par Telegram.'), { code: 'stats_threshold' }));
  assert.match(threshold, /nombre d’abonnés/);
  assert.match(threshold, /rien à corriger/);
  assert.ok(!/régénérez|mtproto-setup/.test(threshold), 'on demande de régénérer une session déjà valide');

  // Le vrai manque de droits garde, lui, son instruction de régénération.
  const rights = mtProtoEditorialError(new Error('400: CHAT_ADMIN_REQUIRED (caused by stats.GetBroadcastStats)'));
  assert.match(rights, /administrateur du canal/);
  assert.match(rights, /mtproto-setup/);
  assert.notEqual(threshold, rights, 'les deux causes donnent le même message');
});

test('le seuil n’est conclu qu’APRÈS vérification des droits réels', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/mtproto.js', import.meta.url)), 'utf8');
  const block = source.slice(source.indexOf('export async function getChannelBroadcastStats'));
  assert.ok(block.includes('channelAdminStatus('), 'le rôle réel n’est pas vérifié avant de conclure');
  assert.ok(block.includes("code: 'stats_threshold'"), 'la cause « seuil » n’est pas distinguée');
  // Un simple membre garde l'erreur d'origine : on ne lui invente pas un seuil.
  assert.ok(/role === 'creator' \|\| role === 'admin'/.test(block), 'le seuil serait conclu pour un non-administrateur');
});

// — RÈGLE : aucun chiffre inventé, et chaque libellé dit exactement ce qu'il mesure.
test('audience : les libellés disent ce qui est réellement compté (Telegram uniquement)', () => {
  const web = readFileSync(fileURLToPath(new URL('../studio/web-studio.js', import.meta.url)), 'utf8');
  const mini = readFileSync(fileURLToPath(new URL('../studio.js', import.meta.url)), 'utf8');
  const track = readFileSync(fileURLToPath(new URL('../api/track.js', import.meta.url)), 'utf8');

  // La mesure exige une identité Telegram vérifiée : une lecture web n'est donc PAS comptée.
  assert.ok(track.includes('validateTelegramInitData(initData, token)'), 'la mesure d’audience accepterait une identité non vérifiée');
  assert.ok(track.includes('return res.status(401)'), 'un événement non authentifié serait compté');

  // Les libellés ne doivent donc pas prétendre couvrir toute l'audience.
  for (const [name, source] of [['web-studio.js', web], ['studio.js', mini]]) {
    assert.ok(!/'Ouvertures'|>Ouvertures</.test(source), `${name} : « Ouvertures » sans préciser Telegram`);
    assert.ok(!/'Visiteurs uniques'|>Visiteurs uniques</.test(source), `${name} : « Visiteurs uniques » sans préciser Telegram`);
    assert.ok(/Ouvertures Telegram/.test(source), `${name} : la portée de la mesure n’est pas dite`);
  }
});

test('statistiques : aucun chiffre n’est fabriqué en cas d’indisponibilité', () => {
  const server = readFileSync(fileURLToPath(new URL('../api/studio.js', import.meta.url)), 'utf8');
  const block = server.slice(server.indexOf("action === 'telegram_stats'"), server.indexOf("action === 'live_status_sync'"));
  // Une forme non reconnue doit répondre « indisponible », jamais des zéros.
  assert.ok(block.includes('if (!stats)'), 'une réponse illisible pourrait être servie telle quelle');
  assert.ok(/503/.test(block), 'l’indisponibilité n’est pas signalée comme telle');
  assert.ok(!/\|\| 0/.test(block), 'un compteur absent est remplacé par 0 (chiffre inventé)');

  // Côté Studio, une mesure absente s'affiche « — », jamais 0.
  const web = readFileSync(fileURLToPath(new URL('../studio/web-studio.js', import.meta.url)), 'utf8');
  const panelStart = web.indexOf("action: 'telegram_stats'");
  assert.ok(panelStart > 0, 'panneau des statistiques introuvable');
  const panel = web.slice(panelStart, web.indexOf('periodLabel(data.period)', panelStart));
  assert.ok(panel.includes("? '—' :"), 'une mesure absente serait affichée comme 0');
  assert.ok(!/Number\(data\.\w+ \|\| 0\)/.test(panel), 'une mesure absente est convertie en 0');
  assert.ok(panel.includes('par publication'), 'des moyennes par publication sont présentées comme des totaux');
});
