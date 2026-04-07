/**
 * /api/ads-campaigns
 *
 * GET ?accountId=<id>&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&includePaused=1
 *   Returns campaigns (+ metrics) for the given account.
 *
 * GET ?accountId=<id>&campaignId=<id>&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&includePaused=1
 *   Returns ads for the given campaign.
 */

import { createSign } from 'crypto';

const GADS_API_VERSION = 'v20';

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

async function getAccessToken() {
  const email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const pem    = rawKey.replace(/\\n/g, '\n');
  if (!email || !pem) throw new Error('Missing Google service account credentials');

  const sub     = process.env.GOOGLE_ADS_DELEGATE_EMAIL || email;
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: email, sub, scope: 'https://www.googleapis.com/auth/adwords',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sigInput = `${header}.${payload}`;
  const signer   = createSign('RSA-SHA256');
  signer.update(sigInput);
  const jwt = `${sigInput}.${signer.sign(pem, 'base64url')}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token error: ${data.error_description || data.error}`);
  return data.access_token;
}

async function gaqlSearch(token, customerId, query) {
  const url = `https://googleads.googleapis.com/${GADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  const loginId  = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization':     `Bearer ${token}`,
      'developer-token':   devToken,
      'login-customer-id': loginId,
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({ query: query.trim() }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    let detail = text.slice(0, 400);
    try {
      const err = JSON.parse(text)?.error;
      if (err) detail = `${err.status || err.code}: ${err.message}`;
    } catch {}
    throw new Error(`Google Ads API ${resp.status}: ${detail}`);
  }
  return JSON.parse(text);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { accountId, campaignId, dateFrom, dateTo, includePaused } = req.query;

  if (!accountId || !/^\d+$/.test(accountId)) {
    return res.status(400).json({ error: 'accountId is required and must be numeric' });
  }
  if (!dateFrom || !dateTo ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return res.status(400).json({ error: 'dateFrom and dateTo are required (YYYY-MM-DD)' });
  }
  if (campaignId && !/^\d+$/.test(campaignId)) {
    return res.status(400).json({ error: 'campaignId must be numeric' });
  }

  const showPaused = includePaused === '1' || includePaused === 'true';
  const statusClause = showPaused
    ? `AND campaign.status IN ('ENABLED', 'PAUSED')`
    : `AND campaign.status = 'ENABLED'`;

  try {
    const token = await getAccessToken();

    // ── Ads drill-down ──────────────────────────────────────────────────────
    if (campaignId) {
      const adStatusClause = showPaused
        ? `AND ad_group_ad.status IN ('ENABLED', 'PAUSED')`
        : `AND ad_group_ad.status = 'ENABLED'`;

      const data = await gaqlSearch(token, accountId, `
        SELECT
          ad_group_ad.ad.id,
          ad_group_ad.ad.name,
          ad_group_ad.ad.type,
          ad_group_ad.ad.final_urls,
          ad_group_ad.status,
          ad_group.name,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM ad_group_ad
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
          AND campaign.id = ${campaignId}
          ${adStatusClause}
        ORDER BY metrics.impressions DESC
        LIMIT 200
      `);

      const ads = (data.results || []).map(r => ({
        id:          String(r.adGroupAd?.ad?.id || ''),
        name:        r.adGroupAd?.ad?.name || r.adGroupAd?.ad?.type || 'Ad',
        type:        r.adGroupAd?.ad?.type || '',
        finalUrl:    (r.adGroupAd?.ad?.finalUrls || [])[0] || '',
        adGroupName: r.adGroup?.name || '',
        status:      r.adGroupAd?.status || 'UNKNOWN',
        metrics: {
          impressions: Number(r.metrics?.impressions || 0),
          clicks:      Number(r.metrics?.clicks      || 0),
          costMicros:  Number(r.metrics?.costMicros  || 0),
          conversions: Number(r.metrics?.conversions || 0),
        },
      }));

      return res.status(200).json({ ads });
    }

    // ── Campaigns list ──────────────────────────────────────────────────────
    const data = await gaqlSearch(token, accountId, `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
        ${statusClause}
      ORDER BY metrics.impressions DESC
      LIMIT 200
    `);

    const campaigns = (data.results || []).map(r => ({
      id:          String(r.campaign?.id || ''),
      name:        r.campaign?.name || `Campaign ${r.campaign?.id}`,
      status:      r.campaign?.status || 'UNKNOWN',
      channelType: r.campaign?.advertisingChannelType || '',
      metrics: {
        impressions: Number(r.metrics?.impressions || 0),
        clicks:      Number(r.metrics?.clicks      || 0),
        costMicros:  Number(r.metrics?.costMicros  || 0),
        conversions: Number(r.metrics?.conversions || 0),
      },
    }));

    return res.status(200).json({ campaigns });
  } catch (e) {
    console.error('[ads-campaigns]', e);
    return res.status(500).json({ error: e?.message || 'Failed to fetch data' });
  }
}
