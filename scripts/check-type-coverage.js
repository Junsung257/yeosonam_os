#!/usr/bin/env node

/**
 * Type Coverage Checker
 * Scans src/ for `any` type usage and reports coverage percentage
 * Fails if coverage drops below threshold (90%)
 */

const fs = require('fs');
const path = require('path');

// 현 baseline 84%. 점진적으로 끌어올릴 때까지 ratchet — 신규 PR 이 baseline 아래로 떨어뜨리지 못하게.
const THRESHOLD = 80;
const SRC_DIR = path.join(__dirname, '../src');

let totalFiles = 0;
let filesWithAny = 0;
const problematicFiles = [];

function walkDir(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules') {
        walkDir(fullPath);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      totalFiles++;
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check for various `any` patterns
      const anyPatterns = [
        /:\s*any\b/g,           // : any
        /as\s+any\b/g,          // as any
        /any\s*\[/g,            // any[
        /:\s*any\s*[,=;)]/g,    // : any followed by punctuation
      ];

      const hasAny = anyPatterns.some(pattern => pattern.test(content));

      if (hasAny) {
        filesWithAny++;
        problematicFiles.push({
          file: fullPath.replace(SRC_DIR, 'src'),
          anyCount: (content.match(/:\s*any\b|as\s+any\b/g) || []).length
        });
      }
    }
  });
}

console.log('🔍 Scanning for `any` type usage...\n');
walkDir(SRC_DIR);

const coverage = Math.round(((totalFiles - filesWithAny) / totalFiles) * 100);

console.log(`Total TypeScript files: ${totalFiles}`);
console.log(`Files with \`any\`: ${filesWithAny}`);
console.log(`Type coverage: ${coverage}%\n`);

if (problematicFiles.length > 0) {
  console.log('⚠️  Files with `any` type:');
  problematicFiles
    .sort((a, b) => b.anyCount - a.anyCount)
    .slice(0, 10)
    .forEach(({ file, anyCount }) => {
      console.log(`   ${file} (${anyCount} occurrences)`);
    });

  if (problematicFiles.length > 10) {
    console.log(`   ... and ${problematicFiles.length - 10} more files`);
  }
  console.log();
}

if (coverage < THRESHOLD) {
  console.error(`❌ Type coverage ${coverage}% is below threshold ${THRESHOLD}%`);
  process.exit(1);
} else {
  console.log(`✅ Type coverage ${coverage}% meets threshold ${THRESHOLD}%`);
  process.exit(0);
}
