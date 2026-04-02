import { getDb } from '../../lib/firebase';

/**
 * GET  — returns all chats from Firestore, sorted newest first
 * POST — upserts a single chat (body: { id, title, messages, createdAt?, updatedAt? })
 * DELETE — deletes a chat by ?id= query param
 */
export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  if (req.method === 'GET') {
    try {
      const { profile } = req.query;
      let snap;
      if (profile) {
        // Equality filter alone avoids the composite index requirement
        snap = await db.collection('chats').where('profile', '==', profile).get();
      } else {
        snap = await db.collection('chats').orderBy('updatedAt', 'desc').get();
      }
      const chats = snap.docs.map(d => d.data());
      if (profile) {
        chats.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      }
      return res.status(200).json(chats);
    } catch (e) {
      const isQuota = e?.message?.includes('RESOURCE_EXHAUSTED') || e?.message?.includes('Quota exceeded') || e?.code === 8;
      if (isQuota) {
        console.warn('chats GET: Firestore quota exceeded, returning empty list');
        return res.status(200).json([]);  // graceful empty — UI stays usable
      }
      console.error('chats GET error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const chat = req.body;
      if (!chat?.id) return res.status(400).json({ error: 'Missing chat id' });
      const now = new Date().toISOString();
      const doc = {
        ...chat,
        updatedAt: now,
        createdAt: chat.createdAt || now,
      };
      await db.collection('chats').doc(String(chat.id)).set(doc);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('chats POST error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await db.collection('chats').doc(String(id)).delete();
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('chats DELETE error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
