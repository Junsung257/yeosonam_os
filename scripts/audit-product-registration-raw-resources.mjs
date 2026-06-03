#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const defaultRoots = [
  'src/lib/parser/fixtures',
  'src/lib/product-registration-golden-fixtures.ts',
  'db/_archive',
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex/attachments'),
];

const fileNamePattern = /sample|raw|input|fixture|baekdu|dad|nha|huang|toyama|bohol|pasted-text|product-registration/i;
const textExtPattern = /\.(txt|md|json|ts|tsx|js|mjs)$/i;

const priceWords = /\uC131\uC778|\uC544\uB3D9|\uC18C\uC544|\uC694\uAE08|\uD310\uB9E4\uAC00|\uC0C1\uD488\uAC00/;
const flightWords = /\uCD9C\uBC1C\uD3B8|\uADC0\uAD6D\uD3B8|\uD56D\uACF5/;
const dayWords = /\d+\s*\uC77C\uCC28|\uC81C\s*\d+\s*\uC77C|1\uC77C\uCC28/;
const noticeWords = /REMARK|\uBE44\uACE0|\uACF5\uC9C0|\uC5EC\uAD8C|\uCDE8\uC18C|\uC2F1\uAE00|\uB8F8|\uD301|\uD328\uB110\uD2F0|\uC804\uC790\uB2F4\uBC30|\uC77C\uC815\uBCC0\uACBD|\uC720\uC758/;
const tableWords = /\uCD9C\uBC1C\uC77C[\s\S]{0,80}\uC131\uC778/;
const webChromeWords = /\uC608\uC57D\s*\uBB38\uC758|\uACE0\uAC1D\s*\uD6C4\uAE30|Open-Meteo|Naver\s*DataLab|A4\s*\uBCF4\uAE30|\uBAA8\uBC14\uC77C\s*LP/;
const nonProductWords = /PLEASE\s+IMPLEMENT|Implementation\s+Plan|AGENTS\.md|CURRENT_STATUS|CLAUDE\.md|\/goal/i;
const hangulPattern = /[\u3131-\u318E\uAC00-\uD7A3]/g;
const hanjaPattern = /[\u3400-\u4DBF\u4E00-\u9FFF]/g;
const replacementPattern = /\uFFFD/g;
const questionRunPattern = /\?{2,}|[占�]{1,}/g;

function walk(target, out = []) {
  if (!target || !fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (textExtPattern.test(target) && fileNamePattern.test(target)) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    walk(path.join(target, entry.name), out);
  }
  return out;
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function classify(text) {
  const hangul = countMatches(text, hangulPattern);
  const hanja = countMatches(text, hanjaPattern);
  const replacements = countMatches(text, replacementPattern);
  const questionRuns = countMatches(text, questionRunPattern);
  const encodingCorrupted =
    replacements >= 3 ||
    questionRuns >= 12 ||
    (hanja >= 80 && hangul < 80 && hanja / Math.max(1, hangul + hanja) >= 0.45);

  const features = {
    hasPrice: /[0-9,]+\s*(?:\uC6D0|KRW|\$|USD)/.test(text) || priceWords.test(text),
    hasFlight: /[A-Z0-9]{2}\s*\d{2,4}|BX|LJ|7C|PR|ZE|TW|KE|OZ/.test(text) || flightWords.test(text),
    hasDays: /DAY\s*\d+/i.test(text) || dayWords.test(text),
    hasNotice: noticeWords.test(text),
    hasTable: /\|/.test(text) || /\t/.test(text) || tableWords.test(text),
  };
  const productSignals = Object.values(features).filter(Boolean).length;

  const issues = [];
  if (encodingCorrupted) issues.push('encoding_corrupted');
  if (webChromeWords.test(text)) issues.push('web_page_copy');
  if (nonProductWords.test(text)) issues.push('non_product_prompt');
  if (text.length >= 500 && productSignals <= 1 && issues.length === 0) issues.push('weak_product_source');

  return { hangul, hanja, replacements, questionRuns, productSignals, features, issues };
}

function auditFile(file) {
  const buffer = fs.readFileSync(file);
  const text = buffer.toString('utf8');
  const result = classify(text);
  return {
    file: path.relative(repoRoot, file).replaceAll('\\', '/'),
    bytes: buffer.length,
    chars: text.length,
    sha1: createHash('sha1').update(buffer).digest('hex').slice(0, 10),
    ...result,
  };
}

const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultRoots;
const files = [...new Set(roots.flatMap(root => walk(path.resolve(repoRoot, root))))];
const rows = files.map(auditFile).sort((a, b) => b.bytes - a.bytes);
const summary = {
  scannedAt: new Date().toISOString(),
  totalFiles: rows.length,
  blockedLike: rows.filter(row => row.issues.some(issue => issue !== 'weak_product_source')).length,
  weakSource: rows.filter(row => row.issues.includes('weak_product_source')).length,
  featureCoverage: {
    price: rows.filter(row => row.features.hasPrice).length,
    flight: rows.filter(row => row.features.hasFlight).length,
    days: rows.filter(row => row.features.hasDays).length,
    notice: rows.filter(row => row.features.hasNotice).length,
    table: rows.filter(row => row.features.hasTable).length,
  },
};

console.log(JSON.stringify({ summary, rows }, null, 2));
