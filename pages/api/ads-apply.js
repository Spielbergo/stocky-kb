import { getDb } from '../../lib/firebase';
import { getAccessToken, gaqlMutate } from '../../lib/google-ads';

/**
 * POST /api/ads-apply
 *
 * Executes a selected list of mutations against the Google Ads API and writes
 * an immutable audit log entry to Firestore.
 *
 * Body:
 *   accountId  {string}          target Google Ads customer ID (digits)
 *   mutations  {MutationObject[]}  array from /api/ads-optimize, filtered to the ones the user selected
 *
 * Returns:
 *   { applied: number, failed: number, errors: string[], auditId: string }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accountId, mutations = [] } = req.body || {};

  if (!accountId || !/^\d+$/.test(String(accountId))) {
    return res.status(400).json({ error: 'accountId is required and must be numeric' });
  }
  if (!mutations.length) {
    return res.status(400).json({ error: 'mutations array is empty' });
  }

  // ── Map each mutation to a (service, operation) pair ──────────────────────
  function mutationToServiceOp(m) {
    switch (m.type) {
      case 'bid':
        if (m.level === 'keyword') return {
          service: 'adGroupCriteria',
          op: {
            update:     { resourceName: m.resourceName, cpcBidMicros: String(m.after) },
            updateMask: 'cpc_bid_micros',
          },
        };
        if (m.level === 'ad_group') return {
          service: 'adGroups',
          op: {
            update:     { resourceName: m.resourceName, cpcBidMicros: String(m.after) },
            updateMask: 'cpc_bid_micros',
          },
        };
        break;

      case 'status':
        if (m.level === 'campaign') return {
          service: 'campaigns',
          op: {
            update:     { resourceName: m.resourceName, status: m.after },
            updateMask: 'status',
          },
        };
        if (m.level === 'ad_group') return {
          service: 'adGroups',
          op: {
            update:     { resourceName: m.resourceName, status: m.after },
            updateMask: 'status',
          },
        };
        if (m.level === 'keyword') return {
          service: 'adGroupCriteria',
          op: {
            update:     { resourceName: m.resourceName, status: m.after },
            updateMask: 'status',
          },
        };
        break;

      case 'budget': {
        const budgetRN = m.budgetResourceName || m.resourceName;
        return {
          service: 'campaignBudgets',
          op: {
            update:     { resourceName: budgetRN, amountMicros: String(m.after) },
            updateMask: 'amount_micros',
          },
        };
      }

      case 'ad_copy': {
        const isHeadlines = m.field === 'headlines';
        const assets      = (m.after || []).map(text => ({ text }));
        return {
          service: 'adGroupAds',
          op: {
            update: {
              resourceName: m.resourceName,
              ad: {
                responsiveSearchAd: isHeadlines
                  ? { headlines:    assets }
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

  // ── Group valid operations by service ─────────────────────────────────────
  const groups = {};
  const skipped = [];

  for (const m of mutations) {
    const entry = mutationToServiceOp(m);
    if (!entry) { skipped.push(m.id); continue; }
    const key = entry.service;
    if (!groups[key]) groups[key] = { service: entry.service, operations: [], mutationIds: [] };
    groups[key].operations.push(entry.op);
    groups[key].mutationIds.push(m.id);
  }

  // ── Execute all groups ────────────────────────────────────────────────────
  let applied = 0;
  let failed  = 0;
  const errors = [];

  try {
    const token = await getAccessToken();

    const results = await Promise.allSettled(
      Object.values(groups).map(g =>
        gaqlMutate(token, String(accountId), g.service, g.operations)
          .then(()  => { applied += g.operations.length; })
          .catch(e  => { failed  += g.operations.length; errors.push(`${g.service}: ${e.message}`); })
      )
    );

    // Log any unexpected rejections (Promise.allSettled itself shouldn't reject)
    for (const r of results) {
      if (r.status === 'rejected') errors.push('Unexpected: ' + r.reason?.message);
    }
  } catch (e) {
    return res.status(500).json({ error: `Authentication or network error: ${e.message}` });
  }

  // ── Write audit log to Firestore ──────────────────────────────────────────
  let auditId = null;
  try {
    const db  = getDb();
    const ref = db.collection('ads_audit').doc();
    auditId   = ref.id;

    const auditEntry = {
      id:        auditId,
      timestamp: new Date().toISOString(),
      accountId: String(accountId),
      applied,
      failed,
      errors:    errors.length ? errors : [],
      mutations: mutations.map(m => ({
        id:           m.id,
        type:         m.type,
        level:        m.level,
        entityName:   m.entityName,
        campaignName: m.campaignName,
        field:        m.field,
        before:       m.before,
        after:        m.after,
        beforeDisplay: m.beforeDisplay,
        afterDisplay:  m.afterDisplay,
        reason:        m.reason,
        confidence:    m.confidence,
        resourceName:  m.resourceName,
      })),
    };

    await ref.set(auditEntry);
  } catch (e) {
    console.warn('[ads-apply] Failed to write audit log:', e?.message);
  }

  return res.status(200).json({ applied, failed, errors, auditId, skipped });
}
