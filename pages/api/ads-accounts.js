/**
 * /api/ads-accounts
 *
 * GET  - returns cached account list from Firestore (fast, no Google API call)
 * POST - fetches fresh data from Google Ads API, caches in Firestore, returns result
 *
 * Required environment variables (.env.local):
 *   GOOGLE_ADS_DEVELOPER_TOKEN      - Developer token from Google Ads (API Center)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID    - Manager account customer ID, digits only (e.g. 1234567890)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL    - Service account email (xxx@project.iam.gserviceaccount.com)
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY - PEM private key from service account JSON, \n-escaped
 *
 * The service account must be granted access to the Google Ads manager account.
 * Google Ads API version can be bumped by changing GADS_API_VERSION below.
 */

import { getDb } from '../../lib/firebase';
import { getAccessToken, gaqlSearch } from '../../lib/google-ads';

const CACHE_COLLECTION = 'ads_cache';
const CACHE_DOC        = 'accounts';

// --------------------------------------------------------------------------
// Sync logic

async function syncFromGoogleAds() {
  const missing = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
                   'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY']
    .filter(v => !process.env[v]);

  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }

  const token     = await getAccessToken();
  const managerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, '');

  // -- 1. Fetch all client accounts under the manager --------------------------
  const clientData = await gaqlSearch(token, managerId, `
    SELECT
      customer_client.id,
      customer_client.descriptive_name,
      customer_client.currency_code,
      customer_client.time_zone,
      customer_client.status,
      customer_client.level,
      customer_client.test_account,
      customer_client.manager
    FROM customer_client
    WHERE customer_client.level = 1
  `);

  const accounts = (clientData.results || []).map(r => {
    const c = r.customerClient || {};
    return {
      id:           String(c.id || ''),
      name:         c.descriptiveName || `Account ${c.id}`,
      currencyCode: c.currencyCode   || 'USD',
      timeZone:     c.timeZone       || '',
      status:       c.status         || 'UNKNOWN',
      isManager:    !!c.manager,
      isTest:       !!c.testAccount,
      metrics:      null, // populated below
    };
  });

  // -- 2. Fetch 30-day performance metrics for each non-manager account ---------
  // Run in parallel (max 5 concurrent) to avoid overloading the API
  const clientAccounts = accounts.filter(a => !a.isManager);

  const metricsResults = await Promise.allSettled(
    clientAccounts.map(a =>
      gaqlSearch(token, a.id, `
        SELECT
          customer.id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.all_conversions,
          metrics.average_cpc
        FROM customer
        WHERE segments.date DURING LAST_30_DAYS
      `)
    )
  );

  metricsResults.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      const row = result.value?.results?.[0];
      if (row?.metrics) {
        const m = row.metrics;
        clientAccounts[idx].metrics = {
          impressions: Number(m.impressions  || 0),
          clicks:      Number(m.clicks       || 0),
          costMicros:  Number(m.costMicros   || 0),
          conversions: Number(m.conversions  || 0),
          allConversions: Number(m.allConversions || 0),
          averageCpcMicros: Number(m.averageCpc || 0),
        };
      }
    }
    // silently ignore metric fetch failures - account still shows without metrics
  });

  return accounts;
}

// -- Live metrics for an arbitrary date range -----------------------------------

async function fetchMetricsForRange(dateFrom, dateTo, accountIds) {
  const token = await getAccessToken();
  const results = await Promise.allSettled(
    accountIds.map(id =>
      gaqlSearch(token, id, `
        SELECT
          customer.id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM customer
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      `)
    )
  );
  const metrics = {};
  results.forEach((result, idx) => {
    const id = accountIds[idx];
    if (result.status === 'fulfilled') {
      const row = result.value?.results?.[0];
      const m = row?.metrics;
      metrics[id] = {
        impressions: Number(m?.impressions || 0),
        clicks:      Number(m?.clicks      || 0),
        costMicros:  Number(m?.costMicros  || 0),
        conversions: Number(m?.conversions || 0),
      };
    }
  });
  return metrics;
}

// -- Route handler --------------------------------------------------------------

export default async function handler(req, res) {
  const db = getDb();

  // GET - return cached data, or live metrics when dateFrom/dateTo are supplied
  if (req.method === 'GET') {
    const { dateFrom, dateTo } = req.query;

    if (dateFrom && dateTo) {
      // Validate date format to prevent injection
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }
      // Derive accountIds from query param or fall back to cached list
      let accountIds = [];
      if (req.query.accountIds) {
        accountIds = String(req.query.accountIds).split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
      }
      if (!accountIds.length && db) {
        try {
          const doc = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC).get();
          if (doc.exists) accountIds = (doc.data().accounts || []).filter(a => !a.isManager).map(a => a.id);
        } catch (e) { console.warn('ads-accounts cache read (metrics) failed', e?.message); }
      }
      if (!accountIds.length) return res.status(200).json({ metrics: {} });
      try {
        const metrics = await fetchMetricsForRange(dateFrom, dateTo, accountIds);
        return res.status(200).json({ metrics });
      } catch (e) {
        console.error('ads-accounts live metrics error', e);
        return res.status(500).json({ error: e?.message || 'Failed to fetch metrics' });
      }
    }

    // Default: return full cached accounts list
    if (db) {
      try {
        const doc = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC).get();
        if (doc.exists) return res.status(200).json(doc.data());
      } catch (e) {
        console.warn('ads-accounts cache read failed', e?.message);
      }
    }
    return res.status(200).json({ accounts: [], syncedAt: null });
  }

  // POST - sync from Google Ads API
  if (req.method === 'POST') {
    try {
      const accounts  = await syncFromGoogleAds();
      const syncedAt  = new Date().toISOString();
      const payload   = { accounts, syncedAt };

      if (db) {
        try {
          await db.collection(CACHE_COLLECTION).doc(CACHE_DOC).set(payload);
        } catch (e) {
          console.warn('ads-accounts cache write failed', e?.message);
        }
      }

      return res.status(200).json(payload);
    } catch (e) {
      console.error('ads-accounts sync error', e);
      return res.status(500).json({ error: e?.message || 'Sync failed' });
    }
  }

  return res.status(405).end();
}
