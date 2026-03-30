import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  const { title, profile } = req.query;
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });
  const snapshot = await db.collection('book_chunks').where('bookTitle', '==', title).get();
  const chunks = snapshot.docs
    .map(doc => doc.data())
    .filter(d => !profile || (d.profile || 'stocks') === profile);
  res.status(200).json(chunks);
}