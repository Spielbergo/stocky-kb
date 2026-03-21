import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });
  const id = Date.now();
  const newPlan = { id, ...req.body };
  await db.collection('plans').doc(String(id)).set(newPlan);
  res.status(200).json({ message: 'Plan saved' });
}