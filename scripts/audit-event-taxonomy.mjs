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

const root = process.cwd();
const taxonomyPath = 'docs/analytics-event-taxonomy.md';
const taxonomy = readFileSync(taxonomyPath, 'utf8');

const trackedFiles = [
  'src/lib/tracker.ts',
  'src/app/concierge/page.tsx',
  'src/app/m/guide/[token]/GuideTimeline.tsx',
  'src/app/api/tracking/route.ts',
  'src/app/api/tracking/recommendation/route.ts',
  'src/app/api/tracking/guidebook/route.ts',
  'src/components/ProductCard.tsx',
  'src/components/customer/PackageCard.tsx',
  'src/components/customer/RecommendationCard.tsx',
  'src/app/packages/[id]/DetailClient.tsx',
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

const allowedOperationalTrackingEvents = new Set(['view', 'click', 'inquiry', 'booking']);
const allowedRecommendationOutcomes = new Set(['click', 'inquiry', 'booking', 'cancelled']);
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

  return events;
}

const missingDocs = requiredCurrentEvents.filter((eventName) => !documented(eventName));
const discovered = trackedFiles.flatMap(extractEvents);

const unknown = discovered.filter((event) => {
  if (knownDynamicPatterns.some((pattern) => pattern.test(event.value))) return false;
  if (allowedOperationalTrackingEvents.has(event.value)) return false;
  if (allowedRecommendationOutcomes.has(event.value)) return false;
  return !documented(event.value);
});

for (const eventName of requiredCurrentEvents) {
  const label = documented(eventName) ? 'PASS' : 'FAIL';
  console.log(`${label}  taxonomy  ${eventName}`);
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

console.log(`\n[event-taxonomy] ${requiredCurrentEvents.length} required events documented; ${discovered.length} code references checked.`);
