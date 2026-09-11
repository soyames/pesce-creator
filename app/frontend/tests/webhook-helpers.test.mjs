// Tests des fonctions pures du webhook Telegram (normalize/media/supportMarkup/enrichment).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichChannelPost, media, normalize, supportMarkup } from '../api/telegram-pesce-studio.webhook.js';

const CHAT = { id: -1004313542784, username: 'PesceHounyoOfficiel' };

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

test('normalize : post texte', () => {
  const post = normalize({ message_id: 42, date: 1726000000, chat: CHAT, text: 'Bonjour la communauté' });
  assert.equal(post.id, '-1004313542784_42');
  assert.equal(post.contentType, 'text');
  assert.equal(post.text, 'Bonjour la communauté');
  assert.equal(post.channelId, -1004313542784);
  assert.equal(post.telegramUrl, 'https://t.me/PesceHounyoOfficiel/42');
  assert.equal(post.published, true);
  assert.ok(post.publishedAt instanceof Date);
  assert.ok(post.receivedAt instanceof Date);
});

test('normalize : photo avec légende', () => {
  const post = normalize({
    message_id: 7, date: 1726000000, chat: CHAT,
    caption: 'Un moment partagé',
    photo: [{ file_id: 'small', width: 320, height: 240 }, { file_id: 'large', width: 1280, height: 960 }],
  });
  assert.equal(post.contentType, 'photo');
  assert.equal(post.text, 'Un moment partagé');
  assert.equal(post.mediaFileId, 'large', 'dernière taille de photo retenue');
  assert.equal(post.mediaMimeType, 'image/jpeg');
  assert.equal(post.mediaWidth, 1280);
  assert.equal(post.mediaHeight, 960);
});

test('normalize : audio (fichier) et note vocale', () => {
  const audio = normalize({ message_id: 8, date: 1, chat: CHAT, audio: { file_id: 'audio1', duration: 90, mime_type: 'audio/mpeg', file_name: 'chronique.mp3' } });
  assert.equal(audio.contentType, 'audio');
  assert.equal(audio.mediaFileId, 'audio1');
  assert.equal(audio.mediaDuration, 90);
  assert.equal(audio.mediaFileName, 'chronique.mp3');
  const voice = normalize({ message_id: 9, date: 1, chat: CHAT, voice: { file_id: 'voice1', duration: 30 } });
  assert.equal(voice.contentType, 'audio');
  assert.equal(voice.mediaMimeType, 'audio/ogg');
});

test('normalize : vidéo avec miniature', () => {
  const post = normalize({
    message_id: 10, date: 1, chat: CHAT,
    video: { file_id: 'video1', duration: 120, width: 1920, height: 1080, mime_type: 'video/mp4', thumbnail: { file_id: 'thumb1' } },
  });
  assert.equal(post.contentType, 'video');
  assert.equal(post.mediaThumbnailFileId, 'thumb1');
  const noThumb = normalize({ message_id: 11, date: 1, chat: CHAT, video: { file_id: 'video2', duration: 10 } });
  assert.equal(noThumb.mediaThumbnailFileId, null);
});

test('normalize : document et message sans média', () => {
  const doc = normalize({ message_id: 12, date: 1, chat: CHAT, document: { file_id: 'doc1', mime_type: 'application/pdf', file_name: 'rapport.pdf' } });
  assert.equal(doc.contentType, 'document');
  assert.equal(doc.mediaFileName, 'rapport.pdf');
  const empty = normalize({ message_id: 13, date: 1, chat: CHAT });
  assert.equal(empty.contentType, 'other');
  assert.equal(empty.mediaFileId, null);
});

