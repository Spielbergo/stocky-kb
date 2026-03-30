import { getDb } from '../../lib/firebase';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

/**
 * POST /api/stock-import
 * Body: { ticker: string, csv: string }
 * Parses OHLCV CSV (header row: date,open,high,low,close,volume or any order) and
 * upserts into Firestore stock_history collection in the same schema used by stock-history.js.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { ticker, csv } = req.body || {};
  if (!ticker || typeof ticker !== 'string') return res.status(400).json({ error: 'Missing ticker' });
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'Missing csv' });

  // ── Parse CSV ──────────────────────────────────────────────────────────────
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n').filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row plus at least one data row' });

  const headerRaw = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/['"]/g, ''));
  const required  = ['date', 'open', 'high', 'low', 'close', 'volume'];
  const missing   = required.filter(c => !headerRaw.includes(c));
  if (missing.length) return res.status(400).json({ error: `CSV is missing columns: ${missing.join(', ')}` });

  const idx = {};
  required.forEach(c => { idx[c] = headerRaw.indexOf(c); });

  const data = [];
  const badRows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/['"]/g, ''));
    if (cols.length < headerRaw.length) { badRows.push(i + 1); continue; }
    const dateStr = cols[idx.date];
    const open    = parseFloat(cols[idx.open]);
    const high    = parseFloat(cols[idx.high]);
    const low     = parseFloat(cols[idx.low]);
    const close   = parseFloat(cols[idx.close]);
    const volume  = parseFloat(cols[idx.volume]);
    if (!dateStr || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
      badRows.push(i + 1);
      continue;
    }
    // Validate date
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) { badRows.push(i + 1); continue; }
    data.push({ date: d.toISOString().split('T')[0], open, high, low, close, volume });
  }

  if (!data.length) {
    return res.status(400).json({ error: 'No valid data rows found. Check date format (YYYY-MM-DD) and numeric columns.' });
  }

  // Deduplicate by date; prefer later rows on collision
  const byDate = {};
  data.forEach(r => { byDate[r.date] = r; });
  const sorted = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  const startDate = sorted[0].date;
  const endDate   = sorted[sorted.length - 1].date;
  const tickerUC  = ticker.trim().toUpperCase();

  // ── Upsert to Firestore ────────────────────────────────────────────────────
  const db = getDb();
  if (db) {
    try {
      // Merge with existing Firestore data so we don't erase previously fetched rows
      const existing = await db.collection('stock_history').doc(tickerUC).get();
      let merged = sorted;
      if (existing.exists) {
        const prev = existing.data()?.data || [];
        const combined = { ...Object.fromEntries(prev.map(r => [r.date, r])), ...byDate };
        merged = Object.values(combined).sort((a, b) => a.date.localeCompare(b.date));
      }
      const mergedStart = merged[0].date;
      const mergedEnd   = merged[merged.length - 1].date;
      await db.collection('stock_history').doc(tickerUC).set({
        ticker:     tickerUC,
        start_date: mergedStart,
        end_date:   mergedEnd,
        data:       merged,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('stock-import firebase error', e);
      return res.status(500).json({ error: 'Failed to save to database: ' + (e?.message || e) });
    }
  }

  return res.status(200).json({
    ticker:    tickerUC,
    imported:  sorted.length,
    skipped:   badRows.length,
    startDate,
    endDate,
  });
}
