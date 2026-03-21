import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end();
  const { title } = req.query;
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });
  const snapshot = await db.collection('book_chunks').where('bookTitle', '==', title).get();
  for (let i = 0; i < snapshot.docs.length; i += 500) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + 500).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  res.status(200).json({ message: 'Book removed' });
}