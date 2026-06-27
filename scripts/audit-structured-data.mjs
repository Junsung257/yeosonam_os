#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const outputJson = args.includes('--json');

const roots = ['src/app', 'src/components', 'src/lib'];
const productTypePattern = /['"]@type['"]\s*:\s*['"]Product['"]/g;
const descriptionPattern = /\bdescription\s*:/;
const maxLookaheadChars = 2500;

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(path, files);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function inspectFile(path) {
  const text = readFileSync(path, 'utf8');
  const matches = [...text.matchAll(productTypePattern)];
  const failures = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const index = match.index ?? 0;
    const nextIndex = matches[i + 1]?.index ?? text.length;
    const end = Math.min(index + maxLookaheadChars, nextIndex);
    const snippet = text.slice(index, end);

    if (!descriptionPattern.test(snippet)) {
      failures.push({
        file: relative(process.cwd(), path).replace(/\\/g, '/'),
        line: lineNumber(text, index),
      });
    }
  }

  return {
    products: matches.length,
    failures,
  };
}

const files = roots.flatMap((root) => walk(root));
const summaries = files.map((file) => ({ file, ...inspectFile(file) }));
const scannedProducts = summaries.reduce((sum, item) => sum + item.products, 0);
const failures = summaries.flatMap((item) => item.failures);

if (outputJson) {
  console.log(JSON.stringify({ ok: failures.length === 0, scannedProducts, failures }, null, 2));
} else if (failures.length === 0) {
  console.log(`[structured-data] Product JSON-LD description check passed (${scannedProducts} Product nodes).`);
} else {
  console.error('[structured-data] Product JSON-LD nodes must include description:');
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line}`);
  }
}

if (failures.length > 0) process.exit(1);
