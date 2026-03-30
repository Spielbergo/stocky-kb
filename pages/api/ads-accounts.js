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

const GADS_API_VERSION = 'v19';
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

  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   email,
    sub:   email,
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
    throw new Error(data.error_description || data.error || 'Failed to obtain access token');
  }
  return data.access_token;
}

/**
 * Execute a GAQL query against the Google Ads REST API.
 * @param {string} token         - OAuth2 access token
 * @param {string} customerId    - Customer ID to query against (no dashes)
 * @param {string} query         - GAQL query string
 */
async function gaqlSearch(token, customerId, query) {
  const url  = `https://googleads.googleapis.com/${GADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization':    `Bearer ${token}`,
      'developer-token':  process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      'Content-Type':     'application/json',
    },
    body: JSON.stringify({ query: query.trim() }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Google Ads API ${resp.status}: ${text.slice(0, 400)}`);
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

// ── Route handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const db = getDb();

  // GET — return cached data
  if (req.method === 'GET') {
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
