export const cosineSimilarity = (a, b) => {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
};

// ── Technical Indicators ──────────────────────────────────────────────────────
// All functions accept an array of numbers (prices) and return an array of the
// same length, with nulls for positions where there is insufficient data.

/**
 * Simple Moving Average
 * @param {number[]} data - price series
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function sma(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

/**
 * Exponential Moving Average
 * @param {number[]} data - price series
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function ema(data, period) {
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  // seed with the SMA of the first `period` values
  let seed = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = seed;
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Relative Strength Index
 * @param {number[]} data - price series
 * @param {number} period - default 14
 * @returns {(number|null)[]}
 */
export function rsi(data, period = 14) {
  const result = new Array(data.length).fill(null);
  if (data.length < period + 1) return result;

  // Calculate initial avg gain/loss over first period
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = 100 - 100 / (1 + rs);

  // Wilder's smoothing for subsequent values
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[i] = 100 - 100 / (1 + rs2);
  }
  return result;
}

/**
 * MACD — returns { macd, signal, histogram } each as arrays of (number|null)
 * @param {number[]} data - price series
 * @param {number} fastPeriod  - default 12
 * @param {number} slowPeriod  - default 26
 * @param {number} signalPeriod - default 9
 * @returns {{ macd: (number|null)[], signal: (number|null)[], histogram: (number|null)[] }}
 */
export function macd(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEma  = ema(data, fastPeriod);
  const slowEma  = ema(data, slowPeriod);
  const macdLine = data.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? fastEma[i] - slowEma[i] : null
  );

  // Build a dense array of just the non-null MACD values to seed the signal EMA
  const macdValues  = macdLine.filter(v => v !== null);
  const signalDense = ema(macdValues, signalPeriod);

  // Map back to original index space
  const signalLine = new Array(data.length).fill(null);
  let denseIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] !== null) {
      signalLine[i] = signalDense[denseIdx] ?? null;
      denseIdx++;
    }
  }

  const histogram = data.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null ? macdLine[i] - signalLine[i] : null
  );

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Bollinger Bands — returns { upper, middle, lower } each as arrays of (number|null)
 * @param {number[]} data - price series
 * @param {number} period  - default 20
 * @param {number} stdDev  - multiplier, default 2
 * @returns {{ upper: (number|null)[], middle: (number|null)[], lower: (number|null)[] }}
 */
export function bollingerBands(data, period = 20, stdDev = 2) {
  const middle = sma(data, period);
  const upper  = new Array(data.length).fill(null);
  const lower  = new Array(data.length).fill(null);

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const mean  = middle[i];
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdDev * sd;
    lower[i] = mean - stdDev * sd;
  }

  return { upper, middle, lower };
}

/**
 * On-Balance Volume
 * @param {number[]} closes
 * @param {number[]} volumes
 * @returns {number[]}
 */
export function obv(closes, volumes) {
  const result = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1])      result[i] = result[i - 1] + volumes[i];
    else if (closes[i] < closes[i - 1]) result[i] = result[i - 1] - volumes[i];
    else                                 result[i] = result[i - 1];
  }
  return result;
}

/**
 * Detect Golden Cross / Death Cross signals from two SMA series.
 * Returns array of { index, type: 'golden'|'death', date, price }
 * @param {(number|null)[]} fast - e.g. SMA 50
 * @param {(number|null)[]} slow - e.g. SMA 200
 * @param {object[]} series      - original price series with .date and .close
 */
export function crossSignals(fast, slow, series) {
  const signals = [];
  for (let i = 1; i < fast.length; i++) {
    if (fast[i] === null || slow[i] === null || fast[i-1] === null || slow[i-1] === null) continue;
    const wasBelowOrEqual = fast[i - 1] <= slow[i - 1];
    const isAbove         = fast[i] > slow[i];
    const wasAboveOrEqual = fast[i - 1] >= slow[i - 1];
    const isBelow         = fast[i] < slow[i];
    if (wasBelowOrEqual && isAbove)  signals.push({ index: i, type: 'golden', date: series[i]?.date, price: series[i]?.close });
    if (wasAboveOrEqual && isBelow)  signals.push({ index: i, type: 'death',  date: series[i]?.date, price: series[i]?.close });
  }
  return signals;
}
