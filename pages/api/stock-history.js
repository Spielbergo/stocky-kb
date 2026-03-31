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
 * Convert any date representation (string, JS Date, Firestore Timestamp, or serialised
 * {_seconds,_nanoseconds} object) to a plain 'YYYY-MM-DD' string.
 */
function toDateStr(d) {
  if (!d) return null;
  if (typeof d === 'string')              return d.split('T')[0];
  if (d instanceof Date)                  return d.toISOString().split('T')[0];
  if (typeof d.toDate === 'function')     return d.toDate().toISOString().split('T')[0]; // Firestore Timestamp
  if (d._seconds !== undefined)           return new Date(d._seconds * 1000).toISOString().split('T')[0]; // serialised Timestamp
  return new Date(d).toISOString().split('T')[0];
}

/** Normalise a raw data row into a consistent {date,open,high,low,close,volume} shape. */
function normaliseRow(date, open, high, low, close, volume) {
  return {
    date:   toDateStr(date) ?? date,  // always a 'YYYY-MM-DD' string — never a Date/Timestamp
    open:   parseFloat(open)   || 0,
    high:   parseFloat(high)   || 0,
    low:    parseFloat(low)    || 0,
    close:  parseFloat(close)  || 0,
    volume: parseInt(volume)   || 0,
  };
}

function dedupeAndSort(rows) {
  const seen = new Set();
  return rows
    .filter(d => {
      const key = new Date(d.date).toISOString().split('T')[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * PRIMARY (if env var set): Twelve Data — free API key, 800 req/day, no rate-limit issues.
 * Sign up free at https://twelvedata.com → copy API key → set TWELVE_DATA_API_KEY in .env
 */
async function fetchFromTwelveData(ticker, startStr, endStr) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error('No TWELVE_DATA_API_KEY configured');

  // Twelve Data paginates at 5000 rows; for long ranges we may need multiple pages
  const allRows = [];
  let page = 1;

  while (true) {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker.toUpperCase())}&interval=1day&start_date=${startStr}&end_date=${endStr}&outputsize=5000&page=${page}&apikey=${apiKey}&format=JSON`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let json;
    try {
      const res = await fetch(url, { signal: controller.signal });
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }

    if (json?.status === 'error') throw new Error(`Twelve Data: ${json.message}`);
    const values = json?.values;
    if (!Array.isArray(values) || values.length === 0) break;

    for (const v of values) {
      allRows.push(normaliseRow(v.datetime, v.open, v.high, v.low, v.close, v.volume ?? 0));
    }

    // Twelve Data returns newest first; if we got fewer than 5000 we have all pages
    if (values.length < 5000) break;
    page++;
  }

  if (allRows.length === 0) throw new Error(`Twelve Data returned no data for ${ticker}`);
  console.log(`📈 Twelve Data: ${allRows.length} rows for ${ticker}`);
  return dedupeAndSort(allRows);
}

/**
 * SECONDARY: Stooq — free, no API key needed.
 * Must send browser-like headers or Stooq returns an HTML block page.
 */
async function fetchFromStooq(ticker, startStr, endStr) {
  const d1  = startStr.replace(/-/g, '');
  const d2  = endStr.replace(/-/g, '');
  const sym = ticker.toLowerCase();

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://stooq.com/',
  };

  // Try with .us suffix first (US-listed stocks), then bare symbol
  for (const suffix of ['.us', '']) {
    const url = `https://stooq.com/q/d/l/?s=${sym}${suffix}&d1=${d1}&d2=${d2}&i=d`;
    let text;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
        if (!res.ok) { console.warn(`Stooq ${suffix}: HTTP ${res.status}`); continue; }
        text = await res.text();
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.warn(`Stooq ${suffix} fetch error: ${e.message}`);
      continue;
    }

    // Stooq returns HTML or "No data" when blocked / ticker not found
    const firstLine = text?.trim().split('\n')[0] || '';
    if (!firstLine.startsWith('Date') || !text.includes(',')) {
      console.warn(`Stooq ${suffix}: unexpected response (first 80 chars): ${text?.slice(0, 80)}`);
      continue;
    }

    const lines = text.trim().split('\n');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 5) continue;
      const [date, open, high, low, close, volume = '0'] = parts;
      if (!date || date === 'Date') continue;
      rows.push(normaliseRow(date, open, high, low, close, volume));
    }

    if (rows.length > 0) {
      console.log(`📈 Stooq: ${rows.length} rows for ${ticker}${suffix}`);
      return dedupeAndSort(rows);
    }
  }

  throw new Error(`Stooq returned no usable data for ${ticker}`);
}

