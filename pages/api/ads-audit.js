import { getDb } from '../../lib/firebase';

/**
 * GET    — returns all audit log entries, newest first (optional ?accountId= filter)
 * DELETE — deletes an audit entry by ?id= query param
 */
export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  if (req.method === 'GET') {
    try {
      const { accountId } = req.query;
      let snap;
      if (accountId) {
        snap = await db.collection('ads_audit').where('accountId', '==', String(accountId)).get();
      } else {
        snap = await db.collection('ads_audit').orderBy('timestamp', 'desc').get();
      }
      const entries = snap.docs.map(d => d.data());
      if (accountId) {
        entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
      }
      return res.status(200).json(entries);
    } catch (e) {
      const isQuota = e?.message?.includes('RESOURCE_EXHAUSTED') || e?.code === 8;
      if (isQuota) return res.status(200).json([]);
      console.error('ads-audit GET error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await db.collection('ads_audit').doc(String(id)).delete();
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('ads-audit DELETE error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
