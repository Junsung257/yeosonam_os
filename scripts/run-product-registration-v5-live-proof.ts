#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

import { buildPublicPackageSnapshot } from '@/lib/package-publication/public-snapshot';
import { persistProductRegistrationV5ProofRun } from '@/lib/product-registration-v4/proof';

function arg(name: string): string | null {
  const value = process.argv.slice(2).find(item => item.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function loadEnvironment(): void {
  if (process.env.LIVE_ENV_FILE) dotenv.config({ path: process.env.LIVE_ENV_FILE, override: false });
  dotenv.config({ path: '.env.local', override: false });
  dotenv.config({ path: '.env', override: false });
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function main(): Promise<void> {
  loadEnvironment();
  const packageId = arg('--package-id');
  const revisionId = arg('--revision-id');
  const baseUrl = (arg('--base') || 'http://127.0.0.1:3100').replace(/\/+$/, '');
  if (!packageId || !revisionId) throw new Error('PACKAGE_AND_REVISION_REQUIRED');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_ADMIN_ENV_REQUIRED');
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: packageRow, error: packageError } = await supabase
    .from('travel_packages')
    .select('*')
    .eq('id', packageId)
    .single();
  if (packageError || !packageRow) throw new Error(packageError?.message || 'PACKAGE_NOT_FOUND');

  const { data: revision, error: revisionError } = await supabase
    .from('product_registration_v5_revisions')
    .select('id,payload_hash,status')
    .eq('id', revisionId)
    .single();
  if (revisionError || !revision) throw new Error(revisionError?.message || 'REVISION_NOT_FOUND');

  const { snapshot, snapshotHash } = buildPublicPackageSnapshot(packageRow as Record<string, unknown>);
  const shadowRendererBuild = process.env.VERCEL_GIT_COMMIT_SHA || 'local-v5-shadow';
  const shadowSnapshot = {
    package_id: packageId,
    package_revision: Number((packageRow as { package_revision?: unknown }).package_revision ?? 1),
    snapshot_hash: snapshotHash,
    snapshot_json: snapshot,
    card_projection: snapshot.card_projection,
    lp_projection: snapshot.lp_projection,
    route_text_dump: snapshot.route_text_dump,
    source_raw_text_hash: (packageRow as { raw_text_hash?: string | null }).raw_text_hash ?? null,
    parser_revision: 'local-v5-shadow',
    audit_revision: null,
    mobile_proof_revision: null,
    app_build_id: shadowRendererBuild,
    status: 'blocked',
    canonical_revision_id: revisionId,
    renderer_build_id: shadowRendererBuild,
    locale: 'ko-KR',
    projection_hashes: {},
  };

  const { data: existingSnapshot, error: existingSnapshotError } = await supabase
    .from('public_package_snapshots')
    .select('id,snapshot_hash,canonical_revision_id,status')
    .eq('package_id', packageId)
    .eq('snapshot_hash', snapshotHash)
    .maybeSingle();
  if (existingSnapshotError) throw new Error(existingSnapshotError.message);

  let snapshotId = String(existingSnapshot?.id ?? '');
  if (!snapshotId) {
    const { data: insertedSnapshot, error: insertSnapshotError } = await supabase
      .from('public_package_snapshots')
      .insert(shadowSnapshot)
      .select('id')
      .single();
    if (insertSnapshotError || !insertedSnapshot) throw new Error(insertSnapshotError?.message || 'SHADOW_SNAPSHOT_INSERT_FAILED');
    snapshotId = String(insertedSnapshot.id);
  } else if (existingSnapshot?.canonical_revision_id !== revisionId || existingSnapshot.status !== 'blocked') {
    throw new Error('EXISTING_SNAPSHOT_NOT_SHADOW_SAFE');
  }

  const proofSecret = process.env.REVALIDATE_SECRET || process.env.ADMIN_API_TOKEN;
  if (!proofSecret) throw new Error('RENDER_PROOF_SECRET_REQUIRED');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({
    'x-yeosonam-render-proof': proofSecret,
    'Cache-Control': 'no-cache',
  });

  const surfaces: Array<Record<string, unknown>> = [];
  for (const surface of ['packages', 'lp'] as const) {
    const route = `/${surface}/${packageId}`;
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
    await page.waitForTimeout(1200);
    const html = await page.content().catch(() => '');
    const body = await page.locator('body').innerText().catch(() => '');
    const normalized = text(body);
    const checks = [
      { name: 'http_200', ok: (response?.status() ?? null) === 200, detail: String(response?.status() ?? 'no-response') },
      { name: 'not_error', ok: !/Application error|Internal Server Error|client-side exception|server-side exception/i.test(`${html} ${normalized}`) },
      { name: 'not_not_found', ok: !/not found|404|Package not found|상품을 찾을 수 없습니다/i.test(normalized) },
      { name: 'price_marker', ok: /\d{1,3}(?:,\d{3})+/.test(normalized) || /가격|판매가|출발일/.test(normalized) },
      { name: 'itinerary_marker', ok: /DAY\s*1|여행 일정|상세 일정|일정/.test(normalized) },
      { name: 'readable_text', ok: !/\?{2,}/.test(normalized) },
    ];
    surfaces.push({
      surface,
      route,
      http_status: response?.status() ?? null,
      status: checks.every(check => check.ok) ? 'pass' : 'fail',
      checks,
      screen_hash: sha256(html),
      customer_visible_hash: sha256(normalized),
      body_preview: normalized.slice(0, 300),
    });
  }
  await browser.close();

  const overallStatus = surfaces.every(surface => surface.status === 'pass') ? 'passed' : 'failed';
  const checkedAt = new Date().toISOString();
  const proofRows: Array<Record<string, unknown>> = [];
  for (const surface of surfaces) {
    const persisted = await persistProductRegistrationV5ProofRun({
      supabase,
      proof: {
        packageId,
        revisionId,
        publicSnapshotId: snapshotId,
        snapshotHash,
        rendererBuildId: shadowRendererBuild,
        proofSuiteVersion: 'v5-live-shadow-mobile-v1',
        route: String(surface.route),
        viewport: { width: 390, height: 844 },
        locale: 'ko-KR',
        deviceProfile: 'mobile-shadow',
        status: overallStatus === 'passed' && surface.status === 'pass' ? 'passed' : 'failed',
        result: surface,
        screenshotHash: typeof surface.screen_hash === 'string' ? surface.screen_hash : null,
        checkedAt,
      },
    });
    proofRows.push({ route: surface.route, ...persisted });
  }

  console.log(JSON.stringify({
    mode: 'operational-shadow-quarantine',
    customerPublicationAttempted: false,
    packageId,
    revisionId,
    revisionStatus: revision.status,
    publicSnapshot: { id: snapshotId, hash: snapshotHash, status: 'blocked', canonicalRevisionId: revisionId },
    proofStatus: overallStatus,
    surfaces,
    proofRows,
  }, null, 2));
}

void main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
