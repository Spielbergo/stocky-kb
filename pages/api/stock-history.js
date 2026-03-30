import yahooFinance from 'yahoo-finance2';
import { getDb } from '../../lib/firebase';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Compute ISO date strings for the requested period. */
function calcPeriodDates(period, customStart, customEnd) {
  const end = customEnd ? new Date(customEnd) : new Date();
  let start;
  switch (period) {
    case '1y':   start = new Date(end); start.setFullYear(start.getFullYear() - 1);  break;
    case '3y':   start = new Date(end); start.setFullYear(start.getFullYear() - 3);  break;
    case '5y':   start = new Date(end); start.setFullYear(start.getFullYear() - 5);  break;
    case '10y':  start = new Date(end); start.setFullYear(start.getFullYear() - 10); break;
    case 'all':  start = new Date('1970-01-01'); break;
    case 'custom':
      start = customStart ? new Date(customStart) : new Date(end);
      if (!customStart) start.setFullYear(start.getFullYear() - 1);
      break;
    default:     start = new Date(end); start.setFullYear(start.getFullYear() - 10);
  }
  return {
    start: start.toISOString().split('T')[0],
    end:   end.toISOString().split('T')[0],
  };
}

/**
 * Fetch historical data in 1-year chunks with a pause between each to avoid Yahoo 429s.
 * Retries up to 3 times per chunk with exponential backoff on rate-limit errors.
 */
async function fetchChunked(ticker, startStr, endStr) {
  // Build list of 1-year date chunks
  const chunks = [];
  let cur = new Date(startStr);
  const endDate = new Date(endStr);
  while (cur < endDate) {
    const chunkEnd = new Date(cur);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());
    chunks.push({
      period1: cur.toISOString().split('T')[0],
      period2: chunkEnd.toISOString().split('T')[0],
    });
    cur = new Date(chunkEnd);
    cur.setDate(cur.getDate() + 1); // next day to avoid overlap
  }

  const BACKOFFS = [12000, 25000, 45000]; // 12s, 25s, 45s between retries

  const allData = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(3000); // 3s between chunks to respect rate limits
    let attempts = 0;
    while (true) {
      try {
        const result = await yahooFinance.historical(ticker.toUpperCase(), {
          period1:  chunks[i].period1,
          period2:  chunks[i].period2,
          interval: '1d',
        });
        allData.push(...(result || []));
        break;
      } catch (e) {
        const msg = e?.message || '';
        const is429 = msg.includes('429') ||
                      msg.toLowerCase().includes('too many') ||
                      msg.toLowerCase().includes('unexpected token'); // yahoo returns plain text on rate limit
        if (is429 && attempts < BACKOFFS.length) {
          await sleep(BACKOFFS[attempts]);
          attempts++;
        } else {
          throw e;
        }
      }
    }
  }

  // Deduplicate by date and sort ascending
  const seen = new Set();
  return allData
    .filter(d => {
      const key = new Date(d.date).toISOString().split('T')[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

export default async function handler(req, res) {
  try {
    const { ticker, period = '10y', startDate: qStart, endDate: qEnd } = req.query;
    const force = req.query.force === '1' || req.query.force === 'true';

    if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

    const { start: reqStart, end: reqEnd } = calcPeriodDates(period, qStart, qEnd);
    const db = getDb();

    // ── Cache check ─────────────────────────────────────────────────────────
    // If the cached data fully covers the requested date range, filter & return
    // without hitting Yahoo Finance at all (zero duplicates).
    if (db && !force) {
      try {
        const doc = await db.collection('stock_history').doc(ticker.toUpperCase()).get();
        if (doc.exists) {
          const cached = doc.data();
          if (cached?.data) {
            const cacheStart = new Date(cached.start_date);
            const cacheEnd   = new Date(cached.end_date);
            const needStart  = new Date(reqStart);
            const needEnd    = new Date(reqEnd);
            if (cacheStart <= needStart && cacheEnd >= needEnd) {
              const data = cached.data.filter(d => {
                const dt = new Date(d.date);
                return dt >= needStart && dt <= needEnd;
              });
              return res.status(200).json({
                ticker,
                startDate:  cached.start_date,
                endDate:    cached.end_date,
                data,
                cached:     true,
                updated_at: cached.updated_at ?? null,
              });
            }
          }
        }
      } catch (e) {
        console.warn('firebase cache check failed', e?.message || e);
      }
    }

    // ── Fetch from Yahoo (chunked to avoid 429) ──────────────────────────────
    const data = await fetchChunked(ticker, reqStart, reqEnd);

    // ── Persist to Firestore ─────────────────────────────────────────────────
    if (db) {
      try {
        await db.collection('stock_history').doc(ticker.toUpperCase()).set({
          ticker:     ticker.toUpperCase(),
          start_date: reqStart,
          end_date:   reqEnd,
          data,
          updated_at: new Date().toISOString(),
        }); // full overwrite — no merge so stale data doesn't linger
      } catch (e) {
        console.warn('firebase upsert failed', e?.message || e);
      }
    }

    return res.status(200).json({
      ticker,
      startDate:  reqStart,
      endDate:    reqEnd,
      data,
      cached:     false,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('stock-history error', error);
    const msg = error?.message || String(error) || 'Unknown error';
    const isRateLimit = msg.includes('429') ||
                        msg.toLowerCase().includes('too many requests') ||
                        (msg.toLowerCase().includes('unexpected token') && msg.toLowerCase().includes('too many'));
    if (isRateLimit) {
      return res.status(429).json({ error: 'Yahoo Finance rate limit hit. Wait 30–60 seconds and try again, or import data manually via CSV.' });
    }
    return res.status(500).json({ error: msg });
  }
}
