#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import './load-script-env';

import { supabaseAdmin } from '@/lib/supabase';
import {
  customerCopyQualityIssues,
  normalizeCustomerVisibleCopy,
} from '@/lib/customer-copy-quality';
import { auditCustomerVisibleProductText } from '@/lib/customer-visible-text-audit';
import { repairCustomerVisibleCopyPayload } from '@/lib/product-registration/customer-visible-copy-repair';

type StatusScope = 'all' | 'openable' | 'active' | 'non-archived';

type Options = {
  json: boolean;
  applySafeFixes: boolean;
  markBlocked: boolean;
  outputDir: string;
  scope: StatusScope;
  limit: number;
};

type TravelPackageRow = {
  id: string;
  title: string | null;
  display_title: string | null;
  hero_tagline: string | null;
  product_summary: string | null;
  destination: string | null;
  trip_style: string | null;
  airline: string | null;
  departure_airport: string | null;
  departure_days: unknown;
  status: string | null;
  audit_status: string | null;
  audit_report: Record<string, unknown> | null;
  internal_code: string | null;
  short_code: string | null;
  price_dates: unknown;
  price_tiers: unknown;
  itinerary_data: unknown;
  inclusions: unknown;
  excludes: unknown;
  surcharges: unknown;
  optional_tours: unknown;
  accommodations: unknown;
  notices_parsed: unknown;
  customer_notes: string | null;
  products?: { internal_code?: string | null; display_name?: string | null; departure_region?: string | null } | Array<{ internal_code?: string | null; display_name?: string | null; departure_region?: string | null }> | null;
};

type ProductPriceRow = {
  product_id: string | null;
  target_date: string | null;
  adult_selling_price: number | null;
  note: string | null;
};

type TextIssue = {
  package_id: string;
  internal_code: string | null;
  status: string | null;
  audit_status: string | null;
  field_path: string;
  code: string;
  detail: string;
  value: string;
  normalized_value: string;
  safe_fixable: boolean;
};

const CUSTOMER_TEXT_FIELDS = [
  'title',
  'display_title',
  'hero_tagline',
  'product_summary',
  'destination',
  'trip_style',
  'airline',
  'departure_airport',
  'departure_days',
  'price_dates',
  'price_tiers',
  'itinerary_data',
  'inclusions',
  'excludes',
  'surcharges',
  'optional_tours',
  'accommodations',
  'notices_parsed',
  'customer_notes',
  'products',
] as const;

const SAFE_TOP_LEVEL_FIELDS = new Set([
  'title',
  'display_title',
  'hero_tagline',
  'product_summary',
  'destination',
  'trip_style',
  'airline',
  'departure_airport',
  'customer_notes',
]);

function parseOptions(args: string[]): Options {
  const scopeArg = args.find(arg => arg.startsWith('--scope='))?.split('=')[1] as StatusScope | undefined;
  const limitArg = Number(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? '5000');
  return {
    json: args.includes('--json'),
    applySafeFixes: args.includes('--apply-safe-fixes'),
    markBlocked: args.includes('--mark-blocked'),
    outputDir: args.find(arg => arg.startsWith('--output-dir='))?.split('=')[1] ?? 'data/product-registration/customer-text-audit',
    scope: scopeArg && ['all', 'openable', 'active', 'non-archived'].includes(scopeArg) ? scopeArg : 'all',
    limit: Number.isFinite(limitArg) && limitArg > 0 ? Math.min(Math.floor(limitArg), 10_000) : 5000,
  };
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function isOpenableStatus(status: string | null): boolean {
  return ['active', 'approved', 'selling', 'available'].includes(String(status ?? ''));
}

function isNonArchivedStatus(status: string | null): boolean {
  return !['archived', 'inactive', 'INACTIVE', 'rejected', 'expired'].includes(String(status ?? ''));
}

function shouldIncludeRow(row: TravelPackageRow, scope: StatusScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'openable' || scope === 'active') return isOpenableStatus(row.status);
  if (scope === 'non-archived') return isNonArchivedStatus(row.status);
  return true;
}

