import './load-script-env';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type ReadResult = { rows: Row[]; error: string | null };

const PAGE_SIZE = 1_000;
const PLATFORM_TENANT = '00000000-0000-0000-0000-000000000001';
const strict = process.argv.includes('--strict');
const json = process.argv.includes('--json');

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function tenant(value: unknown): string {
  return text(value) || PLATFORM_TENANT;
}

async function readAll(
  client: SupabaseClient,
  table: string,
  columns: string,
): Promise<ReadResult> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error: `${table}:${error.message}` };
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, error: null };
  }
}

async function readWithFallback(
  client: SupabaseClient,
  table: string,
  columns: string,
  fallbackColumns: string,
): Promise<ReadResult & { schemaGap: string | null }> {
  const primary = await readAll(client, table, columns);
  if (!primary.error) return { ...primary, schemaGap: null };
  const fallback = await readAll(client, table, fallbackColumns);
  return {
    ...fallback,
    schemaGap: fallback.error ? null : primary.error,
  };
}

function groupBy(rows: Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return groups;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SECRET_DEFAULT_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_ADMIN_UNAVAILABLE');
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [products, packages, sources, jobs, revisions, snapshots, pointers] = await Promise.all([
    readAll(supabaseAdmin, 'products', 'internal_code,tenant_id'),
    readAll(supabaseAdmin, 'travel_packages', 'id,internal_code,tenant_id,status,publication_state'),
    readAll(supabaseAdmin, 'product_source_documents', 'id,tenant_id'),
    readWithFallback(supabaseAdmin, 'upload_jobs', 'id,tenant_id,source_document_id', 'id,source_document_id'),
    readAll(supabaseAdmin, 'product_registration_v5_revisions', 'id,tenant_id,package_id,source_document_id,status'),
    readWithFallback(
      supabaseAdmin,
      'public_package_snapshots',
      'id,tenant_id,package_id,canonical_revision_id,status',
      'id,package_id,canonical_revision_id,status',
    ),
    readAll(supabaseAdmin, 'product_registration_v5_publication_pointers', 'tenant_id,package_id,current_revision_id,current_snapshot_id,state'),
  ]);

  const readErrors = [products, packages, sources, jobs, revisions, snapshots, pointers]
    .map(result => result.error)
    .filter((value): value is string => Boolean(value));
  const schemaGaps = [jobs.schemaGap, snapshots.schemaGap]
    .filter((value): value is string => Boolean(value));
  const packageById = new Map(packages.rows.map(row => [text(row.id), row]));
  const sourceById = new Map(sources.rows.map(row => [text(row.id), row]));
  const revisionById = new Map(revisions.rows.map(row => [text(row.id), row]));
  const snapshotById = new Map(snapshots.rows.map(row => [text(row.id), row]));
  const packagesByCode = groupBy(packages.rows, row => text(row.internal_code));
  const productsByCode = groupBy(products.rows, row => text(row.internal_code));

  const missingProductCodes = products.rows.filter(row => !text(row.internal_code));
  const duplicatePackageCodes = [...packagesByCode.entries()].filter(([, rows]) => rows.length > 1);
  const duplicateProductCodes = [...productsByCode.entries()].filter(([, rows]) => rows.length > 1);
  const crossTenantIdentityMatches = products.rows.filter(product => {
    const matches = packagesByCode.get(text(product.internal_code)) ?? [];
    return matches.length === 1 && tenant(matches[0]?.tenant_id) !== tenant(product.tenant_id);
  });
  const ambiguousProductMatches = products.rows.filter(product => (
    (packagesByCode.get(text(product.internal_code)) ?? []).length > 1
  ));

  const sourceJobTenantMismatches = jobs.rows.filter(job => {
    const sourceId = text(job.source_document_id);
    if (!sourceId) return false;
    const source = sourceById.get(sourceId);
    return !source || tenant(source.tenant_id) !== tenant(job.tenant_id);
  });
  const revisionTenantMismatches = revisions.rows.filter(revision => {
    const packageId = text(revision.package_id);
    const sourceId = text(revision.source_document_id);
    const linkedPackage = packageId ? packageById.get(packageId) : null;
    const linkedSource = sourceId ? sourceById.get(sourceId) : null;
    return (packageId && (!linkedPackage || tenant(linkedPackage.tenant_id) !== tenant(revision.tenant_id)))
      || (sourceId && (!linkedSource || tenant(linkedSource.tenant_id) !== tenant(revision.tenant_id)));
  });
  const snapshotTenantMismatches = snapshots.rows.filter(snapshot => {
    const linkedPackage = packageById.get(text(snapshot.package_id));
    const linkedRevision = revisionById.get(text(snapshot.canonical_revision_id));
    return !linkedPackage
      || tenant(linkedPackage.tenant_id) !== tenant(snapshot.tenant_id)
      || (linkedRevision && tenant(linkedRevision.tenant_id) !== tenant(snapshot.tenant_id));
  });
  const pointerLineageMismatches = pointers.rows.filter(pointer => {
    const linkedPackage = packageById.get(text(pointer.package_id));
    const linkedRevision = revisionById.get(text(pointer.current_revision_id));
    const linkedSnapshot = snapshotById.get(text(pointer.current_snapshot_id));
    if (!linkedPackage) return true;
    if (tenant(linkedPackage.tenant_id) !== tenant(pointer.tenant_id)) return true;
    if (pointer.state !== 'published') return false;
    return !linkedRevision || !linkedSnapshot
      || text(linkedRevision.package_id) !== text(pointer.package_id)
      || text(linkedSnapshot.package_id) !== text(pointer.package_id)
      || text(linkedSnapshot.canonical_revision_id) !== text(pointer.current_revision_id);
  });

  const publishedPointerPackageIds = new Set(pointers.rows
    .filter(row => row.state === 'published')
    .map(row => text(row.package_id)));
  const publicPackagesWithoutPointer = packages.rows.filter(row => {
    const state = text(row.status).toLowerCase();
    const publicationState = text(row.publication_state).toLowerCase();
    return (state === 'active' || publicationState === 'published' || publicationState === 'approved')
      && !publishedPointerPackageIds.has(text(row.id));
  });

  const migrationBlockers = {
    readErrors,
    missingProductInternalCode: missingProductCodes.length,
    duplicateProductInternalCode: duplicateProductCodes.length,
    sourceJobTenantMismatches: sourceJobTenantMismatches.length,
    revisionTenantMismatches: revisionTenantMismatches.length,
    snapshotTenantMismatches: snapshotTenantMismatches.length,
    pointerLineageMismatches: pointerLineageMismatches.length,
  };
  const migrationBlockingCount = readErrors.length
    + missingProductCodes.length
    + duplicateProductCodes.length
    + sourceJobTenantMismatches.length
    + revisionTenantMismatches.length
    + snapshotTenantMismatches.length
    + pointerLineageMismatches.length;
  const report = {
    ok: migrationBlockingCount === 0 && publicPackagesWithoutPointer.length === 0,
    migrationReady: migrationBlockingCount === 0,
    kernelCutoverReady: migrationBlockingCount === 0 && publicPackagesWithoutPointer.length === 0,
    counts: {
      products: products.rows.length,
      travelPackages: packages.rows.length,
      sourceDocuments: sources.rows.length,
      jobs: jobs.rows.length,
      revisions: revisions.rows.length,
      publicSnapshots: snapshots.rows.length,
      publicationPointers: pointers.rows.length,
      productsWithNullTenant: products.rows.filter(row => !text(row.tenant_id)).length,
      packagesWithNullTenant: packages.rows.filter(row => !text(row.tenant_id)).length,
    },
    schemaGaps,
    migrationBlockers,
    cutoverBlockers: {
      publicPackagesWithoutPointer: publicPackagesWithoutPointer.length,
    },
    quarantinedOrReviewable: {
      duplicatePackageInternalCode: duplicatePackageCodes.length,
      ambiguousProductMatches: ambiguousProductMatches.length,
      crossTenantIdentityMatchesSeparatedByMigration: crossTenantIdentityMatches.length,
      sourceDocumentsUsingPlatformTenantBackfill: sources.rows.filter(row => !text(row.tenant_id)).length,
      jobsUsingPlatformTenantBackfill: jobs.rows.filter(row => !text(row.tenant_id)).length,
      unboundRevisions: revisions.rows.filter(row => !text(row.package_id)).length,
    },
  };

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[product-registration-preflight] migrationReady=${report.migrationReady} kernelCutoverReady=${report.kernelCutoverReady}`);
    console.log(`[product-registration-preflight] packages=${report.counts.travelPackages} products=${report.counts.products} revisions=${report.counts.revisions}`);
    console.log(`[product-registration-preflight] migrationBlockers=${migrationBlockingCount} publicWithoutPointer=${publicPackagesWithoutPointer.length}`);
  }
  if (strict && !report.ok) process.exit(1);
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
