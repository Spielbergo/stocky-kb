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

  try {
    const token = await getAccessToken();

    // ── Ads drill-down ──────────────────────────────────────────────────────
    if (campaignId) {
      const adStatusFilter = showPaused
        ? `ad_group_ad.status IN ('ENABLED', 'PAUSED')`
        : `ad_group_ad.status = 'ENABLED'`;

      // 1. All ads for campaign (no date filter — so zero-activity ads still appear)
      const [listData, metricsData] = await Promise.all([
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_ad.ad.id,
            ad_group_ad.ad.name,
            ad_group_ad.ad.type,
            ad_group_ad.ad.final_urls,
            ad_group_ad.status,
            ad_group.name
          FROM ad_group_ad
          WHERE campaign.id = ${campaignId}
            AND ${adStatusFilter}
          ORDER BY ad_group_ad.ad.id
          LIMIT 500
        `),
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_ad.ad.id,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
          FROM ad_group_ad
          WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
            AND campaign.id = ${campaignId}
            AND ${adStatusFilter}
          LIMIT 500
        `).catch(() => ({ results: [] })),
      ]);

      // Build metrics lookup by ad id
      const metricsById = {};
      for (const r of (metricsData.results || [])) {
        const id = String(r.adGroupAd?.ad?.id || '');
        if (!id) continue;
        metricsById[id] = {
          impressions: Number(r.metrics?.impressions || 0),
          clicks:      Number(r.metrics?.clicks      || 0),
          costMicros:  Number(r.metrics?.costMicros  || 0),
          conversions: Number(r.metrics?.conversions || 0),
        };
      }

      const ads = (listData.results || []).map(r => {
        const id = String(r.adGroupAd?.ad?.id || '');
        return {
          id,
          name:        r.adGroupAd?.ad?.name || r.adGroupAd?.ad?.type || 'Ad',
          type:        r.adGroupAd?.ad?.type || '',
          finalUrl:    (r.adGroupAd?.ad?.finalUrls || [])[0] || '',
          adGroupName: r.adGroup?.name || '',
          status:      r.adGroupAd?.status || 'UNKNOWN',
          metrics:     metricsById[id] || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 },
        };
      });

      // Sort by impressions desc
      ads.sort((a, b) => b.metrics.impressions - a.metrics.impressions);

      console.log(`[ads-campaigns] campaign=${campaignId} list=${listData.results?.length ?? 0} returning=${ads.length} ads`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ads });
    }

    // ── Campaigns list ──────────────────────────────────────────────────────
    // List ALL campaigns regardless of status (including REMOVED) so we can see
    // what exists, then filter for display. Metrics query uses the status filter.
    const statusFilter = showPaused
      ? `campaign.status IN ('ENABLED', 'PAUSED')`
      : `campaign.status = 'ENABLED'`;

    const [listData, metricsData] = await Promise.all([
      gaqlSearch(token, accountId, `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type
        FROM campaign
        ORDER BY campaign.name
        LIMIT 500
      `),
      gaqlSearch(token, accountId, `
        SELECT
          campaign.id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM campaign
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
          AND ${statusFilter}
        LIMIT 500
      `).catch(() => ({ results: [] })),
    ]);

    // Log all unique statuses found to help debug
    const statusCounts = {};
    for (const r of (listData.results || [])) {
      const s = r.campaign?.status || 'UNKNOWN';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    console.log(`[ads-campaigns] account=${accountId} raw_list=${listData.results?.length ?? 0} statuses=${JSON.stringify(statusCounts)} metricsRows=${metricsData.results?.length ?? 0}`);

    // Build metrics lookup by campaign id
    const metricsById = {};
    for (const r of (metricsData.results || [])) {
      const id = String(r.campaign?.id || '');
      if (!id) continue;
      metricsById[id] = {
        impressions: Number(r.metrics?.impressions || 0),
        clicks:      Number(r.metrics?.clicks      || 0),
        costMicros:  Number(r.metrics?.costMicros  || 0),
        conversions: Number(r.metrics?.conversions || 0),
      };
    }

    const campaigns = (listData.results || []).map(r => {
      const id = String(r.campaign?.id || '');
      return {
        id,
        name:        r.campaign?.name || `Campaign ${id}`,
        status:      r.campaign?.status || 'UNKNOWN',
        channelType: r.campaign?.advertisingChannelType || '',
        metrics:     metricsById[id] || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 },
      };
    });

    // Sort by impressions desc (campaigns with activity float to top)
    campaigns.sort((a, b) => b.metrics.impressions - a.metrics.impressions);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ campaigns });
  } catch (e) {
    console.error('[ads-campaigns]', e);
    return res.status(500).json({ error: e?.message || 'Failed to fetch data' });
  }
}
