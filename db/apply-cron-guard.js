#!/usr/bin/env node

/**
 * Apply withCronGuard() to all unauthed cron routes
 */

const fs = require('fs');
const path = require('path');

const CRON_API_DIR = path.join(__dirname, '..', 'src', 'app', 'api', 'cron');

function findCronRoutes() {
  const routes = [];

  function walk(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        walk(fullPath);
      } else if (file.name === 'route.ts') {
        routes.push(fullPath);
      }
    }
  }

  walk(CRON_API_DIR);
  return routes;
}

function processRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Check if already has cron guard
  if (
    content.includes('withCronGuard') ||
    content.includes('requireCronBearer') ||
    content.includes('isCronAuthorized')
  ) {
    return { status: 'skip', reason: 'Already has cron guard' };
  }

  // Check if file has GET/POST/PUT/DELETE exports
  if (!/^export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)/m.test(content)) {
    return { status: 'skip', reason: 'No HTTP method exports' };
  }

  // Add import
  let newContent = content;
  if (!content.includes('from \'@/lib/cron-auth\'') && !content.includes('from "@/lib/cron-auth"')) {
    const lastImportMatch = content.match(/^import\s+.*?from\s+['"].*?['"];?$/gm);
    if (lastImportMatch && lastImportMatch.length > 0) {
      const lastImport = lastImportMatch[lastImportMatch.length - 1];
      const insertPos = content.indexOf(lastImport) + lastImport.length;
      newContent =
        content.slice(0, insertPos) +
        `\nimport { withCronGuard } from '@/lib/cron-auth';` +
        content.slice(insertPos);
    } else {
      newContent = `import { withCronGuard } from '@/lib/cron-auth';\n\n${content}`;
    }
  }

  // Transform handlers
  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  let modified = false;

  for (const method of HTTP_METHODS) {
    // Find: export async function GET(request: NextRequest) {
    const pattern = new RegExp(
      `^(export\\s+)(async\\s+)?function\\s+${method}\\s*\\(([^)]*)\\)\\s*\\{`,
      'gm'
    );

    if (pattern.test(newContent)) {
      newContent = newContent.replace(pattern, (match, exportKw, asyncKw, params) => {
        const handlerName = `${method.toLowerCase()}Handler`;
        return `const ${handlerName} = async (${params}) => {`;
      });
      modified = true;
    }
  }

  if (!modified) {
    return { status: 'skip', reason: 'No transformable patterns found' };
  }

  // Add exports at the end before utility functions
  const lines = newContent.split('\n');
  let insertIndex = lines.length;

  // Find where to insert (before helper functions)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('function ') || line.startsWith('const ') || line === '') {
      insertIndex = i;
    } else {
      break;
    }
  }

  // Add exports for each method
  const exports = [];
  for (const method of HTTP_METHODS) {
    const handlerName = `${method.toLowerCase()}Handler`;
    if (newContent.includes(`const ${handlerName} =`)) {
      exports.push(`export const ${method} = withCronGuard(${handlerName});`);
    }
  }

  if (exports.length > 0) {
    lines.splice(insertIndex, 0, `\n${exports.join('\n')}`);
    newContent = lines.join('\n');
  }

  fs.writeFileSync(filePath, newContent, 'utf-8');
  return { status: 'updated' };
}

// Main
const routes = findCronRoutes();
console.log(`\nApplying withCronGuard to ${routes.length} cron routes...\n`);

const results = { updated: 0, skip: 0, error: 0 };
for (const route of routes) {
  try {
    const result = processRoute(route);
    results[result.status] = (results[result.status] || 0) + 1;
    if (result.status === 'updated') {
      console.log(`✅ UPDATED: ${path.relative(CRON_API_DIR, route)}`);
    }
  } catch (err) {
    results.error++;
    console.log(`❌ ERROR: ${path.relative(CRON_API_DIR, route)} — ${err.message}`);
  }
}

console.log(`\n✅ Updated: ${results.updated}`);
console.log(`⏭️  Skipped: ${results.skip}`);
console.log(`❌ Errors: ${results.error}`);
