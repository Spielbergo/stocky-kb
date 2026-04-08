/**
 * Shared Google Ads API helpers.
 * Used by /api/ads-accounts, /api/ads-campaigns, /api/ads-query, and /api/ads-apply.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   (PEM, \n-escaped)
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID         (manager account ID, digits only)
 *   GOOGLE_ADS_DELEGATE_EMAIL            (optional — only for domain-wide delegation)
 */

import { createSign } from 'crypto';

export const GADS_API_VERSION = 'v20';

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

/**
 * Exchange service account credentials for a short-lived Google OAuth2 access token
 * using the JWT Bearer grant (RFC 7523).
 */
export async function getAccessToken() {
  const email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const pem    = rawKey.replace(/\\n/g, '\n');

  if (!email || !pem) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set');
  }

  const sub     = process.env.GOOGLE_ADS_DELEGATE_EMAIL || email;
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   email,
    sub,
    scope: 'https://www.googleapis.com/auth/adwords',
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
    throw new Error(
      `Failed to obtain access token: ${data.error_description || data.error || JSON.stringify(data)}`
    );
  }
  return data.access_token;
}

/**
 * Execute a GAQL query against the Google Ads REST API.
 * @param {string} token       - OAuth2 access token from getAccessToken()
 * @param {string} customerId  - Customer ID to query (digits only, no dashes)
 * @param {string} query       - GAQL query string
 * @returns {Promise<object>}  - Parsed JSON response body
 */
export async function gaqlSearch(token, customerId, query) {
  const url      = `https://googleads.googleapis.com/${GADS_API_VERSION}/customers/${customerId}/googleAds:search`;
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

  if (!resp.ok) {
    let detail = text.slice(0, 600);
    try {
      const parsed = JSON.parse(text);
      const err    = parsed?.error;
      if (err) {
        const code  = err.details?.[0]?.errors?.[0]?.errorCode;
        const inner = code ? JSON.stringify(code) : '';
        detail = `${err.status || err.code}: ${err.message}${inner ? ' — ' + inner : ''}`;
      }
    } catch { /* keep raw text */ }

    if (resp.status === 401) throw new Error(`Authentication failed — check service account credentials and scopes. Detail: ${detail}`);
    if (resp.status === 403) throw new Error(`Permission denied — service account may not have access to this account. Detail: ${detail}`);
    if (resp.status === 404) throw new Error(`Customer ID "${customerId}" not found or not accessible. Detail: ${detail}`);
    throw new Error(`Google Ads API ${resp.status}: ${detail}`);
  }

  return JSON.parse(text);
}

/**
 * Execute a mutate operation against a Google Ads REST API resource.
 *
 * @param {string}   token       - OAuth2 access token from getAccessToken()
 * @param {string}   customerId  - Customer ID (digits only, no dashes)
 * @param {string}   service     - Resource service name, e.g. 'campaigns', 'adGroupCriteria',
 *                                 'campaignBudgets', 'adGroups', 'adGroupAds'
 * @param {object[]} operations  - Array of mutate operation objects, each shaped as:
 *                                 { update: { resourceName, ...fields }, updateMask: 'field_name' }
 * @returns {Promise<object>}    - Parsed JSON response body
 */
export async function gaqlMutate(token, customerId, service, operations) {
  const url      = `https://googleads.googleapis.com/${GADS_API_VERSION}/customers/${customerId}/${service}:mutate`;
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
    body: JSON.stringify({ operations }),
  });

  const text = await resp.text();

  if (!resp.ok) {
    let detail = text.slice(0, 600);
    try {
      const parsed = JSON.parse(text);
      const err    = parsed?.error;
      if (err) {
        const code  = err.details?.[0]?.errors?.[0]?.errorCode;
        const inner = code ? JSON.stringify(code) : '';
        detail = `${err.status || err.code}: ${err.message}${inner ? ' — ' + inner : ''}`;
      }
    } catch { /* keep raw text */ }

    if (resp.status === 401) throw new Error(`Authentication failed. Detail: ${detail}`);
    if (resp.status === 403) throw new Error(`Permission denied for mutate on ${service}. Detail: ${detail}`);
    throw new Error(`Google Ads API mutate ${resp.status}: ${detail}`);
  }

  return JSON.parse(text);
}
