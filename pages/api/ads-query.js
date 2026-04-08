import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '../../lib/firebase';
import { getAccessToken, gaqlSearch } from '../../lib/google-ads';

/**
 * POST /api/ads-query
 *
 * Streaming endpoint for the Account Optimizer chatbot.
 * For sourceOption 'mydata' or 'combined', fetches live data directly from the
 * Google Ads API — campaigns, keywords (with QS & IS%), and top search terms —
 * for the requested accounts and date range. No Firestore cache required.
 * Also includes any CSV-import datasets from Firestore as supplementary context.
 *
 * Body:
 *   userPrompt   {string}   required
 *   platform     {string}   focus area label (e.g. 'Campaign Performance')
 *   sourceOption {string}   'mydata' | 'combined' | 'model'
 *   geminiModel  {string}   e.g. 'gemini-2.5-flash'
 *   accountIds   {string[]} list of numeric Google Ads customer IDs
 *   dateFrom     {string}   YYYY-MM-DD
 *   dateTo       {string}   YYYY-MM-DD
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    userPrompt,
    platform,
    sourceOption = 'mydata',
    geminiModel  = 'gemini-2.5-flash-lite',
    accountIds   = [],
    dateFrom,
    dateTo,
  } = req.body || {};

  if (!userPrompt?.trim()) return res.status(400).json({ error: 'Missing userPrompt' });

  let context = '';

  // ── Live Google Ads data (always fetched when accounts are selected) ────────
  if (accountIds?.length) {
    const validDates = dateFrom && dateTo &&
      /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo);

    const dateFilter  = validDates
      ? `segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`
      : `segments.date DURING LAST_30_DAYS`;
    const periodLabel = validDates ? `${dateFrom} to ${dateTo}` : 'last 30 days';

    // Cap at 15 accounts to avoid excessive API calls in a single request
    const ids = accountIds.slice(0, 15).map(String).filter(id => /^\d+$/.test(id));

    if (ids.length) {
      try {
        const token = await getAccessToken();

        // Fetch all data for all accounts in parallel
        const accountResults = await Promise.allSettled(ids.map(async accountId => {
          const [
            campaignList,
            campaignMetrics,
            keywordList,
            keywordMetrics,
            searchTerms,
            accountInfo,
          ] = await Promise.allSettled([

            // ── Campaign list (all statuses, no date filter) ──────────────
            gaqlSearch(token, accountId, `
              SELECT
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.advertising_channel_type,
                campaign.bidding_strategy_type
              FROM campaign
              WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
              ORDER BY campaign.name
              LIMIT 200
            `),

            // ── Campaign metrics for the selected period ──────────────────
            gaqlSearch(token, accountId, `
              SELECT
                campaign.id,
                metrics.impressions,
                metrics.clicks,
                metrics.cost_micros,
                metrics.conversions,
                metrics.average_cpc,
                metrics.search_impression_share,
                metrics.search_top_impression_share
              FROM campaign
              WHERE ${dateFilter}
              ORDER BY metrics.impressions DESC
              LIMIT 200
            `).catch(() => ({ results: [] })),

            // ── Keyword list (text, match type, QS, bid) ─────────────────
            gaqlSearch(token, accountId, `
              SELECT
                ad_group_criterion.criterion_id,
                ad_group_criterion.keyword.text,
                ad_group_criterion.keyword.match_type,
                ad_group_criterion.status,
                ad_group_criterion.quality_info.quality_score,
                ad_group_criterion.quality_info.search_predicted_ctr,
                ad_group_criterion.quality_info.ad_relevance,
                ad_group_criterion.quality_info.landing_page_experience,
                ad_group_criterion.cpc_bid_micros,
                ad_group.name,
                campaign.name
              FROM keyword_view
              WHERE ad_group_criterion.status IN ('ENABLED', 'PAUSED')
              ORDER BY ad_group_criterion.keyword.text
              LIMIT 500
            `),

            // ── Keyword metrics for the selected period ───────────────────
            gaqlSearch(token, accountId, `
              SELECT
                ad_group_criterion.criterion_id,
                metrics.impressions,
                metrics.clicks,
                metrics.cost_micros,
                metrics.conversions,
                metrics.average_cpc,
                metrics.search_impression_share
              FROM keyword_view
              WHERE ${dateFilter}
                AND ad_group_criterion.status IN ('ENABLED', 'PAUSED')
              ORDER BY metrics.impressions DESC
              LIMIT 500
            `).catch(() => ({ results: [] })),

            // ── Top search terms for the selected period ──────────────────
            gaqlSearch(token, accountId, `
              SELECT
                search_term_view.search_term,
                search_term_view.status,
                ad_group.name,
                campaign.name,
                metrics.impressions,
                metrics.clicks,
                metrics.cost_micros,
                metrics.conversions,
                metrics.average_cpc
              FROM search_term_view
              WHERE ${dateFilter}
              ORDER BY metrics.impressions DESC
              LIMIT 100
            `).catch(() => ({ results: [] })),

            // ── Account name & currency ───────────────────────────────────
            gaqlSearch(token, accountId, `
              SELECT
                customer.id,
                customer.descriptive_name,
                customer.currency_code,
                customer.status
              FROM customer
              LIMIT 1
            `).catch(() => ({ results: [] })),
          ]);

          return { accountId, campaignList, campaignMetrics, keywordList, keywordMetrics, searchTerms, accountInfo };
        }));

        // ── Build context string from results ─────────────────────────────
        for (const settled of accountResults) {
          if (settled.status !== 'fulfilled') {
            context += `_Account data unavailable (API error)._\n\n`;
            continue;
          }

          const { accountId, campaignList, campaignMetrics, keywordList, keywordMetrics, searchTerms, accountInfo } = settled.value;

          // Account header
          const acctRow  = accountInfo.status === 'fulfilled' ? accountInfo.value?.results?.[0] : null;
          const acctName = acctRow?.customer?.descriptiveName || `Account ${accountId}`;
          const currency = acctRow?.customer?.currencyCode    || 'USD';
          context += `## Account: ${acctName} (ID: ${accountId}) | Currency: ${currency} | Period: ${periodLabel}\n\n`;

          // ── Campaigns ──────────────────────────────────────────────────
          if (campaignList.status === 'fulfilled' && campaignList.value?.results?.length) {
            const cmMetrics = {};
            for (const r of (campaignMetrics.status === 'fulfilled' ? campaignMetrics.value?.results ?? [] : [])) {
              const id = String(r.campaign?.id || '');
              if (!id) continue;
              const m = r.metrics || {};
              cmMetrics[id] = {
                impressions: Number(m.impressions || 0),
                clicks:      Number(m.clicks      || 0),
                cost:        Number(m.costMicros  || 0) / 1e6,
                conversions: Number(m.conversions || 0),
                cpc:         Number(m.averageCpc  || 0) / 1e6,
                is:          m.searchImpressionShare != null
                               ? (parseFloat(m.searchImpressionShare) * 100).toFixed(1) + '%'
                               : '—',
              };
            }

            const campaigns = campaignList.value.results.map(r => {
              const id = String(r.campaign?.id || '');
              return {
                id,
                name:    r.campaign?.name || id,
                status:  r.campaign?.status || 'UNKNOWN',
                bidding: (r.campaign?.biddingStrategyType || '').replace(/_/g, ' '),
                ...(cmMetrics[id] || { impressions: 0, clicks: 0, cost: 0, conversions: 0, cpc: 0, is: '—' }),
              };
            });
            campaigns.sort((a, b) => b.impressions - a.impressions);

            const topCampaigns = campaigns.slice(0, 30);
            context += `### Campaigns (${campaigns.length} total; top ${topCampaigns.length} by impressions)\n`;
            context += `| Campaign | Status | Bidding | Impr | Clicks | CTR | Cost (${currency}) | Avg CPC | Conv | IS% |\n`;
            context += `|---|---|---|---|---|---|---|---|---|---|\n`;
            for (const c of topCampaigns) {
              const ctr = c.impressions ? ((c.clicks / c.impressions) * 100).toFixed(2) + '%' : '—';
              context += `| ${c.name} | ${c.status} | ${c.bidding} | ${c.impressions.toLocaleString()} | ${c.clicks.toLocaleString()} | ${ctr} | ${c.cost.toFixed(2)} | ${c.cpc ? c.cpc.toFixed(2) : '—'} | ${c.conversions ? Math.round(c.conversions) : '—'} | ${c.is} |\n`;
            }
            context += '\n';
          }

          // ── Keywords ───────────────────────────────────────────────────
          if (keywordList.status === 'fulfilled' && keywordList.value?.results?.length) {
            const kwMetrics = {};
            for (const r of (keywordMetrics.status === 'fulfilled' ? keywordMetrics.value?.results ?? [] : [])) {
              const id = String(r.adGroupCriterion?.criterionId || '');
              if (!id) continue;
              const m = r.metrics || {};
              kwMetrics[id] = {
                impressions: Number(m.impressions || 0),
                clicks:      Number(m.clicks      || 0),
                cost:        Number(m.costMicros  || 0) / 1e6,
                conversions: Number(m.conversions || 0),
                cpc:         Number(m.averageCpc  || 0) / 1e6,
                is:          m.searchImpressionShare != null
                               ? (parseFloat(m.searchImpressionShare) * 100).toFixed(1) + '%'
                               : '—',
              };
            }

            const keywords = keywordList.value.results.map(r => {
              const id = String(r.adGroupCriterion?.criterionId || '');
              const qi = r.adGroupCriterion?.qualityInfo || {};
              return {
                id,
                text:     r.adGroupCriterion?.keyword?.text     || '',
                match:    (r.adGroupCriterion?.keyword?.matchType || '').replace(/_/g, ' '),
                status:   r.adGroupCriterion?.status || '',
                qs:       qi.qualityScore ?? '—',
                predCtr:  qi.searchPredictedCtr  || '',
                adRel:    qi.adRelevance          || '',
                lpe:      qi.landingPageExperience || '',
                bid:      Number(r.adGroupCriterion?.cpcBidMicros || 0) / 1e6,
                adGroup:  r.adGroup?.name  || '',
                campaign: r.campaign?.name || '',
                ...(kwMetrics[id] || { impressions: 0, clicks: 0, cost: 0, conversions: 0, cpc: 0, is: '—' }),
              };
            });
            keywords.sort((a, b) => b.impressions - a.impressions);

            const topKw = keywords.slice(0, 50);
            context += `### Keywords (${keywords.length} total; top ${topKw.length} by impressions)\n`;
            context += `| Keyword | Match | Ad Group | Campaign | QS | Pred CTR | Ad Rel | LPE | Bid | Impr | CTR | Cost | IS% |\n`;
            context += `|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
            for (const k of topKw) {
              const ctr = k.impressions ? ((k.clicks / k.impressions) * 100).toFixed(2) + '%' : '—';
              context += `| ${k.text} | ${k.match} | ${k.adGroup} | ${k.campaign} | ${k.qs} | ${k.predCtr} | ${k.adRel} | ${k.lpe} | ${k.bid ? k.bid.toFixed(2) : '—'} | ${k.impressions.toLocaleString()} | ${ctr} | ${k.cost.toFixed(2)} | ${k.is} |\n`;
            }
            context += '\n';
          }

          // ── Search Terms ───────────────────────────────────────────────
          if (searchTerms.status === 'fulfilled' && searchTerms.value?.results?.length) {
            const terms = searchTerms.value.results.slice(0, 25);
            context += `### Top Search Terms (top ${terms.length} by impressions)\n`;
            context += `| Query | Status | Ad Group | Campaign | Impr | Clicks | CTR | Cost |\n`;
            context += `|---|---|---|---|---|---|---|---|\n`;
            for (const r of terms) {
              const m   = r.metrics || {};
              const imp = Number(m.impressions || 0);
              const clk = Number(m.clicks      || 0);
              const ctr = imp ? ((clk / imp) * 100).toFixed(2) + '%' : '—';
              const cost = (Number(m.costMicros || 0) / 1e6).toFixed(2);
              context += `| ${r.searchTermView?.searchTerm || ''} | ${r.searchTermView?.status || ''} | ${r.adGroup?.name || ''} | ${r.campaign?.name || ''} | ${imp.toLocaleString()} | ${clk.toLocaleString()} | ${ctr} | ${cost} |\n`;
            }
            context += '\n';
          }
        }
      } catch (e) {
        console.warn('[ads-query] Live Google Ads fetch failed:', e?.message);
        context += `_Live account data unavailable: ${e.message}_\n\n`;
      }
    }

    // ── Supplementary CSV import data from Firestore (My Data / My Data+Model only) ──
    if (sourceOption !== 'model') try {
      const db   = getDb();
      const snap = await db.collection('ads_data').get();
      if (!snap.empty) {
        context += `## Supplementary CSV Import Data\n`;
        snap.forEach(docSnap => {
          const d = docSnap.data();
          context += `\n### Dataset: ${d.label} (${d.start_date} to ${d.end_date})\n`;
          const bycamp = {};
          (d.data || []).forEach(row => {
            if (!bycamp[row.campaign]) bycamp[row.campaign] = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
            bycamp[row.campaign].impressions += row.impressions || 0;
            bycamp[row.campaign].clicks      += row.clicks      || 0;
            bycamp[row.campaign].cost        += row.cost        || 0;
            bycamp[row.campaign].conversions += row.conversions || 0;
          });
          Object.entries(bycamp).forEach(([name, m]) => {
            const ctr = m.impressions ? ((m.clicks / m.impressions) * 100).toFixed(2) : '0.00';
            const cpc = m.clicks ? (m.cost / m.clicks).toFixed(2) : '0.00';
            context += `- **${name}**: Impressions ${Math.round(m.impressions).toLocaleString()}, Clicks ${Math.round(m.clicks).toLocaleString()}, CTR ${ctr}%, Cost $${m.cost.toFixed(2)}, CPC $${cpc}, Conversions ${m.conversions.toFixed(1)}\n`;
          });
        });
        context += '\n';
      }
    } catch { /* CSV data is optional */ }
  }

  // ── Build Gemini prompt ────────────────────────────────────────────────────
  const platformNote = platform ? `\nFocus area: ${platform}.` : '';
  const rankingInstruction = `\nWhen providing suggestions or recommendations, always present them as an explicitly ranked list — Rank 1 being the highest-impact action. Format each rank as:\n**Rank N — [Short Title]**\n[Explanation and reasoning]. Each suggestion should include the specific entity (campaign/ad group/keyword/ad), what to change, why, and the expected impact.`;
  let fullPrompt;

  if (!context.trim()) {
    fullPrompt = `You are a Google Ads expert and performance marketer.${platformNote}${rankingInstruction}\n\nUser: ${userPrompt}`;
  } else {
    const scopeNote = sourceOption === 'mydata'
      ? 'Base your analysis strictly on the provided account data — do not fabricate metrics not shown.'
      : 'Analyze the provided data and supplement with your broader Google Ads expertise where helpful.';
    fullPrompt = `You are a Google Ads expert and performance marketer. ${scopeNote}${platformNote}${rankingInstruction}\n\nLive Account Data:\n${context}\nUser: ${userPrompt}`;
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
