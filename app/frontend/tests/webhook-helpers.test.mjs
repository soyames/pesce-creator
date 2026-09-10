// Tests des fonctions pures du webhook Telegram (normalize/media/supportMarkup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { media, normalize, supportMarkup } from '../api/telegram-pesce-studio.webhook.js';

const CHAT = { id: -1004313542784, username: 'PesceHounyoOfficiel' };

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
