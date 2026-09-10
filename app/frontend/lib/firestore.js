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

export async function listChannelPosts({ type, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  let query = firestore().collection('pesce_posts').where('published', '==', true).limit(50);
  if (type) query = query.where('contentType', '==', type);

  const snapshot = await query.get();
  const posts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  posts.sort((a, b) => toMillis(b.publishedAt) - toMillis(a.publishedAt));
  return posts.slice(0, safeLimit);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
