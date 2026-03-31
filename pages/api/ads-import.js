import { getDb } from '../../lib/firebase';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

/**
 * POST /api/ads-import
 * Body: { label: string, csv: string }
 * Parses a Google Ads CSV (date, campaign, impressions, clicks, cost, conversions) and
 * upserts into Firestore `ads_data` collection, keyed by label.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { label, csv } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'Missing label' });
  if (!csv   || typeof csv   !== 'string') return res.status(400).json({ error: 'Missing csv' });

  // ── Parse CSV ──────────────────────────────────────────────────────────────
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n').filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row plus at least one data row' });

  const headerRaw = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/['"]/g, ''));
  const required  = ['date', 'campaign', 'impressions', 'clicks', 'cost'];
  const missing   = required.filter(c => !headerRaw.includes(c));
  if (missing.length) return res.status(400).json({ error: `CSV is missing columns: ${missing.join(', ')}` });

  const idx = {};
  required.forEach(c => { idx[c] = headerRaw.indexOf(c); });
  idx.conversions = headerRaw.indexOf('conversions'); // optional

  const data    = [];
  const badRows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/['"]/g, ''));
    if (cols.length < required.length) { badRows.push(i + 1); continue; }

    const dateStr     = cols[idx.date];
    const campaign    = cols[idx.campaign];
    const impressions = parseFloat(cols[idx.impressions]);
    const clicks      = parseFloat(cols[idx.clicks]);
    const cost        = parseFloat(cols[idx.cost]);
    const conversions = idx.conversions >= 0 ? parseFloat(cols[idx.conversions]) : 0;

    if (!dateStr || !campaign || isNaN(impressions) || isNaN(clicks) || isNaN(cost)) {
      badRows.push(i + 1);
      continue;
    }

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) { badRows.push(i + 1); continue; }

    data.push({
      date:        d.toISOString().split('T')[0],
      campaign,
      impressions,
      clicks,
      cost,
      conversions: isNaN(conversions) ? 0 : conversions,
    });
  }

  if (!data.length) {
    return res.status(400).json({ error: 'No valid data rows found. Check date format (YYYY-MM-DD) and numeric columns.' });
  }

  // Deduplicate by date+campaign; prefer later rows on collision
  const byKey = {};
  data.forEach(r => { byKey[`${r.date}__${r.campaign}`] = r; });
  const sorted = Object.values(byKey).sort((a, b) =>
    a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign)
  );

  const startDate = sorted[0].date;
  const endDate   = sorted[sorted.length - 1].date;
  const labelKey  = label.trim();

  // ── Upsert to Firestore ────────────────────────────────────────────────────
  const db = getDb();
  if (db) {
    try {
      const existing = await db.collection('ads_data').doc(labelKey).get();
      let merged = sorted;
      if (existing.exists) {
        const prev = existing.data()?.data || [];
        const combined = {
          ...Object.fromEntries(prev.map(r => [`${r.date}__${r.campaign}`, r])),
          ...byKey,
        };
        merged = Object.values(combined).sort((a, b) =>
          a.date.localeCompare(b.date) || a.campaign.localeCompare(b.campaign)
        );
      }
      await db.collection('ads_data').doc(labelKey).set({
        label:      labelKey,
        start_date: merged[0].date,
        end_date:   merged[merged.length - 1].date,
        data:       merged,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('ads-import firebase error', e);
      return res.status(500).json({ error: 'Failed to save to database: ' + (e?.message || e) });
    }
  }

  return res.status(200).json({
    label:     labelKey,
    imported:  sorted.length,
    skipped:   badRows.length,
    startDate,
    endDate,
  });
}
