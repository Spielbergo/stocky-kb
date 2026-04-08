/**
 * /api/qs-snapshot
 *
 * GET  ?accountId=<id>&campaignId=<id>   — return saved snapshots (newest first, max 52)
 * POST { accountId, campaignId, avgQS, keywordCount, qsDistribution }
 *         — save a new QS snapshot to Firestore qs_snapshots
 */

import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { accountId, campaignId } = req.query;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    try {
      let q = db.collection('qs_snapshots').where('accountId', '==', String(accountId));
      if (campaignId) q = q.where('campaignId', '==', String(campaignId));
      q = q.orderBy('timestamp', 'desc').limit(52);

      const snap = await q.get();
      const snapshots = snap.docs.map(d => {
        const data = d.data();
        return {
          id:              d.id,
          accountId:       data.accountId,
          campaignId:      data.campaignId || null,
          campaignName:    data.campaignName || null,
          avgQS:           data.avgQS,
          keywordCount:    data.keywordCount,
          qsDistribution:  data.qsDistribution || {},
          timestamp:       data.timestamp?.toDate?.()?.toISOString() || '',
        };
      });
      return res.status(200).json({ snapshots });
    } catch (e) {
      console.error('[qs-snapshot GET]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { accountId, campaignId, campaignName, avgQS, keywordCount, qsDistribution } = req.body || {};

    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    try {
      const doc = await db.collection('qs_snapshots').add({
        accountId:      String(accountId),
        campaignId:     campaignId ? String(campaignId) : null,
        campaignName:   campaignName || null,
        avgQS:          Number(avgQS) || 0,
        keywordCount:   Number(keywordCount) || 0,
        qsDistribution: qsDistribution || {},
        timestamp:      new Date(),
      });
      return res.status(200).json({ ok: true, id: doc.id });
    } catch (e) {
      console.error('[qs-snapshot POST]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
