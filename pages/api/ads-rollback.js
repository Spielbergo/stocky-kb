import { getDb } from '../../lib/firebase';
import { getAccessToken, gaqlMutate } from '../../lib/google-ads';

/**
 * POST /api/ads-rollback
 *
 * Reverses a single mutation from an audit log entry by swapping before/after,
 * then writes a new audit entry recording the rollback.
 *
 * Body:
 *   auditId    {string}  the Firestore document ID of the ads_audit entry
 *   mutationId {string}  the id of the specific mutation within that entry to roll back
 *
 * Returns:
 *   { ok: boolean, auditId: string }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { auditId, mutationId } = req.body || {};
  if (!auditId || !mutationId) {
    return res.status(400).json({ error: 'auditId and mutationId are required' });
  }

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  // ── Load the audit entry ──────────────────────────────────────────────────
  let entry;
  try {
    const snap = await db.collection('ads_audit').doc(String(auditId)).get();
    if (!snap.exists) return res.status(404).json({ error: 'Audit entry not found' });
    entry = snap.data();
  } catch (e) {
    return res.status(500).json({ error: `Failed to load audit entry: ${e.message}` });
  }

  const mutation = (entry.mutations || []).find(m => m.id === mutationId);
  if (!mutation) return res.status(404).json({ error: 'Mutation not found in audit entry' });

  const accountId = entry.accountId;
  if (!accountId || !/^\d+$/.test(String(accountId))) {
    return res.status(400).json({ error: 'Invalid accountId in audit entry' });
  }

  // ── Build the rollback operation (swap before ↔ after) ────────────────────
  function buildRollbackOp(m) {
    switch (m.type) {
      case 'bid':
        if (m.level === 'keyword') return {
          service: 'adGroupCriteria',
          op: { update: { resourceName: m.resourceName, cpcBidMicros: String(m.before) }, updateMask: 'cpc_bid_micros' },
        };
        if (m.level === 'ad_group') return {
          service: 'adGroups',
          op: { update: { resourceName: m.resourceName, cpcBidMicros: String(m.before) }, updateMask: 'cpc_bid_micros' },
        };
        break;

      case 'status':
        if (m.level === 'campaign') return {
          service: 'campaigns',
          op: { update: { resourceName: m.resourceName, status: m.before }, updateMask: 'status' },
        };
        if (m.level === 'ad_group') return {
          service: 'adGroups',
          op: { update: { resourceName: m.resourceName, status: m.before }, updateMask: 'status' },
        };
        if (m.level === 'keyword') return {
          service: 'adGroupCriteria',
          op: { update: { resourceName: m.resourceName, status: m.before }, updateMask: 'status' },
        };
        break;

      case 'budget': {
        const budgetRN = m.budgetResourceName || m.resourceName;
        return {
          service: 'campaignBudgets',
          op: { update: { resourceName: budgetRN, amountMicros: String(m.before) }, updateMask: 'amount_micros' },
        };
      }

      case 'ad_copy': {
        const isHeadlines = m.field === 'headlines';
        const assets = (m.before || []).map(text => ({ text }));
        return {
          service: 'adGroupAds',
          op: {
            update: {
              resourceName: m.resourceName,
              ad: {
                responsiveSearchAd: isHeadlines
                  ? { headlines: assets }
                  : { descriptions: assets },
              },
            },
            updateMask: isHeadlines
              ? 'ad.responsive_search_ad.headlines'
              : 'ad.responsive_search_ad.descriptions',
          },
        };
      }
    }
    return null;
  }

  const rollbackOp = buildRollbackOp(mutation);
  if (!rollbackOp) {
    return res.status(422).json({ error: `Cannot build rollback operation for type="${mutation.type}" level="${mutation.level}"` });
  }

  // ── Execute rollback ───────────────────────────────────────────────────────
  try {
    const token = await getAccessToken();
    await gaqlMutate(token, String(accountId), rollbackOp.service, [rollbackOp.op]);
  } catch (e) {
    return res.status(500).json({ error: `Rollback failed: ${e.message}` });
  }

  // ── Write rollback audit entry ─────────────────────────────────────────────
  let newAuditId = null;
  try {
    const ref = db.collection('ads_audit').doc();
    newAuditId = ref.id;
    await ref.set({
      id:              newAuditId,
      timestamp:       new Date().toISOString(),
      accountId:       String(accountId),
      type:            'rollback',
      rolledBackFrom:  auditId,
      applied:         1,
      failed:          0,
      errors:          [],
      mutations: [{
        ...mutation,
        before:        mutation.after,
        after:         mutation.before,
        beforeDisplay: mutation.afterDisplay,
        afterDisplay:  mutation.beforeDisplay,
        reason:        `Rollback of: ${mutation.reason}`,
      }],
    });
  } catch (e) {
    console.warn('[ads-rollback] Failed to write rollback audit log:', e?.message);
  }

  return res.status(200).json({ ok: true, auditId: newAuditId });
}
