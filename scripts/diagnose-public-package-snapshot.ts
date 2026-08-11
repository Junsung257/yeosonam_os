#!/usr/bin/env tsx
import './load-script-env';
import dotenv from 'dotenv';
if (process.env.LIVE_ENV_FILE) dotenv.config({ path: process.env.LIVE_ENV_FILE, override: true });
import { createClient } from '@supabase/supabase-js';
import { fetchLatestPublicPackageSnapshot } from '@/lib/package-publication/repository';
import { loadProductRegistrationV4PublicationGate } from '@/lib/product-registration-v4/publication-gate';
import { evaluateCustomerSurfaceParity } from '@/lib/package-publication/customer-surface-parity';
import { collectItineraryAttractionIds, validateCustomerPublishableAttractionIds } from '@/lib/package-publication/attraction-validation';
import { auditCustomerVisibleScreenText, blockingCustomerVisibleTextIssues } from '@/lib/customer-visible-text-audit';
import { PLATFORM_PRODUCT_REGISTRATION_TENANT_ID } from '@/lib/product-registration-authority/types';

const packageId = process.argv.find(v => v.startsWith('--package-id='))?.slice('--package-id='.length);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
if (!packageId || !supabaseAdmin) throw new Error('PACKAGE_ID_AND_SUPABASE_REQUIRED');

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function safeImage(value: unknown): boolean {
  return typeof value === 'string' && /^(https?:|data:image\/|\/)/i.test(value.trim());
}

async function main(): Promise<void> {
const client = supabaseAdmin;
if (!client || !packageId) throw new Error('PACKAGE_ID_AND_SUPABASE_REQUIRED');
const { data: row, error } = await client
  .from('public_package_snapshots')
  .select('id, package_id, package_revision, canonical_revision_id, snapshot_hash, snapshot_json, card_projection, lp_projection, route_text_dump, status, created_at')
  .eq('package_id', packageId)
  .in('status', ['approved', 'published'])
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (error || !row) throw new Error(error?.message || 'SNAPSHOT_NOT_FOUND');
const snapshot = asRecord((row as any).snapshot_json);
const pkg = asRecord(snapshot.package);
const card = asRecord((row as any).card_projection);
const lp = asRecord((row as any).lp_projection);
const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
const pricesOk = priceDates.length > 0 && priceDates.every((item) => {
  const r = asRecord(item); const date = typeof r.date === 'string' ? r.date.trim() : ''; const price = Number(r.adult_selling_price ?? r.price ?? r.selling_price);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0;
});
const images = Array.isArray(snapshot.images_public) ? snapshot.images_public : [];
const imagesOk = images.some(item => safeImage(item) || safeImage(asRecord(item).url) || safeImage(asRecord(item).src_large) || safeImage(asRecord(item).src_medium)) || safeImage(pkg.hero_image_url) || safeImage(pkg.lp_hero_image_url) || (Array.isArray(pkg.thumbnail_urls) && pkg.thumbnail_urls.some(safeImage));
const parity = evaluateCustomerSurfaceParity({ package: pkg, cardProjection: card, lpProjection: lp });
const routeDump = Array.isArray((row as any).route_text_dump) ? (row as any).route_text_dump.join('\n') : '';
const gate = await loadProductRegistrationV4PublicationGate({ supabase: client, packageId });
const attractionIds = collectItineraryAttractionIds(pkg.itinerary_data);
const attractions = await validateCustomerPublishableAttractionIds(client, attractionIds);
const result = {
  row: { id: (row as any).id, package_revision: (row as any).package_revision, status: (row as any).status, snapshot_hash: (row as any).snapshot_hash },
  package: { id: pkg.id, title: pkg.title, price_dates: priceDates.length, images: images.length, cardTitle: card.title, lpTitle: lp.title },
  checks: {
    pricesOk,
    imagesOk,
    publicTitle: Boolean(String(card.title ?? '').trim() || String(lp.title ?? '').trim()),
    parity,
    copyBlockers: blockingCustomerVisibleTextIssues(pkg),
    routeIssues: auditCustomerVisibleScreenText(routeDump, { surface: 'public_snapshot' }),
    v4Gate: gate,
    attractionIds,
    attractions,
  },
  helper: await fetchLatestPublicPackageSnapshot(client, packageId, {
    tenantId: PLATFORM_PRODUCT_REGISTRATION_TENANT_ID,
    expectedPackageRevision: Number((row as any).package_revision),
  }).then(v => v ? { ok: true, hash: v.row.snapshot_hash } : { ok: false }).catch(e => ({ ok: false, error: String(e) })),
};
console.log(JSON.stringify(result, null, 2));
}

void main();