/**
 * FALLBACK: Yahoo Finance (chunked 1-year windows + exponential backoff).
 * Only used when Stooq fails.
 */
async function fetchFromYahoo(ticker, startStr, endStr) {
  const chunks = [];
  let cur = new Date(startStr);
  const endDate = new Date(endStr);
  while (cur < endDate) {
    const chunkEnd = new Date(cur);
    chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());
    chunks.push({ period1: cur.toISOString().split('T')[0], period2: chunkEnd.toISOString().split('T')[0] });
    cur = new Date(chunkEnd);
    cur.setDate(cur.getDate() + 1);
  }

  const BACKOFFS = [12000, 25000, 45000];
  const allData  = [];

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(3000);
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
                      msg.toLowerCase().includes('unexpected token');
        if (is429 && attempts < BACKOFFS.length) {
          await sleep(BACKOFFS[attempts++]);
        } else {
          throw e;
        }
      }
    }
  }

  // Normalise Yahoo's field names and Date objects into the same shape as the other sources
  const normalized = allData.map(r => ({
    date:   toDateStr(r.date),
    open:   parseFloat(r.open)              || 0,
    high:   parseFloat(r.high)              || 0,
    low:    parseFloat(r.low)               || 0,
    close:  parseFloat(r.adjClose ?? r.close) || 0,
    volume: parseInt(r.volume)              || 0,
  }));
  console.log(`📈 Yahoo Finance: ${normalized.length} rows for ${ticker}`);
  return dedupeAndSort(normalized);
}

/**
 * Try sources in order: Twelve Data (if key set) → Stooq → Yahoo Finance
 */
async function fetchWithFallback(ticker, startStr, endStr) {
  // 1. Twelve Data — most reliable if API key is configured
  if (process.env.TWELVE_DATA_API_KEY) {
    try {
      return await fetchFromTwelveData(ticker, startStr, endStr);
    } catch (e) {
      console.warn(`Twelve Data failed for ${ticker}: ${e.message}`);
    }
  }

  // 2. Stooq — free, no key needed
  try {
    return await fetchFromStooq(ticker, startStr, endStr);
  } catch (e) {
    console.warn(`Stooq failed for ${ticker}: ${e.message}`);
  }

  // 3. Yahoo Finance — last resort
  return await fetchFromYahoo(ticker, startStr, endStr);
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
    // without hitting any external API.
    if (db && !force) {
      try {
        const doc = await db.collection('stock_history').doc(ticker.toUpperCase()).get();
        if (doc.exists) {
          const cached = doc.data();
          if (cached?.data?.length) {
            const cacheStart = new Date(cached.start_date);
            const cacheEnd   = new Date(cached.end_date);
            const needStart  = new Date(reqStart);
            const needEnd    = new Date(reqEnd);
            if (cacheStart <= needStart && cacheEnd >= needEnd) {
              // Normalise dates from Firestore (may be Timestamps or serialised objects)
              const data = cached.data
                .map(d => ({ ...d, date: toDateStr(d.date) }))
                .filter(d => {
                  const dt = new Date(d.date);
                  return dt >= needStart && dt <= needEnd;
                });
              console.log(`✅ Firestore cache hit for ${ticker}: ${data.length} rows`);
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

    // ── Fetch from data source (Stooq → Yahoo fallback) ─────────────────────
    const data = await fetchWithFallback(ticker, reqStart, reqEnd);

    // ── Persist to Firestore ─────────────────────────────────────────────────
    // Ensure all dates are plain YYYY-MM-DD strings before writing — Firestore
    // Timestamps would come back corrupted on the next read.
    if (db) {
      try {
        const dataToStore = data.map(d => ({ ...d, date: toDateStr(d.date) }));
        await db.collection('stock_history').doc(ticker.toUpperCase()).set({
          ticker:     ticker.toUpperCase(),
          start_date: reqStart,
          end_date:   reqEnd,
          data:       dataToStore,
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
      return res.status(429).json({ error: 'All data sources are rate-limited right now. Wait 60 seconds and try again, or import data manually via CSV.' });
    }
    return res.status(500).json({ error: msg });
  }
}