function isSafeFixableIssue(value: string, normalized: string, codes: string[]): boolean {
  if (value === normalized) return false;
  if (codes.some(code => (
    code === 'placeholder_or_mojibake'
    || code === 'internal_source_copy'
    || code === 'customer_forbidden_internal_terms'
  ))) return false;
  return true;
}

function isInternalFallbackValue(value: string): boolean {
  return /일정에서 소개되는 관광 포인트|자동 생성 설명|사진은 정확한 자료|원문 일정에는|고객 화면에서.*원문 표현/.test(value);
}

function walkCustomerStrings(value: unknown, pathParts: string[], visit: (fieldPath: string, value: string) => void) {
  if (typeof value === 'string') {
    visit(pathParts.join('.'), value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkCustomerStrings(item, [...pathParts, String(index)], visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'raw_text' || key === 'net_price' || key === 'cost_price' || key === 'margin_rate') continue;
    walkCustomerStrings(item, [...pathParts, key], visit);
  }
}

async function loadPackages(options: Options): Promise<TravelPackageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select(`
      id,title,display_title,hero_tagline,product_summary,destination,trip_style,airline,departure_airport,departure_days,
      status,audit_status,audit_report,internal_code,short_code,price_dates,price_tiers,itinerary_data,inclusions,excludes,surcharges,
      optional_tours,accommodations,notices_parsed,customer_notes,
      products(internal_code,display_name,departure_region)
    `)
    .order('created_at', { ascending: false })
    .limit(options.limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as TravelPackageRow[]).filter(row => shouldIncludeRow(row, options.scope));
}

async function loadProductPriceRows(packageRows: TravelPackageRow[]): Promise<Map<string, ProductPriceRow[]>> {
  const codes = Array.from(new Set(packageRows.map(row => row.internal_code).filter((code): code is string => Boolean(code))));
  const byCode = new Map<string, ProductPriceRow[]>();
  if (codes.length === 0) return byCode;

  for (let index = 0; index < codes.length; index += 200) {
    const chunk = codes.slice(index, index + 200);
    const { data, error } = await supabaseAdmin
      .from('product_prices')
      .select('product_id,target_date,adult_selling_price,note')
      .in('product_id', chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as ProductPriceRow[]) {
      const code = row.product_id;
      if (!code) continue;
      const rows = byCode.get(code) ?? [];
      rows.push(row);
      byCode.set(code, rows);
    }
  }

  return byCode;
}

function auditPackage(row: TravelPackageRow, priceRows: ProductPriceRow[]): TextIssue[] {
  return auditCustomerVisibleProductText({ ...row, product_prices: priceRows }).map(issue => ({
    package_id: row.id,
    internal_code: row.internal_code,
    status: row.status,
    audit_status: row.audit_status,
    field_path: issue.fieldPath,
    code: issue.code,
    detail: issue.detail,
    value: issue.value,
    normalized_value: issue.normalizedValue,
    safe_fixable: issue.safeFixable,
  }));
}

function safelyRepairCustomerValue(value: unknown, pathParts: string[]): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const issues = customerCopyQualityIssues(value);
    if (issues.length === 0) return { value, changed: false };
    const codes = issues.map(issue => issue.code);
    const normalized = normalizeCustomerVisibleCopy(value);
    const fieldName = pathParts.at(-1) ?? '';
    if (codes.includes('internal_source_copy') && fieldName === 'attraction_note' && isInternalFallbackValue(value)) {
      return { value: null, changed: true };
    }
    if (isSafeFixableIssue(value, normalized, codes)) {
      return { value: normalized, changed: normalized !== value };
    }
    return { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item, index) => {
      const repaired = safelyRepairCustomerValue(item, [...pathParts, String(index)]);
      changed = changed || repaired.changed;
      return repaired.value;
    });
    return changed ? { value: next, changed } : { value, changed: false };
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const repaired = safelyRepairCustomerValue(item, [...pathParts, key]);
      next[key] = repaired.value;
      changed = changed || repaired.changed;
    }
    return changed ? { value: next, changed } : { value, changed: false };
  }

  return { value, changed: false };
}

