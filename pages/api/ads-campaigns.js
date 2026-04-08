/**
 * /api/ads-campaigns
 *
 * GET ?accountId=<id>&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD[&includePaused=1]
 *   Returns campaigns + metrics.
 *
 * GET ?accountId=<id>&campaignId=<id>&view=adGroups&...
 *   Returns ad groups + metrics for that campaign.
 *
 * GET ?accountId=<id>&campaignId=<id>&view=keywords&...
 *   Returns keywords (match type, QS, bid, metrics) for that campaign.
 *
 * GET ?accountId=<id>&campaignId=<id>&view=searchTerms&...
 *   Returns the search terms report for that campaign.
 *
 * GET ?accountId=<id>&campaignId=<id>&adGroupId=<id>&view=ads&...
 *   Returns ads (with RSA headlines/descriptions) for a specific ad group.
 */

import { getAccessToken, gaqlSearch } from '../../lib/google-ads';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { accountId, campaignId, adGroupId, view, dateFrom, dateTo, includePaused } = req.query;

  if (!accountId || !/^\d+$/.test(accountId)) {
    return res.status(400).json({ error: 'accountId is required and must be numeric' });
  }
  if (!dateFrom || !dateTo ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return res.status(400).json({ error: 'dateFrom and dateTo are required (YYYY-MM-DD)' });
  }
  if (campaignId && !/^\d+$/.test(campaignId)) {
    return res.status(400).json({ error: 'campaignId must be numeric' });
  }
  if (adGroupId && !/^\d+$/.test(adGroupId)) {
    return res.status(400).json({ error: 'adGroupId must be numeric' });
  }

  const showPaused = includePaused === '1' || includePaused === 'true';

  res.setHeader('Cache-Control', 'no-store');

  try {
    const token = await getAccessToken();

    // ── Ad Groups ──────────────────────────────────────────────────────────
    if (campaignId && view === 'adGroups') {
      const agStatusFilter = showPaused
        ? `ad_group.status IN ('ENABLED', 'PAUSED')`
        : `ad_group.status = 'ENABLED'`;

      const [listData, metricsData] = await Promise.all([
        gaqlSearch(token, accountId, `
          SELECT
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group.type,
            ad_group.cpc_bid_micros
          FROM ad_group
          WHERE campaign.id = ${campaignId}
          ORDER BY ad_group.name
          LIMIT 500
        `),
        gaqlSearch(token, accountId, `
          SELECT
            ad_group.id,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.average_cpc
          FROM ad_group
          WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
            AND campaign.id = ${campaignId}
            AND ${agStatusFilter}
          LIMIT 500
        `).catch(() => ({ results: [] })),
      ]);

      const metricsById = {};
      for (const r of (metricsData.results || [])) {
        const id = String(r.adGroup?.id || '');
        if (!id) continue;
        metricsById[id] = {
          impressions: Number(r.metrics?.impressions || 0),
          clicks:      Number(r.metrics?.clicks      || 0),
          costMicros:  Number(r.metrics?.costMicros  || 0),
          conversions: Number(r.metrics?.conversions || 0),
          avgCpcMicros: Number(r.metrics?.averageCpc  || 0),
        };
      }

      const adGroups = (listData.results || []).map(r => ({
        id:          String(r.adGroup?.id || ''),
        name:        r.adGroup?.name || '',
        status:      r.adGroup?.status || 'UNKNOWN',
        type:        r.adGroup?.type || '',
        bidMicros:   Number(r.adGroup?.cpcBidMicros || 0),
        metrics:     metricsById[String(r.adGroup?.id || '')] || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, avgCpcMicros: 0 },
      }));

      adGroups.sort((a, b) => b.metrics.impressions - a.metrics.impressions);
      return res.status(200).json({ adGroups });
    }

    // ── Ads for a specific ad group ────────────────────────────────────────
    if (campaignId && adGroupId && view === 'ads') {
      const adStatusFilter = showPaused
        ? `ad_group_ad.status IN ('ENABLED', 'PAUSED')`
        : `ad_group_ad.status = 'ENABLED'`;

      const [listData, metricsData] = await Promise.all([
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_ad.ad.id,
            ad_group_ad.ad.name,
            ad_group_ad.ad.type,
            ad_group_ad.ad.final_urls,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.expanded_text_ad.headline_part1,
            ad_group_ad.ad.expanded_text_ad.headline_part2,
            ad_group_ad.ad.expanded_text_ad.headline_part3,
            ad_group_ad.ad.expanded_text_ad.description,
            ad_group_ad.ad.expanded_text_ad.description2,
            ad_group_ad.status,
            ad_group_ad.policy_summary.approval_status,
            ad_group.name
          FROM ad_group_ad
          WHERE campaign.id = ${campaignId}
            AND ad_group.id = ${adGroupId}
            AND ${adStatusFilter}
          ORDER BY ad_group_ad.ad.id
          LIMIT 500
        `),
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_ad.ad.id,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.average_cpc
          FROM ad_group_ad
          WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
            AND campaign.id = ${campaignId}
            AND ad_group.id = ${adGroupId}
            AND ${adStatusFilter}
          LIMIT 500
        `).catch(() => ({ results: [] })),
      ]);

      const metricsById = {};
      for (const r of (metricsData.results || [])) {
        const id = String(r.adGroupAd?.ad?.id || '');
        if (!id) continue;
        metricsById[id] = {
          impressions:  Number(r.metrics?.impressions || 0),
          clicks:       Number(r.metrics?.clicks      || 0),
          costMicros:   Number(r.metrics?.costMicros  || 0),
          conversions:  Number(r.metrics?.conversions || 0),
          avgCpcMicros: Number(r.metrics?.averageCpc  || 0),
        };
      }

      const ads = (listData.results || []).map(r => {
        const id  = String(r.adGroupAd?.ad?.id || '');
        const ad  = r.adGroupAd?.ad || {};
        const rsa = ad.responsiveSearchAd || null;
        const eta = ad.expandedTextAd || null;

        // Build a human-readable summary of ad content
        let headlines = [];
        let descriptions = [];
        if (rsa) {
          headlines    = (rsa.headlines    || []).map(h => h.text || '').filter(Boolean);
          descriptions = (rsa.descriptions || []).map(d => d.text || '').filter(Boolean);
        } else if (eta) {
          headlines    = [eta.headlinePart1, eta.headlinePart2, eta.headlinePart3].filter(Boolean);
          descriptions = [eta.description, eta.description2].filter(Boolean);
        }

        return {
          id,
          name:           ad.name || '',
          type:           ad.type || '',
          finalUrl:       (ad.finalUrls || [])[0] || '',
          adGroupName:    r.adGroup?.name || '',
          status:         r.adGroupAd?.status || 'UNKNOWN',
          approvalStatus: r.adGroupAd?.policySummary?.approvalStatus || '',
          headlines,
          descriptions,
          metrics:        metricsById[id] || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, avgCpcMicros: 0 },
        };
      });

      ads.sort((a, b) => b.metrics.impressions - a.metrics.impressions);
      console.log(`[ads-campaigns] adGroup=${adGroupId} returning=${ads.length} ads`);
      return res.status(200).json({ ads });
    }

    // ── Keywords ──────────────────────────────────────────────────────────
    if (campaignId && view === 'keywords') {
      const kwStatusFilter = showPaused
        ? `ad_group_criterion.status IN ('ENABLED', 'PAUSED')`
        : `ad_group_criterion.status = 'ENABLED'`;

      const [listData, metricsData] = await Promise.all([
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type,
            ad_group_criterion.status,
            ad_group_criterion.quality_info.quality_score,
            ad_group_criterion.quality_info.search_predicted_ctr,
            ad_group_criterion.quality_info.creative_quality_score,
            ad_group_criterion.quality_info.post_click_quality_score,
            ad_group_criterion.cpc_bid_micros,
            ad_group.name,
            ad_group.id
          FROM keyword_view
          WHERE campaign.id = ${campaignId}
            AND ${kwStatusFilter}
          ORDER BY ad_group_criterion.keyword.text
          LIMIT 1000
        `),
        gaqlSearch(token, accountId, `
          SELECT
            ad_group_criterion.criterion_id,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.average_cpc,
            metrics.search_impression_share,
            metrics.search_top_impression_share
          FROM keyword_view
          WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
            AND campaign.id = ${campaignId}
            AND ${kwStatusFilter}
          LIMIT 1000
        `).catch(() => ({ results: [] })),
      ]);

      const metricsById = {};
      for (const r of (metricsData.results || [])) {
        const id = String(r.adGroupCriterion?.criterionId || '');
        if (!id) continue;
        metricsById[id] = {
          impressions:          Number(r.metrics?.impressions || 0),
          clicks:               Number(r.metrics?.clicks      || 0),
          costMicros:           Number(r.metrics?.costMicros  || 0),
          conversions:          Number(r.metrics?.conversions || 0),
          avgCpcMicros:         Number(r.metrics?.averageCpc  || 0),
          searchImprShare:      r.metrics?.searchImpressionShare ?? null,
          searchTopImprShare:   r.metrics?.searchTopImpressionShare ?? null,
        };
      }

      const keywords = (listData.results || []).map(r => {
        const id = String(r.adGroupCriterion?.criterionId || '');
        const qi = r.adGroupCriterion?.qualityInfo || {};
        return {
          id,
          text:          r.adGroupCriterion?.keyword?.text || '',
          matchType:     r.adGroupCriterion?.keyword?.matchType || '',
          status:        r.adGroupCriterion?.status || 'UNKNOWN',
          qualityScore:  qi.qualityScore ?? null,
          predictedCtr:  qi.searchPredictedCtr || '',
          adRelevance:   qi.creativeQualityScore || '',
          landingPage:   qi.postClickQualityScore || '',
          bidMicros:     Number(r.adGroupCriterion?.cpcBidMicros || 0),
          adGroupId:     String(r.adGroup?.id || ''),
          adGroupName:   r.adGroup?.name || '',
          metrics:       metricsById[id] || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, avgCpcMicros: 0, searchImprShare: null, searchTopImprShare: null },
        };
      });

      keywords.sort((a, b) => b.metrics.impressions - a.metrics.impressions);
      return res.status(200).json({ keywords });
    }

    // ── Search Terms ──────────────────────────────────────────────────────
    if (campaignId && view === 'searchTerms') {
      const data = await gaqlSearch(token, accountId, `
        SELECT
          search_term_view.search_term,
          search_term_view.status,
          ad_group.name,
          ad_group.id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.average_cpc
        FROM search_term_view
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
          AND campaign.id = ${campaignId}
        ORDER BY metrics.impressions DESC
        LIMIT 1000
      `).catch(() => ({ results: [] }));

      const searchTerms = (data.results || []).map(r => ({
        term:                 r.searchTermView?.searchTerm || '',
        status:               r.searchTermView?.status || '',
        adGroupId:            String(r.adGroup?.id || ''),
        adGroupName:          r.adGroup?.name || '',
        campaignResourceName: `customers/${accountId}/campaigns/${campaignId}`,
        impressions:   Number(r.metrics?.impressions || 0),
        clicks:        Number(r.metrics?.clicks      || 0),
        costMicros:    Number(r.metrics?.costMicros  || 0),
        conversions:   Number(r.metrics?.conversions || 0),
        avgCpcMicros:  Number(r.metrics?.averageCpc  || 0),
      }));

      return res.status(200).json({ searchTerms });
    }

    // ── Keyword QS Summary (all campaigns, no metrics) ─────────────────────
    if (!campaignId && view === 'keywordQSSummary') {
      const kwStatusFilter = showPaused
        ? `ad_group_criterion.status IN ('ENABLED', 'PAUSED')`
        : `ad_group_criterion.status = 'ENABLED'`;

      const data = await gaqlSearch(token, accountId, `
        SELECT
          campaign.id,
          ad_group_criterion.criterion_id,
          ad_group_criterion.quality_info.quality_score
        FROM keyword_view
        WHERE ${kwStatusFilter}
        LIMIT 10000
      `).catch(() => ({ results: [] }));

      // Group QS scores by campaign, compute avg
      const byCampaign = {};
      for (const r of (data.results || [])) {
        const cid = String(r.campaign?.id || '');
        const qs  = r.adGroupCriterion?.qualityInfo?.qualityScore;
        if (!cid || qs == null) continue;
        if (!byCampaign[cid]) byCampaign[cid] = { sum: 0, count: 0 };
        byCampaign[cid].sum   += Number(qs);
        byCampaign[cid].count += 1;
      }

      const summary = {};
      for (const [cid, { sum, count }] of Object.entries(byCampaign)) {
        summary[cid] = parseFloat((sum / count).toFixed(2));
      }

      return res.status(200).json({ summary });
    }

    // ── Campaigns list ──────────────────────────────────────────────────────
    const statusFilter = showPaused
      ? `campaign.status IN ('ENABLED', 'PAUSED')`
      : `campaign.status = 'ENABLED'`;

    const [listData, metricsData] = await Promise.all([
      gaqlSearch(token, accountId, `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.bidding_strategy_type
        FROM campaign
        ORDER BY campaign.name
        LIMIT 500
      `),
      gaqlSearch(token, accountId, `
        SELECT
          campaign.id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.average_cpc,
          metrics.search_impression_share,
          metrics.search_top_impression_share,
          metrics.search_budget_lost_impression_share,
          metrics.search_rank_lost_impression_share
        FROM campaign
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
          AND ${statusFilter}
        LIMIT 500
      `).catch(() => ({ results: [] })),
    ]);

    const statusCounts = {};
    for (const r of (listData.results || [])) {
      const s = r.campaign?.status || 'UNKNOWN';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    console.log(`[ads-campaigns] account=${accountId} raw_list=${listData.results?.length ?? 0} statuses=${JSON.stringify(statusCounts)} metricsRows=${metricsData.results?.length ?? 0}`);

    const metricsById = {};
    for (const r of (metricsData.results || [])) {
      const id = String(r.campaign?.id || '');
      if (!id) continue;
      metricsById[id] = {
        impressions:        Number(r.metrics?.impressions || 0),
        clicks:             Number(r.metrics?.clicks      || 0),
        costMicros:         Number(r.metrics?.costMicros  || 0),
        conversions:        Number(r.metrics?.conversions || 0),
        avgCpcMicros:       Number(r.metrics?.averageCpc  || 0),
        searchImprShare:       r.metrics?.searchImpressionShare ?? null,
        searchTopImprShare:    r.metrics?.searchTopImpressionShare ?? null,
        budgetLostImprShare:   r.metrics?.searchBudgetLostImpressionShare ?? null,
        rankLostImprShare:     r.metrics?.searchRankLostImpressionShare ?? null,
      };
    }

    const campaigns = (listData.results || []).map(r => {
      const id = String(r.campaign?.id || '');
      return {
        id,
        name:           r.campaign?.name || `Campaign ${id}`,
        status:         r.campaign?.status || 'UNKNOWN',
        channelType:    r.campaign?.advertisingChannelType || '',
        biddingStrategy: r.campaign?.biddingStrategyType || '',
        metrics:        metricsById[id] || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0, avgCpcMicros: 0, searchImprShare: null, searchTopImprShare: null, budgetLostImprShare: null, rankLostImprShare: null },
      };
    });

    campaigns.sort((a, b) => b.metrics.impressions - a.metrics.impressions);
    return res.status(200).json({ campaigns });
  } catch (e) {
    console.error('[ads-campaigns]', e);
    return res.status(500).json({ error: e?.message || 'Failed to fetch data' });
  }
}
