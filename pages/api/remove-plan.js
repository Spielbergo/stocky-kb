import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end();
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });
  const { id } = req.query;
  await db.collection('plans').doc(String(id)).delete();
  res.status(200).json({ message: 'Plan removed' });
}