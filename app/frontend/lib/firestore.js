import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

let db;

export function firestore() {
  if (db) return db;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firestore non configuré: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL et FIREBASE_PRIVATE_KEY sont requis.');
  }

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

  db = getFirestore(app);
  return db;
}

export { FieldValue };

export async function upsertChannelPost(post) {
  const ref = firestore().collection('pesce_posts').doc(post.id);
  await ref.set({ ...post, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return ref.id;
}

export async function upsertPayment(payment) {
  const chargeId = String(payment.telegramPaymentChargeId || payment.id || '').trim();
  if (!chargeId) throw new Error('Paiement sans identifiant Telegram.');

  const ref = firestore().collection('pesce_payments').doc(chargeId);
  await ref.set({ ...payment, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return ref.id;
}

export async function getSupportSession(userId) {
  if (!userId) return null;
  const snapshot = await firestore().collection('pesce_support_sessions').doc(String(userId)).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function setSupportSession(userId, data) {
  const ref = firestore().collection('pesce_support_sessions').doc(String(userId));
  await ref.set({ userId: String(userId), ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return ref.id;
}

export async function deleteSupportSession(userId) {
  await firestore().collection('pesce_support_sessions').doc(String(userId)).delete();
}

export async function createSupportTicket(ticket) {
  const ref = firestore().collection('pesce_support_tickets').doc(ticket.id);
  await ref.set({ ...ticket, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return ref.id;
}

export async function listSupportTickets({ status, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  let query = firestore().collection('pesce_support_tickets').limit(safeLimit);
  if (status) query = query.where('status', '==', status);

  const snapshot = await query.get();
  const tickets = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  tickets.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  return tickets.slice(0, safeLimit);
}

export async function updateSupportTicket(ticketId, data) {
  const ref = firestore().collection('pesce_support_tickets').doc(String(ticketId));
  await ref.set({ ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return ref.id;
}

export async function listPayments({ limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const snapshot = await firestore().collection('pesce_payments').limit(safeLimit).get();
  const payments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  payments.sort((a, b) => toMillis(b.paidAt) - toMillis(a.paidAt));
  return payments.slice(0, safeLimit);
}

export async function listChannelPosts({ type, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  let query = firestore().collection('pesce_posts').where('published', '==', true).limit(50);
  if (type) query = query.where('contentType', '==', type);

  const snapshot = await query.get();
  const posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  posts.sort((a, b) => toMillis(b.publishedAt) - toMillis(a.publishedAt));
  return posts.slice(0, safeLimit);
}

export async function getStudioOverview() {
  const [posts, payments, openTickets] = await Promise.all([
    listChannelPosts({ limit: 50 }),
    listPayments({ limit: 200 }),
    listSupportTickets({ status: 'open', limit: 100 })
  ]);

  const totals = posts.reduce((acc, post) => {
    const type = post.contentType || 'other';
    acc[type] = (acc[type] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { total: 0 });

  const stars = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const supporters = new Set(payments.map((payment) => String(payment.userId || '')).filter(Boolean)).size;

  return {
    totals,
    stars,
    payments: payments.length,
    supporters,
    openTickets: openTickets.length,
    recentPosts: posts.slice(0, 10),
    recentPayments: payments.slice(0, 10),
    recentTickets: openTickets.slice(0, 10)
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
