#!/usr/bin/env node

/**
 * Fails when API route handlers touch sensitive free-form or direct-contact
 * fields without an explicit route-level auth guard or a documented public
 * token/webhook exception.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const apiRoot = join(root, 'src', 'app', 'api');

const sensitivePattern =
  /\b(raw_text|raw_payload|raw_extracted_text|passport|passport_no|passport_number|customer_phone|customer_email|traveler_phone|traveler_email|phone|email|memo|internal_memo|bank_account|account_number|transcript|chat_history|ocr_text)\b/i;

const guardPattern =
  /withAdminGuard|requireAdminRequest|isAdminRequest|requireCronBearer|isCronAuthorized|withCronGuard|isCronOrVercelAuthorized|verifySupabaseAccessToken|verifySignature|verify\w*Webhook|validate\w*Token|validate\w*Share|resolve\w*Session|require\w*Auth|auth\.getUser|getUser\(/i;

const publicExceptionPatterns = [
  // Customer entry points intentionally accept contact fields from anonymous
  // users, but should still sanitize logs and persistence separately.
  /^src\/app\/api\/checkout\//,
  /^src\/app\/api\/checkout$/,
  /^src\/app\/api\/concierge\//,
  /^src\/app\/api\/partner-apply$/,
  /^src\/app\/api\/rfq$/,
  /^src\/app\/api\/reviews$/,
  /^src\/app\/api\/packages\/inquiry$/,
  /^src\/app\/api\/voucher$/,
  /^src\/app\/api\/kakao\/ingest$/,
  /^src\/app\/api\/sms\//,
  /^src\/app\/api\/webhooks\//,
  /^src\/app\/api\/tracking$/,
  /^src\/app\/api\/tracking\//,
  /^src\/app\/api\/user-actions$/,
  /^src\/app\/api\/qa\//,
  /^src\/app\/api\/share\//,

  // Tokenized customer/mobile surfaces. These are protected by unguessable
  // route tokens or row-level ownership checks rather than admin auth.
  /^src\/app\/api\/join\/\[token\]$/,
  /^src\/app\/api\/m\/companion\/\[token\]$/,
  /^src\/app\/api\/m\/passport\/\[token\]$/,
  /^src\/app\/api\/settlements\/\[id\]\/pdf$/,
  /^src\/app\/api\/travel-history$/,

  // Tenant/influencer delegated APIs have their own tenant/referral boundary.
  /^src\/app\/api\/tenant\//,
  /^src\/app\/api\/influencer\//,
  /^src\/app\/api\/free-travel\//,
  /^src\/app\/api\/customers\/me\//,

  // Public product creation/intake APIs are gated elsewhere in the request
  // path or intentionally expose only structured customer-safe responses.
  /^src\/app\/api\/packages$/,
  /^src\/app\/api\/packages\/\[id\]\/reviews$/,
  /^src\/app\/api\/products$/,
  /^src\/app\/api\/products\/assemble-free-travel$/,
  /^src\/app\/api\/products\/from-mrt$/,
  /^src\/app\/api\/passport\/ocr$/,
  /^src\/app\/api\/leads$/,
  /^src\/app\/api\/notify\/alimtalk$/,
  /^src\/app\/api\/v1\/voice\/chat$/,

  // Development-only session bootstrap returns 404 in production.
  /^src\/app\/api\/dev\/admin-session$/,
];

function listRouteFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listRouteFiles(full));
    } else if (entry === 'route.ts' || entry === 'route.js') {
      files.push(full);
    }
  }
  return files;
}

function routeId(filePath) {
  return relative(root, filePath)
    .replaceAll(sep, '/')
    .replace(/\/route\.[jt]s$/, '');
}

const violations = [];

for (const filePath of listRouteFiles(apiRoot)) {
  const source = readFileSync(filePath, 'utf8');
  if (!sensitivePattern.test(source)) continue;

  const id = routeId(filePath);
  if (guardPattern.test(source)) continue;
  if (publicExceptionPatterns.some((pattern) => pattern.test(id))) continue;

  const firstSensitiveLine = source
    .split(/\r?\n/)
    .findIndex((line) => sensitivePattern.test(line));
  violations.push({
    route: id,
    line: firstSensitiveLine + 1,
  });
}

if (violations.length > 0) {
  console.error('[sensitive-api-guards] unguarded sensitive API routes found:');
  for (const v of violations) {
    console.error(`- ${v.route}:${v.line}`);
  }
  console.error('\nAdd an explicit guard such as withAdminGuard/requireAdminRequest/requireCronBearer, or document a narrow public exception in this script.');
  process.exit(1);
}

console.log('[sensitive-api-guards] OK - no unguarded sensitive API routes found');
