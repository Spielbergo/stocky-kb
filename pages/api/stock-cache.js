import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase not configured' });

  const collection = db.collection('stock_history');

  if (req.method === 'GET') {
    try {
      const snapshot = await collection.orderBy('updated_at', 'desc').get();
      const data = snapshot.docs.map((doc) => ({
        ticker:     doc.id,
        start_date: doc.data().start_date ?? null,
        end_date:   doc.data().end_date   ?? null,
        updated_at: doc.data().updated_at ?? null,
        data:       doc.data().data       ?? null,
      }));

      // Optionally enrich with company name from Finnhub if available
      const fhKey = process.env.FINNHUB_API_KEY;
      if (fhKey && data.length > 0) {
        const enriched = await Promise.all(data.map(async (row) => {
          try {
            const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(row.ticker)}&token=${encodeURIComponent(fhKey)}`;
            const r = await fetch(url);
            if (!r.ok) return { ...row, company_name: null };
            const j = await r.json();
            return { ...row, company_name: j.name || null };
          } catch {
            return { ...row, company_name: null };
          }
        }));
        return res.status(200).json({ data: enriched });
      }

      return res.status(200).json({ data });
    } catch (e) {
      console.error('stock-cache GET error', e);
      return res.status(500).json({ error: e.message || 'Unknown' });
    }
  }

  if (req.method === 'POST') {
    // Upsert a display name (stored in notes field) for a ticker
    try {
      const { ticker, display_name } = req.body || {};
      if (!ticker) return res.status(400).json({ error: 'Missing ticker' });
      await collection.doc(ticker.toUpperCase()).set(
        { notes: display_name || null },
        { merge: true }
      );
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('stock-cache POST error', e);
      return res.status(500).json({ error: e.message || 'Unknown' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const ticker = req.query.ticker || req.body?.ticker;
      if (!ticker) return res.status(400).json({ error: 'Missing ticker' });
      await collection.doc(ticker.toUpperCase()).delete();
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('stock-cache DELETE error', e);
      return res.status(500).json({ error: e.message || 'Unknown' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
