import yahooFinance from 'yahoo-finance2';
import { getDb } from '../../lib/firebase';

export default async function handler(req, res) {
  try {
    const { ticker } = req.query;
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!ticker) {
      return res.status(400).json({ error: 'Missing ticker parameter' });
    }

    // Default to 10 years of history
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 10);

    const endDate = new Date();

    const params = {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval: '1d',
    };

    const db = getDb();

    // If Firebase is configured, try to return cached data first
    if (db) {
      try {
        const doc = await db.collection('stock_history').doc(ticker.toUpperCase()).get();
        if (doc.exists) {
          const cached = doc.data();
          if (cached?.data && !force) {
            return res.status(200).json({
              ticker,
              startDate:  cached.start_date  ?? null,
              endDate:    cached.end_date    ?? null,
              data:       cached.data,
              cached:     true,
              updated_at: cached.updated_at  ?? null,
            });
          }
        }
      } catch (e) {
        console.warn('firebase cache check failed', e?.message || e);
      }
    }

    const result = await yahooFinance.historical(ticker, params);

    // After fetching, cache in Firestore if available
    if (db) {
      try {
        await db.collection('stock_history').doc(ticker.toUpperCase()).set({
          ticker:     ticker.toUpperCase(),
          start_date: params.period1,
          end_date:   params.period2,
          data:       result,
          updated_at: new Date().toISOString(),
        }, { merge: true });
      } catch (e) {
        console.warn('firebase upsert failed', e?.message || e);
      }
    }

    return res.status(200).json({ ticker, startDate: params.period1, endDate: params.period2, data: result, cached: false });
  } catch (error) {
    console.error('stock-history error', error);
    const msg = error?.message || String(error) || 'Unknown error';
    if (msg.includes('429') || msg.toLowerCase().includes('too many requests')) {
      return res.status(429).json({ error: 'Yahoo Finance rate limit reached. Please wait a minute and try again.' });
    }
    return res.status(500).json({ error: msg });
  }
}
