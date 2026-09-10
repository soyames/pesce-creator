// Tests de lib/tickets.js : générateurs d'identifiants (tickets de support, brouillons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraftId, newLiveId, newTicketId } from '../lib/tickets.js';

test('newTicketId : forme PS-YYYYMMDD-XXXXX', () => {
  const id = newTicketId(new Date('2026-09-10T12:00:00Z'));
  assert.match(id, /^PS-\d{8}-[A-Z0-9]{5}$/);
  assert.ok(id.startsWith('PS-20260910-'));
});

test('newTicketId : deux identifiants à la même date diffèrent', () => {
  const date = new Date('2026-09-10T12:00:00Z');
  assert.notEqual(newTicketId(date), newTicketId(date));
});

test('newDraftId : forme draft_<timestamp>_<6 caractères>', () => {
  const id = newDraftId(1726000000000, 0.5);
  assert.match(id, /^draft_1726000000000_[a-z0-9]{6}$/);
});

test('newDraftId : deux identifiants diffèrent', () => {
  assert.notEqual(newDraftId(), newDraftId());
});

test('newLiveId : forme live_<timestamp>_<6 caractères>', () => {
  const id = newLiveId(1726000000000, 0.25);
  assert.match(id, /^live_1726000000000_[a-z0-9]{6}$/);
});

test('newLiveId : deux identifiants diffèrent', () => {
  assert.notEqual(newLiveId(), newLiveId());
});
