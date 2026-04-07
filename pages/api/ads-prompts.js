import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  // GET — list all saved prompts
  if (req.method === 'GET') {
    const snap = await db.collection('ads_prompts').orderBy('createdAt', 'desc').get();
    const prompts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.status(200).json({ prompts });
  }

  // POST — save a new prompt
  if (req.method === 'POST') {
    const { label, text, category } = req.body || {};
    if (!label?.trim() || !text?.trim()) {
      return res.status(400).json({ error: 'label and text are required' });
    }
    const id = String(Date.now());
    const doc = { id, label: label.trim(), text: text.trim(), category: category?.trim() || '', createdAt: Date.now() };
    await db.collection('ads_prompts').doc(id).set(doc);
    return res.status(200).json({ prompt: doc });
  }

  // DELETE — remove a prompt by id (?id=...)
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await db.collection('ads_prompts').doc(id).delete();
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