function buildSafePatchLegacy(row: TravelPackageRow, issues: TextIssue[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const issuePaths = new Set(issues.map(issue => issue.field_path));
  for (const field of SAFE_TOP_LEVEL_FIELDS) {
    if (!issuePaths.has(field)) continue;
    const current = row[field as keyof TravelPackageRow];
    if (typeof current !== 'string') continue;
    let normalized = normalizeCustomerVisibleCopy(current);
    if (
      field === 'display_title'
      && /\s[-–—|/]\s*$/.test(current)
      && typeof row.title === 'string'
      && !/\s[-–—|/]\s*$/.test(row.title)
    ) {
      normalized = normalizeCustomerVisibleCopy(row.title);
    }
    if (normalized && normalized !== current) patch[field] = normalized;
  }
  for (const field of CUSTOMER_TEXT_FIELDS) {
    if (field === 'products') continue;
    if (SAFE_TOP_LEVEL_FIELDS.has(field)) continue;
    if (!issues.some(issue => issue.field_path === field || issue.field_path.startsWith(`${field}.`))) continue;
    const repaired = safelyRepairCustomerValue(row[field], [field]);
    if (repaired.changed) patch[field] = repaired.value;
  }
  return patch;
}

function buildSafePatch(row: TravelPackageRow, issues: TextIssue[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const issuePaths = new Set(issues.map(issue => issue.field_path));
  const repairInput: Record<string, unknown> = {};

  for (const field of CUSTOMER_TEXT_FIELDS) {
    if (field === 'products') continue;
    repairInput[field] = row[field as keyof TravelPackageRow];
  }
  const repairResult = repairCustomerVisibleCopyPayload(repairInput);
  const repaired = repairResult.value as Record<string, unknown>;
  const repairChangePaths = new Set(repairResult.changes.map(change => change.fieldPath));

  for (const field of CUSTOMER_TEXT_FIELDS) {
    if (field === 'products') continue;
    const hasIssue = issues.some(issue => issue.field_path === field || issue.field_path.startsWith(`${field}.`));
    const hasRepairChange = [...repairChangePaths].some(path => path === field || path.startsWith(`${field}.`));
    if (!hasIssue && !hasRepairChange) continue;
    const before = row[field as keyof TravelPackageRow];
    const after = repaired[field];
    if (JSON.stringify(after) !== JSON.stringify(before)) patch[field] = after;
  }

  if (
    issuePaths.has('display_title')
    && typeof row.display_title === 'string'
    && /\s[-–—/]\s*$/.test(row.display_title)
    && typeof row.title === 'string'
    && !/\s[-–—/]\s*$/.test(row.title)
  ) {
    const normalized = normalizeCustomerVisibleCopy(row.title);
    if (normalized && normalized !== row.display_title) patch.display_title = normalized;
  }

  return patch;
}

async function applySafeFixes(packageRows: TravelPackageRow[], issuesByPackage: Map<string, TextIssue[]>) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const productUpdates: Array<{ internalCode: string; displayName: string }> = [];
  for (const row of packageRows) {
    const issues = issuesByPackage.get(row.id) ?? [];
    const patch = buildSafePatch(row, issues);
    if (Object.keys(patch).length > 0) updates.push({ id: row.id, patch });
    if (row.internal_code && issues.some(issue => issue.safe_fixable && issue.field_path === 'products.display_name')) {
      const productRows = Array.isArray(row.products) ? row.products : row.products ? [row.products] : [];
      for (const product of productRows) {
        if (product.internal_code !== row.internal_code || typeof product.display_name !== 'string') continue;
        const normalized = normalizeCustomerVisibleCopy(product.display_name);
        if (normalized && normalized !== product.display_name) {
          productUpdates.push({ internalCode: row.internal_code, displayName: normalized });
        }
      }
    }
  }

  for (const update of updates) {
    const { error } = await supabaseAdmin
      .from('travel_packages')
      .update({
        ...update.patch,
        updated_at: new Date().toISOString(),
      })
      .eq('id', update.id);
    if (error) throw new Error(error.message);
  }
  for (const update of productUpdates) {
    const { error } = await supabaseAdmin
      .from('products')
      .update({
        display_name: update.displayName,
        updated_at: new Date().toISOString(),
      })
      .eq('internal_code', update.internalCode);
    if (error) throw new Error(error.message);
  }
  return [
    ...updates,
    ...productUpdates.map(update => ({
      id: `products:${update.internalCode}`,
      patch: { display_name: update.displayName },
    })),
  ];
}

async function markBlockingPackages(
  packageRows: TravelPackageRow[],
  issuesByPackage: Map<string, TextIssue[]>,
) {
  const now = new Date().toISOString();
  const updates: Array<{ id: string; issueCount: number }> = [];
  for (const row of packageRows) {
    const issues = (issuesByPackage.get(row.id) ?? []).filter(issue => !issue.safe_fixable);
    if (issues.length === 0) continue;
    const existing = row.audit_report && typeof row.audit_report === 'object' && !Array.isArray(row.audit_report)
      ? row.audit_report
      : {};
    const { error } = await supabaseAdmin
      .from('travel_packages')
      .update({
        audit_status: 'blocked',
        audit_checked_at: now,
        audit_report: {
          ...existing,
          customer_visible_text_audit: {
            status: 'blocked',
            checked_at: now,
            issue_count: issues.length,
            issues: issues.slice(0, 20).map(issue => ({
              field_path: issue.field_path,
              code: issue.code,
              value: issue.value,
              detail: issue.detail,
            })),
          },
        },
        updated_at: now,
      })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
    updates.push({ id: row.id, issueCount: issues.length });
  }
  return updates;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  ensureDir(options.outputDir);

  const packageRows = await loadPackages(options);
  const productPriceRows = await loadProductPriceRows(packageRows);
  const issues = packageRows.flatMap(row => auditPackage(row, productPriceRows.get(row.internal_code ?? '') ?? []));
  const issuesByPackage = new Map<string, TextIssue[]>();
  for (const issue of issues) {
    const rows = issuesByPackage.get(issue.package_id) ?? [];
    rows.push(issue);
    issuesByPackage.set(issue.package_id, rows);
  }

  const applied = options.applySafeFixes ? await applySafeFixes(packageRows, issuesByPackage) : [];
  const markedBlocked = options.markBlocked ? await markBlockingPackages(packageRows, issuesByPackage) : [];
  const affectedPackages = Array.from(new Set(issues.map(issue => issue.package_id)));
  const byCode = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.code] = (acc[issue.code] ?? 0) + 1;
    return acc;
  }, {});
  const byStatus = issues.reduce<Record<string, number>>((acc, issue) => {
    const key = `${issue.status ?? 'null'} / ${issue.audit_status ?? 'null'}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const blockingPackageIds = Array.from(new Set(
    issues
      .filter(issue => !issue.safe_fixable)
      .map(issue => issue.package_id),
  ));

  const report = {
    generated_at: new Date().toISOString(),
    scope: options.scope,
    scanned_packages: packageRows.length,
    affected_packages: affectedPackages.length,
    blocking_packages: blockingPackageIds.length,
    safe_fixable_issues: issues.filter(issue => issue.safe_fixable).length,
    applied_safe_fixes: applied.length,
    marked_blocked: markedBlocked.length,
    by_code: byCode,
    by_status: byStatus,
    samples: issues.slice(0, 100),
    issues,
    applied,
    marked_blocked_packages: markedBlocked,
  };

  const reportPath = path.join(options.outputDir, `customer-visible-text-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  if (options.json) {
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  } else {
    console.log(JSON.stringify({
      reportPath,
      scanned_packages: report.scanned_packages,
      affected_packages: report.affected_packages,
      blocking_packages: report.blocking_packages,
      safe_fixable_issues: report.safe_fixable_issues,
      applied_safe_fixes: report.applied_safe_fixes,
      marked_blocked: report.marked_blocked,
      by_code: report.by_code,
      by_status: report.by_status,
    }, null, 2));
  }

  if (blockingPackageIds.some(id => {
    const row = packageRows.find(pkg => pkg.id === id);
    return row && isOpenableStatus(row.status);
  })) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
