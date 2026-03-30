import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Firebase not configured' });
    const { profile } = req.query;
    const snapshot = await db.collection('book_chunks').get();
    const grouped = {};
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const docProfile = data.profile || 'stocks';
      if (profile && docProfile !== profile) return;
      const { bookTitle } = data;
      if (!grouped[bookTitle]) grouped[bookTitle] = { bookTitle, count: 0 };
      grouped[bookTitle].count++;
    });
    res.status(200).json(Object.values(grouped));
  } catch (err) {
    console.error('books error', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}