test('normalize : document audio → contentType audio (pont des enregistrements du Studio)', () => {
  const audio = normalize({ message_id: 14, date: 1, chat: CHAT, caption: 'Note vocale', document: { file_id: 'audio-doc-1', mime_type: 'audio/webm', file_name: 'note-vocale.webm' } });
  assert.equal(audio.contentType, 'audio');
  assert.equal(audio.mediaFileId, 'audio-doc-1');
  assert.equal(audio.mediaMimeType, 'audio/webm');
  const voice = normalize({ message_id: 15, date: 1, chat: CHAT, voice: { file_id: 'voice1', duration: 42, mime_type: 'audio/ogg' } });
  assert.equal(voice.contentType, 'audio');
  assert.equal(voice.mediaDuration, 42);
});

test('normalize : dépêche contenant un lien Telegraph → contentType text (Écrit)', () => {
  const post = normalize({ message_id: 19, date: 1, chat: CHAT, text: 'Le numérique africain a besoin de confiance\n\nhttps://telegra.ph/Le-numerique-africain-09-11-2' });
  assert.equal(post.contentType, 'text');
  assert.equal(post.mediaFileId, null);
});

test('enrichChannelPost : article Telegraph → URL + couverture hébergée, échec non bloquant', async () => {
  const base = normalize({ message_id: 20, date: 1, chat: CHAT, text: 'Titre\n\nhttps://telegra.ph/Article-Test-09-11-2' });
  const fetchPage = async () => ({
    title: 'Titre',
    content: [
      { tag: 'figure', children: [{ tag: 'img', attrs: { src: '/file/cover-abc.jpg' } }, { tag: 'figcaption', children: ['Légende'] }] },
      { tag: 'p', children: ['Chapeau.'] },
    ],
  });
  await withEnv({ TELEGRAPH_ACCESS_TOKEN: 'jeton-test' }, async () => {
    const enriched = await enrichChannelPost(base, { fetchPage });
    assert.equal(enriched.articleUrl, 'https://telegra.ph/Article-Test-09-11-2');
    assert.equal(enriched.articleImageUrl, 'https://telegra.ph/file/cover-abc.jpg');
  });
  // Sans lien Telegraph : dépêche inchangée.
  const plain = normalize({ message_id: 21, date: 1, chat: CHAT, text: 'Une dépêche ordinaire.' });
  assert.equal((await enrichChannelPost(plain, { fetchPage })), plain);
  // Échec de la lecture de la page : dépêche conservée, sans couverture.
  const failing = async () => { throw new Error('Telegraph indisponible'); };
  await withEnv({ TELEGRAPH_ACCESS_TOKEN: 'jeton-test' }, async () => {
    const result = await enrichChannelPost(base, { fetchPage: failing });
    assert.ok(result);
    assert.equal(result.articleImageUrl, undefined);
  });
});

test('normalize : dépêche contenant un lien YouTube → contentType video (référence YouTube)', () => {
  const post = normalize({ message_id: 16, date: 1, chat: CHAT, text: 'Grand format\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(post.contentType, 'video');
  assert.equal(post.mediaFileId, null, 'aucun fichier : YouTube héberge la vidéo');
  const shorts = normalize({ message_id: 17, date: 1, chat: CHAT, text: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(shorts.contentType, 'video');
  const plain = normalize({ message_id: 18, date: 1, chat: CHAT, text: 'Une dépêche ordinaire.' });
  assert.equal(plain.contentType, 'text');
});

test('normalize : canal sans username → pas d’URL publique', () => {
  const post = normalize({ message_id: 14, date: 1, chat: { id: 123456 }, text: 'x' });
  assert.equal(post.telegramUrl, null);
  assert.equal(post.channelUsername, 'PesceHounyoOfficiel', 'repli sur le canal officiel');
});

test('media() : texte seul → null', () => {
  assert.equal(media({ text: 'bonjour' }), null);
  assert.equal(media({}), null);
});

test('supportMarkup : bouton ⭐ vers l’URL de soutien', () => {
  const markup = supportMarkup();
  assert.deepEqual(markup.inline_keyboard[0][0], { text: '⭐ Soutenir le travail de Pesce', url: 'https://t.me/PesceStudioBot?startapp=support' });
});
