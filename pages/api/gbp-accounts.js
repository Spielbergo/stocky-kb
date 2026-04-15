/**
 * /api/gbp-accounts
 *
 * GET  - returns cached GBP account & location data from Firestore
 * POST - syncs fresh data from the Google Business Profile API, caches in Firestore
 *
 * Required env vars (.env.local):
 *   GBP_SERVICE_ACCOUNT_EMAIL
 *   GBP_SERVICE_ACCOUNT_PRIVATE_KEY
 *   GBP_DELEGATE_EMAIL
 */

import { getDb } from '../../lib/firebase';
import { getGbpAccessToken, listGbpAccounts, listGbpLocations, fetchLocationInsights, summariseInsights } from '../../lib/gbp';

const CACHE_COLLECTION = 'gbp_cache';
const CACHE_DOC        = 'accounts';

// ── Date helpers ──────────────────────────────────────────────────────────────
function isoToDateObj(iso) {
  const d = new Date(iso);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function last90DateRange() {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 89);
  return {
    startDate: isoToDateObj(start.toISOString().slice(0, 10)),
    endDate:   isoToDateObj(end.toISOString().slice(0, 10)),
  };
}

// ── Sync from GBP API ─────────────────────────────────────────────────────────
async function syncFromGbp() {
  const missing = ['GBP_SERVICE_ACCOUNT_EMAIL', 'GBP_SERVICE_ACCOUNT_PRIVATE_KEY', 'GBP_DELEGATE_EMAIL']
    .filter(v => !process.env[v]);

  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }

  const token    = await getGbpAccessToken();
  const accounts = await listGbpAccounts(token);

  const dateRange = last90DateRange();

  // For each account, fetch its locations
  const enrichedAccounts = await Promise.all(
    accounts.map(async (account) => {
      let locations = [];
      try {
        locations = await listGbpLocations(token, account.name);
      } catch (e) {
        console.warn(`Could not list locations for ${account.name}: ${e.message}`);
      }

      // Fetch insights for all locations in this account
      const locationNames = locations.map(l => l.name);
      let insightMap = {};
      if (locationNames.length) {
        try {
          const insightResults = await fetchLocationInsights(token, locationNames, dateRange);
          for (const r of insightResults) {
            if (r.ok && r.data) {
              insightMap[r.locName] = summariseInsights(r.data);
            }
          }
        } catch (e) {
          console.warn(`Could not fetch insights for account ${account.name}: ${e.message}`);
        }
      }

      const enrichedLocations = locations.map(loc => {
        const insights = insightMap[loc.name] || {};
        return {
          name:          loc.name,
          title:         loc.title || '',
          address:       formatAddress(loc.storefrontAddress),
          websiteUri:    loc.websiteUri || '',
          phone:         loc.phoneNumbers?.primaryPhone || '',
          categories:    (loc.categories?.primaryCategory?.displayName) || '',
          openInfo:      loc.openInfo?.status || '',
          mapsUri:       loc.metadata?.mapsUri || '',
          newReviewUri:  loc.metadata?.newReviewUri || '',
          // Insight totals (last 90 days)
          impressionsDesktopMaps:    insights.BUSINESS_IMPRESSIONS_DESKTOP_MAPS    || 0,
          impressionsMobileMaps:     insights.BUSINESS_IMPRESSIONS_MOBILE_MAPS     || 0,
          impressionsDesktopSearch:  insights.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH  || 0,
          impressionsMobileSearch:   insights.BUSINESS_IMPRESSIONS_MOBILE_SEARCH   || 0,
          callClicks:                insights.CALL_CLICKS                          || 0,
          websiteClicks:             insights.WEBSITE_CLICKS                       || 0,
          directionRequests:         insights.BUSINESS_DIRECTION_REQUESTS          || 0,
        };
      });

      return {
        name:          account.name,
        accountName:   account.accountName || account.name,
        type:          account.type        || '',
        verificationState: account.verificationState || '',
        vettedState:   account.vettedState || '',
        locations:     enrichedLocations,
      };
    })
  );

  return enrichedAccounts;
}

function formatAddress(addr) {
  if (!addr) return '';
  const lines = addr.addressLines || [];
  const parts = [...lines];
  if (addr.locality)            parts.push(addr.locality);
  if (addr.administrativeArea)  parts.push(addr.administrativeArea);
  if (addr.postalCode)          parts.push(addr.postalCode);
  return parts.filter(Boolean).join(', ');
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  // GET — return cache
  if (req.method === 'GET') {
    try {
      const doc = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC).get();
      if (!doc.exists) return res.status(200).json({ accounts: [], syncedAt: null });
      const { accounts, syncedAt } = doc.data();
      return res.status(200).json({ accounts: accounts || [], syncedAt: syncedAt || null });
    } catch (e) {
      console.error('gbp-accounts GET error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — sync from API then cache
  if (req.method === 'POST') {
    try {
      const accounts = await syncFromGbp();
      const syncedAt = new Date().toISOString();
      await db.collection(CACHE_COLLECTION).doc(CACHE_DOC).set({ accounts, syncedAt });
      return res.status(200).json({ accounts, syncedAt });
    } catch (e) {
      console.error('gbp-accounts POST error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
