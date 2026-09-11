// Tests de lib/youtube.js : YouTube est l'hébergeur vidéo (V1) — le studio valide/normalise
// l'URL, dérive l'identifiant et la miniature, et ne stocke jamais de fichier vidéo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYouTubeUrl, youtubeIdOf, youtubeThumbnail } from '../lib/youtube.js';

const ID = 'dQw4w9WgXcQ';

test('youtubeIdOf : formes d’URL courantes et identifiant nu', () => {
  assert.equal(youtubeIdOf(`https://www.youtube.com/watch?v=${ID}`), ID);
  assert.equal(youtubeIdOf(`https://youtube.com/watch?v=${ID}&t=42`), ID);
  assert.equal(youtubeIdOf(`https://youtu.be/${ID}`), ID);
  assert.equal(youtubeIdOf(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(youtubeIdOf(`https://www.youtube.com/embed/${ID}`), ID);
  assert.equal(youtubeIdOf(`https://www.youtube.com/live/${ID}?feature=share`), ID);
  assert.equal(youtubeIdOf(`https://www.youtube.com/watch?v=${ID}&list=PL1234567890`), ID);
  assert.equal(youtubeIdOf(ID), null, 'identifiant nu accepté — seules les URLs sont acceptées');
  assert.equal(youtubeIdOf('pas-une-url'), null);
  assert.equal(youtubeIdOf('https://vimeo.com/123456'), null);
  assert.equal(youtubeIdOf('https://example.com/watch?v=12345678901'), null);
  assert.equal(youtubeIdOf(''), null);
});

test('normalizeYouTubeUrl : forme canonique watch uniquement', () => {
  assert.equal(normalizeYouTubeUrl(`https://youtu.be/${ID}`), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(normalizeYouTubeUrl(`https://www.youtube.com/watch?v=${ID}`), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(normalizeYouTubeUrl('pas-une-url'), null);
});

test('youtubeThumbnail : miniature dérivée de l’identifiant', () => {
  assert.equal(youtubeThumbnail(ID), `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
});
