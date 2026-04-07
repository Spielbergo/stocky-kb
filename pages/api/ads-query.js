import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '../../lib/firebase';

/**
 * POST /api/ads-query
 * Streaming endpoint for the Account Optimizer chatbox.
 * Fetches Google Ads account + campaign data from Firestore, builds a rich
 * context string, then streams a Gemini response back chunk-by-chunk.
 *
 * Body: { userPrompt, platform, sourceOption, geminiModel, accountIds[] }
 * sourceOption: 'mydata' | 'combined' | 'model'
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    userPrompt,
    platform,
    sourceOption = 'mydata',
    geminiModel  = 'gemini-2.5-flash-lite',
    accountIds,
  } = req.body || {};

  if (!userPrompt?.trim()) return res.status(400).json({ error: 'Missing userPrompt' });

  // ── Build context from Firestore ──────────────────────────────────────────
  let context = '';

  if (sourceOption !== 'model') {
    const db = getDb();

    // 1. Account-level data (ads_cache/accounts)
    try {
      const doc = await db.collection('ads_cache').doc('accounts').get();
      if (doc.exists) {
        let { accounts = [] } = doc.data();
        if (accountIds?.length) {
          const ids = accountIds.map(String);
          accounts = accounts.filter(a => ids.includes(String(a.id)));
        }
        if (accounts.length) {
          context += `## Google Ads Accounts\n`;
          accounts.forEach(a => {
            context += `- **${a.name}** (ID: ${a.id}, Status: ${a.status}, Currency: ${a.currencyCode})\n`;
            if (a.metrics) {
              const m = a.metrics;
              const spend = (m.costMicros / 1e6).toFixed(2);
              const ctr   = m.impressions ? ((m.clicks / m.impressions) * 100).toFixed(2) : '0.00';
              const cpc   = m.clicks ? (m.costMicros / 1e6 / m.clicks).toFixed(2) : '0.00';
              context += `  30d metrics — Impressions: ${Number(m.impressions).toLocaleString()}, Clicks: ${Number(m.clicks).toLocaleString()}, CTR: ${ctr}%, Spend: $${spend}, CPC: $${cpc}, Conversions: ${Number(m.conversions).toFixed(1)}\n`;
            }
          });
          context += '\n';
        }
      }
    } catch (e) {
      console.warn('[ads-query] accounts fetch failed:', e?.message);
    }

    // 2. Campaign-level data from CSV imports (ads_data collection)
    try {
      const snap = await db.collection('ads_data').get();
      if (!snap.empty) {
        context += `## Campaign Performance Data (CSV Imports)\n`;
        snap.forEach(docSnap => {
          const d = docSnap.data();
          context += `\n### Dataset: ${d.label} (${d.start_date} to ${d.end_date})\n`;

          // Aggregate rows by campaign name
          const bycamp = {};
          (d.data || []).forEach(row => {
            if (!bycamp[row.campaign]) {
              bycamp[row.campaign] = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
            }
            bycamp[row.campaign].impressions  += row.impressions  || 0;
            bycamp[row.campaign].clicks       += row.clicks       || 0;
            bycamp[row.campaign].cost         += row.cost         || 0;
            bycamp[row.campaign].conversions  += row.conversions  || 0;
          });

          Object.entries(bycamp).forEach(([name, m]) => {
            const ctr = m.impressions ? ((m.clicks / m.impressions) * 100).toFixed(2) : '0.00';
            const cpc = m.clicks      ? (m.cost / m.clicks).toFixed(2)               : '0.00';
            context += `- **${name}**: Impressions ${Math.round(m.impressions).toLocaleString()}, Clicks ${Math.round(m.clicks).toLocaleString()}, CTR ${ctr}%, Cost $${m.cost.toFixed(2)}, CPC $${cpc}, Conversions ${m.conversions.toFixed(1)}\n`;
          });
        });
        context += '\n';
      }
    } catch (e) {
      console.warn('[ads-query] ads_data fetch failed:', e?.message);
    }
  }

  // ── Build prompt ───────────────────────────────────────────────────────────
  const platformNote = platform ? `\nFocus area: ${platform}.` : '';
  let fullPrompt;

  if (sourceOption === 'model') {
    fullPrompt = `You are a Google Ads expert and performance marketer.${platformNote}\n\nUser: ${userPrompt}`;
  } else if (!context.trim()) {
    fullPrompt = `You are a Google Ads expert. No account or campaign data is available yet — the user should sync their accounts (using the Sync button) and/or import CSV data first.${platformNote}\n\nUser: ${userPrompt}`;
  } else {
    fullPrompt = `You are a Google Ads expert and performance marketer. Analyze the data below and answer the user's question concisely.${platformNote}\n\nData:\n${context}\nUser: ${userPrompt}`;
  }

  // ── Stream Gemini response ─────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: geminiModel });
    const resultStream = await model.generateContentStream(fullPrompt);

    for await (const chunk of resultStream.stream) {
      const text = chunk.text();
      if (text) res.write(text);
    }
  } catch (err) {
    const isQuota = err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('Quota exceeded') || err?.status === 429;
    const msg = isQuota
      ? 'Service is temporarily over capacity. Please try again in a few minutes.'
      : err?.message || 'Error generating content.';
    res.write(`\n\n**Error:** ${msg}`);
  }

  res.end();
}
