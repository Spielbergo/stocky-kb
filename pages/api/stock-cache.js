import { getSupabaseClient } from '../../lib/supabase';

export default async function handler(req, res) {
  const supabase = getSupabaseClient();
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' });

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('stock_history')
        .select('ticker, start_date, end_date, updated_at, data')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      // Optionally enrich with company name from Finnhub if available
      const fhKey = process.env.FINNHUB_API_KEY;
      if (fhKey && Array.isArray(data) && data.length > 0) {
        const enriched = await Promise.all(data.map(async (row) => {
          try {
            const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(row.ticker)}&token=${encodeURIComponent(fhKey)}`;
            const r = await fetch(url);
            if (!r.ok) return { ...row, company_name: null };
            const j = await r.json();
            return { ...row, company_name: j.name || (row.data && row.data.companyName) || null };
          } catch (e) {
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
    // Upsert a display name (store in notes) for a ticker
    try {
      const { ticker, display_name } = req.body || {};
      if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

      // upsert notes column
      const payload = { ticker: ticker.toUpperCase(), notes: display_name || null };
      const { error } = await supabase.from('stock_history').upsert([payload], { onConflict: ['ticker'] });
      if (error) throw error;
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
      const { error } = await supabase.from('stock_history').delete().eq('ticker', ticker.toUpperCase());
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('stock-cache DELETE error', e);
      return res.status(500).json({ error: e.message || 'Unknown' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
