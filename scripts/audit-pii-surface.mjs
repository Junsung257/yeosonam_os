#!/usr/bin/env node

/**
 * Static discovery audit for PII-sensitive code surfaces.
 *
 * Default mode is informational and exits 0 because this repo legitimately
 * handles bookings, payments, passports, and support messages. Use --strict to
 * fail on high-risk matches in logging/tracking/AI-learning surfaces.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const strict = process.argv.includes('--strict');
const root = process.cwd();
const scanRoots = ['src/app', 'src/components', 'src/lib'];
const excludedDirs = new Set(['.next', 'node_modules', 'coverage', 'dist', 'build']);
const allowedExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const testFilePattern = /(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i;

const terms = [
  { label: 'phone', regex: /\b(phone|tel|contact_phone|customer_phone|traveler_phone)\b/i, className: 'direct-contact' },
  { label: 'email', regex: /\b(email|customer_email|traveler_email)\b/i, className: 'direct-contact' },
  { label: 'passport', regex: /\b(passport|passport_no|passport_number)\b/i, className: 'identity-document' },
  { label: 'birth', regex: /\b(birth|birthday|birth_date|dob)\b/i, className: 'identity-document' },
  { label: 'account', regex: /\b(account_number|bank_account|depositor|payer_name|payment_key|billing_key)\b/i, className: 'payment-bank' },
  { label: 'name', regex: /\b(customer_name|traveler_name|legal_name|korean_name|english_name)\b/i, className: 'identity-contact' },
  { label: 'raw-text', regex: /\b(raw_text|raw_payload|transcript|chat_history|message_body|ocr_text)\b/i, className: 'free-form-private' },
  { label: 'memo', regex: /\b(memo|internal_note|private_note|staff_note|admin_note)\b/i, className: 'free-form-private' },
  { label: 'social-id', regex: /\b(line_id|wechat_id|telegram_id|kakao_id|kakaotalk_id)\b/i, className: 'direct-contact' },
];

const safeLinePatterns = [
  /maskPhoneForLog\(/,
  /maskPhone\(/,
  /maskEmailForLog\(/,
  /maskEmail\(/,
  /redactNameForLog\(/,
  /safeTranscript/,
  /SensitiveRawText/,
  /sanitizeWebhookPayload\(/,
  /sanitizeDbError\(/,
  /safeRawTextExcerpt\(/,
  /rawTextHash\(/,
  /raw_text:\s*_rawText/,
  /privacyScopedInput\(/,
  /scopedInput/,
  /sha256\(/,
  /actionSource\??:/,
  /content_type\??:/,
  /CHANNELS = new Set/,
  /channel === 'phone'/,
];

function extname(path) {
  const match = path.match(/(\.[^.\\/]+)$/);
  return match ? match[1] : '';
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (excludedDirs.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (allowedExt.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function classifySurface(filePath, line) {
  const rel = relative(root, filePath);
  const isConsole = /\bconsole\.(log|warn|error)\b/i.test(line);
  const isRawPayload = /\b(raw_payload|raw_text|extracted_text|transcript|chat_history|message_body|ocr_text)\b/i.test(line);
  const isExplicitLearning = /[\\/]platform-learning[\\/]|[\\/]learning[\\/]/i.test(rel);
  const isApiOrAdmin = /src[\\/]app[\\/](admin|api)/i.test(rel);

  if (isConsole || isRawPayload || isExplicitLearning) return 'high';
  if (/src[\\/]app[\\/]admin|src[\\/]app[\\/]api/i.test(rel)) return 'medium';
  if (/[\\/]jarvis[\\/]|[\\/]qa[\\/]|[\\/]tracking[\\/]|meta-conversion/i.test(rel)) return 'medium';
  if (isApiOrAdmin) return 'medium';
  return 'low';
}

const findings = [];
const strictBlockers = [];
for (const scanRoot of scanRoots) {
  for (const filePath of listFiles(join(root, scanRoot))) {
    const rel = relative(root, filePath);
    if (testFilePattern.test(rel)) continue;
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (safeLinePatterns.some((pattern) => pattern.test(line))) return;
      for (const term of terms) {
        if (!term.regex.test(line)) continue;
        const risk = classifySurface(filePath, line);
        const finding = {
          file: rel,
          line: index + 1,
          term: term.label,
          className: term.className,
          risk,
          preview: line.trim().replace(/\s+/g, ' ').slice(0, 180),
        };
        findings.push(finding);
        const isConsole = /\bconsole\.(log|warn|error)\b/i.test(line);
        const hasDirectValue =
          /\b(params|body|args|input)\.(phone|email|customer_phone|customer_email|passport|passport_no|raw_text|raw_payload|memo)\b/i.test(line)
          || /\$\{(phone|email|name|customerName|customerPhone|passport|memo)\}/i.test(line);
        if (isConsole && hasDirectValue) strictBlockers.push(finding);
      }
    });
  }
}

const counts = findings.reduce((acc, finding) => {
  acc[finding.risk] = (acc[finding.risk] || 0) + 1;
  return acc;
}, {});

console.log('[pii-surface] findings by risk');
console.log(`high=${counts.high || 0} medium=${counts.medium || 0} low=${counts.low || 0} total=${findings.length}`);
console.log(`strict_blockers=${strictBlockers.length}`);

for (const finding of findings.filter((row) => row.risk === 'high').slice(0, 80)) {
  console.log(
    `HIGH  ${finding.term}  ${finding.file}:${finding.line}  ${finding.preview}`,
  );
}

for (const finding of findings.filter((row) => row.risk === 'medium').slice(0, 40)) {
  console.log(
    `MED   ${finding.term}  ${finding.file}:${finding.line}  ${finding.preview}`,
  );
}

if (findings.length > 120) {
  console.log(`INFO  output truncated; ${findings.length - 120} additional low/medium findings hidden`);
}

if (strict && strictBlockers.length > 0) {
  console.error(`\n[pii-surface] strict mode failed: ${strictBlockers.length} unmasked log references need review.`);
  process.exit(1);
}

console.log('\n[pii-surface] discovery audit complete. Review docs/security-pii-role-matrix.md for handling rules.');
