import { getDb } from '../../lib/firebase';

const PAGE_SIZE = 20; // small pages to stay well under Firestore 10 MiB gRPC limit

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end();
  const { title, profile } = req.query;
  if (!title) return res.status(400).json({ error: 'Missing title' });
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Firebase not configured' });

    let deleted = 0;

    // Paginate to avoid pulling huge datasets over gRPC in one shot.
    // Each loop fetches PAGE_SIZE doc refs (no embedding data), deletes them, then repeats.
    while (true) {
      const snapshot = await db.collection('book_chunks')
        .where('bookTitle', '==', title)
        .select('profile') // only fetch the profile field, not the embedding vectors
        .limit(PAGE_SIZE)
        .get();

      if (snapshot.empty) break;

      // Filter by profile (backwards compat: old docs have no profile field, default to 'stocks')
      const toDelete = profile
        ? snapshot.docs.filter(d => (d.data().profile || 'stocks') === profile)
        : snapshot.docs;

      if (toDelete.length > 0) {
        const batch = db.batch();
        toDelete.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        deleted += toDelete.length;
      }

      // If the snapshot was a full page but ALL were filtered out (wrong profile),
      // we need a different exit condition to avoid an infinite loop.
      if (toDelete.length === 0 && snapshot.size < PAGE_SIZE) break;
      if (toDelete.length === 0) {
        // All remaining docs belong to a different profile — nothing more to delete
        break;
      }
    }

    res.status(200).json({ message: 'Book removed', deleted });
  } catch (err) {
    console.error('remove-book error', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
}