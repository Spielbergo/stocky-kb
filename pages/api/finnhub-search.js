export default async function handler(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query' });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) return res.status(500).json({ error: 'Finnhub key not configured' });

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    const json = await r.json();
    // json.result is an array of matches
    return res.status(200).json(json);
  } catch (e) {
    console.error('finnhub proxy error', e);
    return res.status(500).json({ error: e.message || 'Unknown' });
  }
}
