/**
 * /api/ads-negative-keyword
 *
 * POST { accountId, campaignId, term, matchType? }
 *   Adds a campaign-level negative keyword via Google Ads campaignCriteria mutate.
 */

import { getAccessToken, gaqlMutate } from '../../lib/google-ads';

const VALID_MATCH_TYPES = ['BROAD', 'PHRASE', 'EXACT'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { accountId, campaignId, term, matchType = 'EXACT' } = req.body || {};

  if (!accountId || !/^\d+$/.test(String(accountId))) {
    return res.status(400).json({ error: 'accountId is required and must be numeric' });
  }
  if (!campaignId || !/^\d+$/.test(String(campaignId))) {
    return res.status(400).json({ error: 'campaignId is required and must be numeric' });
  }
  if (!term || !String(term).trim()) {
    return res.status(400).json({ error: 'term is required' });
  }

  const matchTypeUpper = String(matchType).toUpperCase();
  if (!VALID_MATCH_TYPES.includes(matchTypeUpper)) {
    return res.status(400).json({ error: 'matchType must be BROAD, PHRASE, or EXACT' });
  }

  const cleanTerm = String(term).trim().slice(0, 80); // Google Ads max keyword length

  try {
    const token = await getAccessToken();
    const result = await gaqlMutate(token, String(accountId), 'campaignCriteria', [
      {
        create: {
          campaign: `customers/${accountId}/campaigns/${campaignId}`,
          negative: true,
          keyword: {
            text: cleanTerm,
            matchType: matchTypeUpper,
          },
        },
      },
    ]);

    const resourceName = result?.results?.[0]?.resourceName || null;
    return res.status(200).json({ ok: true, resourceName });
  } catch (e) {
    console.error('[ads-negative-keyword]', e);
    return res.status(500).json({ error: e.message || 'Failed to add negative keyword' });
  }
}
