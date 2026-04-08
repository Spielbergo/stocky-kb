import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAccessToken, gaqlSearch } from '../../lib/google-ads';

/**
 * POST /api/ads-optimize
 *
 * Fetches live Google Ads data (with resource names) for the selected accounts,
 * then asks Gemini to return a structured JSON list of suggested mutations.
 * The returned mutations can be passed directly to /api/ads-apply.
 *
 * Body:
 *   accountIds    {string[]}  required — list of numeric Google Ads customer IDs
 *   dateFrom      {string}    YYYY-MM-DD
 *   dateTo        {string}    YYYY-MM-DD
 *   instruction   {string}    optional — user's focus area / specific instruction
 *   geminiModel   {string}    Gemini model to use
 *
 * Returns:
 *   { mutations: MutationObject[], accounts: { id, name }[] }
 *
 * MutationObject:
 *   id            {string}   unique short ID for client-side keying
 *   type          {string}   "bid" | "status" | "budget" | "ad_copy"
 *   level         {string}   "campaign" | "ad_group" | "keyword" | "ad"
 *   accountId     {string}   customer ID (digits)
 *   resourceName  {string}   exact Google Ads resource name URI
 *   budgetResourceName {string}  only for type=budget (campaign budget resource name)
 *   entityName    {string}   human-readable entity name
 *   campaignName  {string}   parent campaign name
 *   adGroupName   {string?}  parent ad group name if applicable
 *   field         {string}   "cpcBidMicros"|"status"|"amountMicros"|"headlines"|"descriptions"
 *   before        {number|string|string[]}  current value (micros for bids/budgets)
 *   after         {number|string|string[]}  proposed value
 *   beforeDisplay {string}   human-readable current value
 *   afterDisplay  {string}   human-readable proposed value
 *   reason        {string}   actionable explanation
 *   confidence    {string}   "high" | "medium" | "low"
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    accountIds   = [],
    dateFrom,
    dateTo,
    instruction  = '',
    platform     = '',
    geminiModel  = 'gemini-2.5-flash',
  } = req.body || {};

  if (!accountIds?.length) return res.status(400).json({ error: 'accountIds is required' });

  const validDates = dateFrom && dateTo &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo);

  const dateFilter  = validDates
    ? `segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`
    : `segments.date DURING LAST_30_DAYS`;
  const periodLabel = validDates ? `${dateFrom} to ${dateTo}` : 'last 30 days';

  const ids = accountIds.slice(0, 5).map(String).filter(id => /^\d+$/.test(id));
  if (!ids.length) return res.status(400).json({ error: 'No valid accountIds provided' });

  // ── Fetch live data with resource names for all accounts ──────────────────
  let context = '';
  const accountMeta = [];

  try {
    const token = await getAccessToken();

    const accountResults = await Promise.allSettled(ids.map(async accountId => {
      const [
        campaignDefs,
        campaignMetrics,
        keywords,
        ads,
        accountInfo,
      ] = await Promise.allSettled([

        // ── Campaigns: definitions + budget resource names ────────────────
        gaqlSearch(token, accountId, `
          SELECT
            campaign.resource_name,
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            campaign.campaign_budget,
            campaign_budget.resource_name,
            campaign_budget.amount_micros,
            campaign_budget.explicitly_shared
          FROM campaign
          WHERE campaign.status IN ('ENABLED', 'PAUSED')
          ORDER BY campaign.name
          LIMIT 100
        `),

        // ── Campaign metrics for the date period ──────────────────────────
        gaqlSearch(token, accountId, `
          SELECT
            campaign.id,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.average_cpc,
            metrics.search_impression_share,
            metrics.search_budget_lost_impression_share,
            metrics.search_rank_lost_impression_share
          FROM campaign
          WHERE ${dateFilter}
          ORDER BY metrics.impressions DESC
          LIMIT 100
        `).catch(() => ({ results: [] })),

        // ── Keywords: definitions + metrics ───────────────────────────────
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_criterion.resource_name,
            ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            ad_group_criterion.status,
            ad_group_criterion.quality_info.quality_score,
            ad_group_criterion.cpc_bid_micros,
            ad_group.name,
            campaign.name,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.average_cpc,
            metrics.search_impression_share,
            metrics.conversions
          FROM keyword_view
          WHERE ${dateFilter}
            AND ad_group_criterion.status IN ('ENABLED', 'PAUSED')
          ORDER BY metrics.impressions DESC
          LIMIT 150
        `).catch(() => ({ results: [] })),

        // ── RSA ads: headlines + descriptions for ad copy suggestions ─────
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_ad.resource_name,
            ad_group_ad.status,
            ad_group_ad.ad.type,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.final_urls,
            ad_group.name,
            campaign.name,
            metrics.impressions,
            metrics.clicks
          FROM ad_group_ad
          WHERE ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
            AND ad_group_ad.status IN ('ENABLED', 'PAUSED')
            AND ${dateFilter}
          ORDER BY metrics.impressions DESC
          LIMIT 30
        `).catch(() => ({ results: [] })),

        // ── Account info ──────────────────────────────────────────────────
        gaqlSearch(token, accountId, `
          SELECT customer.id, customer.descriptive_name, customer.currency_code
          FROM customer LIMIT 1
        `).catch(() => ({ results: [] })),
      ]);

      return { accountId, campaignDefs, campaignMetrics, keywords, ads, accountInfo };
    }));

    // ── Build context for Gemini ──────────────────────────────────────────
    for (const settled of accountResults) {
      if (settled.status !== 'fulfilled') continue;

      const { accountId, campaignDefs, campaignMetrics, keywords, ads, accountInfo } = settled.value;

      const acctRow  = accountInfo.status === 'fulfilled' ? accountInfo.value?.results?.[0] : null;
      const acctName = acctRow?.customer?.descriptiveName || `Account ${accountId}`;
      const currency = acctRow?.customer?.currencyCode    || 'USD';
      accountMeta.push({ id: accountId, name: acctName });

      context += `## Account: "${acctName}" | ID: ${accountId} | Currency: ${currency} | Period: ${periodLabel}\n\n`;

      // ── Campaign table with resource names ────────────────────────────
      if (campaignDefs.status === 'fulfilled' && campaignDefs.value?.results?.length) {
        const metricsMap = {};
        for (const r of (campaignMetrics.status === 'fulfilled' ? campaignMetrics.value?.results ?? [] : [])) {
          const id = String(r.campaign?.id || '');
          if (!id) continue;
          const m = r.metrics || {};
          metricsMap[id] = {
            impressions: Number(m.impressions || 0),
            clicks:      Number(m.clicks      || 0),
            cost:        Number(m.costMicros  || 0) / 1e6,
            conversions: Number(m.conversions || 0),
            cpc:         Number(m.averageCpc  || 0) / 1e6,
            is:          m.searchImpressionShare    != null ? (parseFloat(m.searchImpressionShare)    * 100).toFixed(1) : null,
            budgetLost:  m.searchBudgetLostImpressionShare != null ? (parseFloat(m.searchBudgetLostImpressionShare) * 100).toFixed(1) : null,
            rankLost:    m.searchRankLostImpressionShare   != null ? (parseFloat(m.searchRankLostImpressionShare)   * 100).toFixed(1) : null,
          };
        }

        context += `### Campaigns\n`;
        context += `| ResourceName | BudgetResourceName | Name | Status | Bidding | BudgetMicros | Impr | Clicks | Cost${currency} | Conv | IS% | BudgetLostIS% | RankLostIS% |\n`;
        context += `|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

        for (const r of campaignDefs.value.results) {
          const id       = String(r.campaign?.id || '');
          const m        = metricsMap[id] || {};
          const ctr      = m.impressions ? ((m.clicks / m.impressions) * 100).toFixed(2) + '%' : '—';
          const budgetMicros = Number(r.campaignBudget?.amountMicros || 0);
          context += `| ${r.campaign?.resourceName || ''} | ${r.campaignBudget?.resourceName || ''} | ${r.campaign?.name || ''} | ${r.campaign?.status || ''} | ${(r.campaign?.biddingStrategyType || '').replace(/_/g, ' ')} | ${budgetMicros} | ${(m.impressions||0).toLocaleString()} | ${(m.clicks||0).toLocaleString()} | ${m.cost != null ? m.cost.toFixed(2) : '—'} | ${m.conversions != null ? Math.round(m.conversions) : '—'} | ${m.is ?? '—'} | ${m.budgetLost ?? '—'} | ${m.rankLost ?? '—'} |\n`;
        }
        context += '\n';
      }

      // ── Keyword table with resource names ─────────────────────────────
      if (keywords.status === 'fulfilled' && keywords.value?.results?.length) {
        const top = keywords.value.results.slice(0, 100);
        context += `### Keywords (top ${top.length} by impressions)\n`;
        context += `| ResourceName | Keyword | Match | Campaign | AdGroup | Status | QS | BidMicros | Impr | Clicks | Cost${currency} | IS% |\n`;
        context += `|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
        for (const r of top) {
          const m   = r.metrics || {};
          const imp = Number(m.impressions || 0);
          const clk = Number(m.clicks      || 0);
          const is  = m.searchImpressionShare != null ? (parseFloat(m.searchImpressionShare) * 100).toFixed(1) : '—';
          context += `| ${r.adGroupCriterion?.resourceName || ''} | ${r.adGroupCriterion?.keyword?.text || ''} | ${(r.adGroupCriterion?.keyword?.matchType || '').replace(/_/g, ' ')} | ${r.campaign?.name || ''} | ${r.adGroup?.name || ''} | ${r.adGroupCriterion?.status || ''} | ${r.adGroupCriterion?.qualityInfo?.qualityScore ?? '—'} | ${r.adGroupCriterion?.cpcBidMicros || 0} | ${imp.toLocaleString()} | ${clk.toLocaleString()} | ${(Number(m.costMicros||0)/1e6).toFixed(2)} | ${is} |\n`;
        }
        context += '\n';
      }

      // ── RSA ad copy ────────────────────────────────────────────────────
      if (ads.status === 'fulfilled' && ads.value?.results?.length) {
        context += `### RSA Ads (top ${Math.min(ads.value.results.length, 20)} by impressions)\n`;
        for (const r of ads.value.results.slice(0, 20)) {
          const headlines = (r.adGroupAd?.ad?.responsiveSearchAd?.headlines || []).map(h => h.text);
          const descs     = (r.adGroupAd?.ad?.responsiveSearchAd?.descriptions || []).map(d => d.text);
          const m         = r.metrics || {};
          context += `- ResourceName: \`${r.adGroupAd?.resourceName || ''}\`\n`;
          context += `  Campaign: ${r.campaign?.name || ''} | AdGroup: ${r.adGroup?.name || ''} | Impr: ${Number(m.impressions||0).toLocaleString()}\n`;
          context += `  Headlines: ${JSON.stringify(headlines)}\n`;
          context += `  Descriptions: ${JSON.stringify(descs)}\n`;
        }
        context += '\n';
      }
    }
  } catch (e) {
    return res.status(500).json({ error: `Failed to fetch account data: ${e.message}` });
  }

  if (!context.trim()) {
    return res.status(422).json({ error: 'No data could be fetched for the selected accounts.' });
  }

  // ── Ask Gemini for structured mutation suggestions ─────────────────────────
  const platformFocusMap = {
    'Campaign Performance':  'Focus on status and bid changes that improve campaign-level efficiency and impression share.',
    'Ad Copy Review':        'Focus primarily on ad_copy mutations — rewrite underperforming headlines and descriptions. Include at least 4 ad_copy suggestions if data supports it.',
    'Keyword Strategy':      'Focus on keyword-level bid adjustments and pausing poor performers. Prioritize keywords with low Quality Score or high cost and no conversions.',
    'Budget Optimization':   'Focus primarily on budget mutations — identify campaigns with high BudgetLostIS% and recommend increases, and trim budgets from underperformers.',
    'Conversion Analysis':   'Focus on bid and status changes based on conversion data — pause keywords with high spend and zero conversions, raise bids on high-converting keywords.',
    'Improve QS':            'Focus on Quality Score improvement — identify keywords with QS below 6, suggest bid adjustments, ad copy rewrites to better match keyword intent, and flag keywords that need tighter ad group theming or landing page alignment.',
    'Custom Analysis':       '',
  };

  const platformNote    = platformFocusMap[platform] || '';
  const instructionNote = [
    platformNote    ? `\n\nAnalysis focus (${platform}): ${platformNote}` : '',
    instruction?.trim() ? `\n\nUser instruction: "${instruction.trim()}"` : '',
  ].join('');

  const prompt = `You are a Google Ads optimization expert. Analyze the live account data below and generate a list of specific, high-impact mutations (changes) that should be applied to improve performance.

IMPORTANT RULES:
1. Return ONLY valid JSON — no markdown code fences, no explanatory text outside JSON.
2. The resourceName in each mutation MUST be copied EXACTLY from the data — do not modify or invent resource names.
3. For bid mutations: before/after values are in MICROS (1,000,000 = $1.00).
4. For budget mutations: before/after values are in MICROS. Use the budgetResourceName from the campaign row, not the campaign resourceName.
5. For status mutations: use "ENABLED" or "PAUSED" only.
6. For ad_copy mutations: before/after are JSON arrays of strings (headline or description texts only, no pinning data needed). Provide complete replacement arrays (not partial).
7. Maximum 20 mutations total. Prioritize high-confidence, high-impact changes.
8. Only suggest bid changes for manual or enhanced CPC bidding strategies.
9. Do not suggest changes where insufficient data exists.
10. Include a DIVERSE MIX of mutation types. Do not return only bid mutations. Where data supports it, include at least 2 suggestions from each of: bid, status, budget, ad_copy — unless the analysis focus below overrides this.${instructionNote}

Return this exact JSON shape (one example of each mutation type — your response must include all 4 types where data supports it):
{
  "mutations": [
    {
      "id": "m1",
      "type": "bid",
      "level": "keyword",
      "accountId": "1234567890",
      "resourceName": "customers/1234567890/adGroupCriteria/111~222",
      "entityName": "blue shoes",
      "campaignName": "Brand - Exact",
      "adGroupName": "Blue Shoes",
      "field": "cpcBidMicros",
      "before": 500000,
      "after": 700000,
      "beforeDisplay": "$0.50",
      "afterDisplay": "$0.70",
      "reason": "High CTR (8.2%) with low IS (34%); increasing bid should recover impression share.",
      "confidence": "high"
    },
    {
      "id": "m2",
      "type": "status",
      "level": "campaign",
      "accountId": "1234567890",
      "resourceName": "customers/1234567890/campaigns/999",
      "entityName": "Legacy Brand - BMM",
      "campaignName": "Legacy Brand - BMM",
      "field": "status",
      "before": "ENABLED",
      "after": "PAUSED",
      "beforeDisplay": "Enabled",
      "afterDisplay": "Paused",
      "reason": "Zero conversions over 90 days with $420 spend; traffic absorbed by other campaigns.",
      "confidence": "high"
    },
    {
      "id": "m3",
      "type": "budget",
      "level": "campaign",
      "accountId": "1234567890",
      "resourceName": "customers/1234567890/campaigns/888",
      "budgetResourceName": "customers/1234567890/campaignBudgets/777",
      "entityName": "Shopping - Core",
      "campaignName": "Shopping - Core",
      "field": "amountMicros",
      "before": 5000000,
      "after": 8000000,
      "beforeDisplay": "$5.00/day",
      "afterDisplay": "$8.00/day",
      "reason": "Budget lost IS of 42% indicates the campaign is regularly capped; increasing budget should capture missed clicks.",
      "confidence": "medium"
    },
    {
      "id": "m4",
      "type": "ad_copy",
      "level": "ad",
      "accountId": "1234567890",
      "resourceName": "customers/1234567890/adGroupAds/555~666",
      "entityName": "RSA - Blue Shoes Promo",
      "campaignName": "Brand - Exact",
      "adGroupName": "Blue Shoes",
      "field": "headlines",
      "before": ["Buy Blue Shoes", "Free Shipping", "Shop Now"],
      "after": ["Blue Shoes Sale — 30% Off", "Free Same-Day Shipping", "Shop 200+ Styles"],
      "beforeDisplay": "Buy Blue Shoes | Free Shipping | Shop Now",
      "afterDisplay": "Blue Shoes Sale — 30% Off | Free Same-Day Shipping | Shop 200+ Styles",
      "reason": "Current headlines lack specificity and urgency; updated copy includes discount, speed, and variety signals.",
      "confidence": "medium"
    }
  ]
}

Valid type values: "bid", "status", "budget", "ad_copy"
Valid level values: "campaign", "ad_group", "keyword", "ad"
Valid field values: "cpcBidMicros" (for bid), "status" (for status), "amountMicros" (for budget), "headlines" or "descriptions" (for ad_copy)
Valid confidence values: "high", "medium", "low"

For budget mutations, ALSO include a "budgetResourceName" field with the budget resource name from the BudgetResourceName column.

Live Account Data:
${context}`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      generationConfig: { responseMimeType: 'application/json' },
    });

    const result = await model.generateContent(prompt);
    const raw    = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Gemini occasionally wraps with code fences despite responseMimeType — strip and retry
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(stripped);
    }

    const mutations = (parsed.mutations || []).map((m, i) => ({
      ...m,
      id: m.id || `m${i + 1}`,
    }));

    return res.status(200).json({ mutations, accounts: accountMeta });
  } catch (e) {
    console.error('[ads-optimize] Gemini error:', e?.message);
    return res.status(500).json({ error: `Failed to generate suggestions: ${e.message}` });
  }
}
