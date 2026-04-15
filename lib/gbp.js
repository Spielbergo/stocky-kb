/**
 * Google Business Profile (GBP) API helpers.
 * Uses a service account with domain-wide delegation (or direct impersonation)
 * to access the My Business API on behalf of the configured delegate user.
 *
 * Required env vars:
 *   GBP_SERVICE_ACCOUNT_EMAIL       - Service account email
 *   GBP_SERVICE_ACCOUNT_PRIVATE_KEY - PEM private key, \n-escaped
 *   GBP_DELEGATE_EMAIL              - Google Workspace user to impersonate
 */

import { createSign } from 'crypto';

const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

/**
 * Exchange service account credentials for a short-lived OAuth2 access token
 * scoped for the Business Profile API, impersonating GBP_DELEGATE_EMAIL.
 */
export async function getGbpAccessToken() {
  const email  = process.env.GBP_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GBP_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const pem    = rawKey.replace(/\\n/g, '\n');

  if (!email || !pem) {
    throw new Error('GBP_SERVICE_ACCOUNT_EMAIL or GBP_SERVICE_ACCOUNT_PRIVATE_KEY not set');
  }

  const sub = process.env.GBP_DELEGATE_EMAIL || email;
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   email,
    sub,
    scope: GBP_SCOPE,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const sigInput = `${header}.${payload}`;
  const signer   = createSign('RSA-SHA256');
  signer.update(sigInput);
  const jwt = `${sigInput}.${signer.sign(pem, 'base64url')}`;

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
    throw new Error(`GBP token error: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

/**
 * Fetch all GBP accounts (business accounts) visible to the delegate user.
 * Returns an array of account resource objects.
 */
export async function listGbpAccounts(token) {
  const url = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GBP accounts error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.accounts || [];
}

/**
 * Fetch all locations under a given account name (e.g. "accounts/12345678").
 * The Business Information API is used to read location details.
 */
export async function listGbpLocations(token, accountName) {
  const base = 'https://mybusinessbusinessinformation.googleapis.com/v1';
  const readMask = [
    'name', 'title', 'storefrontAddress', 'websiteUri',
    'regularHours', 'phoneNumbers', 'categories',
    'openInfo', 'metadata', 'profile',
  ].join(',');

  const url = `${base}/${accountName}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GBP locations error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.locations || [];
}

/**
 * Fetch performance/insights for a set of location names over a date range.
 * Uses the Business Insights API (v1).
 * dateRange: { startDate: {year,month,day}, endDate: {year,month,day} }
 */
export async function fetchLocationInsights(token, locationNames, dateRange) {
  if (!locationNames.length) return [];

  const url = 'https://businessprofileperformance.googleapis.com/v1/' +
    `${locationNames[0].split('/locations/')[0]}` +
    '/locations:fetchMultiDailyMetricsTimeSeries';

  // Note: fetchMultiDailyMetricsTimeSeries is per-location, so we loop
  const results = await Promise.allSettled(
    locationNames.map(async (locName) => {
      const insightUrl = `https://businessprofileperformance.googleapis.com/v1/${locName}:fetchMultiDailyMetricsTimeSeries`;
      const r = await fetch(insightUrl + '?' + new URLSearchParams({
        'dailyMetrics': ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
          'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
          'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS',
        ].join('&dailyMetrics='),
        'dailyRange.startDate.year':  String(dateRange.startDate.year),
        'dailyRange.startDate.month': String(dateRange.startDate.month),
        'dailyRange.startDate.day':   String(dateRange.startDate.day),
        'dailyRange.endDate.year':    String(dateRange.endDate.year),
        'dailyRange.endDate.month':   String(dateRange.endDate.month),
        'dailyRange.endDate.day':     String(dateRange.endDate.day),
      }), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`insights ${r.status}: ${t}`);
      }
      return { locName, data: await r.json() };
    })
  );

  return results.map((r, i) => ({
    locName: locationNames[i],
    ok:      r.status === 'fulfilled',
    data:    r.status === 'fulfilled' ? r.value.data : null,
    error:   r.status === 'rejected'  ? r.reason?.message : null,
  }));
}

/**
 * Summarise a raw multiDailyMetricsTimeSeries response into a flat totals object.
 */
export function summariseInsights(apiResponse) {
  const totals = {};
  for (const series of (apiResponse?.multiDailyMetricTimeSeries || [])) {
    const metric = series.dailyMetric;
    let sum = 0;
    for (const dp of (series.timeSeries?.datedValues || [])) {
      sum += Number(dp.value || 0);
    }
    totals[metric] = sum;
  }
  return totals;
}
