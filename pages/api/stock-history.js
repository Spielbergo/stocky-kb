import yahooFinance from 'yahoo-finance2';
import { getSupabaseClient } from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    const { ticker } = req.query;
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!ticker) {
      return res.status(400).json({ error: 'Missing ticker parameter' });
    }

    // Try to lookup the instrument to get IPO or start date
    let startDate = null;
    try {
      const profile = await yahooFinance.quoteSummary(ticker, { modules: ['assetProfile', 'summaryProfile', 'price'] });
      // Try common fields that sometimes contain IPO/first trade info
      if (profile) {
        // price.firstTradeDateEpochUtc is a common field
        if (profile.price && profile.price.firstTradeDateEpochUtc) {
          startDate = new Date(profile.price.firstTradeDateEpochUtc * 1000);
        }
        // summaryProfile may include a startDate (epoch)
        if (!startDate && profile.summaryProfile && profile.summaryProfile.startDate) {
          startDate = new Date(profile.summaryProfile.startDate * 1000);
        }
        // fallback to founded year (not ideal but better than nothing)
        if (!startDate && profile.assetProfile && profile.assetProfile.founded) {
          const f = profile.assetProfile.founded;
          // if it's a year number
          if (typeof f === 'number' && f > 1800) {
            startDate = new Date(f, 0, 1);
          } else {
            const parsed = Date.parse(f);
            if (!isNaN(parsed)) startDate = new Date(parsed);
          }
        }
      }
    } catch (e) {
      // ignore lookup errors and fallback
      startDate = null;
    }

    // If we couldn't determine a start date, fallback to 10 years ago
    if (!startDate || isNaN(startDate.getTime())) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 10);
      startDate = d;
    }

    const endDate = new Date();

    const params = {
      period1: startDate.toISOString().split('T')[0],
      period2: endDate.toISOString().split('T')[0],
      interval: '1d',
    };

    const supabase = getSupabaseClient();

    // If Supabase is configured, try to return cached data first
    if (supabase) {
      try {
        // Assume a table named `stock_history` exists with columns:
        // ticker (text), start_date (date), end_date (date), data (jsonb), updated_at (timestamp)
        const { data: cached, error: cacheErr } = await supabase
          .from('stock_history')
          .select('data, start_date, end_date, updated_at')
          .eq('ticker', ticker.toUpperCase())
          .maybeSingle();

        if (!cacheErr && cached && cached.data) {
          // If caller requested a forced refetch, skip returning cached data
          if (!force) {
            return res.status(200).json({
              ticker,
              startDate: cached.start_date,
              endDate: cached.end_date,
              data: cached.data,
              cached: true,
              updated_at: cached.updated_at,
            });
          }
          // otherwise fall through to fetch fresh data and upsert
        }
      } catch (e) {
        console.warn('supabase cache check failed', e?.message || e);
      }
    }

    const result = await yahooFinance.historical(ticker, params);

    // After fetching, attempt to upsert into Supabase if available
    if (supabase) {
      try {
        await supabase.from('stock_history').upsert([
          {
            ticker: ticker.toUpperCase(),
            start_date: params.period1,
            end_date: params.period2,
            data: result,
          },
        ], { onConflict: ['ticker'] });
      } catch (e) {
        console.warn('supabase upsert failed', e?.message || e);
      }
    }

    return res.status(200).json({ ticker, startDate: params.period1, endDate: params.period2, data: result, cached: false });
  } catch (error) {
    console.error('stock-history error', error);
    return res.status(500).json({ error: error.message || 'Unknown error' });
  }
}
