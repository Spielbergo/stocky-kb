import { getDb } from '../../lib/firebase';
import { getCachedChunks } from '../../lib/chunk-cache';

export default async function handler(req, res) {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Firebase not configured' });
    const { profile } = req.query;
    const allChunks = await getCachedChunks(db);
    const grouped = {};
    allChunks.forEach(data => {
      const docProfile = data.profile || 'stocks';
      if (profile && docProfile !== profile) return;
      const { bookTitle } = data;
      if (!grouped[bookTitle]) grouped[bookTitle] = { bookTitle, count: 0 };
      grouped[bookTitle].count++;
    });
    res.status(200).json(Object.values(grouped));
  } catch (err) {
    console.error('books error', err);
    const isQuota = err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('Quota exceeded');
    if (isQuota) return res.status(200).json([]);  // return empty list gracefully
    res.status(500).json({ error: err.message || 'Server error' });
  }
}