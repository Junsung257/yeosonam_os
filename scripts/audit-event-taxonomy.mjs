#!/usr/bin/env node

/**
 * Checks that shipped tracking events are documented in docs/analytics-event-taxonomy.md.
 *
 * This audit is intentionally scoped to customer analytics surfaces. Operational
 * message logs and external webhooks also use `event_type`, but they are separate
 * free-text domains and should not be mixed into customer UX analytics.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has('--json');
const root = process.cwd();
const taxonomyPath = 'docs/analytics-event-taxonomy.md';
const taxonomy = readFileSync(taxonomyPath, 'utf8');
const analyticsEventsPath = 'src/lib/analytics-events.ts';
const analyticsEventsSource = readFileSync(analyticsEventsPath, 'utf8');

const trackedFiles = [
  'src/lib/tracker.ts',
  'src/app/concierge/page.tsx',
  'src/app/group-inquiry/page.tsx',
  'src/app/group/GroupLandingClient.tsx',
  'src/app/packages/PackagesClient.tsx',
  'src/app/packages/[id]/DetailClient.tsx',
  'src/app/admin/AdminPageClient.tsx',
  'src/app/admin/bookings/BookingsPageClient.tsx',
  'src/app/admin/packages/PackagesPageClient.tsx',
  'src/app/admin/payments/PaymentsPageClient.tsx',
  'src/app/m/guide/[token]/GuideTimeline.tsx',
  'src/app/api/tracking/route.ts',
  'src/app/api/tracking/recommendation/route.ts',
  'src/app/api/tracking/guidebook/route.ts',
  'src/components/BlogTracker.tsx',
  'src/components/ChatWidget.tsx',
  'src/components/ProductCard.tsx',
  'src/components/customer/BottomTabBar.tsx',
  'src/components/customer/GlobalNav.tsx',
  'src/components/customer/PackageCard.tsx',
  'src/components/customer/HomeHeroSearchCluster.tsx',
  'src/components/customer/ReviewDigestStrip.tsx',
  'src/components/customer/TrackedKakaoLink.tsx',
  'src/components/customer/RecommendationCard.tsx',
];

const requiredCurrentEvents = [
  'page_view',
  'product_view',
  'cart_added',
  'cart_abandon_exit',
  'checkout_start',
  'page_exit',
  'scroll_25',
  'scroll_50',
  'scroll_75',
  'scroll_90',
  'recommendation_impression',
  'recommendation_click',
  'recommendation_inquiry',
  'recommendation_booking',
  'guide_open',
  'voucher_open',
  'directions_hotel',
  'book_hotel',
  'directions_activity',
  'book_activity',
];

const definedAnalyticsEvents = Array.from(
  analyticsEventsSource.matchAll(/:\s*['"`]([a-z0-9_]+)['"`]/g),
  (match) => match[1],
);
const analyticsEventMap = new Map(
  Array.from(
    analyticsEventsSource.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:\s*['"`]([a-z0-9_]+)['"`]/gm),
    (match) => [match[1], match[2]],
  ),
);
const requiredEvents = Array.from(new Set([...requiredCurrentEvents, ...definedAnalyticsEvents]));
const requiredKpiMarkers = [
  '## UI/UX Masterplan KPI Measurement',
  '`public_cta_click_rate_lift`',
  '`ai_consult_start_rate_lift`',
  '`admin_core_action_click_reduction`',
  '`+20%` relative lift',
  '`+30%` relative lift',
  '`-30%` median click-count reduction',
  'baseline window',
  'comparison window',
  '`task_flow`',
  '`action_stage`',
  '`click_count`',
  '`time_to_complete_ms`',
];

const allowedOperationalTrackingEvents = new Set(['view', 'click', 'inquiry', 'booking']);
const allowedTrackedOutcomes = new Set(['click', 'inquiry', 'booking', 'cancelled', 'rfq_created']);
const knownDynamicPatterns = [/scroll_\$\{depthPct\}/];

function documented(eventName) {
  return taxonomy.includes(`\`${eventName}\``);
}

function extractEvents(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const events = [];

  const patterns = [
    { kind: 'event_type', regex: /event_type\s*:\s*['"`]([^'"`]+)['"`]/g },
    { kind: 'event_type_compare', regex: /body\.event_type\s*===\s*['"`]([^'"`]+)['"`]/g },
    { kind: 'guidebook_action', regex: /trackGuidebook\(\s*['"`]([^'"`]+)['"`]/g },
    { kind: 'recommendation_outcome', regex: /outcome\s*:\s*['"`]([^'"`]+)['"`]/g },
  ];

  if (filePath.includes('api/tracking/guidebook/route.ts')) {
    patterns.push({ kind: 'guidebook_action_set', regex: /^\s*['"`]([^'"`]+)['"`],\s*$/gm });
  }

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(source))) {
      const value = match[1].trim();
      if (!value || value.includes('|') || value.includes('null')) continue;
      events.push({ filePath, kind: pattern.kind, value });
    }
  }

  for (const match of source.matchAll(/ANALYTICS_EVENTS\.([a-zA-Z0-9_]+)/g)) {
    const key = match[1];
    const value = analyticsEventMap.get(key);
    events.push({ filePath, kind: 'analytics_constant', value: value ?? `ANALYTICS_EVENTS.${key}` });
  }

  return events;
}

const missingDocs = requiredEvents.filter((eventName) => !documented(eventName));
const discovered = trackedFiles.flatMap(extractEvents);

const unknown = discovered.filter((event) => {
  if (knownDynamicPatterns.some((pattern) => pattern.test(event.value))) return false;
  if (allowedOperationalTrackingEvents.has(event.value)) return false;
  if (allowedTrackedOutcomes.has(event.value)) return false;
  return !documented(event.value);
});

const checks = [
  ...requiredKpiMarkers.map((marker) => ({
    id: `kpi-contract:${marker}`,
    name: `KPI contract marker ${marker}`,
    status: taxonomy.includes(marker) ? 'pass' : 'fail',
    source: taxonomyPath,
  })),
  ...requiredEvents.map((eventName) => ({
    id: `taxonomy:${eventName}`,
    name: `taxonomy ${eventName}`,
    status: documented(eventName) ? 'pass' : 'fail',
  })),
  ...definedAnalyticsEvents.map((eventName) => ({
    id: `canonical:${eventName}`,
    name: `canonical ${eventName}`,
    status: documented(eventName) ? 'pass' : 'fail',
    source: analyticsEventsPath,
  })),
  ...discovered.map((event) => {
    const failed = unknown.includes(event);
    return {
      id: `code:${event.value}:${relative(root, event.filePath)}`,
      name: `${event.kind} ${event.value}`,
      status: failed ? 'fail' : 'pass',
      source: relative(root, event.filePath),
    };
  }),
];
const failedChecks = checks.filter((check) => check.status !== 'pass');
const report = {
  status: failedChecks.length > 0 ? 'fail' : 'pass',
  passed: checks.length - failedChecks.length,
  blocked: 0,
  failed: failedChecks.length,
  total: checks.length,
  requiredEvents: requiredEvents.length,
  canonicalEvents: definedAnalyticsEvents.length,
  codeReferences: discovered.length,
  checks,
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
  if (failedChecks.length > 0) process.exit(1);
  process.exit(0);
}

for (const eventName of requiredEvents) {
  const label = documented(eventName) ? 'PASS' : 'FAIL';
  console.log(`${label}  taxonomy  ${eventName}`);
}

for (const eventName of definedAnalyticsEvents) {
  const label = documented(eventName) ? 'PASS' : 'FAIL';
  console.log(`${label}  canonical  ${eventName}  ${analyticsEventsPath}`);
}

for (const event of discovered) {
  const status = unknown.includes(event) ? 'FAIL' : 'PASS';
  console.log(
    `${status}  code  ${event.value}  ${event.kind}  ${relative(root, event.filePath)}`,
  );
}

if (missingDocs.length > 0 || unknown.length > 0) {
  if (missingDocs.length > 0) {
    console.error(`\nMissing taxonomy rows: ${missingDocs.join(', ')}`);
  }
  if (unknown.length > 0) {
    console.error(
      `Unknown tracked events: ${unknown.map((event) => `${event.value} (${event.filePath})`).join(', ')}`,
    );
  }
  process.exit(1);
}

console.log(`\n[event-taxonomy] ${requiredEvents.length} required events documented; ${definedAnalyticsEvents.length} canonical analytics events checked; ${discovered.length} code references checked.`);
