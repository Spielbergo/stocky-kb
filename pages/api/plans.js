import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });
  const snapshot = await db.collection('plans').get();
  const plans = snapshot.docs.map(doc => doc.data()).sort((a, b) => b.id - a.id);
  res.status(200).json(plans);
}