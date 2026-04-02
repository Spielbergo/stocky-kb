# Application Design Documentation
## Google Ads API Access Application — Yopie KB

**Prepared for:** Google Ads API Basic Access Application  
**Application Date:** April 2026  
**Document Version:** 1.0

---

## 1. Application Overview

**Application Name:** Yopie KB  
**Application Type:** Private internal business intelligence tool  
**Deployment:** Vercel (Next.js serverless deployment)  
**Primary Purpose:** AI-powered knowledge base and analytics platform for marketing professionals

Yopie KB is a multi-profile web application that allows business users to:
- Ask AI-driven questions against their own uploaded knowledge base document
- **Manage and analyze Google Ads campaign performance data**

The Google Ads profile is one of four data profiles in the application (alongside Stocks, Social Media, and Google Ads Best Practices), each serving a distinct analytical use case for the same internal business user.

---

## 2. Why Google Ads API Access Is Needed

The application currently supports **manual CSV import** of Google Ads data (campaigns, impressions, clicks, cost, conversions). This was built as a stopgap while API access was being sought.

The Google Ads API integration is needed to:

1. **Automate data sync** — eliminate the manual export-then-import cycle that currently requires users to download a CSV from the Google Ads UI and re-upload it to the tool every time they want fresh data
2. **Enable real-time campaign analysis** — allow the AI assistant to answer questions about live campaign performance rather than stale exported data
3. **Support account-level visibility** — fetch all campaigns and accounts accessible under the manager account without requiring the user to export each one individually

The integration is **read-only**. No write operations (creating, modifying, or pausing campaigns) are required or will be implemented.

---

## 3. Technical Architecture

### 3.1 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Next.js 16 |
| Backend | Next.js API Routes (serverless, Node.js) |
| Database | Google Firebase Firestore |
| AI Engine | Google Gemini 2.5 Flash |
| Deployment | Vercel |

### 3.2 Application Pages

| Page | Purpose |
|---|---|
| `/` | AI chat interface (per-profile) |
| `/admin` | Knowledge base management (PDF upload) |
| `/ads-accounts` | Google Ads accounts dashboard (sync + CSV import) |

### 3.3 Google Ads API Integration

**File:** `pages/api/ads-accounts.js`

This is the **sole server-side file** that communicates with the Google Ads API. All API calls happen server-side in a Next.js serverless function — credentials are never exposed to the browser.

- **GET** `/api/ads-accounts` — Returns cached data from Firestore. No Google API call made.
- **POST** `/api/ads-accounts` — User-triggered sync that fetches fresh data from Google Ads API, stores in Firestore, and returns to the client.

### 3.4 Authentication Method

The application uses **Service Account authentication** with the JWT Bearer grant (RFC 7523):

1. A service account with Google Ads scope is configured in Google Cloud
2. The server constructs a signed JWT using the service account's RSA private key
3. The JWT is exchanged for a short-lived OAuth2 access token at `https://oauth2.googleapis.com/token`
4. The access token is used for the duration of a single sync request — never persisted

Credentials stored as environment variables on Vercel

### 3.5 Google Ads API Usage

| Property | Value |
|---|---|
| API Version | v19 |
| Endpoint | `googleads.googleapis.com/{version}/customers/{id}/googleAds:searchStream` |
| Request type | Read-only GAQL (`SELECT` only) |
| Data fetched | Account name, currency, campaign name/status/budget |
| Write operations | **None** |
| Call frequency | On-demand only (user-triggered button click) |
| Result caching | Firestore (prevents redundant API calls) |