# Google Ads API Tool - Design Documentation

## Yeosonam (여소남) Marketing Automation Platform

### 1. Overview

Yeosonam is a B2B2C travel SaaS platform (https://yeosonam.com) that connects land operators to travel agencies and end customers in Korea. The Google Ads API integration is part of our marketing automation pipeline that automatically creates, manages, and optimizes keyword advertising campaigns for travel products.

### 2. System Architecture

```
[Marketing Orchestrator]
        |
        ├── Keyword Brain (keyword-brain.ts)
        │   ├── Keyword extraction & classification
        │   ├── Micro-keyword generation (core/mid/longtail/negative)
        │   └── Bid strategy calculator
        │
        ├── Ad Publisher (ad-publish-agent.ts)
        │   ├── Campaign creation
        │   ├── Ad group & ad copy generation
        │   └── Budget & bid management
        │
        ├── Meta API (meta-api.ts)
        │   └── Facebook/Instagram ad management
        │
        ├── Google Ads API (search-ads-api.ts)
        │   ├── Campaign CRUD operations
        │   ├── Keyword management
        │   ├── Bid optimization
        │   └── Performance reporting
        │
        └── Naver SearchAd API (search-ads-api.ts)
            └── Naver keyword ad management
```

### 3. Google Ads API Integration Design

#### 3.1 Authentication Flow
- OAuth 2.0 with service account
- Developer token authentication
- Manager account (MCC: 313-217-4750) as parent for client accounts

#### 3.2 Key Features

| Feature | Description | API Endpoints Used |
|---------|-------------|-------------------|
| Campaign Management | Create/search/update campaigns | `CampaignService` |
| Ad Group Management | Create/manage ad groups with themed keywords | `AdGroupService` |
| Keyword Management | Add/update/bid on keywords at granular level | `AdGroupCriterionService` |
| Bid Optimization | Micro-keyword bidding strategy with data-driven adjustments | `BiddingStrategyService` |
| Performance Reporting | Daily/weekly performance data collection | `GoogleAdsService.search()` |
| Budget Management | Campaign budget allocation and tracking | `CampaignBudgetService` |

#### 3.3 Micro-Keyword Bidding Strategy

Our core innovation is granular keyword bidding:

1. **Keyword Classification Pipeline**
   - Extract keywords from travel product data
   - Classify into: Core, Mid, Long-tail, Negative
   - Generate micro-variations (location + product + intent combinations)

2. **Bid Strategy**
   - Start with low CP bids for all micro-keywords
   - Collect 7-14 days of performance data
   - Apply automated bid adjustments based on CTR, conversion rate, ROAS
   - Gradually increase bids for high-performing keywords
   - Pause or lower bids for underperforming keywords

3. **Data Collection & Optimization Loop**
   ```
   Day 1-7: Low bid data collection phase
   Day 8-14: Initial optimization (bid adjustments)
   Day 15+: Continuous optimization based on accumulated data
   ```

#### 3.4 Campaign Types Supported
- **Search Campaigns**: Primary focus for keyword advertising
- Automated ad copy generation from travel product data
- Responsive search ads with multiple headlines/descriptions

### 4. Data Flow

```
[Travel Product DB] → [Keyword Brain] → [Ad Publisher]
                                           ↓
                              [Google Ads API Service]
                                           ↓
                              [Campaign Creation]
                              [Keyword Addition]
                              [Bid Management]
                              [Performance Tracking]
                                           ↓
                              [Analytics Dashboard]
```

### 5. Error Handling & Retry Logic

- Exponential backoff for API rate limits
- Graceful degradation: if Google Ads API fails, fall back to manual campaign management
- Logging all API interactions for audit and debugging
- Circuit breaker pattern for repeated failures

### 6. Security & Compliance

- OAuth 2.0 tokens stored encrypted in secret registry
- API keys managed through environment variables
- All API calls logged with request/response for audit
- Compliance with Google Ads API Terms & Conditions

### 7. Technology Stack

- **Runtime**: Node.js / Next.js (App Router)
- **Language**: TypeScript
- **Google Ads API Client Library**: `google-ads-api` npm package (v21+)
- **OAuth**: Google OAuth 2.0 with refresh token rotation
- **Database**: Supabase (PostgreSQL) for campaign data storage
- **Secret Management**: Encrypted secret registry module

---

*Document version 1.0 - May 2026*
