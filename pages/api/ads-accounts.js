/**
 * /api/ads-accounts
 *
 * GET  — returns cached account list from Firestore (fast, no Google API call)
 * POST — fetches fresh data from Google Ads API, caches in Firestore, returns result
 *
 * Required environment variables (.env.local):
 *   GOOGLE_ADS_DEVELOPER_TOKEN      — Developer token from Google Ads (API Center)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID    — Manager account customer ID, digits only (e.g. 1234567890)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL    — Service account email (xxx@project.iam.gserviceaccount.com)
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — PEM private key from service account JSON, \n-escaped
 *
 * The service account must be granted access to the Google Ads manager account.
 * Google Ads API version can be bumped by changing GADS_API_VERSION below.
 */

import { createSign } from 'crypto';
import { getDb } from '../../lib/firebase';

const GADS_API_VERSION = 'v20';
const CACHE_COLLECTION = 'ads_cache';
const CACHE_DOC        = 'accounts';

// ── JWT / OAuth helpers ────────────────────────────────────────────────────────

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

/**
 * Exchange service account credentials for a short-lived Google OAuth2 access token
 * using the JWT Bearer grant (RFC 7523).
 */
async function getAccessToken() {
  const email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const pem    = rawKey.replace(/\\n/g, '\n');

  if (!email || !pem) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set');
  }

  // sub must equal iss (service account email) when the service account is
  // directly added as a user in Google Ads. Use GOOGLE_ADS_DELEGATE_EMAIL only
  // when domain-wide delegation to a human user is required (Google Workspace).
  const sub = process.env.GOOGLE_ADS_DELEGATE_EMAIL || email;

  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   email,
    sub:   sub,
    scope: 'https://www.googleapis.com/auth/adwords',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const sigInput = `${header}.${payload}`;
  const signer   = createSign('RSA-SHA256');
  signer.update(sigInput);
  const sig = signer.sign(pem, 'base64url');
  const jwt = `${sigInput}.${sig}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const data = await resp.json();
  if (!data.access_token) {
    console.error('[ads-accounts] Token exchange failed:', data);
    throw new Error(`Failed to obtain access token: ${data.error_description || data.error || JSON.stringify(data)}`);
  }
  console.log('[ads-accounts] Access token obtained successfully');
  return data.access_token;
}

/**
 * Execute a GAQL query against the Google Ads REST API.
 * @param {string} token         - OAuth2 access token
 * @param {string} customerId    - Customer ID to query against (no dashes)
 * @param {string} query         - GAQL query string
 */
async function gaqlSearch(token, customerId, query) {
  const url = `https://googleads.googleapis.com/${GADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  console.log('[ads-accounts] gaqlSearch URL:', url);

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  const loginId  = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');

  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization':     `Bearer ${token}`,
      'developer-token':   devToken,
      'login-customer-id': loginId,
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({ query: query.trim() }),
  });

  const text = await resp.text();
  console.log('[ads-accounts] gaqlSearch status:', resp.status);

  if (!resp.ok) {
    // Try to parse a structured Google API error for a cleaner message
    let detail = text.slice(0, 600);
    try {
      const parsed = JSON.parse(text);
      const err    = parsed?.error;
      if (err) {
        const code   = err.details?.[0]?.errors?.[0]?.errorCode;
        const inner  = code ? JSON.stringify(code) : '';
        detail = `${err.status || err.code}: ${err.message}${inner ? ' — ' + inner : ''}`;
      }
    } catch { /* keep raw text */ }

    // Give actionable guidance for common status codes
    if (resp.status === 401) throw new Error(`Authentication failed — check service account credentials and scopes. Detail: ${detail}`);
    if (resp.status === 403) throw new Error(`Permission denied — developer token may still be pending Basic Access approval, or the service account has not been granted access to this Google Ads account. Detail: ${detail}`);
    if (resp.status === 404) throw new Error(`API endpoint not found (404) — customer ID "${customerId}" may not exist or is not accessible with this developer token. Detail: ${detail}`);
    throw new Error(`Google Ads API ${resp.status}: ${detail}`);
  }
  return JSON.parse(text);
}

// ── Sync logic ─────────────────────────────────────────────────────────────────

async function syncFromGoogleAds() {
  const missing = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
                   'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY']
    .filter(v => !process.env[v]);

  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }

  const token     = await getAccessToken();
  const managerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, '');

  // ── 1. Fetch all client accounts under the manager ──────────────────────────
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

  // ── 2. Fetch 30-day performance metrics for each non-manager account ─────────
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
    // silently ignore metric fetch failures — account still shows without metrics
  });

  return accounts;
}

// ── Live metrics for an arbitrary date range ───────────────────────────────────

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

// ── Route handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const db = getDb();

  // GET — return cached data, or live metrics when dateFrom/dateTo are supplied
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

  // POST — sync from Google Ads API
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
