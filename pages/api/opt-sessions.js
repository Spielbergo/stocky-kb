import { getDb } from '../../lib/firebase';

/**
 * GET    — returns all saved optimization sessions, newest first
 * POST   — upserts a session (body: { id, title, mutations, platform, accountIds, dateFrom, dateTo })
 * DELETE — deletes a session by ?id= query param
 */
export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  if (req.method === 'GET') {
    try {
      const snap = await db.collection('opt_sessions').orderBy('updatedAt', 'desc').get();
      return res.status(200).json(snap.docs.map(d => d.data()));
    } catch (e) {
      const isQuota = e?.message?.includes('RESOURCE_EXHAUSTED') || e?.code === 8;
      if (isQuota) return res.status(200).json([]);
      console.error('opt-sessions GET error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const session = req.body;
      if (!session?.id) return res.status(400).json({ error: 'Missing id' });
      const now = new Date().toISOString();
      const doc = { ...session, updatedAt: now, createdAt: session.createdAt || now };
      await db.collection('opt_sessions').doc(String(session.id)).set(doc);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('opt-sessions POST error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await db.collection('opt_sessions').doc(String(id)).delete();
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('opt-sessions DELETE error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
