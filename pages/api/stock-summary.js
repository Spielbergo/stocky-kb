import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  try {
    const db = getDb();

    if (!db) {
      return res.status(200).json({ summary: 'No Firebase configured.' });
    }

    // Fetch all tickers and their latest cached data
    const snapshot = await db.collection('stock_history').get();
    const rows = snapshot.docs
      .map(doc => doc.data())
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

    if (rows.length === 0) {
      return res.status(200).json({ summary: 'No cached stock history available.' });
    }

    // Build short textual summary for top N tickers
    const top = rows.slice(0, 8);
    const parts = top.map((r) => {
      try {
        const arr = Array.isArray(r.data) ? r.data : [];
        if (arr.length === 0) return `${r.ticker}: no data`;
        const last = arr[arr.length - 1];
        const lastDate = last?.date || last?.datetime || last?.time || last?.dateRaw || '';
        const close = last?.close ?? last?.adjClose ?? last?.closePrice ?? last?.price ?? null;
        // try to find a 7-day-ago point
        const idx7 = Math.max(0, arr.length - 8);
        const prev = arr[idx7];
        const prevClose = prev?.close ?? prev?.adjClose ?? null;
        let pct = '';
        if (close != null && prevClose != null) {
          pct = ` (${(((close - prevClose) / prevClose) * 100).toFixed(2)}% vs ~7d ago)`;
        }
        return `${r.ticker}: ${close != null ? close : 'n/a'} on ${last?.date || lastDate}${pct}`;
      } catch (e) {
        return `${r.ticker}: error summarizing`;
      }
    });

    return res.status(200).json({ summary: parts.join('\n') });
  } catch (err) {
    console.error('stock-summary error', err);
    return res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
